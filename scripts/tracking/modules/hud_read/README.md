# hud_read — чтение HUD VOD'а (стартовый скелет)

Назначение: на основе разметки зон `/admin/zones` (подложка
**VOD STREAM 2**) распознавать статичный HUD матча и таблицы команд
слева/справа.

Что нужно вытащить из кадра:

- Из зон тега `hud` — `game number`, `map name`,
  `number of teams alive`, `number of players alive`, `ring status`.
- Из каждой зоны тега `team_1`..`team_20` — поднимённые внутри неё
  под-зоны (по полю `name`): `logo`, `name`, `hero 1`..`hero 3`,
  `pts`, `eliminated`.

Текст распознаём через `pytesseract`, логотипы и легенды — через
template / dHash-матчинг с библиотекой эталонов из БД. Сам пайплайн
будет добавлен следующим коммитом; сейчас в модуле только структура.

## Зависимости (будущие)

- `shared/canonical_maps/` — не требуется (HUD статичен).
- Экспорт из `/admin/zones` пресета **VOD STREAM 2**
  (`zones.vod2.json`) — кладётся в `configs/`.
- Логотипы команд и иконки легенд — из БД проекта.

## Запуск (когда появится `hud_read.py`)

```powershell
# с push:
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\hud_read\push.ps1 `
  -Video scripts\tracking\game.mp4

# локально:
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\hud_read\run.ps1 `
  -Video scripts\tracking\game.mp4
```

## Параметры (план)

| Флаг | Дефолт | Что делает |
|---|---|---|
| `-Video`     | — | путь к mp4 (обязательно) |
| `-Zones`     | `configs/zones.vod2.json` | экспорт зон из `/admin/zones` |
| `-FrameStep` | 600 | шаг кадров (HUD меняется редко) |
| `-StartSec`  | 0  | старт окна |
| `-OcrLang`   | `eng` | язык tesseract |
| `-Out`       | `reports` | папка вывода |
| `-NoPush`    | — | без коммита |

## Вывод (план)

- `reports/hud_timeline.json` — серия снимков HUD по кадрам:
  `{frame, t, hud: {...}, teams: [{slot, name, hero1..3, pts, eliminated}]}`.
- `reports/report.txt` — человекочитаемая сводка: какие поля
  распознались, какие нет.
- `reports/overlays/hud_<frame>.jpg` — кадр с нарисованными зонами и
  распознанным текстом, для глазной проверки.

## Связь с пайплайном

`hud_read` работает параллельно `track_teams` — даёт «что показывает
HUD в момент `t`», тогда как `track_teams` даёт «где команды на карте
в момент `t`». Сшивка по таймстампу.
