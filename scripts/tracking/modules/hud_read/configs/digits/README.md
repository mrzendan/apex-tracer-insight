# Эталоны цифр для template-matching pts

Сюда положи `0.png`, `1.png`, …, `9.png` — вырезанные из реального HUD
глифы цифр (по одной на файл). Если папка непустая, `hud_read.py`
автоматически подхватит её как fallback для зон `pts` (срабатывает,
когда Tesseract вернул пустую строку или одну цифру вместо двух — типовая
ошибка на `team_20`).

## Как собрать эталоны

1. Прогон с дампом кропов:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\tracking\modules\hud_read\push.ps1 `
     -Video scripts\tracking\game_sp.mp4 `
     -TessCmd "C:\Program Files\Tesseract-OCR\tesseract.exe" `
     -Mode forward -DumpPts
   ```

2. В `scripts/tracking/modules/hud_read/reports/pts_crops/slot_NN/`
   появятся `f*_raw.png` (исходный) и `f*_x4.png` (увеличенный x4).

3. Открой увеличенный кроп с чёткой цифрой, вырежи каждую цифру
   плотно по контуру (без полей), сохрани в `0.png`..`9.png` в этой папке.
   Размер не критичен — все эталоны должны быть примерно одной высоты;
   код приведёт кроп к высоте эталонов перед матчингом.

4. Формат: одноканальный PNG, цифра ЛЮБОГО цвета на любом фоне — код
   бинаризует через Otsu и при необходимости инвертирует так, чтобы
   цифра была тёмной на светлом.

5. Перезапусти прогон БЕЗ `-DumpPts` — увидишь `"via":"tpl"` в
   `reports/pts_raw.json` для тех слотов, где сработал fallback.