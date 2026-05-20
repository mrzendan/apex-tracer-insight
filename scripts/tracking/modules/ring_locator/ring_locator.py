#!/usr/bin/env python3
"""ring_locator — измеряет геометрию следующего кольца на миникарте.

Использует тайминги из hud_read/reports/rings.json (фазы CLOSING)
и при необходимости find_cuts/reports/cuts.json (исключает кадры с
HUD-событиями — fullmap, killcam, inventory overlay).

См. README.md.
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any

import cv2
import numpy as np

MODULE_DIR = Path(__file__).resolve().parent


def parse_rect(s: str) -> tuple[int, int, int, int]:
    parts = [int(p.strip()) for p in s.split(",")]
    if len(parts) != 4:
        raise SystemExit(f"--minimap должно быть x,y,w,h (got {s!r})")
    return tuple(parts)  # type: ignore[return-value]


def rect_from_zones(zones_path: Path, zone_sel: str) -> tuple[int, int, int, int]:
    """zone_sel: либо точный id зоны, либо name (case-insensitive)."""
    data = json.loads(zones_path.read_text(encoding="utf-8"))
    sel = zone_sel.strip().lower()
    for z in (data.get("zones") or []):
        if z.get("id", "").lower() == sel or z.get("name", "").lower() == sel:
            return (int(z["x"]), int(z["y"]), int(z["w"]), int(z["h"]))
    raise SystemExit(
        f"зона {zone_sel!r} не найдена в {zones_path}. "
        f"доступно: {[z.get('name') for z in data.get('zones') or []][:10]}…"
    )


def load_cut_segments(
    path: Path | None,
) -> tuple[list[float], list[tuple[float, float]]]:
    """Читает cuts.json и возвращает:
    - cut_ts: моменты «жёстких» POV-катов (границы непрерывных POV-сегментов);
    - hud_bad: интервалы ±0.5с вокруг hud_events (камера на месте,
      но картинка дрожит — кадры использовать нельзя).
    """
    if not path or not path.exists():
        return [], []
    data = json.loads(path.read_text(encoding="utf-8"))
    cut_ts: list[float] = []
    for ev in (data.get("events") or []):
        t = ev.get("t")
        if t is not None:
            cut_ts.append(float(t))
    cut_ts.sort()
    hud_bad: list[tuple[float, float]] = []
    for ev in (data.get("hud_events") or []):
        t = ev.get("t")
        if t is not None:
            hud_bad.append((float(t) - 0.5, float(t) + 0.5))
    return cut_ts, hud_bad


def pov_subwindows(
    t_lo: float, t_hi: float, cut_ts: list[float], min_len: float = 2.0,
) -> list[tuple[float, float]]:
    """Режет окно [t_lo, t_hi] границами cut_ts. Возвращает под-окна
    длиной ≥ min_len. Каждое под-окно — один непрерывный POV-сегмент."""
    if t_hi <= t_lo:
        return []
    cuts_in = [t for t in cut_ts if t_lo < t < t_hi]
    # Добавляем небольшой запас вокруг каждого ката (POV переключился),
    # чтобы случайно не подхватить пограничный кадр.
    pad = 0.5
    points = [t_lo] + [
        x for t in cuts_in for x in (t - pad, t + pad)
    ] + [t_hi]
    out: list[tuple[float, float]] = []
    for i in range(0, len(points) - 1, 2):
        a, b = points[i], points[i + 1]
        if b - a >= min_len:
            out.append((a, b))
    return out


def is_bad_time(t: float, bad: list[tuple[float, float]]) -> bool:
    for lo, hi in bad:
        if lo <= t <= hi:
            return True
    return False


def grab_frame(cap: cv2.VideoCapture, f: int) -> np.ndarray | None:
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, f))
    ok, frame = cap.read()
    return frame if ok else None


def detect_next_ring(minimap: np.ndarray) -> tuple[float, float, float] | None:
    """Найти серую окружность следующего кольца на кропе миникарты.
    Возвращает (cx_norm, cy_norm, r_norm) в координатах кропа [0..1].
    """
    if minimap.size == 0:
        return None
    h, w = minimap.shape[:2]
    hsv = cv2.cvtColor(minimap, cv2.COLOR_BGR2HSV)
    # Тёмно-серый следующий ring: низкая S, средне-низкая V.
    s, v = hsv[:, :, 1], hsv[:, :, 2]
    mask = cv2.inRange(s, 0, 60) & cv2.inRange(v, 60, 170)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    gray = cv2.GaussianBlur(mask, (5, 5), 1.5)
    min_r = max(8, min(w, h) // 12)
    max_r = max(min_r + 4, min(w, h) // 2)
    circles = cv2.HoughCircles(
        gray, cv2.HOUGH_GRADIENT, dp=1.2, minDist=max(20, min(w, h) // 3),
        param1=80, param2=20, minRadius=min_r, maxRadius=max_r,
    )
    if circles is None:
        return None
    # Берём самый яркий (по сумме mask вдоль окружности).
    best, best_score = None, -1.0
    for c in circles[0]:
        cx, cy, r = float(c[0]), float(c[1]), float(c[2])
        score = _ring_score(mask, cx, cy, r)
        if score > best_score:
            best_score = score
            best = (cx, cy, r)
    if best is None:
        return None
    cx, cy, r = best
    return (cx / w, cy / h, r / max(w, h))


def _ring_score(mask: np.ndarray, cx: float, cy: float, r: float,
                n: int = 36) -> float:
    h, w = mask.shape[:2]
    hits = 0
    total = 0
    for i in range(n):
        a = 2 * np.pi * i / n
        x = int(round(cx + r * np.cos(a)))
        y = int(round(cy + r * np.sin(a)))
        if 0 <= x < w and 0 <= y < h:
            total += 1
            if mask[y, x] > 0:
                hits += 1
    return hits / max(1, total)


def sample_window(cap: cv2.VideoCapture, minimap_rect: tuple[int, int, int, int],
                  t_lo: float, t_hi: float, fps: float,
                  hud_bad: list[tuple[float, float]],
                  max_samples: int = 3) -> list[tuple[float, float, float, float]]:
    """Сэмплит одно POV-окно. Возвращает список (t, cx_norm, cy_norm, r_norm)."""
    if t_hi <= t_lo:
        return []
    x, y, w, h = minimap_rect
    samples: list[tuple[float, float, float, float]] = []
    for i in range(max_samples):
        alpha = (i + 1) / (max_samples + 1)
        t = t_lo + (t_hi - t_lo) * alpha
        if is_bad_time(t, hud_bad):
            continue
        f = int(round(t * fps))
        frame = grab_frame(cap, f)
        if frame is None:
            continue
        fh, fw = frame.shape[:2]
        xx, yy = min(x, fw - 1), min(y, fh - 1)
        ww, hh = min(w, fw - xx), min(h, fh - yy)
        crop = frame[yy:yy + hh, xx:xx + ww]
        det = detect_next_ring(crop)
        if det is None:
            continue
        cx, cy, r = det
        samples.append((t, cx, cy, r))
    return samples


def sample_phase(
    cap: cv2.VideoCapture, minimap_rect: tuple[int, int, int, int],
    t_lo: float, t_hi: float, fps: float,
    cut_ts: list[float], hud_bad: list[tuple[float, float]],
    max_samples_per_window: int = 3,
) -> tuple[list[tuple[float, float, float, float]],
           tuple[float, float] | None, int]:
    """Из всех POV-под-окон [t_lo..t_hi] выбираем самое согласованное.
    Возвращает (samples, chosen_window, total_subwindows)."""
    subwins = pov_subwindows(t_lo, t_hi, cut_ts)
    if not subwins:
        # Нет ни одного сегмента ≥ min_len — берём всё окно как fallback.
        subwins = [(t_lo, t_hi)] if t_hi > t_lo else []
    best: tuple[list[tuple[float, float, float, float]],
                tuple[float, float], float] | None = None
    for win in subwins:
        samples = sample_window(
            cap, minimap_rect, win[0], win[1], fps, hud_bad,
            max_samples=max_samples_per_window,
        )
        if len(samples) < 2:
            # Один сэмпл нельзя оценить на согласованность — пропускаем,
            # если есть другие варианты.
            if best is None and samples:
                best = (samples, win, float("inf"))
            continue
        med_cx = statistics.median(s[1] for s in samples)
        med_cy = statistics.median(s[2] for s in samples)
        med_r = statistics.median(s[3] for s in samples)
        spread = max(
            max(abs(s[1] - med_cx) for s in samples),
            max(abs(s[2] - med_cy) for s in samples),
            max(abs(s[3] - med_r) for s in samples),
        )
        if best is None or spread < best[2]:
            best = (samples, win, spread)
    if best is None:
        return [], None, len(subwins)
    return best[0], best[1], len(subwins)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--rings", required=True, type=Path,
                    help="rings.json из hud_read")
    ap.add_argument("--cuts", type=Path, default=None,
                    help="cuts.json из find_cuts (опц.)")
    ap.add_argument("--minimap", type=str, default="34,775,300,300",
                    help="x,y,w,h миникарты в координатах оригинального видео")
    ap.add_argument("--zones", type=Path, default=None,
                    help="zones.vod.json — взять прямоугольник миникарты из зоны")
    ap.add_argument("--minimap-zone", type=str, default="camera roi",
                    help="id или name зоны миникарты в --zones (по умолч. 'camera roi')")
    ap.add_argument("--out", type=Path, default=MODULE_DIR / "reports")
    args = ap.parse_args()

    if args.zones:
        minimap_rect = rect_from_zones(args.zones, args.minimap_zone)
        print(f"[ring_locator] minimap from zones[{args.minimap_zone!r}] = {minimap_rect}")
    else:
        minimap_rect = parse_rect(args.minimap)
        print(f"[ring_locator] minimap (raw) = {minimap_rect}")
    rings_data = json.loads(args.rings.read_text(encoding="utf-8"))
    fps = float(rings_data.get("fps") or 30.0)
    phases = rings_data.get("phases") or []
    derived = rings_data.get("derived") or {}
    median_countdown = derived.get("median_countdown")
    if not phases:
        print("[ring_locator] phases[] пуст — нечего измерять")
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "ring_geometry.json").write_text(
            json.dumps({"video": str(args.video), "fps": fps,
                        "minimap": list(minimap_rect), "phases": []},
                       ensure_ascii=False, indent=2), encoding="utf-8")
        return 0

    cut_ts, hud_bad = load_cut_segments(args.cuts)
    if args.cuts is None:
        print("[ring_locator] WARN: --cuts не передан — на плавающей "
              "HUD-миникарте точность геометрии деградирует")
    print(f"[ring_locator] cuts: {len(cut_ts)} POV-границ, "
          f"{len(hud_bad)} hud_event-интервалов")

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise SystemExit(f"не открылся видеофайл: {args.video}")

    phases_by_ring = {p["ring"]: p for p in phases}
    out_phases: list[dict[str, Any]] = []
    prev_geom: tuple[float, float, float] | None = None

    for ring_n in sorted(phases_by_ring):
        p = phases_by_ring[ring_n]
        t_close = p.get("t_closing_start")
        if t_close is None:
            continue
        # Окно: между t_closed предыдущей фазы (=COUNTDOWN текущей)
        # и t_closing_start текущей. Для R1 «предыдущей» нет —
        # используем median_countdown из derived (или 30s fallback).
        prev = phases_by_ring.get(ring_n - 1)
        if prev and prev.get("t_closed") is not None:
            t_lo = prev["t_closed"]
        else:
            window = median_countdown if median_countdown else 30.0
            t_lo = max(0.0, t_close - float(window))
        t_hi = t_close - 0.5
        samples, chosen, n_sub = sample_phase(
            cap, minimap_rect, t_lo, t_hi, fps, cut_ts, hud_bad,
        )
        if not samples:
            print(f"[ring_locator] R{ring_n}: нет валидных сэмплов "
                  f"в окне [{t_lo:.1f}..{t_hi:.1f}] (POV-сегментов: {n_sub})")
            out_phases.append({
                "ring": ring_n,
                "cx_norm": None, "cy_norm": None, "r_norm": None,
                "measured_at_t": None, "samples": 0,
                "geometry_confidence": "missing",
            })
            continue
        cx = statistics.median(s[1] for s in samples)
        cy = statistics.median(s[2] for s in samples)
        r = statistics.median(s[3] for s in samples)
        confidence = "high" if len(samples) >= 3 else "medium"
        # Sanity: внутри предыдущего кольца?
        if prev_geom is not None:
            pcx, pcy, pr = prev_geom
            d = ((cx - pcx) ** 2 + (cy - pcy) ** 2) ** 0.5
            if d + r > pr + 0.05:
                confidence = "low"
        prev_geom = (cx, cy, r)
        t_avg = statistics.mean(s[0] for s in samples)
        out_phases.append({
            "ring": ring_n,
            "cx_norm": round(cx, 4),
            "cy_norm": round(cy, 4),
            "r_norm": round(r, 4),
            "measured_at_t": round(t_avg, 2),
            "samples": len(samples),
            "geometry_confidence": confidence,
            "pov_window": [round(chosen[0], 2), round(chosen[1], 2)] if chosen else None,
            "pov_subwindows_total": n_sub,
        })
        pov_s = f"[{chosen[0]:.1f}..{chosen[1]:.1f}]" if chosen else "n/a"
        print(f"[ring_locator] R{ring_n}: ({cx:.3f},{cy:.3f}) r={r:.3f} "
              f"n={len(samples)} {confidence} pov={pov_s} (sub={n_sub})")

    cap.release()
    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "ring_geometry.json"
    out_path.write_text(json.dumps({
        "video": str(args.video), "fps": fps,
        "minimap": list(minimap_rect),
        "phases": out_phases,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ring_locator] → {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
