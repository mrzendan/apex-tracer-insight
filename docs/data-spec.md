
# CAMERA Tracking — реструктуризация страницы

Цель: превратить текущую перегруженную страницу `/admin/camera` в инструмент оператора с четырьмя режимами работы. Вся правка — только в `src/routes/admin.camera.tsx` (плюс при необходимости пара вспомогательных файлов рядом). Дизайн-токены и стиль остаются как сейчас (`hud-*` классы, semantic tokens).

## 1. Общий каркас (для всех вкладок)

Верхняя «шапка» — не меняет содержимое при переключении вкладок:

```text
┌─ CAMERA TRACKING ─────────────────────────────────────────────┐
│ Tournament ▾  Match ▾  Map ▾   │ OVERVIEW GRAPHS SETTINGS DBG │
├──────────────────────────────────────────────────────────────┤
│ Quality 91%   Jumps 4   Lost 20   Conf 0.78   Preset: Step…  │
└──────────────────────────────────────────────────────────────┘
```

- Селекторы турнир/матч/карта — как сейчас.
- View tabs — уже перенесены рядом с селекторами; оставляем там.
- Под ними новая **strip метрик качества** (Tracking quality, Jump events, Lost frames, Avg confidence, Current preset) — общая для всех вкладок.

Layout страницы: `grid grid-cols-[1fr_320px]` — слева контент вкладки, справа контекстная панель настроек (её содержимое зависит от вкладки). На вкладке Settings правая панель расширяется (`grid-cols-[1fr_380px]`).

## 2. Вкладка OVERVIEW

Главный экран оператора — split view + быстрые настройки.

Слева — `grid grid-rows-[1fr_auto]`:

- **Split View** `grid grid-cols-2`:
  - Левая половина — Observer video / crop preview: `<video>` + crop-рамка, бейдж timestamp, индикатор `video loaded / loading / no video`, метка sync.
  - Правая половина — Map preview (текущая карта с кольцами/командами/траекторией) + viewport-рамка, ring center, camera path, zoom-кнопки (+/−/1:1/fit).
- Над split-блоком — toolbar-кнопки toggle: `SYNC MAP/VIDEO`, `LOCK ZOOM`, `SHOW RING CENTER`, `SHOW CAMERA BBOX`, `RESET VIEWPORT`, `FIT MAP`. Состояние хранится в `SplitOpts` (уже есть).
- Под split — **Timeline** на всю ширину: play/pause, текущий ts, длительность, цветные tick-маркеры событий (jump/lost/relock/ring/manual) с тултипами и кликом-сикером.

Справа в OVERVIEW — компактная панель **Quick settings**:

- Preset selector
- Smoothing, Response speed, Deadzone, Max speed (слайдеры)
- Кнопки `UPDATE`, `SAVE AS…`

Под ней два мини-блока:

- **Tracking health** — те же 5 метрик из шапки, в развёрнутом виде с пояснениями.
- **Problems detected** — список «00:18 jump detected / 00:32 lost tracking / 00:44 relock». Клик по строке → `setTime(t)` (перематывает таймлайн).

## 3. Вкладка GRAPHS

Слева — стек графиков (sticky-cursor по времени, синхронизация по X):

1. X camera raw / smoothed
2. Y camera raw / smoothed
3. Zoom ratio
4. Ring radius / zoomed radius
5. Ring number
6. moveDist / jumpScore
7. Confidence

Каждый — отдельная горизонтальная полоса фиксированной высоты (90 px, без регулировки). Над стеком — toolbar: zoom-in/out/reset по времени, переключатели серий (raw/smoothed/ring center/jump score/confidence). На графиках цветные вертикальные риски для событий по палитре:

- jump — `#ef4444`
- lost — `#f59e0b`
- relock — `#22c55e`
- ring — `#22d3ee`
- manual — `#a855f7`

Клик по графику → переход timeline на этот ts.

Правая панель GRAPHS:

- **Graph presets** (Step zoom / Ring noise / Balance / Max sensitivity)
- **Series visibility** (чекбоксы)
- **Selected event** — ts, type, value, reason (заполняется при клике на маркер)

## 4. Вкладка SETTINGS

Слева — превью карты + crop preview (упрощённый split, чтобы видеть эффект настроек).

Справа — все настройки в `<Accordion>` (collapsible), по 7 секциям из ТЗ:

1. Source — videoUrl, upload, source type, frame rate, duration
2. Crop — crop_l/r/t/b, preview, reset
3. Smoothing / Response — smoothing, response_speed, deadzone_px, max_speed_px_per_frame, ema_window_frames
4. Zoom — zoom_min/max/step/lerp/sensitivity, step_zoom_enabled
5. Ring / Team weighting — ring_weight, team_weight, ring_noise_tolerance, team_cluster_tolerance, ring_center_lock
6. Jump detection — jump_threshold, jump_cooldown_frames, pre_jump_unlock_sec, anti_latch_tail, relock_threshold
7. Advanced — sample_step, confidence_threshold, lost_frame_threshold, debug_mode, save_debug_frames

Под аккордеоном — **Presets**: список (Step zoom / Smooth observer / Fast camera / Low noise / Custom) + кнопки `Apply`, `Update`, `Save as…`, `Duplicate`, `Delete`, `Reset to default`.

Тип `TrackingSettings` расширяется недостающими полями (cropTop, cropBottom, zoomSensitivity, stepZoomEnabled, teamClusterTolerance, ringCenterLock, jumpCooldownFrames, antiLatchTail, sampleStep, confidenceThreshold, lostFrameThreshold, debugMode, saveDebugFrames). Пресеты обновляются соответственно.

## 5. Вкладка DEBUG

Слева — три блока:

- **Current frame debug**: current frame, crop preview, processed frame, detected camera bbox, ring center, team points.
- **Event log** — таблица (time / event type / message / confidence / action) с моковыми данными jump_detected / lost_tracking / relock / low_confidence.
- **Top candidates / rejected points** — таблица (center / score / confidence / reason), моки.

Справа:

- **Debug mode** toggle, Selected timestamp
- **Debug files** — список (`progress.json`, `partial_result.json`, `result.json`, `camera_track.json`, `debug_video.mp4`, `trajectory_map.jpg`) с кнопками Open / Download / Copy path (моки, `navigator.clipboard.writeText`)
- **Raw JSON viewer** — `<pre>` с JSON текущего таймстэмпа / preset config
- Кнопка **Export**

## 6. Логика пресетов и UPDATE

- `applyPreset(id)` — копирует значения пресета в `draftSettings` (UI-state), карта/графики при этом НЕ меняются.
- `UPDATE` — переносит `draftSettings → committedSettings`, пересчитывает trajectories/metrics, обновляет split-view и графики.
- `SAVE AS…` — диалог имени, добавляет новый пресет в `presets` (хранение в `useState`, без бэкенда).
- Метрики (`trackingQuality`, `jumpEvents`, `lostFrames`, `avgConfidence`) пересчитываются из `committedSettings` по формулам из ТЗ:
  - `quality = clamp(100 − jumps·2 − lostRatio·100 − lowConfRatio·50, 0, 100)`
- В шапке всегда показываются метрики `committedSettings`.

## 7. Технические детали

- Файл: `src/routes/admin.camera.tsx`. Текущий код (split view + map + графики + presets) переиспользуется, перекомпонуется в подкомпоненты внутри файла: `<OverviewTab>`, `<GraphsTab>`, `<SettingsTab>`, `<DebugTab>`, `<HeaderStrip>`, `<RightPanel mode>`.
- Используем существующие `@/components/ui/accordion`, `tabs`, `slider`, `switch`, `button`, `card`, `table`, `tooltip`.
- Логика карты (кольца/команды/смерти) — уже скопирована из `MatchViewer`, оставляем как есть.
- Никаких изменений в `mock-match.ts`, `admin-store.ts`, `team-colors.ts`.
- Дизайн-токены: только семантические (`bg-card`, `text-muted-foreground`, `border-border`, `hud-panel-*`), без хардкод-цветов кроме палитры событий, которая уже выделена в `eventColor`.

## 8. Что НЕ делаем в этой итерации

- Реальные бэкенд-вызовы (UPDATE/Save as пока локальные).
- Реальная синхронизация HTML5 `<video>` ↔ карта по `currentTime` (заглушка через единый `time` state).
- Загрузка/upload видео (только поле URL).
- Persist пресетов в БД (in-memory `useState`).
