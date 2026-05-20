# Tracking Lab — локальные скрипты

Пайплайн обработки VOD матча Apex. Тяжёлые вычисления — на машине
аналитика. В Lovable Cloud ничего не считается, только хранится
`tracks.json` / `hud_timeline.json` для визуализации.

## Установка

```bash
cd scripts/tracking
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Структура

```text
scripts/tracking/
  README.md                  # этот файл
  requirements.txt
  shared/
    canonical_maps/          # эталонные карты + калибровка
    schema/                  # JSON-схемы артефактов
  modules/
    find_cuts/               # детектор «прыжков» камеры
    detect_teams/            # bootstrap-поиск 20 команд в зонах
    motion_detect/           # стартовые позиции (HIGH/MED/LOW консенсус)
    track_teams/             # онлайн-трекинг в мировых координатах
    debug_register/          # sanity-check регистрации кадра ↔ карта
    hud_read/                # чтение HUD (game/map/teams alive/ring + команды) [скелет]
```

В каждой папке модуля единая структура:

```text
modules/<name>/
  README.md       # описание + параметры + тюнинг + формат вывода
  <name>.py       # сам скрипт
  run.ps1         # локальный запуск (без git)
  push.ps1        # запуск + git commit + git push (для моего аккаунта,
                  # чтобы Lovable-агент сразу увидел свежие reports/)
  configs/        # пресеты, специфичные для модуля
  assets/         # сэмплы, эталоны
  reports/        # вывод последнего запуска (коммитится в git)
```

## Рекомендуемый порядок запуска

1. **`debug_register`** — убедиться, что регистрация кадр↔карта работает
   на этом VOD'е. Если нет — фиксим `config.yaml` / каноническую карту
   до того, как тратить время на остальные шаги.
2. **`find_cuts`** — нарезать VOD на участки между катами камеры.
   Дальше работаем только внутри непрерывных сегментов.
3. **`motion_detect`** — на коротком окне внутри сегмента найти
   стартовые координаты всех 20 команд (HIGH/MED/LOW консенсус
   трёх методов). Анкеры для онлайн-трекера.
4. **`detect_teams`** — то же, но bootstrap по зонам лидерборда
   (sanity-check для HSV-пресетов).
5. **`track_teams`** — онлайн-трекинг в мировых координатах. Главный
   выход: `tracks.json` для `/admin/tracking-lab`.
6. **`hud_read`** — параллельно: что показывает HUD в каждый момент
   времени. Сшивается с `tracks.json` по таймстампу.

Подробности по каждому модулю — в его собственном `README.md`.

## Отдача результата

- `tracks.json` (`modules/track_teams/reports/`) — drag-and-drop на
  `/admin/tracking-lab`.
- `report.txt` любого модуля — после `push.ps1` агент в Lovable
  увидит свежий коммит и сможет прочитать вывод сам.
