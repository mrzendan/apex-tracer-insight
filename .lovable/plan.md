# План: точные тайминги колец + визуализация Test-матча

Две связанные части — серверная (улучшаем точность поиска кольца) и фронтовая (выводим результаты hud_read как реальный матч в UI).

---

## Часть 1. Высокоточный поиск таймингов кольца (Ring scout)

Сейчас `ring_status` парсится только когда forward-проход случайно попадает на кадр с подсказкой "RING N CLOSING" (в текущем прогоне это ~32% кадров). Шаг 600 кадров (~10с) грубо ловит, **в какой фазе мы находимся**, но не **когда именно** была смена ring N → ring N+1. Применим тот же приём, что и для eliminations: разведка большим шагом + бинпоиск + линейный доводчик.

### Алгоритм (новая функция `scout_rings` в `hud_read.py`)

1. **Coarse pass** — идём вперёд от `start_f` шагом `--ring-scout-step` (по умолчанию 600 кадров ≈10с). На каждом кадре читаем зону `ring_status`, получаем `(ring_n, state)` (где state ∈ CLOSING/COUNTDOWN/CLOSED/OPEN). Запоминаем последний наблюдавшийся `(ring_n, state)`.
2. **Detect transition** — как только видим переход `ring_n → ring_n+1` или `state X → state Y` внутри одной фазы (например `CLOSING → COUNTDOWN`), фиксируем интервал `[f_prev, f_curr]`.
3. **Stage A — binary search** в окне `[f_prev, f_curr]`, бюджет `--ring-refine-budget` (по умолчанию 10) → окно ~600/1024 < 1 кадра.
4. **Stage B — linear refiner** ± `--ring-refine-linear` (по умолчанию 4) кадра вокруг кандидата → гарантированная кадровая точность транзишена.
5. **Sanity check** — если внутри окна OCR дал противоречивые ответы (мерцание HUD/анимация перехода), отметить событие `confidence: "low"` и записать оба соседних кадра.

### Что писать в `reports/rings.json`

```json
{
  "video": "...",
  "fps": 59.94,
  "scout_step": 600,
  "refine_budget": 10,
  "refine_linear": 4,
  "transitions": [
    { "f": 5400, "t": 90.09, "from": {"ring":0,"state":"COUNTDOWN"},
      "to":   {"ring":1,"state":"CLOSING"}, "confidence":"high",
      "refine_method":"binary8+linear1", "refine_window":1 },
    { "f": 12060, "t": 201.20, "from":{"ring":1,"state":"CLOSING"},
      "to":  {"ring":1,"state":"COUNTDOWN"}, "confidence":"high",
      "refine_method":"binary7+linear2", "refine_window":1 }
  ],
  "phases": [
    { "ring": 1, "countdown_start_f": null, "closing_start_f": 5400,
      "closed_f": 12060, "t_closing_start": 90.09, "t_closed": 201.20 },
    { "ring": 2, "countdown_start_f": 12060, "closing_start_f": 14250, ... }
  ]
}
```

`phases[]` — агрегат поверх `transitions[]`, уже готовый под фронтовой `RingPhase`.

### CLI и push.ps1
Новые параметры в `hud_read.py`:
- `--ring-scout-step` (def 600)
- `--ring-refine-budget` (def 10)
- `--ring-refine-linear` (def 4)
- Режим `--mode rings-only` для отдельного быстрого прогона.

В `push.ps1` добавляем `-RingScoutStep`, `-RingRefineBudget`, `-RingRefineLinear`. В режиме `two-pass` рейтинг рассчитывается автоматически после scout эл-ций.

### Скорость
- Coarse pass от 0 до конца с step=600 при 70k кадров → ~120 OCR-проб.
- На каждый transition (обычно 5–10 за матч): 10 binary + 4 linear ≈ 14 OCR.
- Итого +200–300 OCR-вызовов на матч ≈ +30–60с.

---

## Часть 2. Test-турнир / Test-матч / Game 1 на главной + синхронизация данных

### 2.1 Seed данных
Добавить в `src/lib/mock-match.ts`:

- В `tournaments[]`:
  ```ts
  { id: "test-tournament", name: "Test турнир", startDate: "2026-05-01",
    endDate: "2026-05-31", year: 6, type: "Online", region: "EMEA" }
  ```
- В `matches[]`:
  ```ts
  { id: "m-test", name: "Test матч", tournamentId: "test-tournament",
    mapId: "storm-point", durationSec: 1174 }
  ```
- В `matchSeedExtras`:
  ```ts
  "m-test": { mapIds: ["storm-point"], gameDurations: [1174] }
  ```
  (1174с ≈ длина игры из hud_read: `t_last_alive` = 1173.96)

- В `processingFor()` (`src/routes/index.tsx`) добавить явный override для `m-test`: `{ trajectory: "missing", rings: "ready", events: "ready" }` — чтобы карточка матча на главной сразу подсвечивала, какие пайплайны реально готовы по реальным данным.

### 2.2 Перенос реальных данных в публичную папку

Скопировать (через сборку) во время dev:
```
public/data/m-test-g1/
  eliminations.json   ← из scripts/.../reports/eliminations.json
  rings.json          ← из новой части 1
  hud_timeline.json   ← из scripts/.../reports/hud_timeline.json (опционально)
```

Версионируем через git (файлы небольшие). Простой ручной шаг — копирование. Альтернатива: статический импорт через `import elim from "@/data/m-test-g1/eliminations.json"`, тогда положим в `src/data/m-test-g1/`. **Предпочтительно**: статический импорт — типизация, нет fetch-задержек.

### 2.3 Гидрация MatchViewer реальными данными

В `src/lib/mock-match.ts` добавить helper:
```ts
export type GameDataOverride = {
  ringPhases?: RingPhase[];
  events?: GameEvent[];
  durationSec?: number;
};
export const gameDataOverrides: Record<string, GameDataOverride> = {
  "m-test-g1": loadTestGame1(),
};
```
`loadTestGame1()` читает импортированные `eliminations.json` + `rings.json` и конвертирует:

- **rings.json → RingPhase[]**: каждая фаза становится `{ startSec, endSec, cx, cy, r }`. Геометрию (cx/cy/r) пока берём из текущего `buildRingPhases` (без миникарт-локатора), но **тайминги** — реальные из `phases[].t_closing_start`/`t_closed`.
- **eliminations.json → GameEvent[]**: каждая команда с `t_first_dead != null` → `{ t, type: "wipe", team: <slot→tag>, label: "Team X eliminated" }`. Sort by t.

В `MatchViewer`:
- В местах, где сейчас используется `ringPhases` и `events`, заменить на `gameDataOverrides[game.id]?.ringPhases ?? ringPhases` и аналогично для events.
- `durationSec` — взять из override, если есть.

Для слотов 1–20 в `eliminations.json` нужен маппинг slot→team tag. Возьмём из `hud_timeline.json` (там есть `teams[].name` и `slot`). Заранее закодируем как `slotToTag.json` в `src/data/m-test-g1/` (одна разовая операция, см. ниже).

### 2.4 Главная страница
- `featured` теперь будет выбирать m-test (если его `overall === "ready"`) или явно через приоритет `m-test`. Добавим: `const ready = matches.find(m => m.id === "m-test") ?? matches.find(...)`.
- В `recentMatches` он попадёт автоматически.

### 2.5 Скрипт синхронизации
Добавить `scripts/tracking/modules/hud_read/sync_to_ui.py`:
- читает `reports/eliminations.json` + `reports/rings.json` + `reports/hud_timeline.json`
- пишет в `src/data/m-test-g1/`: те же три файла + сгенерированный `slot-to-tag.json`
- запускается из `push.ps1` опцией `-SyncUI`.

---

## Что НЕ делаем сейчас
- Геометрию колец (cx/cy/r) реальную — для неё нужен minimap-locator. Сейчас оставляем мок-геометрию, заменяем только тайминги.
- Реальные траектории команд — это отдельный пайплайн `track_teams`.
- БД/Supabase — данные читаем статически из репозитория. Когда пайплайн станет регулярным, перенесём в storage.

---

## Файлы, которые будут изменены / созданы

**Бэкенд (Python):**
- `scripts/tracking/modules/hud_read/hud_read.py` — `scout_rings()`, новые CLI-флаги, режим `rings-only`
- `scripts/tracking/modules/hud_read/push.ps1` — параметры + опция `-SyncUI`
- `scripts/tracking/modules/hud_read/sync_to_ui.py` — **new**
- `scripts/tracking/modules/hud_read/README.md` — секция Ring scout

**Фронт:**
- `src/lib/mock-match.ts` — Test-турнир/матч + `gameDataOverrides`
- `src/data/m-test-g1/{eliminations,rings,hud_timeline,slot-to-tag}.json` — **new**
- `src/routes/index.tsx` — приоритет m-test в featured + правка `processingFor` override
- `src/components/MatchViewer.tsx` — подмена `ringPhases`/`events` через `gameDataOverrides`

---

## Открытые вопросы
1. **Имена команд по слотам** для Test-матча — берём напрямую из `hud_timeline.json` (`teams[].name`: ELTE, FREE, FXI, NIPC, …) или сгенерировать `T1..T20`? Я предлагаю первый вариант — это реальные команды из видео.
2. **Featured-карточка** — m-test всегда featured или только когда нет других "ready"? Предлагаю всегда (это единственный матч с реальными данными).
3. **rings-only** как отдельный режим или всегда часть `two-pass`? Предлагаю встроить в `two-pass` + оставить `rings-only` для быстрой переразведки.
