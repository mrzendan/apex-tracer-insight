
## Контекст и приоритеты

Сейчас держим в работе только Storm Point (`game_sp.mp4` = текущий `game.mp4`). `game_we.mp4`, `game_ed.mp4`, `game_ol.mp4` уезжают в test-set, но трогаем их только когда SP стабилизируется. Это согласуется с твоей просьбой «добить одну карту до идеала».

План разделён на 3 волны. Каждая волна заканчивается прогоном matrix-а и сравнением. На SP считаем «идеалом», когда **все 20 слотов ≥ 95% tracked-кадров** и **HUD-теги совпадают с VOD на 100%**.

---

## Волна 1 — OCR/HUD: чистый алфанумерик и фикс slot→tag

Цель: убрать мусор вида `JDDG`, `EE`, `HH`, `820`, `OBVN`, чтобы карта команд соответствовала VOD-у.

1. **Жёсткий alphanumeric для тегов команд.**
   - В `hud_read.py::parse_field("name", ...)`: уже стоит `[^A-Z0-9 ]` — расширяем до `[^A-Z0-9]` (даже пробел уберём, теги в Apex без пробелов) и обрезаем по длине ≥2 и ≤5.
   - В `ocr(...)` для зон `team/name` форсируем `alnum_only=True` (сейчас, судя по логике, для `name` идёт обычный текст). Это блокирует Tesseract на `-`, `'`, `.`, `«`, `1` вместо `I` и т.п.
   - Добавим **post-snap к словарю известных тегов матча**: рядом с `KNOWN_MAPS` заводим `KNOWN_TEAMS_OVERRIDE: dict[match_id, list[str]]`, читается из `configs/teams.<match>.json`. Для m-test заполним руками по VOD (BB, CINO, SRC, S2, JDG, GMBL, ELITE, STAL, THUG, FREE, OBVN, NIPC, FXI, CRT, DKK, MR, REV, ROC, SRO, TL — что увидим). Levenshtein с `max_dist=1` для теги длиной 2–3 и `max_dist=2` для 4–5. Без override — fallback на текущий путь.
   - **Голосование по кадрам**: тег команды в матче не меняется (`STATIC_TEAM_NAMES`). Сейчас, похоже, берётся «первое стабильное» — заменим на mode по N≥10 первым валидным OCR-чтениям, чтобы единичный мусорный кадр не фиксировался навечно.

2. **Sync to UI: пересобрать `src/data/m-test-g1/slot-to-tag.json` из обновлённого `hud_read/reports/eliminations.json`.** Поправит `HH→BB`, `EE→…`, `820→S2`, `JDG→GMBL`, `JDDG→JDG`, `OBVN/SRC` перепутаны (см. твой комментарий).

3. **Лог OCR-конфликтов.** В `hud_read.py` дополнительно писать `reports/team_tags_raw.json` — для каждого слота: top-3 OCR-кандидата с числом кадров. Это даёт быструю верификацию вручную.

Артефакты Волны 1: обновлённый `eliminations.json`, новый `team_tags_raw.json`, новый `slot-to-tag.json` в UI. Шанс что нужны переноcы зон в `/admin/zones` — отдельный шаг, делаем только если OCR падает из-за обрезки кропа (проверим по `team_tags_raw.json`).

---

## Волна 2 — DA: Hungarian + фикс init-фазы (THUG, STAL, OBVN)

Проблема: команды стартуют в углах карты / сливаются в одну. Это происходит в первые ~60 кадров, когда motion-anchors ещё пусты и DA выбирает первый попавшийся blob нужного hue.

1. **`da.hungarian.yaml`** — копия `da.color_first.yaml` + `assignment.method: hungarian` (scipy теперь есть). В matrix добавим как 2-й после baseline. Ожидаем +1–3% на «pink-red» кластере (slot_5/6/7/8).

2. **Init-якоря из HUD-killfeed/баннера.** В первых 30 секундах матча Apex показывает интро-баннеры (команда + позиция). Сейчас этот сигнал не используется. Минимальный шаг: в `track_teams` ввести `init_warmup_frames: 120` параметр — пока он не пройден, **разрешаем active-state только для слотов с подтверждённым motion-anchor ≥ 5 кадров**. Это убирает призрачные старты в углах карты.

3. **GT-anchors на старт.** В `scripts/tracking/modules/track_teams/assets/gt_anchors.json` есть пустой шаблон. Один раз руками проставим стартовые позиции по VOD на t=0 для всех 20 слотов SP (одна сетка точек). DA получает мощный prior на init-фазе.

4. **Прогон matrix:** baseline / color_first / hybrid / **hungarian** / **hungarian_init_anchors** / detect_first / motion_first. Сравнить через `compare_matrix.py`. Лидера — в UI.

---

## Волна 3 — Сортировка по цвету + per-slot тюнинг

1. **UI: сортировка списка команд по slot color.** Уже сделали базово (sort by slot id). Дополнительно — в `src/components/MatchViewer.tsx` цвет команды брать не из `TEAM_PALETTE`, а из `scripts/tracking/configs/hsv_presets.storm-point.json::hex`. Тогда фишки на карте и плашки в списке = HUD VOD. Слот 1 → `#11758e`, слот 2 → `#1e4262` и т.д. Делается один раз, общий для всех карт (для каждой карты — свой `hsv_presets.<map>.json`).

2. **Per-slot configs — только для проблемных слотов.** Заводим формат `configs/slot_overrides.storm_point.yaml`:
   ```yaml
   defaults: { eps: 0.4, gate_radius_mult: 1.2, color_delta: 5 }
   overrides:
     "10": { color_delta: 3, min_tracked_for_active: 10 }   # тусклый dark-red
     "11": { color_delta: 7, min_tracked_for_active: 8 }    # сливается с фоном
     "5":  { gate_radius_mult: 0.9 }                        # pink-red ban
   ```
   `track_teams.py` мержит override поверх dataclass-конфига на слот. Это и есть твой «индивидуальный паттерн для цвета» — без распиливания на 20 скриптов. Включаем только когда volna 2 покажет, какие слоты остались проблемными.

3. **Финальная метрика SP:** `compare_matrix.py` + ручная сверка 4–6 ключевых таймстампов с VOD (старт, ring2 closing, последний wipe, финал).

---

## Волна 4 — Test-set из других карт (только после идеала на SP)

1. Запустить `find_cuts` + `hud_read` + `motion_detect` + `track_teams` пайплайн на `game_we.mp4`, `game_ed.mp4`, `game_ol.mp4`. Каждая карта получает свой `hsv_presets.<map>.json` (worlds-edge уже есть, e-district и olympus — собрать через `/admin/hsv` от 2–3 кадров каждой).
2. Сверять: совпадают ли «победители» из matrix между картами. Если `hungarian + init_anchors` стабильно top-1 на 3+ картах — фиксируем как default; если конфиги-победители разные → нужен per-map preset (`da.<map>.yaml`).
3. На этом этапе становится понятно, нужны ли per-slot overrides на других картах или достаточно общего конфига.

---

## Что НЕ делаем сейчас

- Per-color отдельные скрипты (20 файлов) — overkill. Используем overrides YAML.
- Менять зоны `/admin/zones` — только если волна 1 покажет, что причина OCR-ошибок в обрезке кропа.
- Трогать `ring_locator` / `motion_detect` — они вне scope этой итерации.

---

## Технические детали (для меня в build-режиме)

**Файлы Волны 1:**
- `scripts/tracking/modules/hud_read/hud_read.py` — правка `parse_field("name")`, форс `alnum_only=True` для зон team/name, добавить `KNOWN_TEAMS_OVERRIDE` + snap, voting по кадрам, дамп `team_tags_raw.json`.
- `scripts/tracking/modules/hud_read/configs/teams.m-test.json` — новый, словарь известных тегов из VOD.
- `src/data/m-test-g1/slot-to-tag.json` — регенерация через `sync_to_ui.py`.

**Файлы Волны 2:**
- `scripts/tracking/modules/track_teams/configs/da.hungarian.yaml` — новый.
- `scripts/tracking/modules/track_teams/configs/da.hungarian_init_anchors.yaml` — новый.
- `scripts/tracking/modules/track_teams/track_teams.py` — `assignment.method: hungarian|greedy`, `init_warmup_frames`, чтение `gt_anchors.json` при старте.
- `scripts/tracking/modules/track_teams/assets/gt_anchors.json` — наполнить вручную.
- `scripts/tracking/modules/track_teams/run_matrix.ps1` — +2 тега.

**Файлы Волны 3:**
- `src/components/MatchViewer.tsx` — цвет команды из `hsv_presets.<map>.json::hex` вместо `TEAM_PALETTE`.
- `src/data/m-test-g1/` — экспорт hex-палитры (новый JSON или поле в slot-to-tag).
- `scripts/tracking/modules/track_teams/configs/slot_overrides.storm_point.yaml` — новый, формат описан выше.
- `track_teams.py` — merge overrides per slot.

**Решение о Hungarian:** scipy установлен → `scipy.optimize.linear_sum_assignment` на матрице стоимостей DA. Замена точечная: одна функция в `track_teams.py`. Greedy остаётся как fallback.

---

## Открытый вопрос (нужен ответ до старта)

Один — остальное укладывается само:

- **Словарь команд m-test:** перечисли актуальные теги команд из VOD (20 шт, как видишь их в HUD-баннерах). Без этого `KNOWN_TEAMS_OVERRIDE` пустой и snap не работает. Можно списком через запятую, привязка к слотам не нужна — slot↔tag разрулит сама OCR + сверка с твоими комментариями (BB не HH, GMBL не JDG, SRC не CINO, S2 не 820 …).
