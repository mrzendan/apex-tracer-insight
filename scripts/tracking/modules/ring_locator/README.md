# ring_locator — геометрия колец в canonical-координатах

Второй слой ring-трекинга. Тайминги фаз приходят из `hud_read`
(`rings.json`). Здесь мы только **измеряем (cx, cy, r)** кольца в
координатах канонической карты (`shared/canonical_maps/<name>.png`),
чтобы фронт мог рисовать кольца поверх статичной PNG без подгонки под
плавающую HUD-миникарту.

## Алгоритм

Для каждого кольца N (по умолчанию N ∈ {1, 2, 3} — см. roadmap):

1. Берём окно после старта `COUNTDOWN(N+1)` — там кольцо N+1 уже
   нарисовано и стоит. (`t_anchor + post_close_delay`, длина
   `post_close_window`.)
2. Режем окно границами `events` из `cuts.json` (POV-каты) и выкидываем
   кадры внутри `hud_events ±0.5с` (killcam / fullmap / inventory).
3. По N сэмплам:
   - `FrameRegistrar` (SIFT + RANSAC) → гомография
     `H: frame_px → canonical_px` и зум `H`.
   - HSV-маска красной "опасной" зоны → `MORPH_GRADIENT` =
     тонкий контур = граница кольца.
   - **RANSAC по 3 точкам** фитит окружность. Устойчиво к видимой
     дуге 1/3..1 (когда часть кольца обрезана краем миникарты).
   - `(cx, cy) → canonical` через H, `r_canon = r_frame * zoom`.
4. Медиана по сэмплам + `geometry_confidence` (`high / medium / low /
   missing`) на основе разброса.

## Запуск

```powershell
powershell -ExecutionPolicy Bypass -File `
  scripts\tracking\modules\ring_locator\run.ps1 `
  -Video scripts\tracking\game.mp4 `
  -Rings scripts\tracking\modules\hud_read\reports\rings.json `
  -Cuts  scripts\tracking\modules\find_cuts\reports\cuts.json `
  -Zones scripts\tracking\configs\zones.vod.json `
  -Canonical storm_point `
  -MaxRing 3
```

## Выход

`reports/ring_geometry_v2.json`:

```json
{
  "canonical": "storm_point",
  "canonical_size": [2048, 2048],
  "max_ring": 3,
  "phases": [
    {
      "ring": 1,
      "cx_canon_norm": 0.39161,
      "cy_canon_norm": 0.41149,
      "r_canon_norm": 0.30597,
      "samples": 4,
      "rel_spread": 0.0,
      "geometry_confidence": "high",
      "measured_at_t": 393.44,
      "pov_window": [387.44, 399.44]
    }
  ]
}
```

Координаты нормализованы к canonical-карте (`0..1` от
`canonical_size`). Фронт умножает на размер `MapCanvas` — никакой
калибровки `map_bounds_in_roi` или поправок на HUD больше не нужно.

На UI данные подхватывает `src/lib/test-game-data.ts` через
`src/data/m-test-g1/ring_geometry_v2.json`. Фазы без замера наследуют
последнее реальное кольцо (`source: "inherited"`).

## Зависимости

- `track_teams.FrameRegistrar` — SIFT/ORB + RANSAC, общий канонический
  лоадер карт.
- `find_cuts/reports/cuts.json` — POV-каты и `hud_events`.
- `hud_read/reports/rings.json` — `transitions[]` с переходами в
  `COUNTDOWN` и `phases[]` с `t_closing_start`.

## Roadmap — поздние кольца (R4..R6)

Текущий пайплайн **умышленно ограничен `--max-ring 3`**, потому что
поздние фазы регулярно проваливают одну или несколько проверок:

- **Радиус → меньше шумов**. У R4..R6 кольцо занимает 10..30 px на
  ROI; RANSAC по дуге становится менее устойчив, доминируют красные
  HUD-элементы вне миникарты.
- **POV нестабилен**. В лейте обсервер быстро прыгает между POV,
  валидное под-окно `pov_subwindows` часто короче `min_len`.
- **Killcam / smoke / гранаты** дают красные пятна, ломающие маску
  «опасной» зоны.
- **Регистрация ROI** на лейтовых fullmap-сценах с подсветкой
  выживших иногда отдаёт малое число inliers.

Возможные улучшения:

1. Маска по **сине-белой кайме** кольца (а не по внешней красной
   зоне) — у поздних колец она тоньше, но контрастнее.
2. Анкер по предыдущему реальному кольцу: ограничить поиск центра
   `R_{N+1}` окрестностью `R_N` (физика Apex: следующее кольцо
   полностью внутри предыдущего).
3. Brute-force без регистрации: фитить окружность сразу в canonical,
   варпая ROI через H предыдущего успешного сэмпла.
4. Использовать full-map (M / Tab) кадры — у них стабильный масштаб
   и нет HUD-шума, но они появляются эпизодически.

До реализации — поздние фазы наследуют последнее замеренное кольцо.