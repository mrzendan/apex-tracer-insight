# ring_locator — геометрия колец на миникарте

Второй слой ring-трекинга. Тайминги фаз приходят из `hud_read` (`rings.json`).
Здесь мы только **измеряем (cx, cy, r)** следующего кольца в моменты,
когда оно стоит — это окно `COUNTDOWN` между `t_closed[N-1]` и
`t_closing_start[N]`. Положение/радиус кольца в любой другой момент
восстанавливается аналитически (линейная интерполяция от prev к next
за `closing_duration`).

## Что нужно на входе

- `--video` — тот же VOD, что и для `hud_read`.
- `--rings` — `rings.json` из `hud_read` с непустыми `phases[]`.
- `--cuts` (опц.) — `find_cuts/reports/cuts.json`. Окна `hud_events`
  пропускаем (там обсервер открыл fullmap/inventory и миникарта искажена).
- `--minimap "x,y,w,h"` — прямоугольник миникарты в координатах
  оригинального видео. По умолчанию `34,775,300,300` для 1920×1080.
  (В `zones.vod.json` пока нет честной HUD-миникарты — есть только
  `camera roi` для мирового видео; передавай явный rect, пока зону
  не пропишем в `/admin/zones`.)

## Как работает

Для каждой фазы N с известным `t_closing_start[N]`:

1. Окно сэмплирования: `[t_closed[N-1], t_closing_start[N] - 0.5s]`.
   Для первой фазы (N=1) берём `[max(0, t_closing_start[1] - 60s),
   t_closing_start[1] - 0.5s]`.
2. Берём до 5 равномерных сэмплов, отфильтрованных по `cuts.json`
   (вырезаем кадры внутри `hud_events`).
3. На каждом сэмпле — кроп миникарты, HSV-маска по тёмно-серому
   (низкая S, средняя V), морфология, `cv2.HoughCircles`.
4. Из всех кандидатов берём медиану (cx, cy, r) — это страхует от
   killcam/рекламных оверлеев.
5. Sanity-check: центр следующего кольца должен лежать внутри
   предыдущего (если оно уже измерено). Иначе фаза получает
   `geometry_confidence: "low"`.

## Запуск

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\ring_locator\run.ps1 `
  -Video scripts\tracking\game.mp4 `
  -Rings scripts\tracking\modules\hud_read\reports\rings.json `
  -Cuts  scripts\tracking\modules\find_cuts\reports\cuts.json `
  -Minimap "34,775,300,300"
```

## Выход

`reports/ring_geometry.json`:

```json
{
  "video": "...", "fps": 59.94, "minimap": [34, 775, 300, 300],
  "phases": [
    { "ring": 1, "cx_norm": 0.50, "cy_norm": 0.50, "r_norm": 0.46,
      "measured_at_t": 100.0, "samples": 3,
      "geometry_confidence": "high",
      "pov_window": [70.2, 99.5], "pov_subwindows_total": 2 }
  ]
}
```

Координаты нормализованы к миникарте: (0,0) — левый верх, (1,1) —
правый низ. Фронт умножает на размеры своего MapCanvas.

## Почему нужен `--cuts`

HUD-миникарта в Apex плавающая: её центр и зум привязаны к POV
спектируемого игрока. Если внутри окна COUNTDOWN обсервер переключил
POV (`events` в `cuts.json`), сэмплы относятся к разным проекциям мира
и медиана `(cx, cy, r)` даёт смещённый центр / неверный радиус.

`ring_locator` режет окно `[t_closed[N-1]..t_closing_start[N]-0.5]`
границами `events.t` на под-окна непрерывного POV, сэмплит каждое
отдельно и выбирает то, где разброс `(cx, cy, r)` между сэмплами
минимален. `hud_events` остаются blacklist'ом отдельных кадров
(killcam/zoom-пульс, ±0.5с) — внутри POV-окна они только пропускают
конкретный кадр, а не отбрасывают всё окно.

Поля в выводе:
- `pov_window` — какой POV-сегмент использовали для замера;
- `pov_subwindows_total` — сколько вообще POV-сегментов нашлось в окне.

Без `--cuts` работает по-старому (одно окно) — но печатает warning,
потому что на плавающей миникарте `geometry_confidence` массово
уходит в `low`.

## Что дальше

`sync_to_ui.py` мерджит `ring_geometry.json` в
`src/data/m-test-g1/rings.json` (новый ключ `geometry`).
`src/lib/test-game-data.ts` читает `geometry`, если есть — строит
`RingPhase[]` из реальных измерений. Фазы без реального замера
наследуют предыдущее реальное кольцо (`source: "inherited"`) —
мок-смещения больше не используются, чтобы на превью не появлялись
«лишние» нарисованные кольца.
