## Проблема

`rings.json` пустой (`transitions: []`, `phases: []`), потому что `scout_rings` начинает coarse-проход с `start_f=0` и до первого `RING N CLOSING` (~1:55) плашка ring status вообще не отрисована в HUD → OCR возвращает `None` на всех ранних сэмплах, transitions не находятся, и единственный «честный» переход внутри игры теряется на стыке coarse-окон.

Плюс текущая логика теряет фазу `COUNTDOWN`: между закрытиями плашка показывает обратный отсчёт до следующего сужения, и именно в этот момент на миникарте видно **серый круг следующего кольца** — это самый чистый момент для измерения геометрии.

## Идея

Разделить задачу на два независимых слоя.

**Слой 1 — тайминги (плашка ring status, OCR).**
Источник истины — текст плашки. Нужна высокая точность, а не покрытие всего VOD: сужаем рабочее окно и улучшаем OCR.

**Слой 2 — геометрия (миникарта, CV).**
Зная из слоя 1, когда ring в `COUNTDOWN`, сэмплируем 1–3 кадра в этом окне и через HoughCircles находим серый «следующий ring». Дальше всё положение/радиус по времени восстанавливаем аналитически: ring сужается линейно от старого радиуса к новому за `t_closed − t_closing_start`, в `COUNTDOWN` стоит на месте.

Камеру обсервера компенсируем через уже работающий `find_cuts`: миникарта в нижнем-левом углу экрана **не двигается** при пане/зуме игровой камеры, она в HUD-слое. Но если обсервер открыл fullmap или killcam — миникарта пропадает/искажается. Эти интервалы режем по `cuts.json` (классы `cut` и `hud`) и не сэмплируем геометрию внутри них.

## План

### 1. Слой 1: тайминги ring status

**1.1. Сжать окно ring-scout.**
Сейчас scout идёт от `start_f` до `end_f` всего видео. Передаём в `scout_rings` нижнюю границу = `min(t_first_dead по eliminations.json)` − 60s, либо явный `--ring-start-sec`. До этого момента плашки физически нет.

**1.2. Уточнить OCR плашки.**
`read_ring_at` сейчас читает зону одним PSM, без префильтра под белый текст на затемнённом фоне. Добавить:
- маску по яркости (V-канал HSV ≥ порог) перед бинаризацией — плашка всегда светлый текст;
- упрощённую regex-цепочку: `RING\s*[1-9]` + отдельный поиск `CLOSING|COUNTDOWN|CLOSED`, чтобы перебить OCR-ошибки (`CLOS1NG` и т.п.);
- snap по списку допустимых состояний (как сделано для KNOWN_MAPS).

**1.3. Добавить COUNTDOWN-ребро.**
Сейчас scout-цикл фиксирует переходы только между непустыми сэмплами с разным ключом. Это работает, но если coarse-шаг 600 кадров «перескакивает» `CLOSING → COUNTDOWN` за один тик — переход теряется. Уменьшить дефолтный `--ring-scout-step` до 300 (≈5 с при 60fps), бинпоиск всё равно сводит к кадру.

**1.4. Вычислить константы фаз.**
После сбора `phases[]` пост-процессом считаем:
- `closing_duration[N] = t_closed[N] − t_closing_start[N]`;
- `countdown_duration[N] = t_closing_start[N+1] − t_closed[N]`.

Эти значения относительно стабильны для конкретной карты/режима. Складываем в `rings.json` как `derived: { closing_durations, countdown_durations, mean, stdev }`. Это и есть «константное время отдыха», о котором ты пишешь.

Если для какой-то фазы OCR не поймал `closed_f` (плашка пропадает в момент закрытия), оцениваем `t_closed[N] = t_closing_start[N+1] − mean(countdown_duration)` и помечаем `confidence: "derived"`.

### 2. Слой 2: геометрия колец на миникарте

Новый модуль `scripts/tracking/modules/ring_locator/`.

**2.1. Где искать.** Для каждой фазы `N` берём окно `COUNTDOWN` (между `t_closed[N-1]` и `t_closing_start[N]`). Сэмплируем 3 кадра: начало, середина, конец окна. Из них голосованием берём усреднённый круг — это страхует от рекламных оверлеев/killcam.

**2.2. Где режем.** Загружаем `find_cuts/reports/cuts.json`. Если момент сэмпла попадает внутрь `hud_event` или ближе `±0.5 s` к `cut` — сдвигаем сэмпл по окну. Если всё окно «грязное» — фаза остаётся без геометрии, помечаем `geometry_confidence: "missing"`.

**2.3. Что детектим на миникарте.**
- Берём зону `minimap` из `zones.vod.json` (если её нет — добавляем в `/admin/zones`, пресет VOD STREAM).
- Маска по тёмно-серому (HSV: низкая S, средняя V) → морфология → `cv2.HoughCircles` с диапазоном радиусов от текущего кольца (известного из предыдущей фазы) до половины миникарты.
- Из кандидатов оставляем тот, который **внутри** текущего активного кольца (sanity-check: центр следующего кольца всегда внутри предыдущего).

**2.4. Компенсация камеры.**
Миникарта HUD-слойная и не двигается, но обсервер может включить **fullmap** (карта на весь экран) или **inventory overlay**. Это в `find_cuts` уже классифицировано как `hud_event` (камера мирового видео на месте, но картинка изменилась). Используем эту метку: пропускаем сэмплы внутри `hud_event` окон.

Для редкого случая, когда обсервер вручную перетаскивает миникарту (бывает на про-турнирах через UI продакшна), детектим это по dHash углов миникарты: если хеш HUD-рамки за окно стабилен — миникарта на месте; нет — пропускаем.

**2.5. Аналитическая модель ring(t).**
Имея `(cx, cy, r)` для ring N (из COUNTDOWN фазы N) и предыдущее активное кольцо ring N-1 (из его же измерения), для любого `t ∈ [t_closing_start[N], t_closed[N]]`:

```text
α = (t − t_closing_start[N]) / (t_closed[N] − t_closing_start[N])
ring(t).cx = lerp(prev.cx, next.cx, α)
ring(t).cy = lerp(prev.cy, next.cy, α)
ring(t).r  = lerp(prev.r,  next.r,  α)
```

В `COUNTDOWN` (между `t_closed[N-1]` и `t_closing_start[N]`) ring стоит = `prev`. Это даёт **непрерывную геометрию** без необходимости сэмплить каждый кадр.

### 3. Артефакты и склейка

`ring_locator/reports/ring_geometry.json`:
```json
{
  "phases": [
    { "ring": 1, "cx_norm": 0.50, "cy_norm": 0.50, "r_norm": 0.46,
      "measured_at_t": 0, "geometry_confidence": "seed" },
    { "ring": 2, "cx_norm": 0.58, "cy_norm": 0.42, "r_norm": 0.23,
      "measured_at_t": 487.3, "geometry_confidence": "high",
      "samples": [...] }
  ]
}
```

`sync_to_ui.py` мерджит `ring_geometry.json` в `src/data/m-test-g1/rings.json` (новое поле `geometry` рядом с `phases`), фронт читает и строит `RingPhase[]` без mock `RING_OFFSETS` в `src/lib/test-game-data.ts`.

### 4. Запуск

```powershell
# слой 1 — только тайминги, узкое окно, агрессивный OCR
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\hud_read\run.ps1 `
  -Video scripts\tracking\game.mp4 `
  -TessCmd "C:\Program Files\Tesseract-OCR\tesseract.exe" `
  -RingsOnly -RingScoutStep 300 -RingRefineBudget 12 -RingRefineLinear 6

# слой 2 — геометрия по таймингам из слоя 1
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\ring_locator\push.ps1 `
  -Video scripts\tracking\game.mp4 `
  -Rings scripts\tracking\modules\hud_read\reports\rings.json `
  -Cuts  scripts\tracking\modules\find_cuts\reports\cuts.json `
  -SyncUI
```

### 5. Что меняется в коде

| Файл | Изменение |
|------|-----------|
| `hud_read.py` | `read_ring_at`: HSV-префильтр + raw regex по двум частям. `scout_rings`: принимает `start_f`-clip, считает `derived` константы фаз, доводит пропущенные `t_closed` из среднего `countdown_duration`. |
| `hud_read.py` CLI | `--ring-start-sec` (нижняя граница окна). Дефолт `--ring-scout-step` 300. |
| `modules/ring_locator/` (новый) | `ring_locator.py` (HoughCircles + cuts-aware sampling), `push.ps1`, `run.ps1`, `README.md`. |
| `sync_to_ui.py` | Мерж `ring_geometry.json` в `src/data/m-test-g1/rings.json`. |
| `src/lib/test-game-data.ts` | Чтение `geometry` из rings.json вместо `RING_OFFSETS`; lerp по фазам. |

### 6. Что не делаем сейчас

- Не трогаем `track_teams` — у него своя гомография, и mixing с миникартой только усложнит отладку.
- Не пытаемся OCR'ить таймер обратного отсчёта внутри плашки. Длительность фаз восстанавливаем из переходов, это надёжнее.
- Не детектим красный край активного кольца на миникарте: его и так знаем из предыдущей фазы по той же модели.
