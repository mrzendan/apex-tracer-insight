## Диагноз

В `rings-7.json` видно три симптома:

1. **R1 пропал полностью.** Хотя CLOSING(1) длится ~6 минут (140s..517s) и должно дать десятки сэмплов на coarse-шаге.
2. **Фантом R5 COUNTDOWN в t=935.9s** — но R5 CLOSING при этом отсутствует, а R4 CLOSING стоит в t=919s. Физически невозможно: пока R4 закрывается, плашка показывает "RING 4 CLOSING", а не "RING 5 IN ...".
3. **R3 / R5 CLOSING отсутствуют**, хотя в предыдущих прогонах с тем же видео они находились в 725s / 1015s.

Все три проблемы — следствия одной архитектурной ошибки в `_scout_rings_with_zone`.

## Корень проблемы

Алгоритм сейчас:

```text
earliest_by[(ring, state)] = min(f for sample in samples if sample == (ring, state))
→ для каждого ключа делаем _rollback_start(...) от этого f
```

Это значит, что **одна-единственная** OCR-ошибка («RING 4» прочитан как «RING 5», или таймер таймера прочитан как COUNTDOWN при том, что текущий ring другой) фиксируется как «earliest» и становится якорем для rollback. Rollback потом честно сужает окно к этому артефакту, и в JSON попадает фантомная фаза с правдоподобным временем (±0.5 кадра вокруг шумового сэмпла).

Симметричная проблема: настоящие фазы могут отсутствовать, если на крупном шаге не повезло попасть в плашку из-за изменившейся HSV-маски (`S<90, V>170` строже, чем была), а одиночный шум побеждает в `earliest_by`.

## Решение

Все правки — в `scripts/tracking/modules/hud_read/hud_read.py`, в `_scout_rings_with_zone` и `read_ring_at`. Внешний контракт (`rings.json`, CLI флаги) не меняется.

### 1. Считать прогон состояний, а не одиночные сэмплы

Вместо `earliest_by[(ring,state)] = min f` строить **runs** — непрерывные отрезки coarse-сэмплов с одним и тем же `(ring, state)`, разрешая «пропуски» (None и опечатки) длиной не более `gap_tolerance` (например 1 сэмпл).

Для каждого `(ring, state)` брать самый ранний *run длиной ≥ 2 сэмпла* как якорь для rollback. Это автоматически отбрасывает одиночные OCR-выбросы — R5@935 не выживет, потому что соседние сэмплы дают R4 CLOSING.

Если ни одного run длиной ≥2 нет, но есть одиночный сэмпл — рапортуем с `confidence: "low"` и НЕ ходим в rollback (чтобы не фабриковать точное время вокруг шума).

### 2. Sanity-проверка результата rollback

После того как `_rollback_start` вернул `f_start`, перечитать 2–3 кадра в окне `[f_start, f_start + scout_step//2]` и убедиться, что хотя бы один даёт ровно `(target_ring, target_state)`. Если ни один не подтверждает — фазу отбрасываем (это был фантом, и rollback просто сошёлся к границе шумового сэмпла).

### 3. Запрет на нарушение монотонности

Кольца в Apex закрываются строго по порядку: `t_countdown_start[N+1] >= t_closed[N] >= t_closing_start[N]`. После сборки всех фаз делаем финальный фильтр:

- если `t_countdown_start[N]` оказался раньше `t_closing_start[N-1]` — фаза N помечается `phantom` и удаляется;
- если `t_closing_start[N]` раньше `t_countdown_start[N]` для того же N — `t_countdown_start[N]` сбрасывается в `null`.

### 4. R1 missing — смягчить HSV-маску и сделать её адаптивной

В `read_ring_at` сейчас `cv2.inRange(hsv, (0,0,170), (179,90,255))`. Плашка R1 в начале матча может иметь другой фон (нет «красного» оттенка опасности), маска `mask.mean() < 3` режет всё.

Правка:
- понизить порог отбраковки до `mask.mean() < 1.5`;
- если основной маски мало (`mask.mean() < 6`), вторым проходом пробовать запасную маску `S<140, V>140` и брать ту, что даёт более длинный OCR-результат с матчем `RE_RING_NUM`.

### 5. Дебаг-вывод для верификации

В лог coarse-пасса (`tqdm.write` около строки 449) добавить пометку, попал ли сэмпл в выбранный run, или классифицирован как outlier. Это пригодится в следующий раз — мы сразу увидим, как R5@935 был отброшен.

## Технические детали

```text
runs = build_runs(samples, gap_tolerance=1)   # list[{ring,state,f_start,f_end,n_samples}]
earliest_runs = {key: min runs by f_start where n_samples >= 2}
fallback singles → confidence="low", no rollback, transition only as informational
```

`build_runs` обходит samples по порядку, начинает новый run при смене `(ring,state)`; единичные «отличающиеся» сэмплы внутри run-а игнорируются, если суммарный gap ≤ `gap_tolerance`.

Sanity-проверка после rollback вызывает уже существующий `read_ring_at` 2–3 раза, бюджет +6 OCR-вызовов на ring — пренебрежимо на фоне coarse-пасса.

## Команды для проверки

```powershell
powershell -ExecutionPolicy Bypass -File `
  scripts\tracking\modules\hud_read\run.ps1 `
  -Video scripts\tracking\game.mp4 -RingsOnly -RingDebugSec 30
```

Ожидаемо в `rings.json`:
- R1 CLOSING присутствует (~140s);
- R5 COUNTDOWN в районе ~935 отсутствует или помечен low/phantom;
- R3 CLOSING (~725s) и R5 CLOSING (~1015s) восстановлены;
- порядок монотонный: для каждого N выполнено `t_countdown_start[N] ≤ t_closing_start[N]`, и `t_closing_start[N] < t_countdown_start[N+1]`.

## Файлы

- `scripts/tracking/modules/hud_read/hud_read.py` — `_scout_rings_with_zone`, `read_ring_at`, новые хелперы `_build_runs`, `_verify_rollback`, финальный `_enforce_monotonic`.
- Остальные файлы (`push.ps1`, `run.ps1`, `sync_to_ui.py`, UI) не меняются.
