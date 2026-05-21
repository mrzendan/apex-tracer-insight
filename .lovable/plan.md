## Что разобрали по логам

**OCR-имена**: все 20 тегов распознаны корректно (`team_tags_raw.json` — 100% locked). Можно закрывать тему имён.

**team_20.pts**: `pts_raw.json` показывает, что tesseract возвращает **пустую строку в 118/120 кадров** (2 раза «0»). Зона геометрически правильная (на скриншотах `f0000000/600/1200.png` чётко видно «11»), но цифры слишком мелкие/тонкие для дефолтного OCR — нужен апскейл + альтернативный psm только для этого слота. Сделаю аккуратный фолбэк, чтобы не сломать остальные.

**Трекинг (`matrix/run_baseline.log`)**: видны конкретные слоты-проблемы:

| Slot | tag  | dominant reason          | проблема |
|------|------|--------------------------|----------|
| 5    | OBVN | never_detected_60f=541   | вообще не находится (тёмная) |
| 8    | STAL | out_of_frame=229         | плашка часто за пределами ROI |
| 10   | THUG | out_of_frame=375         | стартует/находится в углу карты |
| 6    | S2   | shape_reject=174         | блоб не проходит shape-фильтр |
| 7    | SRC  | shape_reject=253         | то же |
| 2    | FREE | shape_reject=88 + sparse | слабый сигнал |

`eval_id_switches.txt`: **coverage 0%** при 5 GT-точках — слотовые id не совпадают с GT (метрика бесполезна без расширения GT).

## План (Wave 3)

### 1) team_20.pts — последний штрих OCR (`scripts/tracking/modules/hud_read/hud_read.py`)

- Для `pts`, если первый OCR-проход вернул пустую строку — повторить с апскейлом ×3 (`cv2.resize(..., INTER_CUBIC)`) и `psm=10` (single char) / `psm=8` (single word). Применяется ко **всем** слотам как универсальный фолбэк, не только к 20-му.
- Если после фолбэка всё ещё пусто — оставить как сейчас (rejected).
- Ожидаемый эффект: «11» из крошечной HUD-плашки начнёт читаться.

### 2) Расширить GT-якоря (`scripts/tracking/modules/track_teams/assets/gt_anchors.json`)

Сейчас 5 точек, нужно ~30, чтобы метрика заработала. Сделаю **разметочный гайд** в `README.md` (как снимать `t`/`world_xy` из миникарты `/admin/tracking-lab` после drag-and-drop) и оставлю файл с теми же 5 точками + TODO-комментариями для 25 будущих — **разметку точек делаешь ты** (мне их неоткуда взять без VOD).

### 3) Init-warmup для первых N секунд (`track_teams.py`)

В `tracking:` секции конфига добавить:
```yaml
tracking:
  init_warmup_sec: 30.0        # до приземления не плодим треки
  init_min_inliers: 25         # повышенный порог регистрации в warmup
  init_reject_world_margin: 30 # отбрасывать детекты у самой границы карты (в canonical_px)
```
В коде: пока `t < init_warmup_sec`, новый трек создаётся **только** если детект ≥ N пикселей от края канонической карты И регистрация HIGH. Это убирает `THUG`-в-углу.

### 4) Per-slot HSV-оверрайды (`configs/hsv_presets.storm-point.json`)

Для слотов 5/6/7/8 расширить S/V диапазоны (HUD-цвет vs игровой цвет команды часто различается на 10–15 единиц яркости). Конкретные значения подберём после первого прогона; сейчас — расширить `v_lo` на −20 и `s_lo` на −20 для проблемных слотов.

### 5) Прогон матрицы + выбор пресета

После 3–4 — перезапустить `run_matrix.ps1` на `game_sp.mp4`, собрать `eval_id_switches.json` по 6 пресетам, выбрать базу (вероятнее всего `color_first` или `hybrid` для тёмных команд).

### 6) Sync UI

`sync_to_ui.py` уже копирует `tracks.slots.json` в `src/data/m-test-g1/` — проверим что цвета карточек на `/games/m-test-g1` совпадают со `SLOT_COLORS` (уже совпадают по коду).

## Что меняю в этом раунде

Только то, что не требует от тебя VOD:

- `scripts/tracking/modules/hud_read/hud_read.py` — апскейл-фолбэк для пустых `pts`.
- `scripts/tracking/modules/track_teams/track_teams.py` — init-warmup (4 строки + чтение из config).
- `scripts/tracking/modules/track_teams/configs/da.baseline.yaml` (и hybrid/color_first) — добавить `init_warmup_sec`/`init_min_inliers`/`init_reject_world_margin`.
- `scripts/tracking/configs/hsv_presets.storm-point.json` — расширить s_lo/v_lo для слотов 5/6/7/8/10.
- `scripts/tracking/modules/track_teams/assets/gt_anchors.json` — оставить как есть + комментарий-гайд.
- `scripts/tracking/modules/track_teams/README.md` — короткая инструкция «как накидать 30 GT-точек».

## Что нужно от тебя после моих правок

1. Прогнать `hud_read/push.ps1` → проверить `pts_raw.json` для slot_20 (должны появиться «11»).
2. Прогнать `track_teams/run_matrix.ps1 -Video scripts\tracking\game_sp.mp4`.
3. Накидать 20–25 GT-точек по гайду в README (для метрики).
4. Прислать новый `eval_id_switches.txt` + `run_baseline.log` — на их основе подкрутим HSV/конфиги.
