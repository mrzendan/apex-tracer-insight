## Что уже видно по коду

1. **Главная причина неправильного тайминга смерти на карте найдена.**
   `MATCH FEED` строится из `eliminations.json` и показывает корректные события вида:
   ```text
   ELTE eliminated
   ```
   Но `MatchViewer` для карты пытается извлечь смерть регуляркой только из старого формата:
   ```text
   <KILLER> wipes <VICTIM>
   ```
   Поэтому реальные wipe-события не попадают в `deathTimes`, и карта использует fallback по placement. Отсюда команда “умирает” в другом тайминге.

2. **Почему видно только 8–9 команд:**
   карта рисует команду только если у неё есть хотя бы одна валидная точка трека до текущего времени. Сейчас `tracks.json` содержит 20 slot-id, но большая часть точек имеет состояния `wiped/lost`, которые фронт отбрасывает. Нужно отдельно проверить: это ошибка `track_teams`, фильтра на фронте или рассинхрон времени между `tracks` и HUD.

3. **Риск stale-данных:**
   `MTestDataIO` может подменять встроенные JSON через `localStorage`. Даже после обновления git-файлов сайт может показывать старый локальный override, если он был загружен раньше.

## План исправления

### 1. Сделать `hud_timeline.json` единым источником HUD-смертей

Изменить pipeline так, чтобы после scout/two-pass данные из `eliminations.json` встраивались прямо в `hud_timeline.json`, например:

```json
{
  "timeline": [...],
  "eliminations": {
    "1": {
      "f_first_dead": 62070,
      "t_first_dead": 1035.53,
      "f_last_alive": 62069,
      "t_last_alive": 1035.52,
      "source": "scout"
    }
  }
}
```

После этого `eliminations.json` можно оставить только как debug-artifact в `reports/`, но фронт больше не должен от него зависеть.

### 2. Обновить `sync_to_ui.py`

- При синхронизации читать `hud_read/reports/eliminations.json`.
- Вмерживать его в `hud_timeline.json` перед копированием в `src/data/m-test-g1/`.
- Не копировать `eliminations.json` в UI как runtime-источник.
- Добавить в консольный вывод краткий sanity-check:
  ```text
  HUD timeline teams: 20
  eliminations embedded: 20 slots / 15 dead / 5 alive
  tracks ids: 20
  ```

### 3. Переписать гидрацию фронта

В `src/lib/test-game-data.ts`:

- импортировать смерти из `hud_timeline.eliminations`, а не из отдельного `eliminations.json`;
- `testGameEvents` строить из этого embedded-блока;
- `testGameTeams.alive`, placement и `testGameDurationSec` строить из него же;
- `testGameTrajectories` фильтровать по тому же источнику.

Итог: Feed, left team list, alive counter и карта используют один и тот же death-source.

### 4. Исправить `deathTimes` в `MatchViewer`

Сейчас карта ломается из-за парсинга label. Нужно убрать зависимость от текста label.

Варианты:

- быстрый безопасный фикс: для wipe-события считать `e.team` eliminated-командой, если label заканчивается на `eliminated`;
- лучше: расширить `GameEvent` полем `teamId` или `slot`, чтобы карта не парсила human-readable text.

Я бы сделал второй вариант:

```ts
type GameEvent = {
  t: number;
  type: ...;
  team?: string;
  teamId?: string;
  slot?: number;
  label: string;
}
```

Тогда `deathTimes` берёт `e.teamId` напрямую.

### 5. Добавить debug-панель/лог для рассинхрона

Для `/games/m-test-g1` добавить dev/debug блок, который показывает по каждой команде:

```text
slot | tag | hud death | event death | track first | track last | visible points | states
```

Это позволит сразу видеть:

- есть ли у команды трек;
- почему она не рисуется;
- где расходятся HUD death и track death;
- сколько точек выкинул фильтр.

Можно сделать это скрытым в существующем `Data I/O`, чтобы не портить основной UI.

### 6. Жёсткий CLI-debug перед коммитом

Добавить отдельный скрипт, например:

```text
scripts/tracking/debug_match_data.py
```

Он будет сравнивать:

- `hud_timeline.eliminations`
- `tracks.json`
- `tracks.slots.json`
- `slot-to-tag.json`

И печатать таблицу проблем:

```text
slot  tag   hud_dead  track_last  drawable_pts  verdict
1     ELTE  1035.53   1028.00     14            OK
4     NIPC  alive     220.00      0             BAD: no drawable track after early game
...
```

Это важнее, чем визуально гадать по сайту.

### 7. Проверить проблему “8–9 команд” отдельно

После фикса death-source нужно выяснить, почему треки не видны:

- если `track_teams` реально помечает живые команды как `wiped` слишком рано — чинить tracker/state-machine;
- если точки есть, но фронт слишком жёстко фильтрует `wiped/lost` — ослабить фильтр или использовать `last known position` до HUD death;
- если время трека сдвинуто относительно HUD — добавить offset/calibration.

### 8. Про скриншоты и кредиты

Точный расход кредитов я не вижу: он зависит от платформенного тарифа, модели и размера изображения. Но общий принцип такой:

- **обычные browser screenshots** для проверки UI — почти бесплатная/техническая операция;
- **AI-анализ изображения** дороже текста, особенно если часто отправлять большие кадры;
- для нашей задачи лучше не гонять AI по каждому кадру.

Оптимальный подход:

1. Генерировать debug-кадры локально скриптом: трансляция + наложенный трекинг + HUD labels.
2. Сравнивать массово численно: координаты, времена, visible points, состояния.
3. AI/визуальный анализ использовать редко: например 10–20 ключевых моментов матча — старт, перед смертью, после смерти, спорные команды.

Так мы не сожжём кредиты на постоянный vision-анализ и получим более воспроизводимый дебаг.

## Проверка после реализации

- `MATCH FEED` и карта должны использовать одинаковые wipe-times.
- Команда должна становиться tombstone ровно на `hud_timeline.eliminations[slot].t_first_dead`.
- Debug table должен показать 20 команд, их death-time и количество drawable track points.
- Если после этого всё ещё видно 8–9 команд — причина будет уже локализована в `track_teams`, а не во фронте.