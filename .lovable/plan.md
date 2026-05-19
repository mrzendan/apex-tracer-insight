
# Спецификация данных по страницам сайта

Документ описывает каждую страницу, её ключевые элементы и **какие данные** нужны приложению, чтобы эти элементы работали. Это основа для проектирования API и схемы БД (которая сейчас целиком замокана через `src/lib/mock-match.ts` и `src/lib/admin-store.ts`).

Обозначения:
- **E** — элемент/блок
- **Smysl** — для чего реализован
- **Data in** — входные данные, которые элемент должен получать

---

## 1. Публичная часть

### `/` — Hub (`src/routes/index.tsx`)
- **E: Сводные KPI-карточки** (турниры / матчи / карты / команды)
  - Smysl: быстрый обзор контента
  - Data in: counts из `tournaments`, `matches`, `maps`, `teams`
- **E: Список ближайших / активных турниров**
  - Smysl: точка входа к live-контенту
  - Data in: `Tournament { id, name, startDate, endDate, region, type, status }`
- **E: Карточки матчей с pipeline-статусом** (trajectory / rings / events: ready/processing/error/missing)
  - Smysl: оператор видит, какие матчи готовы к просмотру
  - Data in: `Match { id, name, tournamentId, mapId(s), durationSec }` + агрегированный статус анализов (`AnalysisProcess.status` сгруппированный по `kind`)
- **E: Featured teams / maps**
  - Data in: `Team { id, tag, name, logo, color }`, `ApexMap { id, name, image }`

### `/tournaments` (`src/routes/tournaments.tsx`)
- **E: Фильтр live / upcoming / finished + счётчики**
  - Data in: список `Tournament` с датами + текущая дата (server-side для SSR)
- **E: Группированный список турниров**
  - Data in: `Tournament` + кол-во матчей и количество игр в каждом (`matches.length`, `getGames().length`)
- **E: Превью карт турнира**
  - Data in: уникальный список `mapId` из всех матчей турнира → `ApexMap.image`

### `/matches` и `/matches/$matchId`
- **E: Список матчей с статусом live/upcoming/finished**
  - Data in: `Match`, родительский `Tournament` (для даты), список `Game` (mapId, durationSec)
- **E: Детальная страница матча** — карточки игр со ссылкой в Viewer
  - Data in: `Match`, `Tournament`, массив `Game { id, matchId, index, mapId, durationSec }`

### `/games` и `/games/$gameId` → MatchViewer
- **E: Видео-плеер + таймлайн**
  - Data in: VOD URL (`Match.vodLink` или `Match.mapVods[index]`), `game.durationSec`
- **E: Карта с траекториями команд** (`MatchViewer`)
  - Data in: на каждый `(gameId, teamId)` — `TrajectoryPoint[] { t, x, y }` (нормализованные координаты)
- **E: Кольца (RingPhase, CD/Closing-сегменты)**
  - Data in: `RingPhase[] { startSec, endSec, cx, cy, r }` по игре
- **E: События матча** (kill / knock / ring / care / wipe / endgame) + фильтры
  - Data in: `GameEvent[] { t, type, team?, label }`
- **E: Селекторы команд + статус «alive»**
  - Data in: `Team[]` участники, `placement`, `kills`, `alive` (на момент игры — статистика per-game)

### `/teams` и `/teams/$teamId`
- **E: Список команд (поиск + сортировка)**
  - Data in: `Team { id, tag, name, color, logo, players, placement, kills, alive, status }`
- **E: Расписание команды (next / past matches)**
  - Data in: `Match.teamIds`, `Tournament.startDate/endDate` → даты + время матча
- **E: Переключатели режима** (all / by year / by tournaments)
  - Data in: `Tournament.year`, агрегация матчей команды
- **E: Карты, где играла команда** (с превью)
  - Data in: уникальные `mapId` из матчей команды

### `/maps` и `/maps/$mapId` → MapDetailContent
- **E: Список карт пула**
  - Data in: `ApexMap { id, name, image, code, previewImage, config }`
- **E: Heatmap по карте для выбранной команды + набора турниров**
  - Data in: для каждой `(mapId, teamId, gameId)` — `TrajectoryPoint[]`; группировка по году/турниру → требуется `Tournament.year` и `Match.tournamentId`
- **E: Список игр по карте**
  - Data in: фильтрованный список `Game` + родительский `Match` и `Tournament`

### `/login`, `/accept-invite`
- **E: Login форма** (email + password, Google OAuth)
  - Data in: Supabase Auth session
- **E: Принятие инвайта**
  - Data in: `invites { token, email, role, expires_at, used_at, max_uses, uses_count }` → создание `profile` и `user_roles`

---

## 2. Админ-панель (`/admin/*`)

### `/admin` — Layout + Index
- **E: Sidebar навигация по группам** (Data / Calibration / Analysis / Tools)
  - Data in: текущий маршрут, роль пользователя (`useAuth()` → operator/administrator)
- **E: Dashboard-обзор**
  - Data in: счётчики сущностей (turn/matches/teams/maps/zones/polygons/processes)

### `/admin/tournaments`
- **E: CRUD турниров + ALGS-таблица очков по матчам/командам**
  - Data in: `Tournament { ... + status, split, stage, description, liquipediaUrl }`, связанные `Match.teamIds`, плейсменты команд per-game
- **E: Список матчей турнира**
  - Data in: `Match[]` где `tournamentId = X`
- **E: Статус процессов по турниру** (Linked Processes)
  - Data in: `AnalysisProcess[]` где `tournamentId = X`

### `/admin/matches` и `/admin/matches/$matchId`
- **E: Таблица матчей с производным статусом** (draft/ready/processing/completed/error)
  - Data in: `Match` + `vodLink` + `teamVods{teamId→url}` + `teamIds` + `mapIds` + статусы `AnalysisProcess`
- **E: Редактор матча**
  - Data in: VOD links (main + per-team POV + per-map + common), список карт `mapIds[]`, длительности `gameDurations[]`, `teamIds[]`
- **E: Редактор per-team POV VOD**
  - Data in: `MatchExtras.teamVods: Record<teamId, url>`

### `/admin/teams` и `/admin/teams/$teamId`
- **E: CRUD команды**
  - Data in: `Team { id, tag, name, color, logo (variant: light/dark), players[], status, liquipediaUrl }`
- **E: Подробная статистика команды по диапазонам** (week/month/3mo/6mo/12mo, by year, by tournaments)
  - Data in: `Match.teamIds`, фактические даты матчей, плейсменты, kills, дамаг per-game → нужна таблица `game_team_stats { gameId, teamId, placement, kills, damage }`
- **E: Карты, где играла команда** + ссылка на heatmap
  - Data in: уникальные `mapId` + per-team аналитика

### `/admin/maps` и `/admin/maps/$mapId`
- **E: Сетка/таблица карт со статусом конфигурации** (Image / Polygons / HSV)
  - Data in: `ApexMap.config { image, zones, polygons, hsv, camera, minimap : bool }`
- **E: Кастомные карты (upload)**
  - Data in: `CustomMap { id, name, image (DataURL/Storage URL) }`, сейчас в localStorage
- **E: Heatmap карты для команды + контрольные фильтры**
  - Data in: `TrajectoryPoint[]` per game + per team

### `/admin/zones`
- **E: Холст 1920×1080 с зонами HUD** (per mode: vod / camera)
  - Data in: `Zone { id, name, tag (team|camera|minimap|timer|map_name), x, y, w, h }` per `ZoneMode`, фоновое изображение примера

### `/admin/polygons`
- **E: Карта + рисование forbidden/safe полигонов**
  - Data in: `Polygon { id, mapId, name, tag (forbidden|safe), points[]: {x,y} нормализованные }`, фон карты `ApexMap.image`

### `/admin/hsv`
- **E: Пипетка + калибровка HSV-диапазонов команд**
  - Data in: тестовые фреймы (`Frame { id, name, image }`), `HsvPreset { teamId/mapId, h, s, v ranges }` (требуется новая таблица)

### `/admin/camera`
- **E: Видео-плеер с симуляцией camera tracking**
  - Data in: VOD URL, координаты zoom-окна, `RingPhase[]`, `TrajectoryPoint[]` для команды
- **E: 30+ параметров `TrackingSettings`** (smoothing, deadzone, EMA, jump detection, ring/team weights и т.д.)
  - Data in: сохранённые `CameraPreset { id, name, viewport, settings }` per map/team
- **E: Дебаг-оверлеи и кадры**
  - Data in: список debug-фреймов от processing-pipeline

### `/admin/minimap`
- **E: Source preview / Full map / Track timeline / Sidebar Configuration**
  - Data in:
    - источник: `teamVods[teamId]` или uploaded video/screenshot
    - minimap zone из `/admin/zones` (`zones.vod` с `tag=minimap`)
    - результат трекинга — `TrackPoint[] { frame, t, x, y, status, score, confidence, jump, bbox, window }`
    - связанный процесс — `AnalysisProcess { id, status, progress }`
    - настройки matching (search mode, thresholds, jump rules) сохраняются как пресет

### `/admin/processes`
- **E: Фильтры по статусам + Needs attention + Suggested**
  - Data in: `AnalysisProcess[]` с полями `status, kind, qualityScore, needsReview, matchId, tournamentId, startedAt, finishedAt`
- **E: Таблица процессов с per-map / per-team progress**
  - Data in: `MapAnalysis[] { mapIndex, ring, start, camera, teams: {teamId, progress} }` per `AnalysisProcess`
- **E: Detail panel** (Identification / Context / Source / Progress / Settings / Quality / Result files / Error log)
  - Data in: полная `AnalysisProcess` + список выходных файлов (storage paths) + `errorMessage`
- **E: Editor процесса** (auto-detect ALGS-метаданных)
  - Data in: URL → метаданные видео (title/channel/duration), список карт (`mapId + start/end сек`), `frameStep`, `preset`, `debugMode`

### `/admin/users` (только administrator)
- **E: CRUD пользователей + инвайты**
  - Data in: `profiles { id, email, display_name, created_at }`, `user_roles { user_id, role }`, `invites { token, email, role, expires_at, max_uses, uses_count, used_at }`

### `/admin/schema`, `/admin/diagrams`
- **E: Редакторы схемы БД и диаграмм процессов**
  - Data in: документы хранятся в localStorage (`apex-stats:schema-v3`, `apex-stats:diagrams-v1`) — кандидаты на отдельную таблицу `admin_docs { key, payload jsonb, updated_by }`

---

## 3. Сводная карта сущностей (то, что нужно положить в БД)

```text
auth (есть)        ──> profiles, user_roles, invites
                       (есть таблицы)

core
  tournaments      { id, name, startDate, endDate, year, type, region,
                     status, split, stage, description, liquipediaUrl }
  teams            { id, tag, name, color, logo, logoLight, logoDark,
                     players[], status, liquipediaUrl }
  team_players     { teamId, name, role?, joinedAt?, leftAt? }   ← новое
  maps             { id, name, code, image, previewImage,
                     config: {image,zones,polygons,hsv,camera,minimap} }
  custom_maps      { id, name, image }                           ← миграция из localStorage

  matches          { id, name, tournamentId, durationSec,
                     vodLink, mapVodCommon }
  match_teams      { matchId, teamId, povVodUrl? }               ← вместо teamIds + teamVods
  games            { id, matchId, index, mapId, durationSec, vodLink? }

analysis
  game_team_stats  { gameId, teamId, placement, kills, damage, alive }
  trajectories     { gameId, teamId, points: jsonb [{t,x,y}] }
  ring_phases      { gameId, index, startSec, endSec, cx, cy, r }
  game_events      { id, gameId, t, type, teamId?, label }

calibration
  zones            { id, mode (vod|camera), name, tag, x, y, w, h }
  polygons         { id, mapId, name, tag (forbidden|safe), points: jsonb }
  hsv_presets      { id, scope (team|map), refId, h, s, v ranges }
  camera_presets   { id, name, mapId?, teamId?, viewport, settings: jsonb }
  minimap_presets  { id, name, searchMode, thresholds: jsonb }

processes
  processes        { id, pov, kind, live, streamUrl, status,
                     tournamentId, matchId, teamId?, preset, frameStep,
                     debugMode, qualityScore, needsReview,
                     startedAt, finishedAt, errorMessage, createdAt }
  process_maps     { processId, mapIndex, mapId, startSec, endSec,
                     ring, start, camera }
  process_teams    { processId, mapIndex, teamId, progress }
  process_files    { processId, kind (result|debug|track), path, size }
  track_points     { processId, mapIndex, frame, t, x, y, status,
                     score, confidence, jump, bbox: jsonb, window }

admin / docs
  admin_docs       { key (schema|diagrams|...), payload jsonb,
                     updated_by, updated_at }
```

---

## 4. Чего сейчас НЕТ в коде, но требуется по UI

1. **Реальные траектории / события / кольца per (game, team)** — генерируются на лету через `generateTrajectory(seed)`. Нужны реальные результаты обработки.
2. **Per-game stats команды** (placement/kills/damage) — сейчас живут только на уровне `Team` агрегатом.
3. **Расписание матчей** — даты выводятся из `Tournament.startDate` + индекс. Нужно поле `Match.scheduledAt` или `Game.scheduledAt`.
4. **Storage** — VOD-видео, скриншоты, debug-фреймы, result.json/jpg/mp4 (нужен bucket в Lovable Cloud).
5. **Long-running processes** — нужен механизм обновления статуса (Realtime канал на `processes`).
6. **Documents** (schema / diagrams) — сейчас в localStorage, не персистятся между устройствами.
7. **Связь Match ↔ Team со статусом** (active / sub / withdrawn) и POV VOD как отдельная строка.
8. **Метаданные источника** (region/day/matchup) — сейчас парсятся из мок-описания, нужны как поля `Match`.

---

## 5. Следующие шаги (при переходе в build)

1. Зафиксировать данную спецификацию как `docs/data-spec.md` (read-only справочник).
2. Создать миграции для **core**-блока (tournaments, teams, maps, matches, match_teams, games).
3. Подключить чтение через `createServerFn` и заменить `useAdminStore` поэтапно, начиная с публичных страниц.
4. Поднять Storage-бакеты: `vods`, `screenshots`, `debug`, `results`.
5. Добавить таблицы analysis (trajectories, ring_phases, game_events, game_team_stats).
6. Реализовать processes-домен + Realtime.
7. Перевести calibration (zones/polygons/hsv/camera/minimap presets).
8. Перенести admin_docs из localStorage.
