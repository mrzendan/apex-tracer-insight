## Цель

Убрать у пользователя необходимость знать тайминги колец заранее. `hud_read --rings-only` должен сам находить начало каждого кольца через "rollback от CLOSING к COUNTDOWN", а `ring_locator` — измерять геометрию для всех колец, включая R1.

## Проблема сейчас

1. **`--ring-start-sec` обязателен** — иначе coarse-pass начинается с t=0, тратит OCR на пустые кадры и часто не находит первое CLOSING (плашки нет до ~1:55).
2. **Seed-фаза не откатывается** — если первое наблюдение R1 CLOSING на t=180s, фаза фиксируется на этом t, а не на реальном начале (1:55).
3. **`ring_locator` теряет R1** — он измеряет "следующее кольцо" во время COUNTDOWN предыдущего; для R1 нет "предыдущего", и фаза пропускается.

## Решение

### Layer 1 — Автодетекция начала колец (`hud_read.py`)

**Алгоритм "find-then-rollback":**

```text
1. Coarse forward-pass с крупным шагом (по умолч. 600f ≈ 10s) от t=0.
   - Пустые кадры (mask brightness < threshold) пропускаются дёшево (без OCR).
   - Останавливаемся, как только нашли первое валидное RING N STATE.

2. Для КАЖДОГО обнаруженного состояния `RING N CLOSING`:
   a) Rollback к началу CLOSING:
      - шаг назад reverse_step (по умолч. 300f), читаем state;
      - пока state == CLOSING (тот же ring) — продолжаем;
      - как только state != CLOSING (COUNTDOWN/CLOSED/None) — бинпоиск
        в окне [last_other, first_closing] до кадровой точности.
      → даёт точный t_closing_start[N].
   b) Rollback дальше для t_countdown_start[N]:
      - продолжаем назад от t_closing_start, ищем границу
        COUNTDOWN(N) → (что-то иное: CLOSED(N-1) или None);
      - бинпоиск даёт t_countdown_start[N] (== t_closed[N-1]).

3. Forward от первого найденного CLOSING крупным шагом — собираем все
   последующие переходы (R1→R2→…), для каждого нового CLOSING повторяем
   rollback из п.2.
```

**Изменения в коде `hud_read.py`:**

- `scout_rings()`: переписать. Убрать предположение, что окно сканирования = окно колец. Вместо seed_phase делать настоящий rollback.
- Новая функция `_rollback_to_state_start(cap, ring_zone, f_known, expected_state, ring_n, step, max_back, fps, lang)` — возвращает кадр первой встречи `expected_state` для `ring_n`. Использует крупный шаг назад + бинпоиск.
- `_derive_ring_constants()` остаётся как fallback для случаев, когда rollback упёрся в t=0 или в "плашки нет".
- Сделать `--ring-start-sec` опциональным (default 0). Параметр оставить — может пригодиться для отладки.
- Префильтр пустого кадра (`mask.mean() < 4` уже есть в `read_ring_at`) — гарантирует быстрый скан до появления плашки.

### Layer 2 — Геометрия R1 (`ring_locator.py`)

Сейчас окно для R1 пропускается, потому что нет `prev` фазы. Логика:

- Для R1 окно сэмплов = `[max(0, t_closing_start[1] − median_countdown), t_closing_start[1] − 0.5]`.
  - `median_countdown` берётся из `rings.json.derived` (его уже считает `_derive_ring_constants`).
  - Если `derived.median_countdown` отсутствует — берём фиксированное окно (например, 30s до начала закрытия).
- Для R2..RN — оставить текущую логику (окно между `t_closed[N-1]` и `t_closing_start[N]`).

### Layer 3 — UI (без изменений API)

`src/lib/test-game-data.ts` уже читает `rings.geometry.phases[].ring` — после фикса R1 появится в массиве автоматически.

## Что НЕ трогаем

- `push.ps1` / `run.ps1` остаются с теми же параметрами (`--ring-start-sec` всё ещё валиден, но необязателен).
- `sync_to_ui.py`, `eliminations` логика, OCR-функции `read_ring_at` / `RE_RING_NUM` — без изменений.
- `track_teams`, гомография — отдельная подсистема.

## Команды для проверки

```powershell
# 1. Полный auto-detect колец (без --ring-start-sec)
powershell -ExecutionPolicy Bypass -File `
  scripts\tracking\modules\hud_read\run.ps1 `
  -Video scripts\tracking\game.mp4 -RingsOnly

# 2. Геометрия (включая R1)
powershell -ExecutionPolicy Bypass -File `
  scripts\tracking\modules\ring_locator\run.ps1 `
  -Video scripts\tracking\game.mp4 `
  -Rings scripts\tracking\modules\hud_read\reports\rings.json `
  -Cuts  scripts\tracking\modules\find_cuts\reports\cuts.json `
  -Zones scripts\tracking\configs\zones.vod.json `
  -MinimapZone "camera roi" -SyncUI
```

Ожидаемо: `phases[0].t_closing_start ≈ 115s` (R1 в 1:55) и `geometry.phases[0].ring == 1`.

## Файлы

- `scripts/tracking/modules/hud_read/hud_read.py` — переработать `scout_rings`, добавить `_rollback_to_state_start`.
- `scripts/tracking/modules/ring_locator/ring_locator.py` — добавить ветку для R1 (окно от `median_countdown`).
- `scripts/tracking/modules/hud_read/README.md` — обновить описание режима.
