#!/usr/bin/env python3
"""
bootstrap_profiles.py — строит team_profiles.json по VOD матча.

Идея:
  По бокам экрана обсервера весь матч стоит лидерборд из 20 плашек.
  Они неподвижны, имеют фиксированный цвет и размер для своей команды.
  Берём чистые кадры (вне cuts/hud_events), детектим прямоугольники в
  боковых ROI, кластеризуем по цвету+размеру и получаем для каждого
  из 20 слотов эталон (hex, Lab, w, h, area).

  Параллельно сохраняем кропы найденных плашек в --out-dir/slots/<i>/
  для глазной проверки.

Запуск:
  python bootstrap_profiles.py \
      --video game.mp4 \
      --cuts cuts_out/cuts.json \
      --out-dir profiles_out \
      --frames 50
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

# 20 эталонных цветов из src/lib/team-colors.ts
SLOT_HEX = [
    "#078396", "#1B486A", "#1F55CD", "#452A60", "#6E2C70",
    "#AD2D78", "#AE1C51", "#BF000B", "#C34221", "#791F14",
    "#9F3A0D", "#764B01", "#CE7A12", "#967E01", "#84930A",
    "#495903", "#719844", "#398935", "#2F5B19", "#017557",
]


def hex_to_bgr(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b, g, r)


def bgr_to_lab(bgr: tuple[int, int, int]) -> np.ndarray:
    px = np.uint8([[list(bgr)]])
    lab = cv2.cvtColor(px, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
    return lab


SLOT_LAB = np.stack([bgr_to_lab(hex_to_bgr(h)) for h in SLOT_HEX])  # (20,3)


def delta_e(lab_a: np.ndarray, lab_b: np.ndarray) -> float:
    return float(np.linalg.norm(lab_a - lab_b))


def is_clean_frame(frame_idx: int, cuts: dict, guard: int = 60) -> bool:
    """Кадр чистый, если он не в окрестности cut/hud_event."""
    for ev in cuts.get("events", []) + cuts.get("hud_events", []) + cuts.get("gray_zone", []):
        if abs(frame_idx - ev["frame"]) < guard:
            return False
    return True


def find_plates_in_roi(roi_bgr: np.ndarray, min_area: int = 40, max_area: int = 2000):
    """Ищем прямоугольные насыщенные пятна в ROI лидерборда."""
    hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
    # Маска: насыщенные не-тёмные пиксели (исключаем чёрный фон/белый текст)
    sat_mask = cv2.inRange(hsv, (0, 80, 60), (179, 255, 255))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    sat_mask = cv2.morphologyEx(sat_mask, cv2.MORPH_CLOSE, kernel)
    cnts, _ = cv2.findContours(sat_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    plates = []
    for c in cnts:
        area = cv2.contourArea(c)
        if area < min_area or area > max_area:
            continue
        x, y, w, h = cv2.boundingRect(c)
        if w < 4 or h < 4:
            continue
        # солидность — плашка должна быть похожей на прямоугольник
        rect_area = w * h
        if rect_area == 0 or area / rect_area < 0.7:
            continue
        # средний цвет
        mask = np.zeros(roi_bgr.shape[:2], dtype=np.uint8)
        cv2.drawContours(mask, [c], -1, 255, -1)
        mean_bgr = cv2.mean(roi_bgr, mask=mask)[:3]
        lab = bgr_to_lab(tuple(int(v) for v in mean_bgr))
        plates.append({
            "bbox": (x, y, w, h),
            "area": float(area),
            "mean_bgr": tuple(float(v) for v in mean_bgr),
            "lab": lab,
        })
    return plates


def assign_slot(lab: np.ndarray, max_de: float = 25.0) -> tuple[int, float]:
    """Возвращает (slot_index, deltaE) для ближайшего эталонного цвета."""
    diffs = np.linalg.norm(SLOT_LAB - lab, axis=1)
    idx = int(np.argmin(diffs))
    de = float(diffs[idx])
    return idx, de


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--cuts", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--frames", type=int, default=40, help="сколько чистых кадров просканировать")
    ap.add_argument("--step", type=int, default=600, help="шаг между кадрами-кандидатами")
    ap.add_argument("--max-de", type=float, default=28.0, help="макс ΔE Lab до эталона слота")
    ap.add_argument("--left-roi", type=str, default="0,0,0.22,1.0", help="x1,y1,x2,y2 нормализованно")
    ap.add_argument("--right-roi", type=str, default="0.78,0,1.0,1.0")
    args = ap.parse_args()

    if not args.video.exists():
        print(f"[err] нет видео {args.video}", file=sys.stderr); sys.exit(2)
    cuts = json.loads(args.cuts.read_text(encoding="utf-8"))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "slots").mkdir(exist_ok=True)
    (args.out_dir / "frames").mkdir(exist_ok=True)

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        print("[err] cv2 не открыл видео", file=sys.stderr); sys.exit(2)
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    def parse_roi(s: str):
        x1, y1, x2, y2 = [float(v) for v in s.split(",")]
        return int(x1 * fw), int(y1 * fh), int(x2 * fw), int(y2 * fh)

    L = parse_roi(args.left_roi)
    R = parse_roi(args.right_roi)

    # копим плашки по slot
    slot_samples: dict[int, list[dict]] = defaultdict(list)
    rejected: list[dict] = []

    collected = 0
    frame_idx = 0
    pbar = tqdm(total=args.frames, unit="f", desc="bootstrap")
    while collected < args.frames and frame_idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
        if not ok:
            break
        if not is_clean_frame(frame_idx, cuts):
            frame_idx += args.step
            continue

        # сохраняем превью кадра (только первые 5)
        if collected < 5:
            cv2.imwrite(str(args.out_dir / "frames" / f"frame_{frame_idx}.jpg"), frame,
                        [cv2.IMWRITE_JPEG_QUALITY, 80])

        for roi_name, (x1, y1, x2, y2) in (("L", L), ("R", R)):
            roi = frame[y1:y2, x1:x2]
            plates = find_plates_in_roi(roi)
            for p in plates:
                slot, de = assign_slot(p["lab"], args.max_de)
                px, py, pw, ph = p["bbox"]
                crop = roi[py:py + ph, px:px + pw].copy()
                rec = {
                    "frame": frame_idx,
                    "roi": roi_name,
                    "bbox_global": (x1 + px, y1 + py, pw, ph),
                    "w": pw, "h": ph, "area": p["area"],
                    "mean_bgr": p["mean_bgr"],
                    "lab": p["lab"].tolist(),
                    "delta_e": de,
                }
                if de > args.max_de:
                    rejected.append({**rec, "reason": "delta_e>thr", "slot_guess": slot})
                    continue
                slot_samples[slot].append(rec)
                # сохраняем кроп для глазной проверки
                slot_dir = args.out_dir / "slots" / f"{slot+1:02d}"
                slot_dir.mkdir(exist_ok=True)
                if len(list(slot_dir.glob("*.png"))) < 12:
                    cv2.imwrite(str(slot_dir / f"f{frame_idx}_{roi_name}_{px}_{py}.png"), crop)

        collected += 1
        pbar.update(1)
        frame_idx += args.step
    pbar.close()
    cap.release()

    # агрегируем профили
    profiles = []
    for slot_idx in range(20):
        samples = slot_samples.get(slot_idx, [])
        if not samples:
            profiles.append({
                "slot": slot_idx + 1,
                "ref_hex": SLOT_HEX[slot_idx],
                "found": False,
                "samples": 0,
            })
            continue
        ws = np.array([s["w"] for s in samples])
        hs = np.array([s["h"] for s in samples])
        areas = np.array([s["area"] for s in samples])
        labs = np.array([s["lab"] for s in samples])
        des = np.array([s["delta_e"] for s in samples])
        profiles.append({
            "slot": slot_idx + 1,
            "ref_hex": SLOT_HEX[slot_idx],
            "found": True,
            "samples": int(len(samples)),
            "w_median": int(np.median(ws)),
            "h_median": int(np.median(hs)),
            "w_std": float(np.std(ws)),
            "h_std": float(np.std(hs)),
            "area_median": float(np.median(areas)),
            "lab_median": [float(v) for v in np.median(labs, axis=0)],
            "delta_e_mean": float(np.mean(des)),
            "delta_e_max": float(np.max(des)),
        })

    out_path = args.out_dir / "team_profiles.json"
    out_path.write_text(json.dumps({
        "video": args.video.name,
        "fps": fps,
        "frames_scanned": collected,
        "max_de": args.max_de,
        "profiles": profiles,
        "rejected_count": len(rejected),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # текстовый отчёт
    report = [f"bootstrap_profiles: {collected} clean frames scanned\n"]
    found = sum(1 for p in profiles if p["found"])
    report.append(f"slots found: {found}/20  (rejected: {len(rejected)})\n\n")
    report.append(f"{'slot':>4} {'hex':>9} {'n':>4} {'w':>4} {'h':>4} {'area':>6} {'ΔE_mean':>8}\n")
    for p in profiles:
        if not p["found"]:
            report.append(f"{p['slot']:>4} {p['ref_hex']:>9}   -    -    -      -        -   NOT FOUND\n")
        else:
            report.append(f"{p['slot']:>4} {p['ref_hex']:>9} {p['samples']:>4} "
                          f"{p['w_median']:>4} {p['h_median']:>4} "
                          f"{p['area_median']:>6.0f} {p['delta_e_mean']:>8.2f}\n")
    (args.out_dir / "report.txt").write_text("".join(report), encoding="utf-8")

    print(f"[ok] profiles -> {out_path}")
    print(f"[ok] crops    -> {args.out_dir / 'slots'}/<slot>/*.png")
    print(f"[ok] report   -> {args.out_dir / 'report.txt'}")
    print(f"     {found}/20 slots found")


if __name__ == "__main__":
    main()