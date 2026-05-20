#!/usr/bin/env python3
"""
motion_detect.py — отделяет ДВИЖУЩИЕСЯ плашки команд от статичных
HSV-ложных срабатываний (объекты карты, иконки HUD и т.п.).

Идея:
  1. Берём окно из N подряд идущих кадров (по умолчанию 300, шаг 10 = 50 сек
     при 60fps). Камера обсервера на полной миникарте почти не двигается,
     поэтому статичные пятна того же HSV-цвета останутся на месте, а команды
     сдвинутся.
  2. В каждой выборке внутри зон с тегом `minimap` строим HSV-маску
     каждой команды (из hsv_presets.json) и находим blob'ы.
  3. Связываем blob'ы между кадрами в траектории (жадный nearest-neighbor
     в координатах зоны, gate = --link-dist).
  4. Для каждой траектории считаем displacement (max расстояние между
     центроидами). Если displacement < --static-thresh → это статичный
     объект карты, выбрасываем.
  5. Если у команды несколько движущихся траекторий — оставляем ту, у
     которой bbox ближе к медианному размеру (size-gating).

Запуск:
  python motion_detect.py \
      --video game.mp4 \
      --cuts cuts_out/cuts.json \
      --hsv-presets hsv_presets.worlds-edge.json \
      --zones zones.vod.json \
      --start-sec 60 \
      --window 300 --step 10 \
      --static-thresh 8 --link-dist 40 \
      --out-dir motion_out
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm


# ---------- утилиты, общие с detect_teams.py ----------

def is_clean_frame(frame_idx: int, cuts: dict, guard: int = 30) -> bool:
    for ev in cuts.get("events", []) + cuts.get("hud_events", []) + cuts.get("gray_zone", []):
        if abs(frame_idx - ev["frame"]) < guard:
            return False
    return True


def build_mask(hsv_img: np.ndarray, team: dict) -> np.ndarray:
    lo = np.array([team["h"][0], team["s"][0], team["v"][0]], dtype=np.uint8)
    hi = np.array([team["h"][1], team["s"][1], team["v"][1]], dtype=np.uint8)
    mask = cv2.inRange(hsv_img, lo, hi)
    if "h2" in team and team["h2"]:
        s2 = team.get("s2", team["s"]); v2 = team.get("v2", team["v"])
        lo2 = np.array([team["h2"][0], s2[0], v2[0]], dtype=np.uint8)
        hi2 = np.array([team["h2"][1], s2[1], v2[1]], dtype=np.uint8)
        mask = cv2.bitwise_or(mask, cv2.inRange(hsv_img, lo2, hi2))
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    return mask


def find_blobs(mask, min_area, max_area, min_solidity):
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        if a < min_area or a > max_area:
            continue
        x, y, w, h = cv2.boundingRect(c)
        if w < 3 or h < 3:
            continue
        if a / (w * h) < min_solidity:
            continue
        M = cv2.moments(c)
        if M["m00"] == 0:
            continue
        cx = M["m10"] / M["m00"]; cy = M["m01"] / M["m00"]
        out.append({"cx": cx, "cy": cy, "w": w, "h": h, "area": float(a)})
    return out


def scale_zone(z, base_w, base_h, fw, fh):
    sx, sy = fw / base_w, fh / base_h
    x1 = max(0, min(fw, int(round(z["x"] * sx))))
    y1 = max(0, min(fh, int(round(z["y"] * sy))))
    x2 = max(0, min(fw, int(round((z["x"] + z["w"]) * sx))))
    y2 = max(0, min(fh, int(round((z["y"] + z["h"]) * sy))))
    return x1, y1, x2, y2


# ---------- трекинг blob'ов внутри окна ----------

class Trajectory:
    __slots__ = ("points", "last_frame", "ws", "hs")

    def __init__(self, frame_idx, blob):
        self.points = [(frame_idx, blob["cx"], blob["cy"])]
        self.ws = [blob["w"]]
        self.hs = [blob["h"]]
        self.last_frame = frame_idx

    def add(self, frame_idx, blob):
        self.points.append((frame_idx, blob["cx"], blob["cy"]))
        self.ws.append(blob["w"])
        self.hs.append(blob["h"])
        self.last_frame = frame_idx

    @property
    def last_xy(self):
        return self.points[-1][1], self.points[-1][2]

    def displacement(self) -> float:
        if len(self.points) < 2:
            return 0.0
        xs = np.array([p[1] for p in self.points])
        ys = np.array([p[2] for p in self.points])
        # max pairwise distance ≈ max distance from centroid * 2 (быстро)
        mx, my = xs.mean(), ys.mean()
        d = np.hypot(xs - mx, ys - my)
        return float(2 * d.max())

    def path_length(self) -> float:
        if len(self.points) < 2:
            return 0.0
        s = 0.0
        for i in range(1, len(self.points)):
            s += math.hypot(self.points[i][1] - self.points[i - 1][1],
                            self.points[i][2] - self.points[i - 1][2])
        return s

    def median_wh(self):
        return float(np.median(self.ws)), float(np.median(self.hs))


def link_blobs(per_frame, link_dist, max_gap):
    """
    per_frame: list[(frame_idx, [blob, ...])] отсортирован по frame_idx.
    Возвращает список Trajectory.
    Жадный nearest-neighbor: на каждом кадре для каждой открытой траектории
    выбираем ближайший blob в радиусе link_dist.
    """
    open_tr: list[Trajectory] = []
    closed: list[Trajectory] = []
    for frame_idx, blobs in per_frame:
        used = set()
        # 1. extend existing
        for tr in open_tr:
            lx, ly = tr.last_xy
            best, best_d = None, link_dist
            for i, b in enumerate(blobs):
                if i in used:
                    continue
                d = math.hypot(b["cx"] - lx, b["cy"] - ly)
                if d < best_d:
                    best_d, best = d, i
            if best is not None:
                tr.add(frame_idx, blobs[best])
                used.add(best)
        # 2. close stale
        still_open = []
        for tr in open_tr:
            if frame_idx - tr.last_frame > max_gap:
                closed.append(tr)
            else:
                still_open.append(tr)
        open_tr = still_open
        # 3. start new from unused
        for i, b in enumerate(blobs):
            if i in used:
                continue
            open_tr.append(Trajectory(frame_idx, b))
    closed.extend(open_tr)
    return closed


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--cuts", required=True, type=Path)
    ap.add_argument("--hsv-presets", required=True, type=Path)
    ap.add_argument("--zones", required=True, type=Path)
    ap.add_argument("--zone-tag", default="minimap")
    ap.add_argument("--start-sec", type=float, default=0.0,
                    help="с какой секунды начать выборку окна")
    ap.add_argument("--window", type=int, default=300,
                    help="сколько кадров взять в окно")
    ap.add_argument("--step", type=int, default=10,
                    help="шаг между кадрами в окне")
    ap.add_argument("--min-area", type=int, default=15)
    ap.add_argument("--max-area", type=int, default=4000)
    ap.add_argument("--min-solidity", type=float, default=0.55)
    ap.add_argument("--link-dist", type=float, default=40.0,
                    help="макс. сдвиг центроида между соседними выборками (px зоны)")
    ap.add_argument("--max-gap", type=int, default=3,
                    help="через сколько пустых выборок закрывать траекторию")
    ap.add_argument("--static-thresh", type=float, default=8.0,
                    help="displacement (px) ниже которого траектория считается статичной")
    ap.add_argument("--min-points", type=int, default=4,
                    help="мин. длина траектории чтобы её рассматривать")
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    if not args.video.exists():
        print(f"[err] нет видео {args.video}", file=sys.stderr); sys.exit(2)
    cuts = json.loads(args.cuts.read_text(encoding="utf-8"))
    hsv_cfg = json.loads(args.hsv_presets.read_text(encoding="utf-8"))
    zones_cfg = json.loads(args.zones.read_text(encoding="utf-8"))
    teams = hsv_cfg["teams"]
    base_w, base_h = zones_cfg.get("base", [1920, 1080])
    zones = [z for z in zones_cfg["zones"] if z["tag"] == args.zone_tag]
    if not zones:
        print(f"[err] в {args.zones} нет зон с тегом {args.zone_tag}", file=sys.stderr); sys.exit(2)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "overlays").mkdir(exist_ok=True)
    (args.out_dir / "slots").mkdir(exist_ok=True)

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        print("[err] cv2 не открыл видео", file=sys.stderr); sys.exit(2)
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scaled_zones = [(z, scale_zone(z, base_w, base_h, fw, fh)) for z in zones]

    start_frame = int(args.start_sec * fps)
    frames_to_grab = []
    f = start_frame
    while len(frames_to_grab) < args.window and f < total:
        if is_clean_frame(f, cuts):
            frames_to_grab.append(f)
        f += args.step
    if len(frames_to_grab) < args.min_points:
        print(f"[err] слишком мало чистых кадров: {len(frames_to_grab)}", file=sys.stderr); sys.exit(2)

    # per_team[team_slot] -> per_zone[zone_name] -> list[(frame_idx, [blob,...])]
    per_team_zone: dict[tuple[int, str], list[tuple[int, list[dict]]]] = defaultdict(list)
    # сохраним несколько кадров для overlay
    overlay_keep = sorted(set([frames_to_grab[0],
                               frames_to_grab[len(frames_to_grab) // 2],
                               frames_to_grab[-1]]))
    overlay_cache: dict[int, np.ndarray] = {}

    pbar = tqdm(total=len(frames_to_grab), unit="f", desc="motion-scan")
    for fi in frames_to_grab:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ok, frame = cap.read()
        if not ok:
            pbar.update(1); continue
        if fi in overlay_keep:
            overlay_cache[fi] = frame.copy()
        for z, (x1, y1, x2, y2) in scaled_zones:
            if x2 - x1 < 8 or y2 - y1 < 8:
                continue
            roi = frame[y1:y2, x1:x2]
            hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
            for team in teams:
                mask = build_mask(hsv, team)
                blobs = find_blobs(mask, args.min_area, args.max_area, args.min_solidity)
                per_team_zone[(team["slot"], z.get("name", z["tag"]))].append((fi, blobs))
        pbar.update(1)
    pbar.close()
    cap.release()

    # связываем blob'ы в траектории
    results = []  # per (slot, zone)
    team_by_slot = {t["slot"]: t for t in teams}
    for (slot, zone_name), per_frame in per_team_zone.items():
        per_frame.sort(key=lambda x: x[0])
        trs = link_blobs(per_frame, args.link_dist, args.max_gap)
        moving = []
        static = []
        for tr in trs:
            if len(tr.points) < args.min_points:
                continue
            disp = tr.displacement()
            entry = {
                "points": [(int(p[0]), round(p[1], 1), round(p[2], 1)) for p in tr.points],
                "n": len(tr.points),
                "displacement_px": round(disp, 1),
                "path_px": round(tr.path_length(), 1),
                "w_med": round(tr.median_wh()[0], 1),
                "h_med": round(tr.median_wh()[1], 1),
            }
            if disp < args.static_thresh:
                static.append(entry)
            else:
                moving.append(entry)
        # если несколько движущихся — оставим все, ранжируем по path_length
        moving.sort(key=lambda e: -e["path_px"])
        results.append({
            "slot": slot,
            "team_name": team_by_slot[slot].get("name"),
            "hex": team_by_slot[slot].get("hex"),
            "zone": zone_name,
            "moving": moving,
            "static_rejected": len(static),
        })

    # рисуем overlay
    for fi, frame in overlay_cache.items():
        ov = frame.copy()
        for z, (x1, y1, x2, y2) in scaled_zones:
            cv2.rectangle(ov, (x1, y1), (x2, y2), (255, 200, 0), 1)
            for r in results:
                if r["zone"] != z.get("name", z["tag"]):
                    continue
                hexc = (r["hex"] or "#ffffff").lstrip("#")
                bgr = (int(hexc[4:6], 16), int(hexc[2:4], 16), int(hexc[0:2], 16))
                for tr in r["moving"]:
                    pts = [(int(x1 + p[1]), int(y1 + p[2])) for p in tr["points"]]
                    for a, b in zip(pts[:-1], pts[1:]):
                        cv2.line(ov, a, b, bgr, 2)
                    if pts:
                        cv2.circle(ov, pts[-1], 5, bgr, 2)
                        cv2.putText(ov, str(r["slot"]), (pts[-1][0] + 6, pts[-1][1] - 6),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, bgr, 1)
        cv2.imwrite(str(args.out_dir / "overlays" / f"motion_{fi}.jpg"),
                    ov, [cv2.IMWRITE_JPEG_QUALITY, 85])

    # сохраняем JSON и отчёт
    (args.out_dir / "motion_tracks.json").write_text(json.dumps({
        "video": args.video.name, "fps": fps,
        "start_sec": args.start_sec, "window": args.window, "step": args.step,
        "static_thresh_px": args.static_thresh, "link_dist_px": args.link_dist,
        "zone_tag": args.zone_tag,
        "frames_used": frames_to_grab,
        "results": results,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [f"motion_detect: {len(frames_to_grab)} frames, "
             f"window={args.window}, step={args.step}, "
             f"static<{args.static_thresh}px → rejected\n\n"]
    lines.append(f"{'slot':>4} {'hex':>9} {'mov':>4} {'best_disp':>10} {'static':>7}  name\n")
    for r in sorted(results, key=lambda x: x["slot"]):
        best = max((m["displacement_px"] for m in r["moving"]), default=0.0)
        lines.append(f"{r['slot']:>4} {(r['hex'] or '-'):>9} "
                     f"{len(r['moving']):>4} {best:>10.1f} {r['static_rejected']:>7}   "
                     f"{r['team_name'] or ''}\n")
    (args.out_dir / "report.txt").write_text("".join(lines), encoding="utf-8")

    print(f"[ok] motion tracks -> {args.out_dir / 'motion_tracks.json'}")
    print(f"[ok] overlays      -> {args.out_dir / 'overlays'}/motion_*.jpg")
    print(f"[ok] report        -> {args.out_dir / 'report.txt'}")


if __name__ == "__main__":
    main()