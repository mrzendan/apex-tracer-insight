## Цель

Единая структура во всём проекте:

```
Tournament
  └── Match (один матч турнира, день/серия)
        └── Game (= одна карта, объект анализа)
```

Сейчас `Match` фактически = одна карта (game). Поле `mapIds[]` уже намекает на множественность, но используется только в admin. Нужно явно ввести `Game` и сделать так, чтобы /tournaments и весь UI оперировал двухуровневой моделью.

## Изменения в данных (`src/lib/mock-match.ts`)

- Ввести тип `Game = { id, matchId, mapId, durationSec, index }`.
- `Match = { id, name, tournamentId, gameIds: string[] }` — без `mapId`/`durationSec`.
- `MatchExtras` (теперь `MatchFull`) теряет `mapIds` (заменён `gameIds`), оставляет `vodLink`, `teamIds`, `teamVods`.
- Добавить экспорт `games: Game[]` и хелперы: `getGamesOfMatch(matchId)`, `getMatchOfGame(gameId)`, `matchDurationSec(match)`, `firstGameMapId(match)`.
- Перегенерировать seed: 6 текущих "матчей" становятся 6 `Game`-ами, сгруппированными в 2–3 `Match` (по турниру). Например:
  - `algs-2026-split-1` → `m-101` (Match Day 1) с 4 games (Worlds Edge, Storm Point, Broken Moon, E-District).
  - `esl-pro-league-12` → `m-102` (Week 1) с 2 games (Olympus, King's Canyon).
- Маршрут анализа `/matches/$matchId` смыслово становится "просмотр карты", поэтому переименуем в `/games/$gameId`. `MatchViewer` принимает `initialGameId`.

## Маршруты

- Переименовать `src/routes/matches.$matchId.tsx` → `src/routes/games.$gameId.tsx` (просмотрщик одной карты).
- `src/routes/matches.tsx` оставить как список матчей, но карточка показывает: турнир, название матча, число игр, превью первой карты, список карт. По клику открывается страница матча с играми.
- Новый файл `src/routes/matches.$matchId.tsx` — детальная страница матча: список Games со ссылками на `/games/$gameId`.
- `/tournaments` — для каждого турнира показывает список Matches (не игр). У матча: название + чипы карт (games).

## Admin

- `admin-store`: seed строит `games`, обновить `MatchFull` shape, добавить CRUD по `games` (минимально: `setGames`, `updateGame`).
- `admin.matches.tsx`: колонка "Map" заменена на "Games (N)" с превью карт; модалка редактирования матча редактирует `gameIds` (порядок, добавить/удалить game, в подформе game — выбрать map и durationSec).
- `admin.matches.$matchId.tsx`: блок "Map order" становится "Games" — те же действия, но создаёт/удаляет записи в `games`.
- `admin.processes.tsx`, `admin.maps.tsx`, `admin.minimap.tsx`, `admin.camera.tsx`, `admin.hsv.tsx`, `admin.polygons.tsx`: заменить чтение `match.mapId`/`match.durationSec` на game-based выбор. Где раньше выбирали матч и затем смотрели карту — теперь выбирают game (или match → game).

## Frontend (index/teams/maps)

- `src/routes/index.tsx`: stats `matches` остаётся (это число матчей), добавить stat `games`. "Последние матчи" → "Последние игры" (Games) и линкуем на `/games/$gameId`; либо оставить матчи и показывать их превью + список игр. Выберу второе: featured = последняя готовая game, "recent matches" = последние матчи с их играми.
- `src/routes/teams.$teamId.tsx`: панели "Next matches" / "Matches" работают с матчами, но статистика по картам считается по `games` команды.
- `src/routes/maps.$mapId.tsx`, `src/components/maps/MapDetailContent.tsx`: список "матчей на карте" → "игр на карте" (Games).

## Адаптеры/совместимость

`MatchViewer` сейчас живёт от `matchId` + `mock-match.events/ringPhases`. Эти моки относятся к одной игре, поэтому привязываем их к `gameId`. `events`/`ringPhases` экспортируем как функции `eventsFor(gameId)` / `ringsFor(gameId)` (пока возвращают одно и то же — это мок).

## Проверка консистентности

После рефакторинга прогон по проекту: `rg "\\.mapId\\b|mapIds"` — все оставшиеся вхождения должны относиться к `Game` или к `Map` (карте), не к `Match`. Названия в UI: "матч" = Match (контейнер игр), "игра/карта" = Game.

## Объём

~14 файлов: `mock-match.ts`, `admin-store.ts`, 2 admin matches + ~5 других admin, `index.tsx`, `matches.tsx`, `matches.$matchId.tsx` (новый), `games.$gameId.tsx` (переименован), `tournaments.tsx`, `teams.$teamId.tsx`, `maps.$mapId.tsx`, `MapDetailContent.tsx`, `MatchViewer.tsx` (мелкая правка пропа).
