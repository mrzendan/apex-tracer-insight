## Что улучшаем

1. **Точность вылетов** — сейчас бинпоиск в scout даёт окно ≈ `reverse_step / 2^refine_budget`. При `1800 / 2^6 ≈ 28 кадров` (≈0.5с при 60fps). Хочется кадровой точности.
2. **Скорость forward-прохода** — параллелим по кадровым блокам отдельными процессами.

---

## Часть 1. Повышение точности вылетов (scout/refine)

### 1.1 Двухступенчатый refine
Вместо одного `refine_budget=6`:

- **Stage A (бинпоиск, как сейчас):** `refine_budget` поднимаем до 10 → окно `1800/1024 ≈ 2 кадра`. Это +4 OCR-вызова на команду (≈ +80 OCR на матч → секунды).
- **Stage B (линейный «доводчик»):** после бинпоиска идём от `f_last_alive` вперёд шагом 1 максимум `--refine-linear` кадров (по умолчанию 4) и фиксируем точный кадр перехода `alive → dead`. Кадровая точность гарантирована.

Итого ≤ ~14 OCR-вызовов на команду в refine-стадии. На 20 командах ≈ 280 — несколько секунд.

### 1.2 Опциональный «откат и уменьшение шага» (--refine-rollback)
Альтернативный режим, который ты описал словами: после первого определения окна делаем второй проход scout-стилем с меньшим шагом (например, 60 кадров) внутри окна `[f_last_alive - margin, f_first_dead + margin]`. Полезно, если eliminated мерцает (анимации HUD).

Делается флагом `--refine-rollback <step>`. По умолчанию выключен — линейного доводчика хватает.

### 1.3 Sanity-check
- Если в `f_first_dead` зона возвращается в `alive` в течение N кадров — это шум HUD; откатываем флаг и продолжаем поиск дальше.
- Логируем в `eliminations.json` поле `refine_method: "binary+linear"` и итоговую ширину окна (для прозрачности).

### CLI / push.ps1
- `-RefineBudget` дефолт **10** (было 6).
- `-RefineLinear` дефолт **4** (новый).
- `-RefineRollback` дефолт **0** (off).

---

## Часть 2. Параллелизация forward по блокам

### 2.1 Архитектура

```text
push.ps1
  └── orchestrator (Python, новый: hud_read_run.py или флаг --workers N)
        ├── scout pass (1 процесс, как сейчас)         → eliminations.json
        ├── split [start_f .. end_f] на N кадровых блоков
        ├── spawn N процессов hud_read.py --mode forward
        │     --start-frame Fi --end-frame Fj
        │     --out reports/_chunk_i
        │     --chunk-id i
        └── merge: reports/_chunk_*/hud_timeline.json → reports/hud_timeline.json
              + объединить report.txt (агрегация %)
              + перенести overlays/crops с префиксом chunk-id
```

### 2.2 Что меняем в `hud_read.py`
- Новые аргументы: `--start-frame`, `--end-frame` (точные кадры; имеют приоритет над `--start-sec`/`--end-sec`).
- Новый аргумент `--chunk-id` (строка): добавляется в имена файлов `overlays/hud_<chunk>_<frame>.jpg` и `crops/<tag>__<name>/<chunk>_<frame>.png`, чтобы не перетирали друг друга.
- Worker не запускает scout сам — получает готовый `eliminations.json` через `--eliminations <path>` и сам обрезает свою область интереса (если команда вылетела до начала чанка — её зоны можно пропускать).
- tqdm с `position=chunk_id` и `desc=f"chunk{i}"` — несколько баров одновременно.

### 2.3 Оркестратор
Новый файл `scripts/tracking/modules/hud_read/orchestrate.py`:

- Считает `total_frames`, делит на `N` равных блоков (N = `--workers`, по умолчанию `os.cpu_count() // 2`, минимум 2).
- Через `subprocess.Popen` запускает `python hud_read.py --mode forward ...` для каждого блока.
- Читает stdout/stderr воркеров с префиксами `[w{i}]`.
- После всех `wait()` — merge:
  - `hud_timeline.json`: конкатенация снапшотов, сортировка по `frame`.
  - `report.txt`: пересчёт % по объединённому набору (один проход агрегации).
  - `overlays/` и `crops/`: воркеры писали в свои подпапки `_chunk_i/`, мерджер переносит наверх (имена уже уникальные за счёт `--chunk-id`).
- Гарантирует, что границы блоков перекрываются на 1 шаг (`frame_step`), чтоб никакой кадр не потерялся.

### 2.4 Что НЕ параллелим
- Scout (он и так быстрый: ~1 минута на матч).
- Статические поля (`map name`, `game number`, team `name`/`logo`) — каждый воркер фиксирует независимо; в мерджере берём моду по чанкам.

### CLI / push.ps1
- `-Workers <N>`: число параллельных процессов. По умолчанию 0 = не параллелить (текущее поведение).
- `-Mode two-pass-parallel`: scout + параллельный forward.

### 2.5 Подводные камни
- **Windows + Tesseract**: `pytesseract` спавнит `tesseract.exe` для каждой OCR-команды. N=4 воркеров → 4× процессы tesseract одновременно. CPU-bound, отлично распараллеливается. Memory ~150 MB / воркер.
- **VideoCapture seek**: каждый воркер делает `set(POS_FRAMES, start_f)` один раз и читает подряд → нормально.
- **dHash-кеш и калибровка PSM**: у каждого процесса свои; первые кадры каждого чанка прогреваются заново. Терпимо, можно позже добавить shared-cache через файл.
- **Логи в консоль**: смешанные stdout от N воркеров — пишем с префиксом `[wN]`, tqdm в `position=N`.

---

## Часть 3. Что НЕ делаем сейчас (опционально на будущее)

- PyAV вместо OpenCV для seek — даст ещё прирост на длинных VOD, но добавляет зависимость.
- Shared OCR-cache между воркерами через SQLite/файл — усложнение ради 5-10% выигрыша.
- GPU-ускорение Tesseract — не поддерживается.

---

## Технические детали реализации

**Файлы, которые поменяем:**
- `scripts/tracking/modules/hud_read/hud_read.py`
  - в `scout_eliminations`: после бинпоиска добавить линейный доводчик (Stage B) и опциональный rollback (Stage C). Сохранять `refine_window_width`, `refine_method`.
  - принять `--start-frame`, `--end-frame`, `--chunk-id`, `--eliminations` (read-only для воркеров).
  - оверлеи и кропы писать с префиксом `chunk-id` если он задан.
- `scripts/tracking/modules/hud_read/orchestrate.py` (новый) — оркестратор для параллельного forward + merge.
- `scripts/tracking/modules/hud_read/push.ps1`
  - параметры `-RefineBudget` (дефолт 10), `-RefineLinear` (дефолт 4), `-RefineRollback` (дефолт 0), `-Workers` (дефолт 0).
  - если `-Workers > 0` — зовём `orchestrate.py`, иначе старый путь `hud_read.py`.
- `scripts/tracking/modules/hud_read/README.md` — раздел «Точность» (двухступенчатый refine) и «Параллелизация» (как `-Workers` делит блоки и что мерджится).

**Что НЕ трогаем:**
- Формат `hud_timeline.json` (только дополняется).
- UI/zones/admin.
- Логику OCR и кешей — расширяем точечно.

---

## Открытые вопросы

1. **`-Workers` по умолчанию = 0 (off) или auto = `cpu_count/2`?** Безопаснее off, чтобы пользователь явно решал.
2. **Linear refine после бинпоиска** — включаем всегда или флагом? Предлагаю всегда (стоит копейки).
3. **Rollback-режим (-RefineRollback)** оставляем как опцию или не делаем сейчас? Скорее всего не нужен, если linear-доводчик работает.
