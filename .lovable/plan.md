## Цель

Ты у себя локально запускаешь Python-скрипт на mp4, получаешь JSON с треками команд (в координатах канонической карты + зум камеры по кадрам), отдаёшь мне JSON, а я визуализирую его на новой странице `/admin/tracking-lab`.

Я ничего не трекаю в облаке — все тяжёлые вычисления у тебя на машине. В репо будут только: скрипты, образец канонической карты-плейсхолдер, схема JSON, и страница визуализации.

## Что появится в репо

```
scripts/tracking/
  README.md                  # как поставить и запустить
  requirements.txt           # opencv-python, numpy, pyyaml, tqdm, (опц.) easyocr
  config.example.yaml        # пути, ROI карты, HSV пресеты команд, frame_step
  canonical_maps/
    storm_point.png          # заглушка; ты подменишь реальной канонической картой
    storm_point.json         # калибровка canonical_px -> world (как в /admin/zones)
  track_teams.py             # главный скрипт: mp4 -> tracks.json
  preview_overlay.py         # (опц.) рендер mp4 с оверлеем для глазной проверки
  schema/tracks.schema.json  # JSON-схема результата

docs/
  tracking-lab.md            # формат JSON, как загрузить в /admin/tracking-lab

src/routes/
  admin.tracking-lab.tsx     # новая страница визуализации
```

## Pipeline скрипта `track_teams.py`

Аргументы:
```
python track_teams.py --video game.mp4 \
                      --config config.yaml \
                      --out tracks.json \
                      [--frame-step 3] [--start 0] [--end -1] \
                      [--preview preview.mp4]
```

Этапы на каждый обрабатываемый кадр:

1. **Регистрация кадра → каноническая карта** (ключевой шаг — решает проблему зума/пана)
   - ORB (быстро) с фолбэком на SIFT
   - `cv2.findHomography(..., cv2.RANSAC)` → матрица `H` (3×3)
   - Из `H` извлекается `zoom` (средний масштаб), `pan_x/pan_y`, `rotation_deg`, `ransac_inliers`
   - Если инлаеров < порога → кадр помечается `registration: "low_confidence"`, треки экстраполируются Калманом
2. **Детекция плашек команд**
   - HSV-маски из пресетов команд (как в `/admin/hsv`)
   - Морфология + `findContours` → bbox + центроид в пикселях кадра
   - Внутри bbox — поиск треугольника-стрелки (`approxPolyDP`), угол стрелки в пикселях кадра
3. **Перевод в мировые координаты**
   - `pixel_frame -- H --> pixel_canonical -- calib --> world(x,y)`
   - Угол стрелки пересчитывается через `H` (компенсируется поворот камеры)
4. **Трекинг в МИРОВЫХ координатах**
   - Простой Калман + венгерское назначение по `team_id`-цвету
   - Состояние трека: `alive` / `low_conf` / `lost`
5. **Запись JSON** (поток в файл, чтобы не держать всё в RAM)

Производительность: `frame_step` (по умолчанию 3) даёт ~10 fps обработки на 1080p60.

## Формат `tracks.json`

```json
{
  "meta": {
    "video": "game.mp4",
    "fps_source": 60,
    "fps_processed": 20,
    "frame_count": 36000,
    "canonical_map": "storm_point",
    "canonical_size": [4096, 4096],
    "world_bounds": { "x": [0, 1000], "y": [0, 1000] },
    "schema_version": 1
  },
  "frames": [
    {
      "t": 12.50,
      "frame": 750,
      "camera": {
        "zoom": 1.84,
        "pan_canonical": [2104, 1880],
        "rotation_deg": 0.3,
        "registration": "ok",
        "ransac_inliers": 142
      },
      "tracks": [
        {
          "team_id": "red",
          "world": [512.4, 388.1],
          "canonical_px": [2110, 1905],
          "frame_px": [960, 540],
          "angle_world_deg": 47.2,
          "state": "alive",
          "confidence": 0.91
        }
      ]
    }
  ]
}
```

## Калибровка канонической карты

`canonical_maps/storm_point.json` — те же 4+ контрольные точки, что используются в `/admin/zones`, но привязанные к canonical_px. Это позволит мне без изменений переиспользовать твою существующую калибровку world↔map.

На первом этапе кладу плейсхолдер-картинку и пустую калибровку — ты подменишь файлами реальной карты Storm Point.

## Страница `/admin/tracking-lab`

Чисто фронтовая — никаких новых таблиц в БД, никаких server functions. Тебе и так нужна быстрая итерация.

Возможности:
- Drag-and-drop загрузка `tracks.json` (+ опционально соответствующее видео для синхронизации)
- Канва с канонической картой как подложкой
- Поверх — точки команд по `canonical_px`, цвет = team_id, стрелка = `angle_world_deg`
- Прозрачный прямоугольник = текущий viewport observer-камеры (из `pan_canonical` + `zoom`)
- Таймлайн снизу: scrubber по `frame.t`, play/pause, скорость 0.5x/1x/2x/4x
- Боковая панель:
  - Список команд с переключателями видимости
  - График `zoom` по времени
  - График `ransac_inliers` (показывает где регистрация шаталась)
  - Счётчики `registration: low_confidence` / `lost` треков
- Кнопка «Экспорт CSV треков»
- (Если приложено видео) <video> синхронизированное со scrubber'ом — карта и кадр идут вместе

Состояние хранится в памяти страницы, перезагрузка чистит. Этого достаточно для лаборатории.

## Что я делаю в этом проекте

1. Создаю папку `scripts/tracking/` со всеми файлами выше (README объясняет установку opencv-python и запуск).
2. Создаю `src/routes/admin.tracking-lab.tsx` + ссылку в админ-сайдбаре.
3. Документирую формат JSON в `docs/tracking-lab.md`.
4. Не трогаю существующие страницы и БД.

## Что делаешь ты

1. `pip install -r scripts/tracking/requirements.txt`
2. Подкладываешь реальную каноническую карту Storm Point в `canonical_maps/storm_point.png` и её калибровку.
3. Запускаешь `python track_teams.py --video <твой VOD>.mp4 --out tracks.json`.
4. Загружаешь `tracks.json` на `/admin/tracking-lab` — смотрим, обсуждаем, итерируем.

## Открытые вопросы (отвечу по умолчанию, если не уточнишь)

- **Какая карта?** По умолчанию беру Storm Point. Если нужна другая (World's Edge / Olympus / Broken Moon / Kings Canyon) — скажи, поменяю плейсхолдеры. Архитектура multi-map (просто папка `canonical_maps/<name>/`).
- **Источник HSV пресетов?** По умолчанию `config.yaml` содержит дефолты, и есть кнопка экспорта пресетов из `/admin/hsv` в формат конфига (отдельный мелкий эндпоинт, если ок).
- **OCR названий команд?** По умолчанию выключен (медленный). Включается флагом `--ocr` если цвета двух команд совпадают.
- **Сохранять видео-превью с оверлеем?** Опционально через `--preview preview.mp4`, по умолчанию выключено — экономит время.
