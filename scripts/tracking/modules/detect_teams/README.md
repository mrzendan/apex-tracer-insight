# detect_teams

Поиск 20 команд в кадре по HSV-маскам **внутри размеченных зон**.
Заменяет предыдущий bootstrap, который пробовал ловить плашки голым
цветовым кластеризатором и находил только 1/20.

## Откуда берутся настройки

1. **HSV-диапазоны команд** — настраиваются вручную оператором
   на странице `/admin/hsv`. Внизу панели кнопка
   **Download hsv_presets.json** — она сохраняет конфиг текущего фрейма
   (карты) для всех 20 слотов.
2. **Зоны кадра** — настраиваются на `/admin/zones` (VOD / Camera пресеты).
   В панели выбранной зоны кнопка **Download zones.json** —
   сохраняет все зоны выбранного пресета с базой 1920×1080.

Принцип: НЕ ищем команды по всему кадру (там HUD, иконки, кольцо, текст).
Ищем только в зонах с тегом `team` (боковые лидерборды) или `minimap`
(если хочется ловить движущиеся маркеры).

## Запуск

```powershell
python scripts/tracking/detect_teams.py `
  --video D:\path\to\game.mp4 `
  --cuts scripts/tracking/cuts_out/cuts.json `
  --hsv-presets D:\configs\hsv_presets.worlds-edge.json `
  --zones      D:\configs\zones.vod.json `
  --zone-tags  team,minimap `
  --out-dir    scripts/tracking/detect_out `
  --frames 40
```

## Что выдаёт

- `detect_out/team_profiles.json` — для каждого слота медианные `w/h/area`
  плашки (используется на следующем шаге для гейтинга по размеру).
- `detect_out/detections.json` — все найденные bbox: `{frame, t, slot,
  zone, bbox_global, w, h, area}`.
- `detect_out/slots/<NN>/*.png` — до 16 кропов на слот для глазной проверки.
- `detect_out/frames/overlay_*.jpg` — кадры с нарисованными зонами и
  bbox найденных команд (цвет совпадает с hex команды).
- `detect_out/report.txt` — текстовая таблица «slot / hex / n / w / h /
  area / name», видно сразу, какие команды НЕ нашлись.

## Чек-лист, если slot NOT FOUND

1. Открой `/admin/hsv`, переключись на нужный фрейм, выбери эту команду,
   ткни пипеткой в плашку на превью — диапазон H/S/V подвинется.
   Жми **Save preset** и **Download hsv_presets.json**.
2. Проверь `Conflict warning` — если у двух команд overlap ≥ 30%,
   сузь Saturation/Value одной из них.
3. Открой `overlay_*.jpg` — если зоны нарисованы НЕ там, где плашки,
   поправь зоны в `/admin/zones` и пересохрани `zones.json`.
4. Если плашка маленькая (<40 px²) — снизь `--min-area`. Если в зону
   попадают огромные пятна — снизь `--max-area`.

## Связь с остальным пайплайном

```
  find_cuts.py      ->  cuts.json     (исключает грязные кадры)
        +
  /admin/hsv       ->  hsv_presets.json (что искать)
        +
  /admin/zones     ->  zones.json       (где искать)
        v
  detect_teams.py  ->  detections.json + team_profiles.json
        v
  track_teams.py   ->  tracks.json     (Калман в мировых координатах)
```

`team_profiles.json` дальше используется как size-gating для шага трекинга:
на одной игре размер плашки одной команды не меняется, поэтому если
HSV нашёл «правильный цвет, но не тот размер» — это HUD-шум, отбрасываем.