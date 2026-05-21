# hud_read — чтение HUD VOD

Поверхностно (с шагом по кадрам) проходит видео, по разметке зон из
`/admin/zones` (пресет **VOD STREAM**) распознаёт HUD матча и таблицы
команд, и выдаёт материал, по которому видно, какие зоны надо подвинуть.

## Что распознаём

**HUD (`tag = hud`):**

| name                       | как распознаём                  |
|----------------------------|---------------------------------|
| `game number`              | OCR + regex `MATCH (\d+)`       |
| `map name`                 | OCR, строка в верхнем регистре  |
| `number of teams alive`    | OCR + regex `(\d+) TEAMS`       |
| `number of players alive`  | OCR + regex `(\d+) PLAYERS`     |
| `ring status`              | OCR + regex `RING (\d+) (CLOSING|COUNTDOWN)` |

**Команды (`tag = team_1` … `team_20`):**

| name           | как распознаём                              |
|----------------|---------------------------------------------|
| `name`         | OCR, верхний регистр                        |
| `pts`          | OCR (только цифры) → int                    |
| `eliminated`   | bool = найдена подстрока `ELIMIN`           |
| `logo`         | сохраняем кроп + dHash (без OCR)            |
| `hero 1..3`    | сохраняем кроп + dHash (без OCR)            |

Распознавание легенды по библиотеке иконок — задача отдельного модуля.

## Установка Tesseract

`pip install` ставит только биндинг `pytesseract`. Сам бинарь Tesseract OCR
ставится отдельно:

- **Windows** — установщик [UB-Mannheim](https://github.com/UB-Mannheim/tesseract/wiki).
  Передаём путь флагом `-TessCmd "C:\Program Files\Tesseract-OCR\tesseract.exe"`.
- **macOS** — `brew install tesseract`.
- **Linux** — `sudo apt install tesseract-ocr`.

## Запуск

```powershell
# с git push:
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\hud_read\push.ps1 `
  -Video scripts\tracking\game.mp4 `
  -TessCmd "C:\Program Files\Tesseract-OCR\tesseract.exe"

# локально (без push):
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\hud_read\run.ps1 `
  -Video scripts\tracking\game.mp4 `
  -TessCmd "C:\Program Files\Tesseract-OCR\tesseract.exe"
```

Конфиг зон по умолчанию ищется в:
1. `scripts/tracking/modules/hud_read/configs/zones.vod.json`
2. `scripts/tracking/configs/zones.vod.json`
3. `…/zones.vod2.json` (фоллбэк)

Положи экспорт из `/admin/zones` в любой из этих путей либо передай
`-Zones <path>`.

## Параметры

| Флаг              | Дефолт | Что делает                                |
|-------------------|--------|-------------------------------------------|
| `-Video`          | —      | путь к mp4 (обязательно)                  |
| `-Zones`          | см. выше | экспорт зон                             |
| `-Mode`           | forward | `forward` / `scout` / `two-pass`         |
| `-ReverseStep`    | 1800   | шаг обратного разведчика (≈60с @30fps)    |
| `-RefineBudget`   | 10     | проб бинпоиска на каждый вылет (Stage A)  |
| `-RefineLinear`   | 4      | линейный доводчик после бинпоиска (Stage B), 0=off |
| `-RefineRollback` | 0      | мелкий rollback-скаут внутри окна (Stage C), 0=off |
| `-Workers`        | 0      | параллельных forward-процессов (0 = single) |
| `-FrameStep`      | 600    | шаг по кадрам                             |
| `-StartSec`       | 0      | начало окна (сек)                         |
| `-EndSec`         | 0      | конец окна, 0 = до конца                  |
| `-OcrLang`        | eng    | язык tesseract                            |
| `-TessCmd`        | —      | путь к tesseract.exe (Windows)            |
| `-OverlayEvery`   | 1      | писать оверлей каждый N-й анализ кадра    |
| `-CropFirstN`     | 3      | кропы текстовых полей для первых N кадров |
| `-StaticConfirm`  | 3      | сколько одинаковых значений «замораживают» статичное поле |
| `-StaticMaxFrames`| 8      | бюджет попыток на статичное поле перед мажоритарной фиксацией |
| `-Out`            | reports| папка вывода                              |
| `-NoPush`         | —      | без git commit/push                       |

## Тюнинг

- Статичные поля (`map name`, `game number`, для каждой команды `name`/`logo`)
  больше не OCR-ятся каждый кадр: после `StaticConfirm` совпадений (или
  `StaticMaxFrames` попыток) значение фиксируется и переиспользуется до
  конца прогона. Это резко ускоряет проход по VOD.
- **Точность вылетов:** scout уточняет момент вылета каждой команды в
  три этапа:
  - Stage A — бинпоиск (`RefineBudget` проб), сужает окно до
    `ReverseStep / 2^budget`. При 1800 / 2^10 ≈ 2 кадра.
  - Stage B — линейный доводчик (`RefineLinear` шагов по 1 кадру), даёт
    кадровую точность.
  - Stage C — опциональный rollback-скаут (`RefineRollback`), помогает
    если HUD «мерцает» (анимация перехода в eliminated).
- **Параллелизация (`-Workers N`):** при N>0 запускается оркестратор
  `orchestrate.py`. Он:
    1. Запускает один scout-проход → `eliminations.json`.
    2. Делит forward-окно на N равных блоков (с перекрытием в один
       `FrameStep`).
    3. Стартует N процессов `hud_read.py --mode forward
       --start-frame X --end-frame Y --chunk-id i`, каждый пишет
       `hud_timeline.<i>.json` и `report.<i>.txt`.
    4. Мерджит результаты в `hud_timeline.json` + `report.txt`.
  Каждый процесс держит свой OCR-кеш и калибровку PSM. Памяти
  ≈150 MB/воркер. Рекомендация: `cpu_count // 2`.
- **Режимы прохода:**
  - `forward` (дефолт) — обычный шаг от начала к концу, читает все зоны.
  - `scout` — обратный разведчик. Идёт от конца к началу шагом
    `ReverseStep`, читает только зоны `team_*/eliminated`, для каждой
    команды находит окно `[последний жив, первый мёртв]`, после чего
    бинпоиском (`RefineBudget` проб) уточняет точный кадр вылета.
    Результат → `eliminations.json`. Самый быстрый способ получить
    тайминги вылетов на длинном VOD.
  - `two-pass` — сначала `scout`, потом обычный forward, но окно
    сужается до момента, когда самая ранняя команда ещё была жива
    (отсекаются преамбула/нарезки между матчами).
- **OCR-кеш по dHash:** каждый кроп хешируется (8×8 dHash), и если кадр
  визуально совпал с предыдущим (`pts` не сменился, `name` тот же) —
  Tesseract не вызывается, переиспользуется прошлый результат. На
  длинных VOD даёт 50–80% хитов.
- **Калибровка PSM/полярности:** на первой успешной комбинации
  `(psm, threshold polarity)` для каждой зоны фиксируется победитель;
  дальше Tesseract вызывается только с ним (экономия x3–x6 на зону).
- `FrameStep` 600 = ~10 секунд при 60fps. HUD меняется редко, можно
  увеличить, чтобы быстрее пройти весь VOD.
- Если `report.txt` показывает много `EMPTY/MISALIGNED` для конкретного
  поля — зона мимо HUD, поправь в `/admin/zones` и пересохрани.
- Если `TIGHTEN` — OCR что-то ловит, но regex не парсит: зона слишком
  широкая и захватывает соседний текст.

## Вывод (в `reports/`)

- `hud_timeline.json` — снапшоты по кадрам:
  `{frame, t, hud:{...}, teams:[{slot, name, pts, eliminated, logo, hero_1..3}]}`.
- `eliminations.json` (`-Mode scout`/`two-pass`) — `{slot: {f_first_dead,
  t_first_dead, f_last_alive, t_last_alive}}` после бинпоиска.
- `report.txt` — таблица: на каждую пару `(tag, name)` — % распознавания,
  % успешного парсинга, подсказка (`OK / TIGHTEN / EMPTY/MISALIGNED /
  STATIC?`) и примеры значений.
- `overlays/hud_<frame>.jpg` — кадр с нарисованными зонами и подписями.
- `crops/<tag>__<name>/<frame>.png` — сырые вырезки для глазной проверки.

## Что значит каждая подсказка

- **OK** — поле стабильно распознаётся и парсится.
- **TIGHTEN** — OCR ловит текст, но regex не находит ожидаемого
  паттерна. Сожми зону по краям.
- **EMPTY/MISALIGNED** — меньше 40% кадров дали хоть какой-то текст:
  зона либо вне HUD, либо текст слишком мелкий/контраст плохой.
- **STATIC?** (для `logo`/`hero N`) — все dHash совпадают на протяжении
  всего матча. Если команда меняла легенду — зона мимо.

## Связь с пайплайном

`hud_read` параллелен `track_teams`: даёт «что показывает HUD в момент
`t`», тогда как `track_teams` даёт «где команды на карте в момент `t`».
Сшивка по таймстампу.

## Sync в UI (`sync_to_ui.py`)

**Структурное правило:** `hud_read.py` всегда пишет в свой `reports/`
(нельзя `--out src/data/...` — это теперь явная ошибка). Перенос данных
на сайт делает `sync_to_ui.py` — он копирует `eliminations.json`,
`rings.json`, `hud_timeline.json` из `hud_read/reports/`, а также
`tracks.json` и `tracks.slots.json` из `track_teams/reports/`.

Канонический one-liner после прогона `hud_read` + `track_teams`:

```powershell
python scripts/tracking/modules/hud_read/sync_to_ui.py `
  --ring-geometry scripts/tracking/modules/ring_locator/reports/ring_geometry_v2.json
```

Флаги:

| Флаг                | Дефолт | Что делает                                |
|---------------------|--------|-------------------------------------------|
| `--reports`         | `hud_read/reports/` | откуда берём HUD-отчёты      |
| `--out`             | `src/data/m-test-g1/` | куда кладём                |
| `--ring-geometry`   | —      | merge геометрии колец в `rings.json`      |
| `--tracks-reports`  | `auto` | `auto` → `track_teams/reports/`; `skip` — выключить копирование tracks |
