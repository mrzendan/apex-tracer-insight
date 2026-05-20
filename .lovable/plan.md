
# hud_read — реализация

Цель: пробежаться по VOD с заданным шагом кадров, по разметке зон из `/admin/zones` (пресет **VOD STREAM**) вытащить текст / картинки HUD и таблиц команд, и выдать материал, по которому видно, какие зоны надо подвинуть.

## 1. Конфиг и зависимости

- Конфиг от пользователя: `scripts/tracking/configs/zones.vod.json` (общий) +
  дефолт модуля `scripts/tracking/modules/hud_read/configs/zones.vod.json`.
  Скрипт принимает `--zones` явно; если флаг не задан — ищет в обоих местах,
  сначала свой `configs/`, потом общий `scripts/tracking/configs/`.
- Формат JSON: `{ base: [W, H], mode, zones: [{id, name, tag, x, y, w, h}] }`
  — координаты в пикселях относительно `base`. При обработке скейлим
  под реальный размер кадра видео.
- Зависимости в `scripts/tracking/requirements.txt`:
  `pytesseract>=0.3.10`, `Pillow>=10`. OpenCV уже есть.
- Системно нужен бинарь Tesseract. В README модуля — инструкция:
  Windows → `choco install tesseract` или установщик UB-Mannheim,
  путь передаём через флаг `--tess-cmd "C:\Program Files\Tesseract-OCR\tesseract.exe"`.

## 2. Семантика зон (tag, name)

Текстовые поля (OCR):

| tag       | name                     | парсер                                  |
|-----------|--------------------------|-----------------------------------------|
| `hud`     | `game number`            | regex `MATCH\s+(\d+)`                   |
| `hud`     | `map name`               | строка, нормализуем верхним регистром   |
| `hud`     | `number of teams alive`  | regex `(\d+)\s*TEAMS`                   |
| `hud`     | `number of players alive`| regex `(\d+)\s*PLAYERS`                 |
| `hud`     | `ring status`            | regex `RING\s+(\d+).*(CLOSING|COUNTDOWN)` |
| `team_N`  | `name`                   | строка                                  |
| `team_N`  | `pts`                    | целое                                   |
| `team_N`  | `eliminated`             | bool = есть ли подстрока `ELIMINATED`   |

Картиночные поля (без OCR, сохраняем кроп + dHash):

| tag      | name              |
|----------|-------------------|
| `team_N` | `logo`            |
| `team_N` | `hero 1..3`       |

## 3. Скрипт `hud_read.py`

Поток на каждый шаг:

```text
open video → for frame in step:
  for zone in zones (scaled to frame size):
    crop = frame[y:y+h, x:x+w]
    if image-type zone:
      save crops/<tag>_<name>/<frame>.png
      hash = dhash(crop)
    else:
      pre = grayscale → upscale x2 → adaptiveThreshold
      text = pytesseract.image_to_string(pre, lang=ocr_lang,
              config=allowlist_per_field)
      value = parse_field(tag, name, text)
  snapshot = {frame, t, hud:{...}, teams:[{slot, name, hero1..3, pts, eliminated}]}
  push to timeline; draw overlay
```

Поля цифр (`pts`, `teams alive`, `players alive`, `game number`, `ring status`)
запускаем с `--psm 7 -c tessedit_char_whitelist=0123456789`.

## 4. Что выдаём в `reports/`

- `hud_timeline.json` — массив снапшотов по кадрам (структура выше).
- `report.txt` — построчно по каждой паре `(tag, name)`:
  `recognized N/M (xx%) | unique values: ... | suggest: OK | TIGHTEN | EMPTY`.
  Эвристика подсказки:
    - `<40%` распознано → `EMPTY/MISALIGNED` (вероятно зона мимо).
    - распознано но значение не парсится regex'ом в большинстве кадров →
      `TIGHTEN` (захватываем лишний текст).
    - для image-зон: если все хэши почти одинаковые в матче, где команда
      меняла легенду — `LIKELY MISALIGNED`.
- `overlays/hud_<frame>.jpg` — кадр с нарисованными прямоугольниками зон,
  цветом по тегу (берём те же цвета, что в `/admin/zones`), и подписанным
  распознанным значением рядом.
- `crops/<tag>_<name>/<frame>.png` — сырые вырезки для image-полей и для
  всех полей в первых N кадрах (для глазной проверки).

## 5. CLI

```text
--video       (req)   путь к mp4
--zones               json от /admin/zones (см. п.1)
--frame-step  600     шаг по кадрам
--start-sec   0
--end-sec     0       0 = до конца
--ocr-lang    eng
--tess-cmd            путь к tesseract.exe (Windows)
--overlay-every 1     писать оверлей каждый N-й проанализированный кадр
--out         reports
```

## 6. README + ps1

- Обновить `modules/hud_read/README.md`: убрать пометку "скелет", добавить
  раздел "Что значит каждое поле в report.txt", напомнить про установку
  Tesseract и про `--tess-cmd`.
- `run.ps1` / `push.ps1`: дефолт `--Zones` указывает на
  `scripts/tracking/configs/zones.vod.json` (то место, куда пользователь
  уже положил файл).

## 7. Порядок имплементации

1. `requirements.txt` + README/инструкция по Tesseract.
2. `hud_read.py` — каркас IO + загрузка/скейл зон + цикл по кадрам +
   сохранение кропов и оверлеев (без OCR ещё).
3. Подключение pytesseract и `parse_field` per (tag, name).
4. Сводка в `report.txt` с эвристиками "что подвинуть".
5. Обновить `run.ps1` / `push.ps1` под новый дефолт `--Zones`.

## Открытые вопросы (нужны ответы до старта)

1. Подтверди путь к видео по умолчанию для `run.ps1` — оставить
   `scripts/tracking/game.mp4`, как в других модулях?
2. ОК ли хранить сырые кропы (`reports/crops/...`) в git, или класть только
   первые ~5 кадров на каждое поле (чтобы не раздувать репозиторий)?
3. Для `hero 1..3` сейчас просто сохраняем картинку. Распознавание легенды
   по библиотеке иконок — отдельным следующим модулем, верно?
