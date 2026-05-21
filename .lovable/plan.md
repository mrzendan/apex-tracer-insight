
# Рефакторинг track_teams.py: «detect-first → associate»

Прежде чем кодить — фиксируем архитектуру, чтобы не сломать существующий формат `tracks.json` и интеграции (`hud_read`, post-hoc, UI).

## Текущая логика (что меняем)

Сейчас `SlotTracker.update()` вызывается **по очереди для каждого слота**:
- проецирует canonical → frame через `H`, ищет цвет своей команды в ROI вокруг прошлой точки,
- если не нашёл — coast / hold / lost.

Проблема: seed «прилипает» к чужой плашке или HUD-зоне → фантом стоит почти неподвижно, и его не убрать ratio-фильтром, если HUD говорит «жив».

## Новая логика

Каждый кадр:

```text
1. detect_all(frame, H, teams)
     для КАЖДОГО slot'а строим HSV-маску → находим все кандидаты в minimap-ROI
     возвращаем плоский список {slot_hint, frame_px, world_px, area, mask_quality, color_score}

2. associate(candidates, prev_slot_state, anchors, t)
     стоимость = α·color_dist + β·world_dist_to_prediction + γ·shape_penalty
     - Венгерский алгоритм (scipy.optimize.linear_sum_assignment)
     - один кандидат → максимум один slot
     - предсказание = последняя tracked точка + калмановское движение
     - для незаассайненных slot'ов: hold/coast/lost как раньше

3. validate(assignments)
     - motion-gate: если v < min_v И recent_movement_score низкий → low_conf
     - conflict-gate: если два slot'а стабильно в одной точке — оба low_conf, retire худшего
```

Сохраняем без изменений:
- `FrameRegistrar`, homography
- HSV-загрузка из `hsv_presets.storm-point.json`
- `load_anchors` + seed
- HUD eliminations и `hud_alive_slots`
- Формат `tracks.json` (schema_version: 2) и `slot-to-tag`
- Post-hoc retire (как страховка, но с новыми порогами)
- Telemetry: `n_tracked / n_wiped / state_reason / v_peak`

## Что меняется в коде

`scripts/tracking/modules/track_teams/track_teams.py`:

| секция | действие |
|---|---|
| `class SlotTracker` (450–917) | оставляем как **состояние слота** (Kalman, EMA HSV, счётчики), но `update()` больше не ищет — принимает готовый detection |
| `SlotTracker._find_in_roi`, `_recover_global` | удаляем (их работу делает новый detector) |
| **новый** `class FrameDetector` | строит HSV-маски всех 20 команд за один проход на minimap-ROI, возвращает candidates |
| **новый** `def associate_hungarian(...)` | строит cost-матрицу slots×candidates, scipy `linear_sum_assignment` |
| `main()` loop (1259–1388) | вместо цикла `for t in teams: st.update(...)` → `dets = detector.detect(frame, H); assigns = associate(dets, slot_trackers, t_now); for slot, det in assigns: st.accept(det) or st.miss()` |
| post-hoc filter | оставляем, но снижаем порог `min_v_peak_for_alive=1.0 px/s`, retire HUD-alive если `v_peak < 1.0 AND tracked < 30` |

`requirements.txt`: добавить `scipy` (если ещё нет, для `linear_sum_assignment`).

`scripts/tracking/modules/track_teams/configs/`:
- `da.baseline.yaml` — копия текущего конфига (контроль)
- `da.color_first.yaml` — высокий вес color_dist
- `da.motion_first.yaml` — высокий вес world_dist (доверяем калману)
- `da.strict_shape.yaml` — узкий size-gate из `team_profiles.json`
- `da.aggressive_retire.yaml` — низкий порог motion-gate, лёгкая retire

## 5 параллельных тестов

`scripts/tracking/modules/track_teams/run_matrix.ps1` — запускает 5 прогонов на одно видео в отдельные `tracks_<tag>.json` + `run_<tag>.log`. Видео read-only, конфликта нет.

| tag | конфиг | гипотеза проверяет |
|---|---|---|
| `baseline` | текущая логика (без detect-first) | контроль, чтобы знать «стало лучше или хуже» |
| `color_first` | α=2.0 β=0.5 γ=0.3 | помогает ли приоритет цвета на похожих оттенках |
| `motion_first` | α=0.5 β=2.0 γ=0.3 | помогает ли доверие к калману (для slot_4/10 с малым движением) |
| `strict_shape` | size-gate ±20% от `team_profiles` | убирает ли строгая фильтрация по размеру плашки HUD-шум |
| `aggressive_retire` | post-hoc `min_v_peak=2.0, min_tracked=40, ratio<0.30` | сколько ложно-живых слотов уйдёт в retire |

Скрипт после прогонов автоматически печатает сравнительную таблицу:

```
slot    baseline  color  motion  shape  aggro
slot_4    12.6%   34.1%  41.2%   28.0%  retired
slot_9    28.6%   55.0%  60.3%   48.1%  35.0%
...
```

## Что писать в `tracks.json`

Формат не ломаем. В `meta` добавляется поле `da_strategy: "detect_first"`, в каждом snapshot слота — `det_source: "hungarian" | "predicted" | "anchor_recovery"` для диагностики. UI игнорирует неизвестные поля.

## Порядок реализации

1. Добавить `scipy` в `requirements.txt`, проверить импорт.
2. Написать `FrameDetector` + unit-тест на одном кадре (`--debug-frame`).
3. Написать `associate_hungarian` + симуляция: 20 фейковых dets vs 20 slots.
4. Срезать `SlotTracker.update()` до `accept(det) / miss()`, переключить main loop.
5. Прогон baseline + новой версии на коротком окне (60 сек), глазами сверить.
6. Подкрутить пороги, добавить motion-gate в post-hoc.
7. Написать `run_matrix.ps1` + конфиги 5 тестов.
8. Запустить матрицу на полном VOD, прислать тебе сравнительный отчёт.

## Технические заметки

- `scipy.optimize.linear_sum_assignment` — O(n³), для 20×~40 кандидатов это <1мс на кадр.
- Cost ∈ [0, 1]; недопустимые пары (вне ROI / цвет совсем не тот) = `inf` → не ассайнятся.
- При <20 кандидатов часть slot'ов остаётся неассайненной → fallback на старую логику (hold/coast/lost).
- HUD-alive больше не даёт иммунитет от retire; даёт только защиту от **absence-based wipe** (это уже есть).

## Риски

- Сломать формат `tracks.json` → UI перестанет рисовать треки. Mitigation: schema_version=2 не трогаем, новые поля только добавляем.
- Венгерский ассайн может «прыгать» между похожими по цвету командами при близких dets. Mitigation: гистерезис — пред. ассайн получает бонус -0.2 к стоимости.
- 5 тестов прогоняются последовательно (PowerShell foreach), не параллельно — на одной машине параллельный SIFT упрётся в CPU. Уточни: хочешь параллельно (нужно 5×RAM/CPU) или последовательно (≈30 мин × 5 = 2.5ч)?

Подтверди план — начинаю с шага 1.
