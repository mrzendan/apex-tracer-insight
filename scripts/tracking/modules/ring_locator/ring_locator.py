#!/usr/bin/env python3
"""ring_locator — измеряет геометрию кольца Apex в координатах
канонической карты (например, storm_point.png).

Подход:
  1. После начала фазы COUNTDOWN(N+1) (момент, когда кольцо N+1 уже
     прорисовано и стоит на месте) берём несколько fullmap-кадров.
  2. Каждый кадр регистрируем к canonical через FrameRegistrar
     (SIFT/ORB + RANSAC), получаем гомографию H: frame_px → canonical_px.
  3. На ROI миникарты строим HSV-маску красной "опасной" зоны, через
     MORPH_GRADIENT берём её контур (тонкая дуга = граница кольца) и
     фитим окружность RANSAC'ом — устойчиво к видимой дуге 1/3..1.
  4. (cx, cy) и r переводим в canonical через H и зум H.
  5. Медиана по сэмплам → стабильный (cx_canon, cy_canon, r_canon).

Текущая версия надёжно работает на кольцах 1..3. Поздние фазы (4..6,
малый радиус, частая смена POV, killcam) пока в roadmap — см. README.

Выход: reports/ring_geometry_v2.json. Координаты canonical-нормализованы
(0..1 от canonical_size); UI рисует кольца поверх полной PNG карты.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

MODULE_DIR = Path(__file__).resolve().parent
TRACKING_ROOT = MODULE_DIR.parent.parent  # scripts/tracking

# track_teams содержит FrameRegistrar + canonical-loader
sys.path.insert(0, str(TRACKING_ROOT / "modules" / "track_teams"))
from track_teams import (  # noqa: E402
    FrameRegistrar, load_canonical_map, decompose_homography, map_point,
)


# ----------------------------- ZONES / CUTS -------------------------------

def rect_from_zones(zones_path: Path, zone_sel: str) -> tuple[int, int, int, int]:
    """zone_sel: точный id зоны или name (case-insensitive)."""
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
    """cuts.json → (POV-каты, hud_events ±0.5с)."""
    if not path or not path.exists():
        return [], []
    data = json.loads(path.read_text(encoding="utf-8"))
    cut_ts = sorted(
        float(ev["t"]) for ev in (data.get("events") or []) if ev.get("t") is not None
    )
    hud_bad = [
        (float(ev["t"]) - 0.5, float(ev["t"]) + 0.5)
        for ev in (data.get("hud_events") or []) if ev.get("t") is not None
    ]
    return cut_ts, hud_bad


def pov_subwindows(
    t_lo: float, t_hi: float, cut_ts: list[float], min_len: float = 2.0,
) -> list[tuple[float, float]]:
    if t_hi <= t_lo:
        return []
    cuts_in = [t for t in cut_ts if t_lo < t < t_hi]
    pad = 0.5
    points = [t_lo] + [x for t in cuts_in for x in (t - pad, t + pad)] + [t_hi]
    out: list[tuple[float, float]] = []
    for i in range(0, len(points) - 1, 2):
        a, b = points[i], points[i + 1]
        if b - a >= min_len:
            out.append((a, b))
    return out


def is_bad_time(t: float, bad: list[tuple[float, float]]) -> bool:
    return any(lo <= t <= hi for lo, hi in bad)


def grab_frame(cap: cv2.VideoCapture, f: int) -> np.ndarray | None:
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, f))
    ok, frame = cap.read()
    return frame if ok else None


# ----------------------------- RING DETECTION -----------------------------

def red_edge_points(bgr: np.ndarray) -> np.ndarray:
    """Nx2 (x,y) — пиксели границы красной зоны (= окружность кольца)."""
    if bgr.size == 0:
        return np.empty((0, 2), dtype=np.int32)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    m1 = cv2.inRange(hsv, (0,   100,  80), (12,  255, 255))
    m2 = cv2.inRange(hsv, (168, 100,  80), (180, 255, 255))
    mask = m1 | m2
    mask = cv2.morphologyEx(
        mask, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    )
    edges = cv2.morphologyEx(
        mask, cv2.MORPH_GRADIENT,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
    )
    ys, xs = np.where(edges > 0)
    return np.stack([xs, ys], axis=1) if xs.size else np.empty((0, 2), np.int32)


def _circle_from_3pts(p1, p2, p3):
    ax, ay = p1; bx, by = p2; cx, cy = p3
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-6:
        return None
    ux = ((ax * ax + ay * ay) * (by - cy) +
          (bx * bx + by * by) * (cy - ay) +
          (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) +
          (bx * bx + by * by) * (ax - cx) +
          (cx * cx + cy * cy) * (bx - ax)) / d
    r = float(np.hypot(ax - ux, ay - uy))
    return float(ux), float(uy), r


def _fit_circle_lsq(pts: np.ndarray) -> tuple[float, float, float]:
    x = pts[:, 0]; y = pts[:, 1]
    A = np.column_stack([2 * x, 2 * y, np.ones_like(x)])
    b = x * x + y * y
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy, c = sol
    r = float(np.sqrt(max(0.0, c + cx * cx + cy * cy)))
    return float(cx), float(cy), r


def ransac_circle(points: np.ndarray, *,
                  min_r: float, max_r: float,
                  inlier_tol: float = 2.5,
                  iters: int = 1500,
                  min_inlier_frac: float = 0.20,
                  rng: np.random.Generator | None = None,
                  ) -> tuple[float, float, float, int] | None:
    n = len(points)
    if n < 50:
        return None
    if rng is None:
        rng = np.random.default_rng(42)
    pts = points.astype(np.float64)
    best: tuple[float, float, float, int] | None = None
    for _ in range(iters):
        idx = rng.choice(n, size=3, replace=False)
        circ = _circle_from_3pts(pts[idx[0]], pts[idx[1]], pts[idx[2]])
        if circ is None:
            continue
        cx, cy, r = circ
        if r < min_r or r > max_r:
            continue
        d = np.abs(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) - r)
        n_in = int((d < inlier_tol).sum())
        if best is None or n_in > best[3]:
            best = (cx, cy, r, n_in)
    if best is None:
        return None
    cx, cy, r, n_in = best
    if n_in < max(50, int(n * min_inlier_frac)):
        return None
    d = np.abs(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) - r)
    in_pts = pts[d < inlier_tol]
    cx2, cy2, r2 = _fit_circle_lsq(in_pts)
    return cx2, cy2, r2, n_in


# ----------------------------- MAIN PIPELINE ------------------------------

# По умолчанию измеряем только R1..R3 — поздние кольца пока в roadmap.
DEFAULT_MAX_RING = 3


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--rings", required=True, type=Path)
    ap.add_argument("--cuts", type=Path, default=None)
    ap.add_argument("--zones", required=True, type=Path)
    ap.add_argument("--minimap-zone", default="camera roi")
    ap.add_argument("--canonical", default="storm_point")
    ap.add_argument("--canonical-dir", type=Path,
                    default=TRACKING_ROOT / "shared" / "canonical_maps")
    ap.add_argument("--out", type=Path, default=MODULE_DIR / "reports")
    ap.add_argument("--samples", type=int, default=4,
                    help="кадров на одно кольцо")
    ap.add_argument("--max-ring", type=int, default=DEFAULT_MAX_RING,
                    help="последнее кольцо для замера (см. roadmap в README)")
    ap.add_argument("--post-close-delay", type=float, default=1.5)
    ap.add_argument("--post-close-window", type=float, default=12.0)
    args = ap.parse_args()

    minimap_rect = rect_from_zones(args.zones, args.minimap_zone)
    rx, ry, rw, rh = minimap_rect
    print(f"[ring_locator] camera ROI = {minimap_rect}")

    rings_data = json.loads(args.rings.read_text(encoding="utf-8"))
    fps = float(rings_data.get("fps") or 30.0)
    phases = rings_data.get("phases") or []
    transitions = rings_data.get("transitions") or []
    countdown_start_by_ring: dict[int, float] = {}
    for tr in transitions:
        to = tr.get("to") or {}
        if to.get("state") == "COUNTDOWN" and to.get("ring") is not None \
           and tr.get("t") is not None:
            countdown_start_by_ring.setdefault(int(to["ring"]), float(tr["t"]))

    cut_ts, hud_bad = load_cut_segments(args.cuts)
    print(f"[ring_locator] cuts: {len(cut_ts)} POV-границ, {len(hud_bad)} hud-окон")

    cmap = load_canonical_map(args.canonical, args.canonical_dir)
    canon_w, canon_h = cmap.size
    print(f"[ring_locator] canonical {args.canonical}: {canon_w}x{canon_h}")
    reg_cfg = {
        "detector": "sift",
        "max_features": 4000,
        "clahe": True,
        "canonical_target_w": 1600,
        "match_ratio": 0.75,
        "ransac_reproj_px": 5.0,
        "min_inliers": 15,
        "roi": [rx / 1920, ry / 1080, (rx + rw) / 1920, (ry + rh) / 1080],
    }
    registrar = FrameRegistrar(cmap, reg_cfg)

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise SystemExit(f"не открылся: {args.video}")
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    video_duration = (total_frames / fps) if (total_frames and fps) else None

    out_phases: list[dict[str, Any]] = []
    phases_by_ring = {p["ring"]: p for p in phases}
    for ring_n in sorted(phases_by_ring):
        if ring_n > args.max_ring:
            continue
        p = phases_by_ring[ring_n]
        t_close = p.get("t_closing_start")
        if t_close is None:
            continue
        t_anchor = countdown_start_by_ring.get(ring_n + 1)
        if t_anchor is None:
            end = video_duration if video_duration else (t_close + 120.0)
            t_lo = t_close + args.post_close_delay + 30.0
            t_hi = max(t_lo + 1.0, end - 2.0)
        else:
            t_lo = t_anchor + args.post_close_delay
            t_hi = t_lo + args.post_close_window

        subwins = pov_subwindows(t_lo, t_hi, cut_ts) or [(t_lo, t_hi)]
        win = max(subwins, key=lambda w: w[1] - w[0])
        wl, wh = win

        samples: list[tuple[float, float, float, float, int]] = []
        for i in range(args.samples):
            alpha = (i + 1) / (args.samples + 1)
            t = wl + (wh - wl) * alpha
            if is_bad_time(t, hud_bad):
                continue
            f = int(round(t * fps))
            frame = grab_frame(cap, f)
            if frame is None:
                continue
            H, inliers = registrar.register(frame)
            if H is None or inliers < 10:
                print(f"[R{ring_n}] t={t:.1f}s register failed (inliers={inliers})")
                continue
            zoom = decompose_homography(H)["zoom"]
            crop = frame[ry:ry + rh, rx:rx + rw]
            pts_roi = red_edge_points(crop)
            if len(pts_roi) < 100:
                print(f"[R{ring_n}] t={t:.1f}s red edge pts={len(pts_roi)}")
                continue
            pts_frame = pts_roi.copy()
            pts_frame[:, 0] += rx; pts_frame[:, 1] += ry
            min_r_canon = 0.04 * canon_w
            max_r_canon = 0.75 * canon_w
            min_r_frame = min_r_canon / max(zoom, 1e-3)
            max_r_frame = max_r_canon / max(zoom, 1e-3)
            fit = ransac_circle(
                pts_frame, min_r=min_r_frame, max_r=max_r_frame,
                inlier_tol=2.5, iters=1200, min_inlier_frac=0.15,
            )
            if fit is None:
                print(f"[R{ring_n}] t={t:.1f}s RANSAC failed "
                      f"(pts={len(pts_frame)} zoom={zoom:.2f})")
                continue
            cx_f, cy_f, r_f, n_in = fit
            cx_c, cy_c = map_point(H, (cx_f, cy_f))
            r_c = r_f * zoom
            samples.append((t, cx_c, cy_c, r_c, n_in))
            print(f"[R{ring_n}] t={t:.1f}s canon=({cx_c:.0f},{cy_c:.0f}) "
                  f"r={r_c:.0f} inliers={n_in} zoom={zoom:.2f}")

        if not samples:
            out_phases.append({
                "ring": ring_n, "samples": 0,
                "geometry_confidence": "missing",
            })
            print(f"[R{ring_n}] нет валидных сэмплов")
            continue
        cx = statistics.median(s[1] for s in samples)
        cy = statistics.median(s[2] for s in samples)
        r = statistics.median(s[3] for s in samples)
        t_avg = statistics.mean(s[0] for s in samples)
        spread = max(
            max(abs(s[1] - cx) for s in samples),
            max(abs(s[2] - cy) for s in samples),
            max(abs(s[3] - r) for s in samples),
        )
        rel_spread = spread / max(r, 1.0)
        if len(samples) >= 3 and rel_spread < 0.05:
            conf = "high"
        elif rel_spread < 0.12:
            conf = "medium"
        else:
            conf = "low"
        out_phases.append({
            "ring": ring_n,
            "cx_canon_px": round(cx, 1),
            "cy_canon_px": round(cy, 1),
            "r_canon_px": round(r, 1),
            "cx_canon_norm": round(cx / canon_w, 5),
            "cy_canon_norm": round(cy / canon_h, 5),
            "r_canon_norm": round(r / max(canon_w, canon_h), 5),
            "canonical_size": [canon_w, canon_h],
            "samples": len(samples),
            "spread_px": round(spread, 1),
            "rel_spread": round(rel_spread, 3),
            "geometry_confidence": conf,
            "measured_at_t": round(t_avg, 2),
            "pov_window": [round(wl, 2), round(wh, 2)],
        })
        print(f"[R{ring_n}] canon=({cx:.0f},{cy:.0f}) r={r:.0f} "
              f"n={len(samples)} {conf} (spread={spread:.1f}px)")

    cap.release()
    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "ring_geometry_v2.json"
    out_path.write_text(json.dumps({
        "video": str(args.video), "fps": fps,
        "canonical": args.canonical,
        "canonical_size": [canon_w, canon_h],
        "camera_roi": list(minimap_rect),
        "max_ring": args.max_ring,
        "phases": out_phases,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ring_locator] → {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())