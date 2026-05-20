# План: аудит scripts/tracking + HUD-модуль + теги команд/HUD в /admin/zones

## 1. Реструктуризация `scripts/tracking/`

Сейчас всё свалено в корень: `.py`, `.ps1`, README'ы, ассеты, конфиги и
output-папки лежат рядом. Пока модулей мало — переложим в единый шаблон
**один модуль = одна папка**, и внутри каждой свои подпапки.

### Целевая структура

```text
scripts/tracking/
  README.md                    # обзор: какие модули, в каком порядке запускать
  requirements.txt             # общий для всех модулей
  .venv/                       # (gitignored)
  shared/
    canonical_maps/            # бывшая canonical_maps/
    schema/                    # бывшая schema/
  modules/
    find_cuts/
      README.md                # описание + параметры + локальный/push-запуск
      find_cuts.py
      run.ps1                  # бывшая cuts.ps1 (локально)
      push.ps1                 # запуск + git push для моего аккаунта
      configs/                 # пресеты, если появятся
      assets/                  # сэмплы кадров, тестовые видео-пути
      reports/                 # бывшая cuts_out/ (gitkeep + git push сюда)
    detect_teams/
      README.md
      detect_teams.py
      run.ps1
      push.ps1
      configs/
      assets/
      reports/
    motion_detect/
      README.md                # уже есть, переедет
      motion_detect.py
      run.ps1                  # бывшая motion.ps1 без push
      push.ps1                 # бывшая motion.ps1 (с git push)
      configs/                 # hsv_presets.*.json, zones.vod.json
      assets/
      reports/                 # бывшая motion_out/
    track_teams/
      README.md
      track_teams.py
      config.example.yaml
      run.ps1
      push.ps1
      configs/
      assets/
      reports/                 # бывшая tracks.json/ (некорректное имя сейчас)
    debug_register/
      README.md
      debug_register.py
      run.ps1
      push.ps1
      reports/                 # бывшая debug_out/
    hud_read/                  # НОВЫЙ модуль (см. раздел 2)
      README.md
      hud_read.py
      run.ps1
      push.ps1
      configs/
      assets/
      reports/
```

### Правила нейминга

- Все папки — snake_case, осмысленные: `reports/` вместо `*_out`,
  `configs/` вместо рядом лежащих json'ов, `assets/` для сэмплов
  кадров/изображений.
- В каждом модуле обязательно: `README.md`, `<module>.py`, `run.ps1`,
  `push.ps1`, плюс `configs/`, `assets/`, `reports/` (с `.gitkeep`).
- `tracks.json/` (сейчас это **папка**, а не файл) переименовать в
  `modules/track_teams/reports/`.

### Шаблон README каждого модуля

1. **Назначение** — что делает и зачем нужен в общем пайплайне.
2. **Зависимости** — какие файлы из других модулей читает
   (например `find_cuts/reports/cuts.json`).
3. **Параметры** — таблица флагов `<module>.py` и параметров `run.ps1`,
   с дефолтами и кратким объяснением, что регулирует каждый.
4. **Гайд по тюнингу** — какие параметры крутить под какую проблему
   (формат «симптом → флаг»).
5. **Запуск (`run.ps1`)** — локально, без git.
6. **Запуск с push (`push.ps1`)** — для моего аккаунта, коммитит
   `reports/` и пушит, чтобы агент в Lovable сразу увидел вывод.
7. **Формат вывода** — что лежит в `reports/` и как это читать.

### Что меняется в коде скриптов

- Переезд = перенос файлов, плюс правка путей по умолчанию внутри
  `*.ps1` и `argparse` defaults в `*.py` (`--cuts`, `--hsv-presets`,
  `--zones`, `--out-dir`) — теперь они относительно собственной папки
  модуля или `shared/`.
- `motion.ps1` распиливается на `run.ps1` (без git) и `push.ps1`
  (с коммитом+push). Аналогично для остальных, чтобы шаблон был один.
- Корневой `scripts/tracking/README.md` — короткий: список модулей и
  ссылки на их README, плюс рекомендуемый порядок запуска.

## 2. Новый модуль `hud_read`

Назначение: читать HUD VOD'а — статичный оверлей с состоянием матча
и таблицами команд слева/справа — и выгружать структурированный JSON
(`game_number`, `map_name`, `teams_alive`, `players_alive`,
`ring_status`, по каждой команде: `logo`, `name`, `hero1..3`, `pts`,
`eliminated_at`).

Модуль читает зоны из `/admin/zones` (см. раздел 3): подложку
`VOD STREAM 2`, теги `HUD` и `Team 1..20`. Внутри каждой зоны:

- **OCR** (`pytesseract`) для текстовых полей (`game number`,
  `map name`, `pts`, `eliminated`, `name`, `ring status`,
  `number of teams/players alive`).
- **Image hash / template match** для `logo` (сравнение с
  логотипом команды из БД) и `hero 1..3` (с легендой).

Структура папки — как в общем шаблоне (см. раздел 1). README
описывает: что считается, какие зоны должны быть размечены,
параметры (`--frame-step`, `--ocr-lang`, пороги матчинга), запуск
`run.ps1` / `push.ps1`. Сам пайплайн распознавания и БД-маппинг — в
следующем шаге; сейчас задача: завести скелет модуля и связку
с зонами.

## 3. Изменения в `/admin/zones`

### 3.1 Новая встроенная подложка `VOD STREAM 2`

- Скопировать загруженный скриншот в
  `src/assets/zones-samples/vod-stream-2.png`.
- В `admin.zones.tsx`:
  - Расширить `ZoneMode` (в `src/lib/admin-store.ts`) на
    `"vod" | "vod2" | "camera"`, добавить пустой массив зон для `vod2`
    в начальный стейт стора.
  - В `BUILTIN` добавить `{ id: "vod2", label: "VOD Stream 2", mode: "vod2" }`.
  - В словарь подложек: `mode === "vod2" ? vodBg2 : ...`.

### 3.2 Теги `Team 1..20` и `HUD`

- В `DEFAULT_TAG_COLORS` добавить:
  - `hud` — нейтральный цвет (например `#38bdf8`).
  - `team_1`..`team_20` — взять цвета из существующей палитры команд
    (`src/lib/team-colors.ts`), чтобы визуально совпадали с
    HSV-пресетами.
- Так как тегов теперь много, нарастить UI:
  - Сворачиваемая группа «Teams» в панели тегов (как было «hidden
    tags» сейчас), чтобы 20 чипов не ломали layout.
  - Кнопки `Show only HUD` / `Show only Teams` для быстрого
    переключения.
- Внутри зон с тегом `team_*` пользователь сам создаёт под-зоны с
  именами `logo`, `name`, `hero 1`, `hero 2`, `hero 3`, `pts`,
  `eliminated`. Имя зоны (поле `name`) — единственное, что отличает
  под-зоны; читать их из JSON в `hud_read.py` будем по комбинации
  `tag=team_N` + `name=<slot>`.
- Аналогично для `tag=hud` — под-зоны с именами `game number`,
  `map name`, `number of teams alive`, `number of players alive`,
  `ring status`.

### 3.3 Модалка подтверждения при импорте JSON

Сейчас `Import zones.json` сразу заменяет зоны активного пресета,
без подтверждения. Поведение нужно сделать как в `/admin/hsv`:
не «прыгать» на пресет из файла, а спросить, куда применить.

- При выборе файла:
  1. Распарсить JSON, вычислить:
     - `mode` из payload (если есть) и `preset_label` (если есть в
       будущем расширении формата);
     - количество зон;
     - набор используемых тегов.
  2. Открыть `AlertDialog` (тот же компонент, что в `admin.hsv.tsx`)
     с текстом «Import N zones into …?» и кнопками:
     - **Replace current preset** — записать в активный пресет
       (текущее поведение).
     - **Replace matching builtin** (`VOD Stream` / `VOD Stream 2` /
       `Player Cam`) — если в payload есть `mode`, подставить именно
       его, но без авто-переключения вкладки.
     - **Create new custom preset** — добавить новый
       `CustomPreset` с зонами из файла и переключиться на него.
     - **Cancel**.
  3. После применения — toast/alert с количеством импортированных
     зон, активная вкладка меняется **только** если пользователь
     явно выбрал «Create new».
- Сейчас импорт молча выкидывает все теги, которых нет в текущем
  списке. В модалке также показать список **новых тегов** из файла
  и предложить «Add missing tags» (чекбокс, по умолчанию on),
  иначе зоны с такими тегами получат fallback `tags[0]`.

## 4. Порядок работ

1. Перенос файлов и переписывание `*.ps1` / `argparse` defaults
   (раздел 1) — отдельный коммит, чтобы diff был читаемый.
2. Шаблонные README для каждого модуля по единой схеме (раздел 1.5).
3. Скелет `modules/hud_read/` с README + пустым `hud_read.py`
   и `run.ps1`/`push.ps1` по шаблону (раздел 2).
4. Подложка `vod-stream-2.png`, режим `vod2`, теги `hud` и
   `team_1..team_20` (3.1, 3.2).
5. Модалка импорта в `admin.zones.tsx` (3.3).

## Технические детали

- `ZoneMode` сейчас `"vod" | "camera"` в `src/lib/admin-store.ts`;
  расширение требует миграции дефолтов стора и проверки всех
  использований `store.zones[...]`.
- Для модалки переиспользуем `AlertDialog` из `@/components/ui/...`
  — тот же импорт, что уже есть в `admin.hsv.tsx`.
- 20 цветов команд берём из `src/lib/team-colors.ts` (либо из
  существующего HSV-пресета `worlds-edge`), чтобы цвета чипов
  тегов совпадали с реальными плашками.
- Никаких изменений в `motion_detect.py` / `find_cuts.py` /
  `detect_teams.py` по логике — только пути по умолчанию.
- `git mv` сохранит историю файлов.
