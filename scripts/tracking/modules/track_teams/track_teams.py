#!/usr/bin/env python3
"""
track_teams.py — обработка VOD Apex и формирование tracks.json.

Пайплайн:
  1. Регистрация кадра -> каноническая карта (ORB + RANSAC homography).
     Из H извлекаются zoom, pan, rotation, ransac_inliers.
  2. Детекция плашек команд по HSV из config.yaml.
  3. Перевод центроидов и стрелок в мировые координаты через H + калибровку.
  4. Трекинг в мировых координатах (простой Калман + жадное назначение).
  5. Потоковая запись tracks.json (без накопления в RAM).

Запуск:
    python track_teams.py --video game.mp4 --config config.example.yaml --out tracks.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import yaml
from tqdm import tqdm


# ----------------------------- Config & maps -----------------------------

@dataclass
class TeamCfg:
    id: str
    name: str
    hsv_lower: np.ndarray
    hsv_upper: np.ndarray
    hsv_lower2: Optional[np.ndarray] = None
    hsv_upper2: Optional[np.ndarray] = None
    color_hex: str = "#ffffff"
    slot: Optional[int] = None       # 1..20, matches motion_detect/hsv_presets
    slot_id: Optional[str] = None    # canonical "slot_<N>"; falls back to id


@dataclass
class CanonicalMap:
    name: str
    image: np.ndarray            # grayscale, full-size
    size: tuple[int, int]        # (W, H)
    world_bounds: dict
    px_to_world: np.ndarray      # 3x3 affine fit canonical_px -> world


def load_config(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def parse_teams(cfg: dict) -> list[TeamCfg]:
    out = []
    palette = ["#ef4444", "#3b82f6", "#eab308", "#22c55e", "#a855f7", "#ec4899", "#06b6d4", "#f97316"]
    for i, t in enumerate(cfg.get("teams", [])):
        slot = t.get("slot")
        slot_id = t.get("slot_id") or (f"slot_{int(slot)}" if slot is not None else str(t["id"]))
        out.append(TeamCfg(
            id=str(t["id"]),
            name=str(t.get("name", t["id"])),
            hsv_lower=np.array(t["hsv_lower"], dtype=np.uint8),
            hsv_upper=np.array(t["hsv_upper"], dtype=np.uint8),
            hsv_lower2=np.array(t["hsv_lower2"], dtype=np.uint8) if "hsv_lower2" in t else None,
            hsv_upper2=np.array(t["hsv_upper2"], dtype=np.uint8) if "hsv_upper2" in t else None,
            color_hex=t.get("color", palette[i % len(palette)]),
            slot=int(slot) if slot is not None else None,
            slot_id=slot_id,
        ))
    return out


def fit_affine_px_to_world(points: list[dict]) -> np.ndarray:
    """Least-squares fit of 2D affine: world = A * [px; 1]. Returns 3x3."""
    src = np.array([p["canonical_px"] for p in points], dtype=np.float64)
    dst = np.array([p["world"] for p in points], dtype=np.float64)
    n = len(src)
    if n < 3:
        raise ValueError("Нужно минимум 3 calibration_points")
    M = np.zeros((2 * n, 6))
    b = np.zeros(2 * n)
    for i, ((x, y), (X, Y)) in enumerate(zip(src, dst)):
        M[2 * i] = [x, y, 1, 0, 0, 0]
        M[2 * i + 1] = [0, 0, 0, x, y, 1]
        b[2 * i] = X
        b[2 * i + 1] = Y
    a, *_ = np.linalg.lstsq(M, b, rcond=None)
    return np.array([[a[0], a[1], a[2]], [a[3], a[4], a[5]], [0, 0, 1]])


def load_canonical_map(name: str, base_dir: Path) -> CanonicalMap:
    meta_path = base_dir / f"{name}.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    img_path = base_dir / meta["image"]
    if not img_path.exists():
        print(f"[warn] {img_path} не найден — использую серый плейсхолдер. Регистрация будет работать плохо.")
        W, H = meta["canonical_size"]
        img = np.full((H, W), 128, dtype=np.uint8)
    else:
        img = cv2.imread(str(img_path), cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise RuntimeError(f"Не смог прочитать {img_path}")
        real_h, real_w = img.shape[:2]
        meta_size = tuple(meta.get("canonical_size", [real_w, real_h]))
        if meta_size != (real_w, real_h):
            print(f"[info] canonical_size в JSON {meta_size} не совпадает с реальным {(real_w, real_h)} — использую реальный.")
            meta["canonical_size"] = [real_w, real_h]
    return CanonicalMap(
        name=name,
        image=img,
        size=tuple(meta["canonical_size"]),
        world_bounds=meta.get("world_bounds", {"x": [0, 1000], "y": [0, 1000]}),
        px_to_world=fit_affine_px_to_world(meta["calibration_points"]),
    )


# ------------------------- Frame registration ----------------------------

class FrameRegistrar:
    """Считает гомографию frame_px -> canonical_px."""

    def __init__(self, cmap: CanonicalMap, reg_cfg: dict):
        self.cmap = cmap
        self.cfg = reg_cfg
        detector = reg_cfg.get("detector", "orb").lower()
        n = int(reg_cfg.get("max_features", 1500))
        if detector == "sift":
            self.detector = cv2.SIFT_create(nfeatures=n)
            self.norm = cv2.NORM_L2
        else:
            self.detector = cv2.ORB_create(nfeatures=n, fastThreshold=7)
            self.norm = cv2.NORM_HAMMING
        self.use_clahe = bool(reg_cfg.get("clahe", True))
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)) if self.use_clahe else None
        # Прекомпьют фич канонической карты (downscale для скорости)
        target_w = int(reg_cfg.get("canonical_target_w", 1600))
        H, W = cmap.image.shape[:2]
        self.scale = min(1.0, target_w / W)
        small = cv2.resize(cmap.image, (int(W * self.scale), int(H * self.scale))) if self.scale < 1 else cmap.image
        small_eq = self.clahe.apply(small) if self.clahe is not None else small
        self.map_small = small_eq
        self.kp_map, self.des_map = self.detector.detectAndCompute(small_eq, None)
        print(f"[info] canonical features: {0 if self.des_map is None else len(self.des_map)} (detector={detector}, clahe={self.use_clahe})")
        self.bf = cv2.BFMatcher(self.norm, crossCheck=False)
        self.ratio = float(reg_cfg.get("match_ratio", 0.75))
        self.reproj = float(reg_cfg.get("ransac_reproj_px", 5.0))
        self.min_inliers = int(reg_cfg.get("min_inliers", 25))
        roi = reg_cfg.get("roi", [0, 0, 1, 1])
        self.roi = tuple(float(v) for v in roi)

    def _crop_roi(self, gray: np.ndarray) -> tuple[np.ndarray, tuple[int, int]]:
        h, w = gray.shape[:2]
        x0 = int(self.roi[0] * w); y0 = int(self.roi[1] * h)
        x1 = int(self.roi[2] * w); y1 = int(self.roi[3] * h)
        return gray[y0:y1, x0:x1], (x0, y0)

    def register(self, frame_bgr: np.ndarray):
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        roi_img, (ox, oy) = self._crop_roi(gray)
        if self.clahe is not None:
            roi_img = self.clahe.apply(roi_img)
        kp_f, des_f = self.detector.detectAndCompute(roi_img, None)
        if des_f is None or self.des_map is None or len(kp_f) < 8:
            return None, 0
        try:
            knn = self.bf.knnMatch(des_f, self.des_map, k=2)
        except cv2.error:
            return None, 0
        good = []
        for pair in knn:
            if len(pair) < 2:
                continue
            m, n = pair
            if m.distance < self.ratio * n.distance:
                good.append(m)
        if len(good) < 8:
            return None, len(good)
        src = np.float32([(kp_f[m.queryIdx].pt[0] + ox, kp_f[m.queryIdx].pt[1] + oy) for m in good]).reshape(-1, 1, 2)
        dst = np.float32([self.kp_map[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        # rescale map points back to full canonical
        if self.scale != 1.0:
            dst = dst / self.scale
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, self.reproj)
        if H is None:
            return None, 0
        inliers = int(mask.sum()) if mask is not None else 0
        if inliers < self.min_inliers:
            return H, inliers   # return anyway, mark low_conf upstream
        return H, inliers


def decompose_homography(H: np.ndarray) -> dict:
    """Грубое разложение H на zoom (средний масштаб), rotation, pan (центр кадра)."""
    a, b = H[0, 0], H[0, 1]
    c, d = H[1, 0], H[1, 1]
    sx = math.hypot(a, c)
    sy = math.hypot(b, d)
    zoom = (sx + sy) / 2.0
    rotation_deg = math.degrees(math.atan2(c, a))
    return {"zoom": float(zoom), "rotation_deg": float(rotation_deg)}


def map_point(H: np.ndarray, pt_xy: tuple[float, float]) -> tuple[float, float]:
    v = np.array([pt_xy[0], pt_xy[1], 1.0])
    w = H @ v
    return float(w[0] / w[2]), float(w[1] / w[2])


# --------------------- Anchors (from motion_detect) ----------------------

def load_minimap_affine(map_name: str, base_dir: Path) -> Optional[np.ndarray]:
    """Load minimap_px -> canonical_px affine. Returns 3x3 or None if no file."""
    p = base_dir / f"{map_name}.minimap_affine.json"
    if not p.exists():
        return None
    raw = json.loads(p.read_text(encoding="utf-8"))
    pts = [{"canonical_px": q["minimap_px"], "world": q["canonical_px"]} for q in raw["points"]]
    return fit_affine_px_to_world(pts)


def load_anchors(path: Path,
                 teams: list[TeamCfg],
                 mini_affine: Optional[np.ndarray],
                 cmap: "CanonicalMap") -> dict[str, dict]:
    """Read motion_detect/reports/motion_tracks.json and convert each slot's
    consensus_xy (minimap pixels) into canonical+world coordinates.

    Returns { team_id: { 'slot': int, 'slot_id': str, 'conf': 'HIGH|MED|LOW|MISS',
                          'world':(x,y), 'canonical_px':(x,y) } }.
    Teams without a 'slot' field in config are skipped (no way to match)."""
    if not path.exists():
        print(f"[warn] anchors file {path} not found — стартую без motion-якорей")
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    # build slot -> best result
    by_slot: dict[int, dict] = {}
    for r in raw.get("results", []):
        slot = r.get("slot")
        if slot is None:
            continue
        prev = by_slot.get(slot)
        order = {"HIGH": 0, "MED": 1, "LOW": 2, "MISS": 3}
        if prev is None or order.get(r.get("confidence", "MISS"), 9) < order.get(prev.get("confidence", "MISS"), 9):
            by_slot[slot] = r
    out: dict[str, dict] = {}
    if mini_affine is None:
        print("[warn] нет minimap_affine.json для карты — anchor xy переведу как identity")
    for t in teams:
        if t.slot is None:
            continue
        r = by_slot.get(t.slot)
        if r is None or not r.get("consensus_xy"):
            out[t.id] = {"slot": t.slot, "slot_id": t.slot_id or f"slot_{t.slot}",
                         "conf": "MISS", "world": None, "canonical_px": None}
            continue
        mx, my = r["consensus_xy"]
        if mini_affine is not None:
            cx, cy = map_point(mini_affine, (float(mx), float(my)))
        else:
            cx, cy = float(mx), float(my)
        wx, wy = map_point(cmap.px_to_world, (cx, cy))
        out[t.id] = {
            "slot": t.slot, "slot_id": t.slot_id or f"slot_{t.slot}",
            "conf": r.get("confidence", "MISS"),
            "world": (wx, wy), "canonical_px": (cx, cy),
        }
    return out


# ----------------------------- Detection ---------------------------------

def detect_team_blobs(frame_bgr: np.ndarray, teams: list[TeamCfg], det_cfg: dict):
    """Возвращает [{team_id, frame_px:(x,y), bbox, angle_frame_deg}]."""
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    k = int(det_cfg.get("morph_kernel", 3))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    min_a = float(det_cfg.get("min_area_px", 60))
    max_a = float(det_cfg.get("max_area_px", 1200))
    arr_min = float(det_cfg.get("arrow_min_area_px", 12))
    eps_rel = float(det_cfg.get("arrow_approx_eps", 0.05))

    out = []
    for t in teams:
        mask = cv2.inRange(hsv, t.hsv_lower, t.hsv_upper)
        if t.hsv_lower2 is not None and t.hsv_upper2 is not None:
            mask |= cv2.inRange(hsv, t.hsv_lower2, t.hsv_upper2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            area = cv2.contourArea(c)
            if area < min_a or area > max_a:
                continue
            x, y, w, h = cv2.boundingRect(c)
            M = cv2.moments(c)
            if M["m00"] == 0:
                continue
            cx = M["m10"] / M["m00"]; cy = M["m01"] / M["m00"]
            # arrow direction via approxPolyDP triangle near bbox
            angle = None
            approx = cv2.approxPolyDP(c, eps_rel * cv2.arcLength(c, True), True)
            if len(approx) == 3 and cv2.contourArea(approx) >= arr_min:
                pts = approx.reshape(-1, 2)
                # tip = farthest vertex from centroid
                d = np.linalg.norm(pts - np.array([cx, cy]), axis=1)
                tip = pts[int(np.argmax(d))]
                angle = math.degrees(math.atan2(tip[1] - cy, tip[0] - cx))
            out.append({
                "team_id": t.id,
                "frame_px": (float(cx), float(cy)),
                "bbox": (int(x), int(y), int(w), int(h)),
                "angle_frame_deg": angle,
                "score": float(area / max_a),
            })
    return out


# ------------------------------ Tracker ----------------------------------

@dataclass
class Track:
    team_id: str
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    angle: Optional[float] = None
    miss: int = 0
    state: str = "alive"
    last_conf: float = 1.0
    slot_id: Optional[str] = None
    last_seen_t: float = 0.0
    wiped_at_t: Optional[float] = None

    def predict(self):
        self.x += self.vx
        self.y += self.vy

    def update(self, mx: float, my: float, angle: Optional[float], conf: float, q: float, r: float):
        # poor man's Kalman: blend predicted and measured
        k = r / (r + q)
        nx = self.x + (mx - self.x) * (1 - k)
        ny = self.y + (my - self.y) * (1 - k)
        self.vx = 0.7 * self.vx + 0.3 * (nx - self.x)
        self.vy = 0.7 * self.vy + 0.3 * (ny - self.y)
        self.x = nx; self.y = ny
        if angle is not None:
            self.angle = angle
        self.miss = 0
        self.state = "alive"
        self.last_conf = conf


class WorldTracker:
    def __init__(self, cfg: dict):
        self.tracks: dict[str, Track] = {}   # one track per team for now
        self.max_gap = int(cfg.get("max_gap_frames", 30))
        self.gate = float(cfg.get("gating_world_dist", 50.0))
        self.q = float(cfg.get("process_noise", 1.0))
        self.r = float(cfg.get("measurement_noise", 4.0))
        # wipe detection
        wcfg = cfg.get("wipe", {}) or {}
        self.wipe_absence_sec = float(wcfg.get("absence_sec", 45.0))
        self.wipe_respect_cuts = bool(wcfg.get("respect_cuts", True))
        # cuts handled by main loop (it freezes last_seen_t around camera cuts)
        self.slot_anchors: dict[str, dict] = {}  # team_id -> anchor info
        self.cur_t: float = 0.0
        self.new_wipes: list[dict] = []

    def set_anchors(self, anchors: dict[str, dict]):
        self.slot_anchors = anchors or {}
        for team_id, a in self.slot_anchors.items():
            if a.get("conf") in ("HIGH", "MED") and a.get("world") is not None:
                wx, wy = a["world"]
                self.tracks[team_id] = Track(
                    team_id=team_id, x=wx, y=wy,
                    state="alive", last_conf=1.0 if a["conf"] == "HIGH" else 0.7,
                    slot_id=a.get("slot_id"), last_seen_t=0.0,
                )

    def step(self, detections_world: list[dict], t: float):
        self.cur_t = t
        self.new_wipes = []
        # 1 predict
        for tr in self.tracks.values():
            tr.predict()
            tr.miss += 1
            if tr.miss > 0 and tr.state == "alive":
                tr.state = "low_conf"
            if tr.miss > self.max_gap:
                tr.state = "lost"
            # 1b wipe detection: long unbroken absence -> mark wiped
            if (tr.wiped_at_t is None
                    and tr.last_seen_t > 0
                    and (t - tr.last_seen_t) >= self.wipe_absence_sec):
                tr.wiped_at_t = round(t, 2)
                tr.state = "lost"
                self.new_wipes.append({
                    "slot_id": tr.slot_id or tr.team_id,
                    "team_id": tr.team_id,
                    "t": tr.wiped_at_t,
                    "last_world": [round(tr.x, 2), round(tr.y, 2)],
                })
        # 2 group detections by team and pick closest to existing track or pick highest score
        by_team: dict[str, list[dict]] = {}
        for d in detections_world:
            by_team.setdefault(d["team_id"], []).append(d)
        for team_id, dets in by_team.items():
            tr = self.tracks.get(team_id)
            if tr is not None and tr.wiped_at_t is not None:
                # команда официально выбита — игнорим ложные детекции
                continue
            chosen = None
            if tr is not None and tr.state != "lost":
                dets_in_gate = [d for d in dets if math.hypot(d["world"][0] - tr.x, d["world"][1] - tr.y) <= self.gate]
                pool = dets_in_gate or dets
                chosen = min(pool, key=lambda d: math.hypot(d["world"][0] - tr.x, d["world"][1] - tr.y))
            else:
                chosen = max(dets, key=lambda d: d.get("score", 0))
            mx, my = chosen["world"]
            angle = chosen.get("angle_world_deg")
            if tr is None or tr.state == "lost":
                anchor = self.slot_anchors.get(team_id, {})
                self.tracks[team_id] = Track(
                    team_id=team_id, x=mx, y=my, angle=angle,
                    last_conf=chosen.get("score", 1.0),
                    slot_id=anchor.get("slot_id"), last_seen_t=t,
                )
            else:
                tr.update(mx, my, angle, chosen.get("score", 1.0), self.q, self.r)
                tr.last_seen_t = t

    def snapshot(self) -> list[dict]:
        out = []
        for tr in self.tracks.values():
            if tr.state == "lost":
                continue
            out.append({
                "team_id": tr.team_id,
                "slot_id": tr.slot_id or tr.team_id,
                "world": [round(tr.x, 2), round(tr.y, 2)],
                "angle_world_deg": None if tr.angle is None else round(tr.angle, 1),
                "state": tr.state,
                "confidence": round(float(tr.last_conf), 3),
            })
        return out


# ---------------------------- Main pipeline ------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--config", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--frame-step", type=int, default=None)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=-1.0)
    ap.add_argument("--preview", type=Path, default=None)
    ap.add_argument("--debug-frame", type=int, default=None)
    ap.add_argument("--anchors", type=Path, default=None,
                    help="motion_detect/reports/motion_tracks.json для инициализации треков")
    args = ap.parse_args()

    if not args.video.exists():
        print(f"[err] не нашёл видео: {args.video}", file=sys.stderr); sys.exit(2)

    cfg = load_config(args.config)
    teams = parse_teams(cfg)
    if not teams:
        print("[err] в config не описано ни одной команды", file=sys.stderr); sys.exit(2)
    canonical_dir = (args.config.parent / "canonical_maps").resolve()
    if not canonical_dir.exists():
        canonical_dir = (Path(__file__).resolve().parents[2] / "shared" / "canonical_maps").resolve()
    cmap = load_canonical_map(cfg.get("canonical_map", "storm_point"), canonical_dir)
    reg = FrameRegistrar(cmap, cfg.get("registration", {}))
    det_cfg = cfg.get("detection", {})
    trk = WorldTracker(cfg.get("tracking", {}))
    # anchors (motion_detect)
    anchors_path = args.anchors
    if anchors_path is None and cfg.get("anchors_file"):
        anchors_path = (args.config.parent / cfg["anchors_file"]).resolve()
    anchors_map: dict[str, dict] = {}
    if anchors_path:
        mini_affine = load_minimap_affine(cmap.name, canonical_dir)
        anchors_map = load_anchors(Path(anchors_path), teams, mini_affine, cmap)
        trk.set_anchors(anchors_map)
        print(f"[info] anchors: {sum(1 for a in anchors_map.values() if a.get('conf') in ('HIGH','MED'))} HIGH/MED, {sum(1 for a in anchors_map.values() if a.get('conf') == 'LOW')} LOW")
    frame_step = int(args.frame_step or cfg.get("frame_step", 3))

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        print("[err] cv2 не открыл видео", file=sys.stderr); sys.exit(2)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    start_frame = int(args.start * fps)
    end_frame = total if args.end < 0 else min(total, int(args.end * fps))
    if start_frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    preview_writer = None
    if args.preview is not None:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        preview_writer = cv2.VideoWriter(str(args.preview), fourcc, fps / frame_step,
                                         (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                                          int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))))

    # Streaming JSON writer
    out_path = args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fout = open(out_path, "w", encoding="utf-8")
    meta = {
        "video": str(args.video.name),
        "fps_source": float(fps),
        "fps_processed": float(fps / frame_step),
        "frame_count": int(end_frame - start_frame),
        "canonical_map": cmap.name,
        "canonical_size": [int(cmap.size[0]), int(cmap.size[1])],
        "world_bounds": cmap.world_bounds,
        "teams": [{"id": t.id, "name": t.name, "color": t.color_hex} for t in teams],
        "slots": [
            {
                "slot_id": t.slot_id or t.id,
                "slot": t.slot,
                "team_id": t.id,
                "name": t.name,
                "color": t.color_hex,
                "anchor_conf": (anchors_map.get(t.id, {}) or {}).get("conf", "MISS"),
                "anchor_world": (lambda a: [round(a[0], 2), round(a[1], 2)] if a else None)(
                    (anchors_map.get(t.id, {}) or {}).get("world")),
                "wiped_at_t": None,
            } for t in teams
        ],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "schema_version": 2,
    }
    fout.write('{"meta":'); json.dump(meta, fout, ensure_ascii=False); fout.write(',"frames":[')
    first = True

    pbar = tqdm(total=(end_frame - start_frame), unit="f", desc="track")
    frame_idx = start_frame
    processed = 0
    try:
        while frame_idx < end_frame:
            ok, frame = cap.read()
            if not ok:
                break
            if (frame_idx - start_frame) % frame_step != 0:
                frame_idx += 1
                pbar.update(1)
                continue

            H, inliers = reg.register(frame)
            if H is None:
                cam = {"registration": "failed", "ransac_inliers": int(inliers)}
                tracks_world = []
            else:
                decomp = decompose_homography(H)
                # pan: где центр кадра попадает на канонической карте
                fw = frame.shape[1]; fh = frame.shape[0]
                cx_can, cy_can = map_point(H, (fw / 2, fh / 2))
                low = inliers < reg.min_inliers
                cam = {
                    "registration": "low_confidence" if low else "ok",
                    "ransac_inliers": int(inliers),
                    "zoom": round(decomp["zoom"], 4),
                    "rotation_deg": round(decomp["rotation_deg"], 2),
                    "pan_canonical": [round(cx_can, 1), round(cy_can, 1)],
                }
                blobs = detect_team_blobs(frame, teams, det_cfg)
                world_dets = []
                for b in blobs:
                    cx_c, cy_c = map_point(H, b["frame_px"])
                    wx, wy = map_point(cmap.px_to_world, (cx_c, cy_c))
                    angle_world = None
                    if b["angle_frame_deg"] is not None:
                        # повернуть единичный вектор стрелки через H и измерить угол на карте
                        a = math.radians(b["angle_frame_deg"])
                        p0 = b["frame_px"]
                        p1 = (p0[0] + 10 * math.cos(a), p0[1] + 10 * math.sin(a))
                        cx1, cy1 = map_point(H, p1)
                        wx1, wy1 = map_point(cmap.px_to_world, (cx1, cy1))
                        angle_world = math.degrees(math.atan2(wy1 - wy, wx1 - wx))
                    world_dets.append({
                        "team_id": b["team_id"],
                        "frame_px": [round(b["frame_px"][0], 1), round(b["frame_px"][1], 1)],
                        "canonical_px": [round(cx_c, 1), round(cy_c, 1)],
                        "world": [wx, wy],
                        "angle_world_deg": angle_world,
                        "score": b["score"],
                    })
                t_now = (frame_idx - start_frame) / fps
                trk.step(world_dets, t_now)
                tracks_world = []
                # обогатим snapshot последними измеренными canonical_px / frame_px (для рендера)
                snap = trk.snapshot()
                last_meas = {}
                for d in world_dets:
                    cur = last_meas.get(d["team_id"])
                    if cur is None or d.get("score", 0) > cur.get("score", 0):
                        last_meas[d["team_id"]] = d
                for s in snap:
                    meas = last_meas.get(s["team_id"])
                    if meas is not None:
                        s["canonical_px"] = meas["canonical_px"]
                        s["frame_px"] = meas["frame_px"]
                    tracks_world.append(s)

            record = {
                "t": round((frame_idx - start_frame) / fps, 3),
                "frame": int(frame_idx),
                "camera": cam,
                "tracks": tracks_world,
            }
            if H is not None and trk.new_wipes:
                record["wipes"] = trk.new_wipes
            if not first:
                fout.write(",")
            json.dump(record, fout, ensure_ascii=False)
            first = False

            if preview_writer is not None:
                vis = frame.copy()
                for s in tracks_world:
                    if "frame_px" not in s:
                        continue
                    x, y = s["frame_px"]
                    color = (0, 255, 0) if s["state"] == "alive" else (0, 200, 255)
                    cv2.circle(vis, (int(x), int(y)), 10, color, 2)
                    cv2.putText(vis, s["team_id"], (int(x) + 12, int(y)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                preview_writer.write(vis)

            if args.debug_frame is not None and frame_idx == args.debug_frame:
                dbg = args.out.parent / f"debug_frame_{frame_idx}.png"
                cv2.imwrite(str(dbg), frame)
                print(f"[debug] saved {dbg}")

            processed += 1
            frame_idx += 1
            pbar.update(1)
    finally:
        pbar.close()
        cap.release()
        if preview_writer is not None:
            preview_writer.release()
        fout.write("]}")
        fout.close()
    print(f"[ok] processed {processed} frames -> {out_path}")


if __name__ == "__main__":
    main()