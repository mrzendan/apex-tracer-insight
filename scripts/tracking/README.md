# Tracking Lab — локальные скрипты

Скрипты обрабатывают VOD матча Apex и формируют `tracks.json`, который
потом загружается на страницу `/admin/tracking-lab` для визуализации.

Все тяжёлые вычисления — на твоей машине. В облаке ничего не считается.

## Установка

```bash
cd scripts/tracking
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Подготовка канонической карты

1. Положи реальный скриншот тактической карты (полностью развёрнутой, без оверлеев)
   в `canonical_maps/storm_point.png`. Сейчас там плейсхолдер.
2. Открой `canonical_maps/storm_point.json` и впиши:
   - размер изображения карты `canonical_size: [W, H]`
   - 4+ контрольные точки `world ↔ canonical_px` (как в `/admin/zones`),
     чтобы перевести пиксели карты в мировые координаты.

Можно завести несколько карт: просто положи `world_edge.png` + `world_edge.json`
и укажи `canonical_map: world_edge` в `config.yaml`.

## Запуск

```bash
python track_teams.py \
  --video /path/to/game.mp4 \
  --config config.example.yaml \
  --out tracks.json \
  --frame-step 3
```

Полезные флаги:

| Флаг | Дефолт | Что делает |
|------|--------|------------|
| `--frame-step N` | 3 | Обрабатывать каждый N-й кадр. 3 ≈ 20 fps из 60 fps VOD. |
| `--start SEC` | 0 | Начало обработки в секундах. |
| `--end SEC` | -1 | Конец в секундах (-1 = до конца видео). |
| `--preview out.mp4` | — | Рендерить превью с оверлеем (медленно). |
| `--max-features N` | 1500 | Кол-во ORB-фич для регистрации кадра. |
| `--debug-frame N` | — | Сохранить отладочные картинки для кадра N. |

## Что внутри

1. **Регистрация кадра → каноническая карта** через ORB + RANSAC.
   Из гомографии H извлекается `zoom`, `pan`, `rotation` — это решает
   проблему движущегося обсервера.
2. **Детекция плашек команд** по HSV-пресетам (`config.yaml`),
   стрелка-треугольник внутри bbox даёт направление.
3. **Перевод в мировые координаты** через H и калибровку карты.
4. **Трекинг в мировых координатах** (простой Калман + жадное назначение
   по цвету). Зум/пан кадра уже не мешают, треки стабильные.
5. **Поток-запись** в `tracks.json` — большие VOD не съедают RAM.

## Формат `tracks.json`

См. `schema/tracks.schema.json` и `docs/tracking-lab.md` в корне проекта.

## Отдача результата

Готовый `tracks.json` (и опционально `preview.mp4`) загрузи на
`/admin/tracking-lab` в админке — там drag-and-drop и таймлайн.