# План: улучшение трекинга команд и визуализация на сайте

## 1. Бэкенд-логика трекинга (Python, `scripts/tracking/modules/`)

### 1.1 Интеграция `motion_detect` → `track_teams`
Сейчас `motion_detect` выдаёт `consensus_xy` с conf-уровнем для всех 20 слотов один раз в начале, а `track_teams` стартует «с нуля» из HSV-плашек кадра. Сольём:

- В `track_teams.py` добавить флаг `--anchors <motion_tracks.json>` (и поле `anchors_file` в `config.yaml`).
- На init считывать `consensus_xy` + `conf` для каждой команды; переводить их через зарегистрированную карту минимапа → канонические/мировые координаты (motion-detect работает в координатах ROI minimap, нужна простая аффинка из `zones.vod.json` → canonical, добавить в shared/).
- Каждый слот получает: `world_anchor`, `anchor_conf` (HIGH/MED/LOW), `palette_hsv` (цвет из конфига команд).
- Калман-треки инициализируются от якорей HIGH/MED. LOW-якоря только подсказывают приоритет ассоциации (бонус к gating). MISS — трек создаётся по факту первой детекции.
- В `output.tracks[*]` появляется `slot_id` (1..20) рядом с `team_id` — теперь это идентичность команды на весь матч, а не только цвет.

### 1.2 Детект «команда выбита»
- Новый модуль `scripts/tracking/modules/team_wipe/` или функция внутри `track_teams`:
  - Сейчас трек переходит в `lost` после `max_gap_frames` без детекции.
  - Добавить честный признак `wiped_at_t` per slot: пропадание плашки **и** отсутствие повторного появления цвета в радиусе R мира на интервале > N секунд → команда помечена выбитой; трек закрывается, не «висит» мёртвой точкой.
  - Опционально валидация по `modules/find_cuts/reports/cuts.json` (не считать камера-кат за смерть).
- Расширить `tracks.schema.json`: добавить в `meta` массив `slots[]` (id, color, name, wiped_at_t|null), в `tracks[*]` поле `slot_id`, в `frames[*]` поле `wipes[]` (новые события на этом кадре).

### 1.3 Тесты и метрика ID-switches
- Тесты гоняем на единственном VOD `scripts/tracking/game.mp4` (storm_point, тот же m-test-g1).
- Скрипт `scripts/tracking/modules/track_teams/eval_id_switches.py`:
  - Берёт `tracks.json` + ручной набор «опорных» аннотаций (`assets/gt_anchors.json`: список `{t, slot_id, world_xy}` — ~30 точек, размечаем руками по overlay-кадрам).
  - Для каждого слота считает: сколько раз `team_id` трека, ближайшего к GT-точке, поменялся между соседними GT, % покрытия (track present at GT), медианный px-error.
  - Пишет `reports/eval_id_switches.txt` и `eval_id_switches.json`.
- Цель — снизить ID-switches до 0 на сегментах между POV-катами (текущий baseline померяем первым прогоном).

### 1.4 Документация
Обновить `track_teams/README.md` (раздел про anchors + wipe-детект), `motion_detect/README.md` (формат, который читает track_teams), добавить раздел «Метрика ID-switches и как запускать eval» в `docs/tracking-lab.md`.

## 2. Визуализация на сайте

### 2.1 Данные матча
- Положить эталонный `tracks.json` после улучшенного прогона в `src/data/m-test-g1/tracks.json`.
- В `src/lib/test-game-data.ts` добавить импорт и адаптер: `tracksByTime(t) → Array<{ slotId, teamId, canonical_norm:[x,y], state, wiped }>`.
- Слоты команд (1..20) маппить на текущие `teams` из `defaultTeams` по slot_id (расширить мета mock-команд полем `slotId`).

### 2.2 `/games/m-test-g1` — продакшн-таймлайн
- В `MatchViewer.tsx` заменить `generateTrajectory` для тех команд, по которым есть реальный трек:
  - Реальный сэмпл → точная позиция; между сэмплами линейная интерполяция; в `lost` — pulsing полупрозрачная точка; после `wiped_at_t` — точку не рисуем, в team-list ставим серый/перечёркнутый стиль.
  - Команды без трека (MISS до улучшений) — fallback на текущий mock, помечаются «estimated».
- На Timeline добавить вертикальные маркеры `wipe` (из новых `wipes[]`), цвет = цвет команды; подсказка `slot+name`.
- Никаких отладочных оверлеев на этой странице.

### 2.3 `/admin/tracking-lab` — расширенная отладка
- Toggle-слои поверх карты:
  - «Anchors»: рисуем HIGH/MED/LOW якоря из motion_detect (точки + крестики из overlay).
  - «Confidence»: цвет трека по `state` (alive/low_conf/lost) и по `confidence`.
  - «ID-switch markers»: красные кружки в точках, где `eval_id_switches` зафиксировал переключение.
- Панель метрик: счётчики HIGH/MED/LOW/MISS старта, total ID-switches, per-team coverage; данные читаются из `eval_id_switches.json`, который дропается вместе с `tracks.json`.

## 3. Порядок работ

1. Расширить схему (`tracks.schema.json`) + миграция `track_teams.py` под slot_id/wipes — без логики, только структура.
2. Реализовать чтение motion-якорей и инициализацию треков от них.
3. Добавить wipe-детект + проверка на cuts.json.
4. Прогнать на `game.mp4`, разметить ~30 GT-точек, запустить `eval_id_switches.py`, зафиксировать baseline и улучшения.
5. Адаптер на фронте + интеграция в `/admin/tracking-lab` (быстрее починить и удобнее отлаживать).
6. Подмена mock-траекторий и wipe-маркеров на `/games/m-test-g1`.

## 4. Технические детали

- **Координатная система якорей.** motion_detect работает в пиксельных координатах minimap-ROI; track_teams — в canonical_px/world. Нужен один раз посчитанный 2D-affine `minimap_roi → canonical` (по корнерам ROI, заданным в `zones.vod.json`, и калибровке карты `storm_point.json`). Складываем в `shared/canonical_maps/storm_point.minimap_affine.json`.
- **Slot stability.** Сейчас `team_id` в `tracks.json` = цвет (`red`/`blue`/…). Меняем на slot id (`slot_3`, `slot_4`, …, как в `motion_detect/report.txt`); цвет уходит в `meta.slots[].color`. Это разовая ломка формата — `/admin/tracking-lab` обновляется в той же ветке.
- **Wipe-детект.** Параметры в `config.yaml` (`wipe.absence_sec`, `wipe.search_radius_world`, `wipe.respect_cuts: true`). По умолчанию: 45s отсутствия в радиусе 80 ед. мира + игнор интервалов вокруг cuts.
- **Eval.** GT-точки складываем в `scripts/tracking/modules/track_teams/assets/gt_anchors.json`, версионируем. Скрипт детерминирован, прогоняется в push-обёртке.
- **Site.** Никаких новых тяжёлых зависимостей; `tracks.json` грузится статикой через `src/data/m-test-g1/`. Объём ~1-2 МБ на матч (frame_step=600 при 60fps) — ок.

## 5. Что НЕ делаем в этой итерации

- Не улучшаем точность LOW/MISS команд в motion_detect (template matching и пр.) — отдельная задача, оставляем как «возможное улучшение» в README.
- Не вводим серверные функции — пайплайн остаётся локальным, сайт читает статические артефакты.
- Не трогаем кольца, killfeed и другие модули.
