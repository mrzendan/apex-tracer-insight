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


def load_cuts(path: Path | None) -> list[tuple[float, float]]:
    """Возвращает интервалы [t0, t1], которые надо пропускать
    (hud_events ± 0.5с, cut ± 0.5с)."""
    if not path or not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    bad: list[tuple[float, float]] = []
    for ev in (data.get("events") or []):
        t = ev.get("t")
        if t is not None:
            bad.append((t - 1.0, t + 1.0))
    for ev in (data.get("hud_events") or []):
        t = ev.get("t")
        if t is not None:
            bad.append((t - 0.5, t + 0.5))
    return bad


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


def sample_phase(cap: cv2.VideoCapture, minimap_rect: tuple[int, int, int, int],
                 t_lo: float, t_hi: float, fps: float,
                 bad: list[tuple[float, float]],
                 max_samples: int = 5) -> list[tuple[float, float, float, float]]:
    """Возвращает список (t, cx_norm, cy_norm, r_norm)."""
    if t_hi <= t_lo:
        return []
    x, y, w, h = minimap_rect
    samples: list[tuple[float, float, float, float]] = []
    for i in range(max_samples):
        alpha = (i + 1) / (max_samples + 1)
        t = t_lo + (t_hi - t_lo) * alpha
        if is_bad_time(t, bad):
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

    bad = load_cuts(args.cuts)
    print(f"[ring_locator] cuts mask: {len(bad)} bad intervals")

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
        samples = sample_phase(cap, minimap_rect, t_lo, t_hi, fps, bad)
        if not samples:
            print(f"[ring_locator] R{ring_n}: нет валидных сэмплов "
                  f"в окне [{t_lo:.1f}..{t_hi:.1f}]")
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
        })
        print(f"[ring_locator] R{ring_n}: ({cx:.3f},{cy:.3f}) r={r:.3f} "
              f"n={len(samples)} {confidence}")

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
