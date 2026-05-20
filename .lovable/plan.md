## Проблема

Нижний таймлайн в `MatchViewer` рисует сегменты `R{N} CD` и `R{N} Closing`, делая искусственный сплит каждой фазы по доле `RING_CLOSE_FRACTION = 0.4` (последние 40% фазы = Closing). Это синтетика, не привязанная к реальным `t_countdown_start` / `t_closing_start` из `rings.json`. Поэтому правая колонка (Match Feed, использует `events` с `t_closing_start`) показывает корректные моменты, а нижняя шкала — нет.

Дополнительно `testGameRingPhases` сейчас задаёт границы фазы как `[prev.t_closing_start … this.t_closing_start]`, то есть фаза N «занимает» интервал от закрытия N-1 до закрытия N. Внутри этого интервала нет данных о моменте появления плашки COUNTDOWN ring N — а именно он нужен, чтобы CD начинался в правильный момент.

## Что меняем

1. **Расширить тип `RingPhase`** в `src/lib/mock-match.ts`:
   ```ts
   export type RingPhase = {
     startSec: number;   // начало CD (или старт игры для R1)
     endSec: number;     // конец Closing
     closingStartSec?: number; // момент перехода CD → Closing
     cx: number; cy: number; r: number;
   };
   ```

2. **Гидрация в `src/lib/test-game-data.ts`** (`testGameRingPhases`):
   - `startSec` = `t_countdown_start` для текущего кольца, иначе `t_closing_start` предыдущего, иначе 0 (для R1).
   - `closingStartSec` = `t_closing_start` текущего кольца.
   - `endSec` = `t_countdown_start` следующего кольца, иначе `t_closing_start` следующего, иначе `testGameDurationSec`.

3. **Обновить `buildRingSegments`** в `src/components/MatchViewer.tsx`:
   - Если `phase.closingStartSec` задан — использовать его как границу CD/Closing.
   - Иначе оставить старый расчёт через `RING_CLOSE_FRACTION` (fallback для дефолтных моков).

## Ожидаемый результат

Нижняя шкала на `/games/m-test-g1` начинает каждую плашку `R{N} CD` ровно в момент `t_countdown_start` из `rings.json` и переключается на `R{N} Closing` ровно в `t_closing_start`. Совпадает с правым Match Feed.

## Файлы

- `src/lib/mock-match.ts` — поле `closingStartSec` в `RingPhase`.
- `src/lib/test-game-data.ts` — заполнение нового поля и пересчёт `startSec/endSec` из реальных таймингов.
- `src/components/MatchViewer.tsx` — `buildRingSegments` уважает `closingStartSec`.
