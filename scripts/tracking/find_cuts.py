#!/usr/bin/env python3
"""
find_cuts.py — поиск точных кадров «телепортаций» камеры обсервера.

Алгоритм:
  1. Идём по видео грубым шагом (--coarse, по умолчанию 600 кадров),
     регистрируем кадр против канонической карты, считаем pan_canonical
     (центр кадра на карте).
  2. Если |pan_curr - pan_prev| > --threshold — между prev и curr был cut.
  3. Откатываемся от curr назад с шагом --fine (по умолчанию 10),
     регистрируя каждый промежуточный кадр, пока pan не «вернётся» к prev
     (т.е. найдём последний кадр СТАРОЙ позиции).
  4. Cut = первый кадр после этого. Записываем событие.
  5. Продолжаем грубое сканирование с curr (откуда начали откат).

Вывод:
  cuts.json  — {"events": [{"frame": N, "t": sec, "from_pan":[...], "to_pan":[...], "delta": px}, ...]}
  cuts.txt   — человекочитаемая сводка
  overlay_cut_<N>.png — карта со стрелкой «откуда -> куда» для каждого cut'а

Запуск:
  python find_cuts.py --video game.mp4 --config config.example.yaml --out cuts_out \
      --coarse 600 --fine 10 --threshold 150
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from track_teams import load_canonical_map, load_config, FrameRegistrar, map_point


def register_frame(cap, reg: FrameRegistrar, idx: int):
    """Прыгает на кадр idx, регистрирует, возвращает (pan_xy, inliers) или (None, inliers)."""
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    if not ok:
        return None, 0, None
    H, inliers = reg.register(frame)
    if H is None or inliers < max(8, reg.min_inliers // 3):
        return None, inliers, frame
    fh, fw = frame.shape[:2]
    pan = map_point(H, (fw / 2, fh / 2))
    return pan, inliers, frame


def dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--config", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--coarse", type=int, default=600, help="грубый шаг (кадров)")
    ap.add_argument("--fine", type=int, default=10, help="шаг отката для уточнения")
    ap.add_argument("--threshold", type=float, default=90.0,
                    help="Δpan на канонической карте, выше которого считаем cut'ом (px)")
    ap.add_argument("--start", type=float, default=0.0, help="старт в секундах")
    ap.add_argument("--end", type=float, default=-1.0, help="конец в секундах (-1 = до конца)")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    cfg = load_config(args.config)
    canonical_dir = (args.config.parent / "canonical_maps").resolve()
    cmap = load_canonical_map(cfg.get("canonical_map", "storm_point"), canonical_dir)
    reg = FrameRegistrar(cmap, cfg.get("registration", {}))

    cap = cv2.VideoCapture(str(args.video), cv2.CAP_FFMPEG)
    if not cap.isOpened():
        cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        print(f"[err] не открыл видео: {args.video}", file=sys.stderr); sys.exit(2)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    start_frame = int(args.start * fps)
    end_frame = total if args.end < 0 else min(total, int(args.end * fps))
    print(f"[info] видео: {total} кадров, {fps:.2f} fps. Сканируем [{start_frame}, {end_frame}) шагом {args.coarse}.")

    events: list[dict] = []
    overlay_base = cv2.cvtColor(reg.map_small, cv2.COLOR_GRAY2BGR)

    prev_idx = start_frame
    prev_pan, prev_inl, _ = register_frame(cap, reg, prev_idx)
    if prev_pan is None:
        print(f"[warn] стартовый кадр {prev_idx} не регистрируется (inliers={prev_inl}). Иду дальше.")
    t0 = time.time()

    curr_idx = prev_idx + args.coarse
    while curr_idx < end_frame:
        curr_pan, curr_inl, _ = register_frame(cap, reg, curr_idx)
        if curr_pan is None:
            print(f"  [skip] frame {curr_idx}: регистрация провалена (inliers={curr_inl})")
            prev_idx = curr_idx
            prev_pan = None
            curr_idx += args.coarse
            continue

        if prev_pan is not None:
            d = dist(prev_pan, curr_pan)
            mark = "  CUT" if d > args.threshold else "  ok"
            print(f"  [coarse] {prev_idx:>7} -> {curr_idx:>7}: Δpan={d:>6.1f}px (inl {prev_inl}->{curr_inl}){mark}")

            if d > args.threshold:
                # уточняем линейным откатом с шагом fine
                exact = refine_cut(cap, reg, prev_idx, prev_pan, curr_idx, curr_pan,
                                   args.fine, args.threshold)
                if exact is not None:
                    cut_frame, from_pan, to_pan = exact
                    # второй проход: шаг 1 в окне ±fine, ищем настоящий межкадровый скачок
                    pinned = pinpoint_cut(cap, reg, cut_frame, args.fine, args.threshold)
                    if pinned is None:
                        print(f"    -> отброшено: в окне ±{args.fine} нет межкадрового скачка "
                              f">{args.threshold/2:.0f}px (это был плавный pan)")
                        prev_idx = curr_idx
                        prev_pan = curr_pan
                        prev_inl = curr_inl
                        curr_idx += args.coarse
                        continue
                    cut_frame, from_pan, to_pan, pixel_diff = pinned
                    ev = {
                        "frame": int(cut_frame),
                        "t": round(cut_frame / fps, 3),
                        "from_pan": [round(from_pan[0], 1), round(from_pan[1], 1)],
                        "to_pan": [round(to_pan[0], 1), round(to_pan[1], 1)],
                        "delta": round(dist(from_pan, to_pan), 1),
                        "pixel_diff": round(pixel_diff, 2),
                    }
                    events.append(ev)
                    print(f"    -> cut at frame {cut_frame} (t={ev['t']}s, "
                          f"Δpan={ev['delta']}px, pixel_diff={ev['pixel_diff']})")
                    # рисуем overlay со стрелкой
                    draw_cut_overlay(overlay_base.copy(), from_pan, to_pan, reg.scale,
                                     args.out / f"overlay_cut_{cut_frame}.png", ev)
                    # сохраняем 4 видеокадра вокруг cut'а
                    dump_context_frames(cap, cut_frame, args.out)
                else:
                    print(f"    -> не смог уточнить (регистрация в окне нестабильна)")

        prev_idx = curr_idx
        prev_pan = curr_pan
        prev_inl = curr_inl
        curr_idx += args.coarse

    cap.release()

    # Сохраняем результат
    out_json = args.out / "cuts.json"
    out_json.write_text(json.dumps({
        "video": args.video.name,
        "fps": fps,
        "coarse": args.coarse,
        "fine": args.fine,
        "threshold": args.threshold,
        "events": events,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [f"[ok] найдено cut'ов: {len(events)}  (за {time.time() - t0:.1f}s)"]
    for ev in events:
        lines.append(f"  frame {ev['frame']:>7} t={ev['t']:>7.2f}s  Δ={ev['delta']:>6.1f}px  "
                     f"{ev['from_pan']} -> {ev['to_pan']}")
    summary = "\n".join(lines)
    (args.out / "cuts.txt").write_text(summary, encoding="utf-8")
    print("\n" + summary)
    print(f"\n[ok] см. {args.out}/cuts.json")


def refine_cut(cap, reg, prev_idx: int, prev_pan, curr_idx: int, curr_pan,
               step: int, threshold: float):
    """
    Откатываемся от curr_idx к prev_idx с шагом step.
    Ищем последний кадр, который ещё «принадлежит» curr_pan-стороне.
    Cut = этот кадр (первый кадр НОВОЙ позиции после прошлого «старого»).

    Возвращает (cut_frame, from_pan, to_pan) или None.
    """
    # Идём с curr_idx - step, curr_idx - 2*step, ... пока не окажемся ближе к prev_pan чем к curr_pan
    last_new = curr_idx          # последний кадр, который точно «новой» стороны
    last_new_pan = curr_pan
    idx = curr_idx - step
    first_old = None
    first_old_pan = None
    while idx > prev_idx:
        pan, inl, _ = register_frame(cap, reg, idx)
        if pan is None:
            # регистрация провалена — пропускаем
            print(f"    [fine]   frame {idx}: skip (inliers={inl})")
            idx -= step
            continue
        d_to_new = dist(pan, curr_pan)
        d_to_old = dist(pan, prev_pan)
        side = "NEW" if d_to_new < d_to_old else "OLD"
        print(f"    [fine]   frame {idx}: pan={[round(pan[0],1), round(pan[1],1)]} "
              f"dNew={d_to_new:.1f} dOld={d_to_old:.1f} -> {side}")
        if side == "NEW":
            last_new = idx
            last_new_pan = pan
        else:
            first_old = idx
            first_old_pan = pan
            break
        idx -= step

    if first_old is None:
        # дошли до prev_idx и всё было «NEW» — значит cut произошёл между prev_idx и last_new
        first_old = prev_idx
        first_old_pan = prev_pan

    # cut = last_new (первый кадр новой позиции). Проверим, что Δ всё ещё > threshold
    if dist(first_old_pan, last_new_pan) < threshold:
        return None
    return last_new, first_old_pan, last_new_pan


def draw_cut_overlay(canvas, from_pan, to_pan, scale, out_path: Path, ev: dict):
    p0 = (int(from_pan[0] * scale), int(from_pan[1] * scale))
    p1 = (int(to_pan[0] * scale), int(to_pan[1] * scale))
    cv2.circle(canvas, p0, 8, (0, 200, 255), 2)   # старая позиция — оранжевая
    cv2.circle(canvas, p1, 8, (0, 255, 0), 2)     # новая — зелёная
    cv2.arrowedLine(canvas, p0, p1, (0, 255, 255), 2, tipLength=0.05)
    label = f"f={ev['frame']} t={ev['t']}s d={ev['delta']}px"
    cv2.putText(canvas, label, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.imwrite(str(out_path), canvas)


def pinpoint_cut(cap, reg, approx_cut_frame: int, window: int, threshold: float):
    """
    Шаг 1 в окне [approx_cut_frame - window, approx_cut_frame + window].
    Камера физически не может телепортироваться, поэтому решение принимает
    ПОПИКСЕЛЬНАЯ разница между соседними кадрами в ROI карты, а не Δpan
    (Δpan может скакать из-за нестабильности SIFT на UI-кадрах).

    Cut = пара (i, i+1) с max mean-abs-diff в ROI, если diff > PIXEL_DIFF_THR.
    Иначе None.
    """
    PIXEL_DIFF_THR = 15.0   # mean abs diff (grayscale 0..255) для настоящего cut'а
    start = max(0, approx_cut_frame - window)
    end = approx_cut_frame + window

    # читаем подряд кадры [start..end], считаем ROI mean-abs-diff между соседями
    roi = reg.roi  # (x0, y0, x1, y1) нормализованный
    frames_gray: dict[int, np.ndarray] = {}
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    for idx in range(start, end + 1):
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]
        x0, y0, x1, y1 = int(roi[0] * w), int(roi[1] * h), int(roi[2] * w), int(roi[3] * h)
        gray = cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
        # уменьшаем для скорости и шумоподавления
        gray = cv2.resize(gray, (256, 256))
        frames_gray[idx] = gray

    best_diff = 0.0
    best_i = None
    for idx in sorted(frames_gray.keys()):
        nxt = idx + 1
        if nxt not in frames_gray:
            continue
        diff = float(np.mean(cv2.absdiff(frames_gray[idx], frames_gray[nxt])))
        if diff > best_diff:
            best_diff = diff
            best_i = idx
    if best_i is None:
        return None
    print(f"    [pin]    max pixel-diff: f{best_i}->f{best_i+1}, diff={best_diff:.2f} "
          f"(thr={PIXEL_DIFF_THR})")
    if best_diff < PIXEL_DIFF_THR:
        return None

    # для overlay нужны pan'ы; регистрируем только эти два кадра
    cut_frame = best_i + 1
    pan_from, _, _ = register_frame(cap, reg, best_i)
    pan_to, _, _ = register_frame(cap, reg, cut_frame)
    if pan_from is None or pan_to is None:
        # регистрация фейлится, но cut точно был (diff большой) — пишем без pan'ов
        pan_from = pan_from or (0.0, 0.0)
        pan_to = pan_to or (0.0, 0.0)
    return cut_frame, pan_from, pan_to, best_diff


def dump_context_frames(cap, cut_frame: int, out_dir: Path):
    """Сохраняет 4 кадра видео: cut-1, cut, cut+1, cut+10."""
    for offset, tag in [(-1, "before"), (0, "at"), (1, "after"), (10, "after10")]:
        idx = max(0, cut_frame + offset)
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            continue
        # уменьшаем до ширины 960 чтобы не раздувать debug_out
        h, w = frame.shape[:2]
        if w > 960:
            scale = 960 / w
            frame = cv2.resize(frame, (960, int(h * scale)))
        out_path = out_dir / f"frame_cut_{cut_frame}_{tag}_f{idx}.jpg"
        cv2.imwrite(str(out_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])


if __name__ == "__main__":
    main()