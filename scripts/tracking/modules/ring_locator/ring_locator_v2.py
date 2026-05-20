#!/usr/bin/env python3
"""ring_locator_v2 — измеряет геометрию кольца через регистрацию кадра
к канонической карте (storm_point.png).

Идея:
  1. На каждом сэмпле берём fullmap-кадр (зона "camera roi" из zones.vod.json).
  2. FrameRegistrar (ORB+RANSAC) → гомография H: frame_px → canonical_px.
  3. Маска красной "опасной" зоны → Canny → RANSAC circle fit по дуге
     (устойчив к видимой части 1/3..1 окружности).
  4. Центр и радиус кольца → canonical через H.
  5. Медиана по N сэмплам → стабильный (cx_canon, cy_canon, r_canon).

Выход: reports/ring_geometry_v2.json. Координаты canonical-нормализованы
(0..1 от canonical_size), т.е. UI должен рисовать кольца на полной карте.
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

# track_teams живёт в соседнем модуле — добавим в sys.path
sys.path.insert(0, str(TRACKING_ROOT / "modules" / "track_teams"))
from track_teams import (  # noqa: E402
    FrameRegistrar, load_canonical_map, decompose_homography, map_point,
)

# Общие утилиты из v1 (зоны, cuts)
from ring_locator import (  # noqa: E402
    rect_from_zones, load_cut_segments, pov_subwindows, is_bad_time, grab_frame,
)


# ----------------------------- RING DETECTION -----------------------------

def red_edge_points(bgr: np.ndarray) -> np.ndarray:
    """Возвращает Nx2 массив (x,y) точек границы красной "опасной" зоны.
    Это и есть пиксели окружности кольца — переход red→not-red.
    """
    if bgr.size == 0:
        return np.empty((0, 2), dtype=np.int32)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    m1 = cv2.inRange(hsv, (0,   100,  80), (12,  255, 255))
    m2 = cv2.inRange(hsv, (168, 100,  80), (180, 255, 255))
    mask = m1 | m2
    # Чуть закроем дырки в массе, потом возьмём градиент — останется тонкий контур.
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
    """Возвращает (cx, cy, r) или None, если точки коллинеарны."""
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


def ransac_circle(points: np.ndarray, *,
                  min_r: float, max_r: float,
                  inlier_tol: float = 2.5,
                  iters: int = 1500,
                  min_inlier_frac: float = 0.20,
                  rng: np.random.Generator | None = None,
                  ) -> tuple[float, float, float, int] | None:
    """RANSAC по точкам контура. Возвращает (cx, cy, r, n_inliers)."""
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
    # Уточняем по inliers (least-squares)
    d = np.abs(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) - r)
    in_pts = pts[d < inlier_tol]
    cx2, cy2, r2 = _fit_circle_lsq(in_pts)
    return cx2, cy2, r2, n_in


def _fit_circle_lsq(pts: np.ndarray) -> tuple[float, float, float]:
    """Алгебраический фит окружности (Kasa). pts: Nx2."""
    x = pts[:, 0]; y = pts[:, 1]
    A = np.column_stack([2 * x, 2 * y, np.ones_like(x)])
    b = x * x + y * y
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy, c = sol
    r = float(np.sqrt(max(0.0, c + cx * cx + cy * cy)))
    return float(cx), float(cy), r


# ----------------------------- MAIN PIPELINE ------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--rings", required=True, type=Path)
    ap.add_argument("--cuts", type=Path, default=None)
    ap.add_argument("--zones", required=True, type=Path)
    ap.add_argument("--minimap-zone", default="camera roi")
    ap.add_argument("--canonical", default="storm_point",
                    help="имя канонической карты в shared/canonical_maps/")
    ap.add_argument("--canonical-dir", type=Path,
                    default=TRACKING_ROOT / "shared" / "canonical_maps")
    ap.add_argument("--out", type=Path, default=MODULE_DIR / "reports")
    ap.add_argument("--samples", type=int, default=4,
                    help="кадров на одно кольцо")
    ap.add_argument("--post-close-delay", type=float, default=1.5)
    ap.add_argument("--post-close-window", type=float, default=12.0)
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    minimap_rect = rect_from_zones(args.zones, args.minimap_zone)
    rx, ry, rw, rh = minimap_rect
    print(f"[v2] camera ROI = {minimap_rect}")

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
    print(f"[v2] cuts: {len(cut_ts)} POV-границ, {len(hud_bad)} hud-интервалов")

    # Canonical map + registrar
    cmap = load_canonical_map(args.canonical, args.canonical_dir)
    canon_w, canon_h = cmap.size
    print(f"[v2] canonical {args.canonical}: {canon_w}x{canon_h}")
    reg_cfg = {
        "detector": "sift",
        "max_features": 4000,
        "clahe": True,
        "canonical_target_w": 1600,
        "match_ratio": 0.75,
        "ransac_reproj_px": 5.0,
        "min_inliers": 15,
        # ROI = camera roi нормализованный в 1920x1080 базовый кадр
        "roi": [rx / 1920, ry / 1080, (rx + rw) / 1920, (ry + rh) / 1080],
    }
    registrar = FrameRegistrar(cmap, reg_cfg)

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise SystemExit(f"не открылся: {args.video}")
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    video_duration = (total_frames / fps) if (total_frames and fps) else None

    debug_dir = (args.out / "debug_v2") if args.debug else None
    if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
        for p in debug_dir.glob("ring*"): p.unlink(missing_ok=True)

    out_phases: list[dict[str, Any]] = []

    phases_by_ring = {p["ring"]: p for p in phases}
    for ring_n in sorted(phases_by_ring):
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

        # Выбираем POV-непрерывное под-окно
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
            # 1) Регистрируем кадр к canonical
            H, inliers = registrar.register(frame)
            if H is None or inliers < 10:
                print(f"[v2] R{ring_n} t={t:.1f}s: register failed (inliers={inliers})")
                continue
            zoom_info = decompose_homography(H)
            zoom = zoom_info["zoom"]
            # 2) RANSAC по красному контуру в координатах ROI (frame_px)
            crop = frame[ry:ry + rh, rx:rx + rw]
            pts_roi = red_edge_points(crop)
            if len(pts_roi) < 100:
                print(f"[v2] R{ring_n} t={t:.1f}s: red edge pts={len(pts_roi)}")
                continue
            # перевод в координаты полного кадра
            pts_frame = pts_roi.copy()
            pts_frame[:, 0] += rx; pts_frame[:, 1] += ry
            # радиус кольца в frame_px → в canonical r * zoom
            # ожидаемый диапазон: кольцо занимает 5..70% canonical_w
            min_r_canon = 0.04 * canon_w
            max_r_canon = 0.75 * canon_w
            min_r_frame = min_r_canon / max(zoom, 1e-3)
            max_r_frame = max_r_canon / max(zoom, 1e-3)
            fit = ransac_circle(
                pts_frame, min_r=min_r_frame, max_r=max_r_frame,
                inlier_tol=2.5, iters=1200, min_inlier_frac=0.15,
            )
            if fit is None:
                print(f"[v2] R{ring_n} t={t:.1f}s: RANSAC failed "
                      f"(pts={len(pts_frame)} zoom={zoom:.2f})")
                continue
            cx_f, cy_f, r_f, n_in = fit
            # 3) Центр в canonical
            cx_c, cy_c = map_point(H, (cx_f, cy_f))
            r_c = r_f * zoom
            samples.append((t, cx_c, cy_c, r_c, n_in))
            print(f"[v2] R{ring_n} t={t:.1f}s: canon=({cx_c:.0f},{cy_c:.0f}) "
                  f"r={r_c:.0f} inliers={n_in} zoom={zoom:.2f}")

            if debug_dir:
                ov = crop.copy()
                cv2.circle(ov, (int(cx_f - rx), int(cy_f - ry)),
                           int(r_f), (0, 200, 255), 2)
                cv2.drawMarker(ov, (int(cx_f - rx), int(cy_f - ry)),
                               (0, 200, 255), cv2.MARKER_CROSS, 16, 2)
                cv2.imwrite(str(debug_dir / f"ring{ring_n}_t{int(t)}_overlay.jpg"),
                            ov, [cv2.IMWRITE_JPEG_QUALITY, 85])

        if not samples:
            out_phases.append({
                "ring": ring_n, "samples": 0,
                "geometry_confidence": "missing",
            })
            print(f"[v2] R{ring_n}: НЕТ валидных сэмплов")
            continue
        cx = statistics.median(s[1] for s in samples)
        cy = statistics.median(s[2] for s in samples)
        r = statistics.median(s[3] for s in samples)
        t_avg = statistics.mean(s[0] for s in samples)
        # spread → confidence
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
        entry = {
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
        }
        out_phases.append(entry)
        print(f"[v2] R{ring_n}: canon=({cx:.0f},{cy:.0f}) r={r:.0f} "
              f"n={len(samples)} {conf} (spread={spread:.1f}px)")

    cap.release()
    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "ring_geometry_v2.json"
    out_path.write_text(json.dumps({
        "video": str(args.video), "fps": fps,
        "canonical": args.canonical,
        "canonical_size": [canon_w, canon_h],
        "camera_roi": list(minimap_rect),
        "phases": out_phases,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[v2] → {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())