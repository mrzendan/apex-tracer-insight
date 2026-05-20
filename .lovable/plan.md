# Что менять в трекинге команд

Изучил `apex-stats/services/analysis/app/core/tracking/` (главное — `simple_arrow_tracker.py`, 988 строк, и `tracking_settings.py` с per-slot HSV/морфологией). Сравнил с нашим `scripts/tracking/modules/track_teams/track_teams.py`.

## Главное архитектурное различие

**У нас сейчас:** на каждом кадре делается одна глобальная HSV-маска по всему кадру для каждой команды → находим все blobs нужного цвета в кадре → переводим в мировые координаты → `WorldTracker` жадно ассоциирует ближайший blob к существующему треку (`gating_world_dist=50`). Один глобальный набор `min_area/max_area/morph_kernel`.

**У них:** на каждый слот — отдельный `SimpleArrowTracker`, который ищет свою плашку **только в локальном ROI вокруг своей последней позиции** (≈3× размера плашки), с per-slot HSV-диапазоном и per-slot морфологией. Никаких глобальных детекций — у каждого слота своя «лупа».

Это объясняет, почему у нас LOW-слоты (2/5/7/10/11) скачут: близкие цвета двух соседних команд дают пересекающиеся маски по всему кадру, а жадная ассоциация по миру выбирает не ту.

## Что взять у них в первую очередь (по приоритету)

### 1. Per-slot локальный трекер вместо глобальной детекции
Завести `SlotTracker` на каждый из 20 слотов с собственным:
- последним world/frame-pixel center,
- HSV-диапазоном,
- `roi_size` (динамический: `max(roi, est_w*2, est_h*3) + roi_expand_px`).

В каждом кадре: вырезаем ROI вокруг последней позиции этого слота → ищем контуры **только этой команды** → выбираем лучшего кандидата. Это убирает межкомандные путаницы в принципе.

### 2. Per-slot конфиг
У них в `tracking_settings.py` каждый из 20 `TEAM_N` имеет свои `hsv_range`, `morph_kernel_size`, `min_area`, `max_area`, `outlier_threshold_ratio`. У нас сейчас один глобальный `detection:` блок. Перенести структуру в наш YAML/в авто-генерацию из `motion_tracks.json` (где anchor_conf=LOW — кернел больше, area-окно шире).

### 3. HSV + LAB маска (с fallback на HSV-only)
```text
mask_hsv = inRange(HSV, lo, hi)
mask_lab = inRange(LAB, lo_lab, hi_lab)   # LAB-диапазон строится из HSV ± запас
mask = mask_hsv AND mask_lab
if countNonZero(mask) < 8: mask = mask_hsv  # fallback
```
LAB лучше держит цвет при изменении яркости/сжатия — заметно меньше «теряний» в красной зоне.

### 4. Подтверждение прыжков (anti-ID-switch)
Если новый кандидат дальше `jump_switch_threshold_px` (≈18) от стабильной точки — не переключаться сразу, держать «pending_center» и подтвердить за N кадров (`switch_confirm_frames=3`). До подтверждения трек стоит на месте, state=`hold`. Это убирает «улетания» к соседним игрокам той же команды.

### 5. Стабилизация позиции с дедзоной + клампом шага
Сейчас у нас Kalman-blend (`k=r/(r+q)`). У них дополнительно:
- `center_deadzone_px=2` — изменения меньше игнорируем,
- `max_center_step_px` — ограничение шага за кадр,
- отдельная стабилизация **правой грани плашки** (`stable_right_x`), потому что стрелка движется и сдвигает геометрический центр.

### 6. Калибровка размера плашки (первые ~10с)
Накапливают bbox'ы → берут 65-й перцентиль ширины/высоты → фиксируют `fixed_bbox_size` и `fixed_tracking_offset`. После этого все детекции «приводятся» к фикс. размеру, точка трекинга — строго под центром фиксированного прямоугольника. Решает дрожание точки из-за стрелки/тени.

### 7. Zone-gating (запретные зоны)
`forbidden_polygons` — полигоны в нормализованных координатах карты, где трекинг считается ложным (HUD, индикатор кольца, иконки в центре карты). У нас в `zones.vod.json` уже есть зоны — переиспользовать с тэгом `forbidden` (или инверсия `team`/`minimap`).

### 8. ROI lock + stall expansion
- После `>15` успешных подряд: `tracking_locked=True`, ROI сжимается до 30% (быстрее, меньше шансов поймать чужую команду).
- При `confidence<0.75` и position не меняется > 5с: `roi_expand_px += 100`, до `max=400` — постепенно расширяем, чтобы поймать команду после потери.
- При потере > 20 кадров: lock снимается.

### 9. Усреднение точек за интервал на выходе
Текущая точка пишется не в каждом кадре, а усредняется по буферу за `averaging_interval=2с` (медиана+среднее). У нас сейчас `frame_step=600` (1 точка/с) и это работает «по совпадению», но при `frame_step=120` без усреднения трек будет дрожать.

### 10. Расширенный JSON-выход
В `tracks.frames[].tracks[]` добавить:
- `state`: `tracked` / `hold` / `low_conf` / `lost` / `switch_wait`,
- `state_reason`: `mask_too_sparse` / `shape_reject` / `zone_gate_N` / `switch_wait_1/3` / `detected` …,
- `mask_mode`: `hsv+lab` / `hsv_only_fallback`,
- `confidence`: float.

В UI (`MatchViewer`) — окрашивать сегмент трейла по `state`/`confidence`, чтобы было видно, где трек неуверен.

### 11. Debug overlays
По образцу `detect_teams.py`: сохранять в `reports/debug_frames/<slot>/f<NNN>.jpg` оверлей (ROI + найденный bbox + state). Это даст возможность смотреть глазами, почему slot_5 ушёл.

### 12. Стратегия выбора кандидата `label_arrow`
Когда в ROI несколько контуров той же команды — у них scoring учитывает «есть ли цветной хвост (стрелка) под плашкой» (`_score_arrow_below`). Для нашего случая (плашка слота + стрелка) это даст приоритет именно плашке игрока, а не отдельной стрелке.

## Что НЕ копировать
- Их `team6_mode_enabled` с 30-сек warmup до начала записи трека — у нас уже есть HIGH/MED/LOW анкер от `motion_detect`, warmup не нужен.
- Их хардкод `MAP_ROI=(420,0,1080,1080)` — у нас регистрация через homography гибче, продолжаем работать в мировых координатах.

## Технический раздел

### Изменения по файлам

- `scripts/tracking/modules/track_teams/track_teams.py`:
  - Новый класс `SlotTracker` (по мотивам `SimpleArrowTracker`, но упрощённый: без `team6_mode`, без observer compensator — у нас гомография уже работает в мире).
  - `WorldTracker.step()` заменить: для каждого слота вызывать `SlotTracker.update(frame_bgr, t)`, который сам делает ROI+маску+выбор. Глобальный `detect_team_blobs` убрать или оставить как fallback при инициализации.
  - В выход добавить `state`, `state_reason`, `mask_mode`.

- `scripts/tracking/modules/track_teams/config.example.yaml`:
  - Добавить блок `per_slot_overrides:` (опционально) для тонкой настройки LOW-слотов.
  - Параметры: `roi_size`, `outlier_threshold_ratio`, `switch_confirm_frames=3`, `jump_switch_threshold_px=18`, `center_deadzone_px=2`, `max_center_step_px=16`, `averaging_interval_sec=2`, `roi_expand_step_px=100`, `max_roi_expand_px=400`.

- `scripts/tracking/modules/track_teams/track_teams.py` (анкеры):
  - `teams_from_anchors`: для LOW slot'ов автоматически расширять HSV (`h_tol=15`, `s_drop=110`, `v_drop=110`), увеличивать `morph_kernel_size=7`, ослаблять `outlier_threshold_ratio=0.10`.

- `scripts/tracking/shared/schema/tracks.schema.json`:
  - Добавить опциональные поля `state`, `state_reason`, `mask_mode` в `track` объект.

- `src/lib/test-game-data.ts`:
  - Прокинуть `state`/`confidence` per-point в `Trajectory`.

- `src/components/MatchViewer.tsx`:
  - Сегменты трейла со `state in {hold, low_conf, switch_wait}` рисовать пунктиром или с пониженной непрозрачностью.

### Порядок работ (можно итерациями, не атомарно)

1. Per-slot SlotTracker + локальный ROI + HSV+LAB маска. Уже это должно решить 70% проблем с LOW-слотами.
2. Подтверждение прыжков + стабилизация правой грани + калибровка bbox.
3. Per-slot конфиг в YAML и автогенерация overrides для LOW-анкеров.
4. Zone-gating через `zones.vod.json`.
5. ROI lock/stall + усреднение точек.
6. Расширенный JSON + цвет трейла в UI + debug-overlays.

После шага 1+2 надо прогнать `eval_id_switches.py` против нового `gt_anchors.json` (тот, что хотели пересобрать из `motion_tracks.json`) и сравнить число id-switches до/после.

## Чего пока не делать
- Не переписывать `WorldTracker` целиком — оставить как обёртку, которая держит slot→SlotTracker и собирает snapshot.
- Не трогать `motion_detect` и `find_cuts` — они дают анкеры/cuts, этого достаточно.
- Не лезть в `apps/api`-аналог: у нас фронт читает `tracks.json` напрямую через `src/data/m-test-g1/`.

Сказать «делай» — начну с пункта 1 (Per-slot SlotTracker), это даст самый заметный эффект на LOW-слотах.
