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
    # LAB range derived from HSV range (filled lazily by SlotTracker).
    lab_lower: Optional[np.ndarray] = None
    lab_upper: Optional[np.ndarray] = None
    # Per-slot detection overrides (None → fall back to global det_cfg).
    min_area: Optional[float] = None
    max_area: Optional[float] = None
    morph_kernel: Optional[int] = None


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


def _hex_to_hsv_center(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.lstrip("#")
    r = int(h[0:2], 16); g = int(h[2:4], 16); b = int(h[4:6], 16)
    px = np.uint8([[[b, g, r]]])  # BGR for cv2
    H, S, V = cv2.cvtColor(px, cv2.COLOR_BGR2HSV)[0, 0]
    return int(H), int(S), int(V)


def teams_from_anchors(path: Path, h_tol: int = 10,
                       s_min_floor: int = 60, v_min_floor: int = 60,
                       s_drop: int = 80, v_drop: int = 80,
                       hsv_preset: dict[int, dict] | None = None) -> list[TeamCfg]:
    """Build TeamCfg list directly from motion_detect/reports/motion_tracks.json.
    Each motion-detected slot becomes one team with HSV range derived from its
    hex color (H ± h_tol, S/V wide around the source). Hue wrap is handled with
    hsv_lower2/hsv_upper2 like the YAML 'red' team.
    If `hsv_preset` is provided (slot -> {h:[lo,hi], s:[lo,hi], v:[lo,hi]}),
    those manually-calibrated ranges take precedence over the derived ones."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    results = raw.get("results", [])
    out: list[TeamCfg] = []
    for r in results:
        slot = r.get("slot")
        if slot is None:
            continue
        hex_str = r.get("hex", "#888888")
        slot_int = int(slot)
        lo = hi = lo2 = hi2 = None
        preset_used = False
        if hsv_preset and slot_int in hsv_preset:
            p = hsv_preset[slot_int]
            h_lo, h_hi = int(p["h"][0]), int(p["h"][1])
            s_lo, s_hi = int(p["s"][0]), int(p["s"][1])
            v_lo, v_hi = int(p["v"][0]), int(p["v"][1])
            if h_lo <= h_hi:
                lo = np.array([h_lo, s_lo, v_lo], dtype=np.uint8)
                hi = np.array([h_hi, s_hi, v_hi], dtype=np.uint8)
            else:
                # hue wrap (e.g. red): split into two ranges
                lo  = np.array([h_lo, s_lo, v_lo], dtype=np.uint8)
                hi  = np.array([179,  s_hi, v_hi], dtype=np.uint8)
                lo2 = np.array([0,    s_lo, v_lo], dtype=np.uint8)
                hi2 = np.array([h_hi, s_hi, v_hi], dtype=np.uint8)
            preset_used = True
        else:
            H, S, V = _hex_to_hsv_center(hex_str)
            s_lo = max(s_min_floor, S - s_drop)
            v_lo = max(v_min_floor, V - v_drop)
            h_low = H - h_tol
            h_high = H + h_tol
            if h_low < 0:
                lo  = np.array([0, s_lo, v_lo], dtype=np.uint8)
                hi  = np.array([h_high, 255, 255], dtype=np.uint8)
                lo2 = np.array([179 + h_low, s_lo, v_lo], dtype=np.uint8)
                hi2 = np.array([179, 255, 255], dtype=np.uint8)
            elif h_high > 179:
                lo  = np.array([h_low, s_lo, v_lo], dtype=np.uint8)
                hi  = np.array([179, 255, 255], dtype=np.uint8)
                lo2 = np.array([0, s_lo, v_lo], dtype=np.uint8)
                hi2 = np.array([h_high - 179, 255, 255], dtype=np.uint8)
            else:
                lo = np.array([h_low,  s_lo, v_lo], dtype=np.uint8)
                hi = np.array([h_high, 255, 255], dtype=np.uint8)
        out.append(TeamCfg(
            id=f"slot_{slot_int}",
            name=str(r.get("team_name") or f"Team {slot_int}"),
            hsv_lower=lo, hsv_upper=hi,
            hsv_lower2=lo2, hsv_upper2=hi2,
            color_hex=hex_str,
            slot=slot_int,
            slot_id=f"slot_{slot_int}",
        ))
    if hsv_preset:
        used = sum(1 for r in results if r.get("slot") is not None and int(r["slot"]) in hsv_preset)
        print(f"[info] hsv_preset: applied to {used}/{len(out)} slots (others use anchor-derived HSV)")
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


# ------------------------- HSV → LAB helper ------------------------------

def _hsv_to_lab_pixel(hsv: tuple[int, int, int]) -> np.ndarray:
    px = np.array([[[hsv[0], hsv[1], hsv[2]]]], dtype=np.uint8)
    bgr = cv2.cvtColor(px, cv2.COLOR_HSV2BGR)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    return lab[0, 0].astype(np.int16)


def build_lab_range_from_hsv(lo: np.ndarray, hi: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Approximate LAB range from HSV bounds, expanded on A/B for shadows/compression."""
    lo_lab = _hsv_to_lab_pixel((int(lo[0]), int(lo[1]), int(lo[2])))
    hi_lab = _hsv_to_lab_pixel((int(hi[0]), int(hi[1]), int(hi[2])))
    l_min = int(max(0, min(lo_lab[0], hi_lab[0]) - 20))
    l_max = int(min(255, max(lo_lab[0], hi_lab[0]) + 20))
    a_min = int(max(0, min(lo_lab[1], hi_lab[1]) - 28))
    a_max = int(min(255, max(lo_lab[1], hi_lab[1]) + 28))
    b_min = int(max(0, min(lo_lab[2], hi_lab[2]) - 28))
    b_max = int(min(255, max(lo_lab[2], hi_lab[2]) + 28))
    return (
        np.array([l_min, a_min, b_min], dtype=np.uint8),
        np.array([l_max, a_max, b_max], dtype=np.uint8),
    )


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

# Per-slot local tracker (inspired by apex-stats SimpleArrowTracker, simplified
# because we already work in world coords via homography).

class SlotTracker:
    """Локальный трекер одного слота: ищет плашку в ROI кадра вокруг
    последней проекции своей канонической позиции.

    Состояние хранится в canonical_px (потому что кадр двигается, а карта — нет).
    """

    def __init__(self, team: TeamCfg, slot_cfg: dict, init_canonical_px: Optional[tuple[float, float]],
                 elim_t: Optional[float] = None,
                 anchor_conf: str = "MISS", hud_alive: bool = False,
                 init_frame_px: Optional[tuple[float, float]] = None):
        self.team = team
        self.canonical_px: Optional[tuple[float, float]] = init_canonical_px
        self.last_frame_px: Optional[tuple[float, float]] = None
        # ROI / detection
        self.roi_size: int = int(slot_cfg.get("roi_size", 220))
        self.min_roi: int = int(slot_cfg.get("min_roi", 120))
        self.max_roi_expand_px: int = int(slot_cfg.get("max_roi_expand_px", 400))
        self.roi_expand_step_px: int = int(slot_cfg.get("roi_expand_step_px", 100))
        self.roi_expand_px: int = 0
        self.min_area: float = float(team.min_area if team.min_area is not None else slot_cfg.get("min_area_px", 40))
        self.max_area: float = float(team.max_area if team.max_area is not None else slot_cfg.get("max_area_px", 2400))
        self.morph_kernel: int = int(team.morph_kernel if team.morph_kernel is not None else slot_cfg.get("morph_kernel", 5))
        # Stabilisation
        self.center_deadzone_px: float = float(slot_cfg.get("center_deadzone_px", 2.0))
        self.max_center_step_px: float = float(slot_cfg.get("max_center_step_px", 24.0))
        self.center_smoothing_alpha: float = float(slot_cfg.get("center_smoothing_alpha", 0.35))
        # Anti-jump
        self.jump_switch_threshold_px: float = float(slot_cfg.get("jump_switch_threshold_px", 30.0))
        self.switch_confirm_frames: int = int(slot_cfg.get("switch_confirm_frames", 3))
        self.pending_canon: Optional[tuple[float, float]] = None
        self.pending_hits: int = 0
        # Full-frame recovery: если ROI промахивается N+ кадров подряд,
        # каждые `recover_interval` кадров ищем плашку по всему кадру
        # в окрестности предсказания (`recover_gate_px` каноники).
        self.recover_after_misses: int = int(slot_cfg.get("recover_after_misses", 10))
        self.recover_interval: int = int(slot_cfg.get("recover_interval", 5))
        self.recover_gate_px: float = float(slot_cfg.get("recover_gate_px", 600.0))
        self.n_recovered: int = 0
        # Time-aware motion model (canonical px / sec).
        motion = slot_cfg.get("motion", {}) or {}
        self.v_max_px_s: float = float(motion.get("v_max_px_s", 60.0))
        self.gate_slack_px: float = float(motion.get("gate_slack_px", 20.0))
        self.gate_cap_px: float = float(motion.get("gate_cap_px", 450.0))
        self.dt_cap_s: float = float(motion.get("dt_cap_s", 20.0))
        self.velocity_alpha: float = float(motion.get("velocity_alpha", 0.5))
        # Adaptive: remember observed peak speed so "mobile" slots auto-widen the gate.
        self.v_observed_peak_px_s: float = 0.0
        self.v_observed_decay: float = float(motion.get("v_observed_decay", 0.97))
        self.v_observed_boost: float = float(motion.get("v_observed_boost", 1.8))
        self.vx: float = 0.0
        self.vy: float = 0.0
        self.last_seen_t: Optional[float] = None
        self.canonical_px_stale: bool = init_canonical_px is None
        self.wiped: bool = False
        # Authoritative wipe time from HUD (eliminations.json). When t_now >= elim_t,
        # the slot is force-wiped — no more detection work, not counted as `lost`.
        self.elim_t: Optional[float] = elim_t
        # Active-slot filter: если за первые N processed-кадров слот так и не
        # дал ни одной успешной детекции — помечаем как `inactive` и больше
        # не тратим CPU/не плодим ложные плашки чужих команд похожего тона.
        # Защищены: anchor HIGH/MED (motion_detect его реально видел) и
        # HUD-alive (HUD подтверждает, что команда жива).
        self.anchor_conf: str = anchor_conf
        self.hud_alive: bool = hud_alive
        self.inactive_after_misses: int = int(slot_cfg.get("inactive_after_misses", 60))
        self.ever_detected: bool = False
        self.n_inactive: int = 0
        # Strict active-slot criteria (anti-fantom slots).
        # `activated` flips True only when K consecutive detections land within
        # `near_anchor_radius_px` of the original anchor frame position
        # (motion_detect placard). Lone false positives on other teams'
        # placards do NOT count, so colors-not-in-this-match retire cleanly.
        self.init_frame_px: Optional[tuple[float, float]] = init_frame_px
        self.near_anchor_radius_px: float = float(slot_cfg.get("near_anchor_radius_px", 300.0))
        self.min_consecutive_for_active: int = int(slot_cfg.get("min_consecutive_for_active", 3))
        self.near_anchor_consecutive: int = 0
        self.activated: bool = False
        # Post-hoc cleanup threshold: if a slot finished the run with fewer than
        # this many `tracked` frames AND was never activated, all its entries
        # are rewritten to `inactive` in tracks.json.
        self.min_tracked_for_active: int = int(slot_cfg.get("min_tracked_for_active", 8))
        # Telemetry counters (filled by run loop).
        self.n_tracked = 0
        self.n_low_conf = 0
        self.n_hold = 0
        self.n_coast = 0
        self.n_lost = 0
        self.n_wiped = 0
        self.n_switches = 0
        self.score_sum = 0.0
        self.score_n = 0
        # state_reason histogram for diagnostics.
        self.reason_hist: dict[str, int] = {}
        # Telemetry
        self.state: str = "init"
        self.state_reason: str = "init"
        self.mask_mode: str = "hsv+lab"
        self.confidence: float = 1.0
        self.consecutive_detections: int = 0
        self.lost_frames: int = 0
        self.last_score: float = 0.0
        # LAB range (built once)
        if team.lab_lower is None:
            team.lab_lower, team.lab_upper = build_lab_range_from_hsv(team.hsv_lower, team.hsv_upper)

    # ---- mask & detection ------------------------------------------------
    def _color_mask(self, roi_bgr: np.ndarray) -> np.ndarray:
        hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
        m_hsv = cv2.inRange(hsv, self.team.hsv_lower, self.team.hsv_upper)
        if self.team.hsv_lower2 is not None and self.team.hsv_upper2 is not None:
            m_hsv |= cv2.inRange(hsv, self.team.hsv_lower2, self.team.hsv_upper2)
        lab = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2LAB)
        m_lab = cv2.inRange(lab, self.team.lab_lower, self.team.lab_upper)
        mask = cv2.bitwise_and(m_hsv, m_lab)
        self.mask_mode = "hsv+lab"
        if cv2.countNonZero(mask) < 8:
            mask = m_hsv
            self.mask_mode = "hsv_only_fallback"
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (self.morph_kernel, self.morph_kernel))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
        # Дополнительный сильный close, чтобы залить дырки от букв
        # внутри плашки (NAME / RANK), иначе fill падает и shape-фильтр рубит.
        kclose = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (max(7, self.morph_kernel + 4),) * 2
        )
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kclose)
        return mask

    def _effective_roi_size(self) -> int:
        base = self.roi_size + self.roi_expand_px
        # «Захват»: уменьшаем ROI после серии успешных детекций
        if self.consecutive_detections > 15:
            base = max(int(self.roi_size * 0.4), self.min_roi) + self.roi_expand_px
        return max(base, self.min_roi)

    def _find_in_roi(self, roi_bgr: np.ndarray, target_local: tuple[float, float]) -> Optional[tuple[int, int, int, int, float]]:
        if roi_bgr.size == 0:
            self.state_reason = "roi_empty"
            return None
        mask = self._color_mask(roi_bgr)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            self.state_reason = "mask_too_sparse"
            return None
        cand = []
        for c in cnts:
            area = cv2.contourArea(c)
            if area < self.min_area or area > self.max_area:
                continue
            x, y, w, h = cv2.boundingRect(c)
            if w < 3 or h < 3:
                continue
            aspect = w / max(1.0, h)
            fill = area / max(1.0, float(w * h))
            # Плашки с текстом дают «дырявую» маску, fill часто 0.08..0.20.
            # Аспект расширен под зум-аут (узкие плашки) и стрелки.
            if not (0.25 <= aspect <= 16.0 and fill >= 0.08):
                continue
            cand.append((x, y, w, h, float(area)))
        if not cand:
            self.state_reason = "shape_reject"
            return None
        # Score: area + proximity to expected (last) center
        max_area = max(c[4] for c in cand)
        tx, ty = target_local
        roi_h = roi_bgr.shape[0]
        best = None
        best_score = -1e9
        for x, y, w, h, area in cand:
            cx = x + w / 2.0
            cy = y + h / 2.0
            dist = math.hypot(cx - tx, cy - ty)
            area_score = area / max(1e-6, max_area)
            dist_penalty = dist / max(1.0, float(roi_h))
            score = area_score * 1.0 - dist_penalty * 0.6
            if score > best_score:
                best_score = score
                best = (x, y, w, h, area)
        self.last_score = float(max(0.0, min(1.0, best_score)))
        return best

    # ---- full-frame recovery -------------------------------------------
    def _recover_global(self, frame_bgr: np.ndarray, H: np.ndarray,
                        pred_canon: tuple[float, float]
                        ) -> Optional[tuple[float, float, float, float, float]]:
        """Search the whole frame for a team-color blob near `pred_canon`.
        Returns (frame_cx, frame_cy, canon_cx, canon_cy, area) or None."""
        hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
        m = cv2.inRange(hsv, self.team.hsv_lower, self.team.hsv_upper)
        if self.team.hsv_lower2 is not None and self.team.hsv_upper2 is not None:
            m |= cv2.inRange(hsv, self.team.hsv_lower2, self.team.hsv_upper2)
        lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
        m_lab = cv2.inRange(lab, self.team.lab_lower, self.team.lab_upper)
        mask = cv2.bitwise_and(m, m_lab)
        if cv2.countNonZero(mask) < 8:
            mask = m
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (self.morph_kernel,) * 2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
        kclose = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (max(7, self.morph_kernel + 4),) * 2
        )
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kclose)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best = None
        best_d = 1e18
        for c in cnts:
            area = cv2.contourArea(c)
            if area < self.min_area or area > self.max_area:
                continue
            x, y, w, h = cv2.boundingRect(c)
            if w < 3 or h < 3:
                continue
            aspect = w / max(1.0, h)
            fill = area / max(1.0, float(w * h))
            if not (0.25 <= aspect <= 16.0 and fill >= 0.08):
                continue
            cx = x + w / 2.0
            cy = y + h / 2.0
            ccx, ccy = map_point(H, (cx, cy))
            d = math.hypot(ccx - pred_canon[0], ccy - pred_canon[1])
            if d < best_d and d <= self.recover_gate_px:
                best_d = d
                best = (cx, cy, ccx, ccy, float(area))
        return best

    # ---- main update -----------------------------------------------------
    def update(self, frame_bgr: np.ndarray, H: np.ndarray, t_now: float = 0.0) -> Optional[dict]:
        """Run one frame. Returns dict with canonical_px / frame_px / state, or None if untrackable yet."""
        # Active-slot filter: once a slot is declared inactive, freeze it cheaply.
        if self.state == "inactive":
            self.n_inactive += 1
            return self._snapshot()
        # HUD-authoritative wipe: as soon as the elimination timestamp is reached,
        # the slot is permanently wiped — skip all detection work to keep the report
        # clean and avoid burning CPU on a team that no longer exists on the map.
        if not self.wiped and self.elim_t is not None and t_now >= self.elim_t:
            self.wiped = True
            self.state = "wiped"
            self.state_reason = f"hud_wiped@{self.elim_t}"
            return self._snapshot()
        if self.wiped:
            self.state = "wiped"
            if not self.state_reason.startswith("hud_wiped") and not self.state_reason.startswith("wiped"):
                self.state_reason = "wiped"
            return self._snapshot()
        if self.canonical_px is None:
            self.state = "lost"
            self.state_reason = "no_anchor"
            return None
        # dt since last confirmed observation — drives the motion budget.
        if self.last_seen_t is None:
            dt = self.dt_cap_s
        else:
            dt = min(self.dt_cap_s, max(0.0, t_now - self.last_seen_t))
        # Adaptive v_max: take max of configured baseline and observed peak (with boost).
        v_eff = max(self.v_max_px_s, self.v_observed_peak_px_s * self.v_observed_boost)
        radius = min(self.gate_cap_px, v_eff * dt + self.gate_slack_px)
        # Predicted canonical position from last velocity (zero after miss).
        pred_cx = self.canonical_px[0] + (self.vx * dt if not self.canonical_px_stale else 0.0)
        pred_cy = self.canonical_px[1] + (self.vy * dt if not self.canonical_px_stale else 0.0)
        # Project canonical → frame via H_inv to find ROI center.
        try:
            H_inv = np.linalg.inv(H)
        except np.linalg.LinAlgError:
            self.state = "lost"
            self.state_reason = "H_singular"
            return None
        fx, fy = map_point(H_inv, (pred_cx, pred_cy))
        fh, fw = frame_bgr.shape[:2]
        if not (0 <= fx < fw and 0 <= fy < fh):
            self.state = "lost"
            self.state_reason = "out_of_frame"
            self.lost_frames += 1
            self._on_miss()
            return self._snapshot()
        rs = self._effective_roi_size()
        x0 = max(0, int(fx - rs // 2))
        y0 = max(0, int(fy - rs // 2))
        x1 = min(fw, x0 + rs)
        y1 = min(fh, y0 + rs)
        roi = frame_bgr[y0:y1, x0:x1]
        target_local = (fx - x0, fy - y0)
        det = self._find_in_roi(roi, target_local)
        if det is None:
            # Full-frame recovery: ROI давно мажет — поищем плашку по всему
            # кадру в окрестности предсказания. Не каждый кадр, чтобы не жечь CPU.
            if (self.lost_frames >= self.recover_after_misses
                    and (self.lost_frames - self.recover_after_misses)
                        % max(1, self.recover_interval) == 0):
                rec = self._recover_global(frame_bgr, H, (pred_cx, pred_cy))
                if rec is not None:
                    rcx, rcy, rccx, rccy, rarea = rec
                    self.canonical_px = (rccx, rccy)
                    self.last_frame_px = (rcx, rcy)
                    self.state = "tracked"
                    self.state_reason = "recovered_global"
                    self.canonical_px_stale = False
                    self.last_seen_t = t_now
                    self.consecutive_detections = 1
                    self.lost_frames = 0
                    self.confidence = max(self.confidence, 0.5)
                    self.last_score = 0.5
                    self.vx = 0.0
                    self.vy = 0.0
                    self.roi_expand_px = 0
                    self.n_recovered += 1
                    self.ever_detected = True
                    return self._snapshot()
            self._on_miss()
            return self._snapshot()
        x, y, w, h, area = det
        # Frame-pixel center of the detected blob
        det_fx = x0 + x + w / 2.0
        det_fy = y0 + y + h / 2.0
        # Project back to canonical
        cand_cx, cand_cy = map_point(H, (det_fx, det_fy))
        # Time-aware gating: must lie within motion budget around prediction.
        dist_pred = math.hypot(cand_cx - pred_cx, cand_cy - pred_cy)
        if dist_pred > radius:
            self.state_reason = f"out_of_gate({dist_pred:.0f}>{radius:.0f}px,dt={dt:.1f}s)"
            self._on_miss()
            return self._snapshot()
        # Anti-jump confirmation in canonical space (relative to last KNOWN pos).
        last_cx, last_cy = self.canonical_px
        jump = math.hypot(cand_cx - last_cx, cand_cy - last_cy)
        jump_thresh = max(self.jump_switch_threshold_px, 2.0 * radius)
        if jump > jump_thresh and self.consecutive_detections > 0:
            if self.pending_canon is not None:
                pd = math.hypot(cand_cx - self.pending_canon[0], cand_cy - self.pending_canon[1])
                if pd <= 8.0:
                    self.pending_hits += 1
                else:
                    self.pending_canon = (cand_cx, cand_cy)
                    self.pending_hits = 1
            else:
                self.pending_canon = (cand_cx, cand_cy)
                self.pending_hits = 1
            if self.pending_hits < self.switch_confirm_frames:
                # Hold previous position; don't commit jump yet.
                self.state = "hold"
                self.state_reason = f"switch_wait_{self.pending_hits}/{self.switch_confirm_frames}"
                self.confidence = max(0.35, self.confidence * 0.92)
                self.last_frame_px = (fx, fy)
                return self._snapshot()
            else:
                self.pending_canon = None
                self.pending_hits = 0
                self.state_reason = "switch_confirmed"
                self.n_switches += 1
                # Reset velocity on confirmed jump.
                self.vx = 0.0
                self.vy = 0.0
        else:
            self.pending_canon = None
            self.pending_hits = 0

        # Smooth toward observation. Step budget scales with motion budget.
        dx = cand_cx - last_cx
        dy = cand_cy - last_cy
        dist = math.hypot(dx, dy)
        step_budget = max(self.max_center_step_px, radius)
        if dist > self.center_deadzone_px:
            if dist > step_budget:
                scale = step_budget / max(1e-6, dist)
                dx *= scale
                dy *= scale
            new_cx = last_cx + dx * self.center_smoothing_alpha
            new_cy = last_cy + dy * self.center_smoothing_alpha
            # Update EMA velocity from the smoothed move.
            if self.last_seen_t is not None and (t_now - self.last_seen_t) > 1e-3:
                inst_vx = (new_cx - last_cx) / (t_now - self.last_seen_t)
                inst_vy = (new_cy - last_cy) / (t_now - self.last_seen_t)
                self.vx = self.velocity_alpha * inst_vx + (1 - self.velocity_alpha) * self.vx
                self.vy = self.velocity_alpha * inst_vy + (1 - self.velocity_alpha) * self.vy
                # Track observed peak speed for adaptive gating.
                inst_speed = math.hypot(inst_vx, inst_vy)
                if inst_speed > self.v_observed_peak_px_s:
                    self.v_observed_peak_px_s = inst_speed
            self.canonical_px = (new_cx, new_cy)
        self.last_frame_px = (det_fx, det_fy)
        self.state = "tracked"
        self.canonical_px_stale = False
        self.last_seen_t = t_now
        if self.state_reason != "switch_confirmed":
            self.state_reason = "detected"
        self.confidence = min(1.0, self.confidence * 0.6 + 0.4 + 0.0)
        self.consecutive_detections += 1
        self.lost_frames = 0
        self.ever_detected = True
        # Gradually shrink expanded ROI back.
        self.roi_expand_px = max(0, self.roi_expand_px - 20)
        return self._snapshot()

    def _on_miss(self) -> None:
        self.lost_frames += 1
        self.consecutive_detections = 0
        self.confidence = max(0.1, self.confidence - 0.07)
        # Slowly forget old peak so a one-off rocket ride doesn't keep gate huge forever.
        self.v_observed_peak_px_s *= self.v_observed_decay
        if self.lost_frames > 5:
            # Slowly expand ROI to recover.
            self.roi_expand_px = min(self.max_roi_expand_px, self.roi_expand_px + self.roi_expand_step_px)
        # Mark canonical position stale so it is not redrawn as "current".
        self.canonical_px_stale = True
        if self.state == "lost":
            return
        # 1st miss → low_conf; >1 miss → coast (no real observation for a while).
        if self.lost_frames <= 1:
            self.state = "low_conf"
        else:
            self.state = "coast"
        # Active-slot filter: never seen on screen + not protected -> retire.
        if (not self.ever_detected
                and self.inactive_after_misses > 0
                and self.lost_frames >= self.inactive_after_misses
                and self.anchor_conf not in ("HIGH", "MED")
                and not self.hud_alive
                and not self.wiped):
            self.state = "inactive"
            self.state_reason = f"never_detected_{self.lost_frames}f"

    def _snapshot(self) -> dict:
        return {
            "team_id": self.team.id,
            "slot_id": self.team.slot_id or self.team.id,
            "canonical_px": [round(self.canonical_px[0], 1), round(self.canonical_px[1], 1)] if self.canonical_px else None,
            "frame_px": [round(self.last_frame_px[0], 1), round(self.last_frame_px[1], 1)] if self.last_frame_px else None,
            "state": self.state,
            "state_reason": self.state_reason,
            "mask_mode": self.mask_mode,
            "confidence": round(float(self.confidence), 3),
            "score": round(float(self.last_score), 3),
        }


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
        # HUD-confirmed alive team_ids — absence-based wipe MUST NOT fire for these.
        self.hud_alive_protected: set[str] = set()

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
                    and tr.team_id not in self.hud_alive_protected
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
            if tr is not None and tr.wiped_at_t is not None and t >= tr.wiped_at_t:
                # команда уже выбита по HUD/absence — игнорим ложные детекции
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
    ap.add_argument("--eliminations", type=Path, default=None,
                    help="hud_read/reports/eliminations.json — точные t_first_dead по слоту, "
                         "если задано, заменяет absence-based wipe детекцию")
    args = ap.parse_args()

    if not args.video.exists():
        print(f"[err] не нашёл видео: {args.video}", file=sys.stderr); sys.exit(2)

    cfg = load_config(args.config)
    # anchors path (CLI overrides config); if present, derive 20 teams from it
    # and ignore YAML 'teams:' — this matches motion_detect's per-slot palette.
    anchors_path = args.anchors
    if anchors_path is None and cfg.get("anchors_file"):
        anchors_path = (args.config.parent / cfg["anchors_file"]).resolve()

    teams: list[TeamCfg] = []
    if anchors_path and Path(anchors_path).exists():
        # Try to load manually calibrated HSV preset for this canonical map.
        # Search order: configs/ next to YAML, then shared/configs, then
        # motion_detect/configs (legacy location). Filename pattern:
        # hsv_presets.<canonical_map_with_dashes>.json
        cmap_name = cfg.get("canonical_map", "storm_point")
        preset_basename = f"hsv_presets.{cmap_name.replace('_', '-')}.json"
        preset_candidates = [
            (args.config.parent / "configs" / preset_basename),
            (Path(__file__).resolve().parents[2] / "configs" / preset_basename),
            (Path(__file__).resolve().parents[1] / "motion_detect" / "configs" / preset_basename),
        ]
        hsv_preset: dict[int, dict] | None = None
        preset_src: Path | None = None
        for cand in preset_candidates:
            if cand.exists():
                try:
                    raw_preset = json.loads(cand.read_text(encoding="utf-8"))
                    hsv_preset = {
                        int(t["slot"]): {"h": t["h"], "s": t["s"], "v": t["v"]}
                        for t in raw_preset.get("teams", [])
                        if t.get("slot") is not None and "h" in t and "s" in t and "v" in t
                    }
                    preset_src = cand
                    break
                except Exception as e:
                    print(f"[warn] failed to parse hsv preset {cand}: {e}")
        if preset_src:
            print(f"[info] hsv_preset loaded: {preset_src} ({len(hsv_preset or {})} slots)")
        else:
            print(f"[info] hsv_preset not found for canonical_map={cmap_name} — using anchor-derived HSV")
        teams = teams_from_anchors(Path(anchors_path), hsv_preset=hsv_preset)
        print(f"[info] teams: {len(teams)} auto-generated from anchors ({anchors_path})")
    if not teams:
        teams = parse_teams(cfg)
        if anchors_path:
            print(f"[warn] anchors file {anchors_path} unusable — fell back to YAML teams ({len(teams)})")
    if not teams:
        print("[err] в config не описано ни одной команды и нет --anchors", file=sys.stderr); sys.exit(2)
    canonical_dir = (args.config.parent / "canonical_maps").resolve()
    if not canonical_dir.exists():
        canonical_dir = (Path(__file__).resolve().parents[2] / "shared" / "canonical_maps").resolve()
    cmap = load_canonical_map(cfg.get("canonical_map", "storm_point"), canonical_dir)
    reg = FrameRegistrar(cmap, cfg.get("registration", {}))
    det_cfg = cfg.get("detection", {})
    trk = WorldTracker(cfg.get("tracking", {}))
    anchors_map: dict[str, dict] = {}
    if anchors_path:
        mini_affine = load_minimap_affine(cmap.name, canonical_dir)
        anchors_map = load_anchors(Path(anchors_path), teams, mini_affine, cmap)
        trk.set_anchors(anchors_map)
        print(f"[info] anchors: {sum(1 for a in anchors_map.values() if a.get('conf') in ('HIGH','MED'))} HIGH/MED, {sum(1 for a in anchors_map.values() if a.get('conf') == 'LOW')} LOW")
    frame_step = int(args.frame_step or cfg.get("frame_step", 3))

    # ---- HUD eliminations (authoritative wipe times) -------------------------
    elim_path = args.eliminations
    if elim_path is None and cfg.get("eliminations_file"):
        elim_path = (args.config.parent / cfg["eliminations_file"]).resolve()
    if elim_path is None:
        # Last-resort default: the standard hud_read output location.
        guess = (Path(__file__).resolve().parents[1] / "hud_read" / "reports" / "eliminations.json")
        if guess.exists():
            elim_path = guess
    if elim_path is None:
        # Fallback: synced UI copy (src/data/<match>/eliminations.json) — useful
        # when hud_read was run with --out pointing into src/data and the
        # canonical reports/ slot is empty.
        # __file__ = <repo>/scripts/tracking/modules/track_teams/track_teams.py
        # parents: [0]=track_teams [1]=modules [2]=tracking [3]=scripts [4]=<repo>
        repo_root = Path(__file__).resolve().parents[4]
        for guess in sorted((repo_root / "src" / "data").glob("*/eliminations.json")):
            if guess.exists():
                elim_path = guess
                break
    elim_by_slot: dict[int, float] = {}
    hud_alive_slots: set[int] = set()   # slots HUD explicitly marks as alive at match end
    if elim_path and Path(elim_path).exists():
        try:
            raw_elim = json.loads(Path(elim_path).read_text(encoding="utf-8"))
            for slot_key, info in (raw_elim.get("teams", {}) or {}).items():
                try:
                    s = int(slot_key)
                except (TypeError, ValueError):
                    continue
                t_dead = info.get("t_first_dead")
                if t_dead is not None:
                    elim_by_slot[s] = float(t_dead)
                else:
                    hud_alive_slots.add(s)
            print(f"[info] eliminations: {len(elim_by_slot)} dead + {len(hud_alive_slots)} alive (HUD-confirmed) from {elim_path}")
        except Exception as e:
            print(f"[warn] failed to read eliminations {elim_path}: {e}")
    else:
        print("[info] eliminations: not provided — falling back to absence-based wipe detection")

    # Per-slot local trackers (the actual detection workhorse). They seed from
    # motion_detect anchors when available and project canonical → frame each step.
    slot_cfg = dict(det_cfg)  # inherit min/max area, morph_kernel as defaults
    slot_cfg.update(cfg.get("slot_tracker", {}) or {})
    slot_trackers: dict[str, SlotTracker] = {}
    for t in teams:
        a = anchors_map.get(t.id, {}) or {}
        init_canon = None
        if a.get("canonical_px") is not None:
            init_canon = (float(a["canonical_px"][0]), float(a["canonical_px"][1]))
        elim_t = elim_by_slot.get(t.slot) if t.slot is not None else None
        anchor_conf = str(a.get("conf", "MISS"))
        hud_alive = (t.slot is not None and t.slot in hud_alive_slots)
        slot_trackers[t.id] = SlotTracker(
            t, slot_cfg, init_canon, elim_t=elim_t,
            anchor_conf=anchor_conf, hud_alive=hud_alive,
        )
    print(f"[info] slot trackers: {sum(1 for s in slot_trackers.values() if s.canonical_px is not None)}/{len(slot_trackers)} seeded with canonical anchor")
    # Pre-seed WorldTracker with HUD wipe times so the sidecar reflects HUD truth
    # instead of (often wrong / early) absence-based detection.
    for t in teams:
        if t.slot in elim_by_slot:
            tr = trk.tracks.get(t.id)
            if tr is not None:
                tr.wiped_at_t = round(elim_by_slot[t.slot], 2)
        elif t.slot in hud_alive_slots:
            # HUD says this team is alive at match end — protect from absence-fallback
            # so a long off-minimap stretch (rotations, edges of map) doesn't fake a wipe.
            trk.hud_alive_protected.add(t.id)
    if hud_alive_slots:
        print(f"[info] absence-wipe protected: {len(trk.hud_alive_protected)} teams (HUD-alive)")

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
                # ---- Per-slot local detection in frame ROI ---------------
                t_now = (frame_idx - start_frame) / fps
                world_dets: list[dict] = []
                slot_snaps: list[dict] = []
                for t in teams:
                    st = slot_trackers[t.id]
                    snap = st.update(frame, H, t_now=t_now)
                    if snap is None:
                        continue
                    slot_snaps.append(snap)
                    # Only emit world detections for actually observed states.
                    if st.canonical_px is not None and st.state == "tracked":
                        wx, wy = map_point(cmap.px_to_world, st.canonical_px)
                        world_dets.append({
                            "team_id": t.id,
                            "world": (wx, wy),
                            "score": st.last_score,
                            "angle_world_deg": None,
                        })
                    # Telemetry.
                    s = snap.get("state", "")
                    if s == "tracked":   st.n_tracked += 1
                    elif s == "low_conf": st.n_low_conf += 1
                    elif s == "hold":     st.n_hold += 1
                    elif s == "coast":    st.n_coast += 1
                    elif s == "lost":     st.n_lost += 1
                    elif s == "wiped":    st.n_wiped += 1
                    if s == "tracked":
                        st.score_sum += st.last_score
                        st.score_n += 1
                    # Record dominant state_reason (strip numeric tails for grouping).
                    # Skip wiped frames — they're not real misses and would dominate the histogram.
                    if s != "wiped":
                        rr = snap.get("state_reason", "") or ""
                        rr_key = rr.split("(")[0].split("@")[0] or "?"
                        st.reason_hist[rr_key] = st.reason_hist.get(rr_key, 0) + 1
                # WorldTracker остаётся только для wipe-логики (длительное отсутствие).
                # Feed it only confirmed (tracked) detections to avoid wipe-resets on hold.
                tracked_dets = [d for d in world_dets if any(
                    s["team_id"] == d["team_id"] and s["state"] == "tracked" for s in slot_snaps
                )]
                trk.step(tracked_dets, t_now)
                # Merge WorldTracker wipe state with slot snapshots.
                wipe_states = {tr.team_id: tr for tr in trk.tracks.values()}
                tracks_world = []
                for snap in slot_snaps:
                    tr = wipe_states.get(snap["team_id"])
                    # WorldTracker absence-wipe is a fallback only when SlotTracker
                    # hasn't been told by HUD that the slot is gone. If SlotTracker
                    # already marked wiped (via elim_t), keep its "wiped" state.
                    if (tr is not None and tr.wiped_at_t is not None
                            and t_now >= tr.wiped_at_t
                            and snap.get("state") != "wiped"):
                        snap["state"] = "wiped"
                        snap["state_reason"] = f"wiped@{tr.wiped_at_t}"
                        slot_trackers[snap["team_id"]].wiped = True
                    # world coord (from current canonical)
                    # Don't expose stale positions as if they were observations.
                    st_obj = slot_trackers.get(snap["team_id"])
                    if (snap.get("canonical_px") is not None
                            and snap.get("state") == "tracked"
                            and st_obj is not None
                            and not st_obj.canonical_px_stale):
                        wx, wy = map_point(cmap.px_to_world, snap["canonical_px"])
                        snap["world"] = [round(wx, 2), round(wy, 2)]
                    else:
                        snap["world"] = None
                    tracks_world.append(snap)

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
                    if s.get("frame_px") is None:
                        continue
                    x, y = s["frame_px"]
                    color = (0, 255, 0) if s.get("state") == "tracked" else (0, 200, 255)
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
    # sidecar: финальные wiped_at_t per slot (мета пишется стримом до накопления wipes)
    slots_final = []
    for t in teams:
        tr = trk.tracks.get(t.id)
        slots_final.append({
            "slot_id": t.slot_id or t.id,
            "slot": t.slot,
            "team_id": t.id,
            "name": t.name,
            "color": t.color_hex,
            "anchor_conf": (anchors_map.get(t.id, {}) or {}).get("conf", "MISS"),
            "wiped_at_t": (tr.wiped_at_t if tr is not None else None),
        })
    (out_path.parent / (out_path.stem + ".slots.json")).write_text(
        json.dumps({"slots": slots_final}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[ok] processed {processed} frames -> {out_path}")
    # Per-slot tracking summary (compare runs at a glance).
    print("\n[summary] per-slot state distribution")
    print(f"{'slot':<10}{'tracked':>9}{'low_conf':>10}{'hold':>7}{'coast':>7}{'lost':>7}"
          f"{'wiped':>7}{'inact':>7}{'alive%':>8}{'switch':>8}{'avg_sc':>8}")
    for t in teams:
        st = slot_trackers[t.id]
        avg = (st.score_sum / st.score_n) if st.score_n else 0.0
        alive = st.n_tracked + st.n_low_conf + st.n_hold + st.n_coast + st.n_lost
        alive_pct = (100.0 * (st.n_tracked + st.n_low_conf) / alive) if alive else 0.0
        print(f"{t.id:<10}{st.n_tracked:>9}{st.n_low_conf:>10}{st.n_hold:>7}"
              f"{st.n_coast:>7}{st.n_lost:>7}{st.n_wiped:>7}{st.n_inactive:>7}"
              f"{alive_pct:>7.1f}%"
              f"{st.n_switches:>8}{avg:>8.2f}")
    # Dominant state_reason per slot — what is actually failing where.
    print("\n[summary] dominant state_reason per slot (top 3)")
    print(f"{'slot':<10}{'v_peak_px/s':>13}  reasons")
    for t in teams:
        st = slot_trackers[t.id]
        top = sorted(st.reason_hist.items(), key=lambda kv: -kv[1])[:3]
        top_str = ", ".join(f"{k}={v}" for k, v in top)
        print(f"{t.id:<10}{st.v_observed_peak_px_s:>13.1f}  {top_str}")


if __name__ == "__main__":
    main()