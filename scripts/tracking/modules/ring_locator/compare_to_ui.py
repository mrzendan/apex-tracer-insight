#!/usr/bin/env python3
"""compare_to_ui — клеит сравнительное изображение «Python vs UI» для колец.

Берёт reports/debug/_all_rings_on_roi.jpg (то, что увидел ring_locator
на ROI кадра) и рисует рядом тот же набор колец поверх ЧИСТОГО PNG карты,
используя ровно те же поля, которые читает фронт из rings.json.geometry.

Если у фаз есть cx_map_norm — рисуем их (это «правильная» система).
Иначе fallback на cx_norm — это покажет, где сейчас рендерится прод
(и почему рингов «съезжают»).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

MODULE_DIR = Path(__file__).resolve().parent
PALETTE_BGR = [
    (80, 80, 255), (60, 180, 255), (60, 240, 255),
    (120, 240, 80), (255, 200, 80), (255, 120, 200),
]


def draw_rings_on_map(
    map_img: np.ndarray,
    phases: list[dict],
    field_cx: str, field_cy: str, field_r: str,
    title: str,
) -> np.ndarray:
    h, w = map_img.shape[:2]
    side = min(w, h)
    ox = (w - side) // 2
    oy = (h - side) // 2
    out = map_img.copy()
    cv2.rectangle(out, (ox, oy), (ox + side, oy + side), (255, 255, 255), 1)
    for p in phases:
        cx, cy, r = p.get(field_cx), p.get(field_cy), p.get(field_r)
        if cx is None or cy is None or r is None:
            continue
        col = PALETTE_BGR[(p["ring"] - 1) % len(PALETTE_BGR)]
        cx_px = int(ox + cx * side)
        cy_px = int(oy + cy * side)
        r_px = int(r * side)
        cv2.circle(out, (cx_px, cy_px), r_px, col, 2)
        cv2.drawMarker(out, (cx_px, cy_px), col,
                       cv2.MARKER_CROSS, 14, 2)
        cv2.putText(out, f"R{p['ring']}",
                    (cx_px + 6, cy_px - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 2, cv2.LINE_AA)
    cv2.rectangle(out, (0, 0), (w, 36), (0, 0, 0), -1)
    cv2.putText(out, title, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                (255, 255, 255), 2, cv2.LINE_AA)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--geometry", type=Path,
                    default=MODULE_DIR / "reports" / "ring_geometry.json")
    ap.add_argument("--roi-debug", type=Path,
                    default=MODULE_DIR / "reports" / "debug" / "_all_rings_on_roi.jpg")
    ap.add_argument("--map-image", type=Path, required=True,
                    help="чистый PNG канонической карты (то, что рендерит фронт)")
    ap.add_argument("--out", type=Path,
                    default=MODULE_DIR / "reports" / "debug" / "compare.png")
    args = ap.parse_args()

    geom = json.loads(args.geometry.read_text(encoding="utf-8"))
    phases = geom.get("phases") or []
    map_img = cv2.imread(str(args.map_image))
    if map_img is None:
        raise SystemExit(f"не открылся map image: {args.map_image}")

    has_map_norm = any(p.get("cx_map_norm") is not None for p in phases)
    if has_map_norm:
        ui = draw_rings_on_map(map_img, phases,
                               "cx_map_norm", "cy_map_norm", "r_map_norm",
                               "UI (map-norm)")
    else:
        ui = draw_rings_on_map(map_img, phases,
                               "cx_norm", "cy_norm", "r_norm",
                               "UI (roi-norm — current prod)")

    if args.roi_debug.exists():
        roi = cv2.imread(str(args.roi_debug))
    else:
        roi = np.zeros_like(ui)
        cv2.putText(roi, f"missing {args.roi_debug.name}",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (255, 255, 255), 2, cv2.LINE_AA)

    # уравниваем высоту
    h = max(roi.shape[0], ui.shape[0])
    def fit(img):
        s = h / img.shape[0]
        return cv2.resize(img, (int(img.shape[1] * s), h))
    combo = cv2.hconcat([fit(roi), fit(ui)])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out), combo)
    print(f"[compare_to_ui] → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())