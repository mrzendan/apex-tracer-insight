# track_teams — онлайн-трекер команд в мировых координатах

Главный потоковый шаг пайплайна. Принимает VOD, для каждого кадра
регистрирует его в каноническую карту (SIFT+RANSAC), находит плашки
команд по HSV, переводит координаты из пикселей кадра в мировые
координаты карты и ведёт треки через простой Калман + жадное
назначение по цвету. На выходе — `tracks.json` для
`/admin/tracking-lab`.

## Зависимости

- `shared/canonical_maps/<map>.png` + `<map>.json` — карта и калибровка.
- `config.example.yaml` (или свой) — единственный конфиг трекера.
- (опционально) `modules/find_cuts/reports/cuts.json` — на следующих
  итерациях, чтобы не трекать через каты камеры.

## Запуск

```powershell
# с push:
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\track_teams\push.ps1 `
  -Video scripts\tracking\game.mp4

# локально:
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\track_teams\run.ps1 `
  -Video scripts\tracking\game.mp4
```

## Параметры

| Флаг       | Дефолт | Что делает |
|---|---|---|
| `-Video`   | — | путь к mp4 (обязательно) |
| `-Config`  | `modules/track_teams/config.example.yaml` | конфиг |
| `-Out`     | `modules/track_teams/reports/tracks.json` | результат |
| `-FrameStep` | 0 (= из config) | шаг между обрабатываемыми кадрами |
| `-Start`   | 0  | начало в секундах |
| `-End`     | -1 | конец в секундах (-1 = до конца) |
| `-NoPush`  | — | (только push.ps1) без коммита |

Параметры самого `track_teams.py` (через `config.yaml`):

| Секция | Что регулирует |
|---|---|
| `registration.*` | SIFT/ORB, `max_features`, `ransac_reproj_px`, `min_inliers` |
| `detection.*`    | размеры/морфология HSV-blob'ов команды |
| `tracking.*`     | `max_gap_frames`, `gating_world_dist`, шумы Калмана |
| `teams[]`        | HSV-диапазоны команд (берём из `/admin/hsv`) |
| `canonical_map`  | имя файла в `shared/canonical_maps/` |

## Тюнинг

| Симптом | Что крутить |
|---|---|
| Треки прыгают через всю карту | поднять `tracking.gating_world_dist` ↓ |
| Команда теряется при пропадании плашки | поднять `tracking.max_gap_frames` |
| Регистрация слабая → шумные координаты | см. README `debug_register`; повысить `registration.max_features`, включить `clahe` |
| Две команды путаются | сузить HSV в `/admin/hsv` и перезалить `hsv_presets.<map>.json` |

## Вывод

`reports/tracks.json` — см. `shared/schema/tracks.schema.json` и
`docs/tracking-lab.md` в корне репо. Файл загружается на
`/admin/tracking-lab` (drag-and-drop) для визуализации.
