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


def map_bounds_from_zones(
    zones_path: Path, zone_sel: str,
) -> tuple[int, int, int, int] | None:
    """Опциональный блок `map_bounds_in_roi` на зоне миникарты:
    где именно в ROI лежит канонический квадрат игровой карты.
    Возвращает (x, y, w, h) в координатах ROI или None.
    """
    data = json.loads(zones_path.read_text(encoding="utf-8"))
    sel = zone_sel.strip().lower()
    for z in (data.get("zones") or []):
        if z.get("id", "").lower() == sel or z.get("name", "").lower() == sel:
            mb = z.get("map_bounds_in_roi")
            if not mb:
                return None
            return (int(mb["x"]), int(mb["y"]), int(mb["w"]), int(mb["h"]))
    return None


def zoom_correction_from_zones(zones_path: Path, zone_sel: str) -> dict[str, Any] | None:
    """Опциональная компенсация зума плавающей карты.
    Формула: canonical = pivot + (detected - pivot) / zoom.
    """
    data = json.loads(zones_path.read_text(encoding="utf-8"))
    sel = zone_sel.strip().lower()
    for z in (data.get("zones") or []):
        if z.get("id", "").lower() == sel or z.get("name", "").lower() == sel:
            cfg = z.get("map_zoom_correction")
            return cfg if isinstance(cfg, dict) else None
    return None


def apply_zoom_correction(
    cx: float, cy: float, r: float, ring_n: int, cfg: dict[str, Any] | None,
) -> tuple[float, float, float, float] | None:
    if not cfg:
        return None
    pivot = cfg.get("pivot") or [0.5, 0.5]
    px, py = float(pivot[0]), float(pivot[1])
    per_ring = cfg.get("per_ring") or {}
    zoom = float(per_ring.get(str(ring_n), cfg.get("default_zoom", 1.0)))
    if zoom <= 0:
        return None
    return (px + (cx - px) / zoom, py + (cy - py) / zoom, r / zoom, zoom)


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


def detect_next_ring(
    minimap: np.ndarray,
    return_debug: bool = False,
):
    """Найти серую окружность следующего кольца на кропе миникарты.
    По умолчанию возвращает (cx_norm, cy_norm, r_norm) в координатах
    кропа [0..1]. Если return_debug=True — кортеж
    (cx_norm, cy_norm, r_norm, cx_px, cy_px, r_px, mask).
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
    norm = (cx / w, cy / h, r / max(w, h))
    if return_debug:
        return (*norm, cx, cy, r, mask)
    return norm


def _red_mask(bgr: np.ndarray) -> np.ndarray:
    """HSV-маска для красной окантовки уже закрытого кольца на миникарте.
    Красный «обнимает» 0°, поэтому две полосы Hue."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    m1 = cv2.inRange(hsv, (0,   110,  90), (10,  255, 255))
    m2 = cv2.inRange(hsv, (170, 110,  90), (180, 255, 255))
    mask = m1 | m2
    mask = cv2.morphologyEx(
        mask, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    )
    return mask


def detect_closed_red_ring(
    minimap: np.ndarray,
    return_debug: bool = False,
):
    """Найти красную окружность уже зафиксированного (закрытого) кольца.
    Тот же контракт, что detect_next_ring."""
    if minimap.size == 0:
        return None
    h, w = minimap.shape[:2]
    mask = _red_mask(minimap)
    blurred = cv2.GaussianBlur(mask, (5, 5), 1.5)
    min_r = max(6, min(w, h) // 20)
    max_r = max(min_r + 4, min(w, h) // 2)
    circles = cv2.HoughCircles(
        blurred, cv2.HOUGH_GRADIENT, dp=1.2,
        minDist=max(20, min(w, h) // 3),
        param1=80, param2=18, minRadius=min_r, maxRadius=max_r,
    )
    if circles is None:
        return None
    best, best_score = None, -1.0
    for c in circles[0]:
        cx, cy, r = float(c[0]), float(c[1]), float(c[2])
        score = _ring_score(mask, cx, cy, r, n=72)
        if score > best_score:
            best_score = score
            best = (cx, cy, r)
    if best is None or best_score < 0.45:
        return None
    cx, cy, r = best
    norm = (cx / w, cy / h, r / max(w, h))
    if return_debug:
        return (*norm, cx, cy, r, mask)
    return norm


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
                  max_samples: int = 3,
                  detector=detect_next_ring,
                  ) -> list[tuple[float, float, float, float]]:
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
        det = detector(crop)
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
    detector=detect_next_ring,
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
            max_samples=max_samples_per_window, detector=detector,
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
    ap.add_argument("--debug-dir", type=Path, default=None,
                    help="папка для дебаг-картинок (по умолч. <out>/debug)")
    ap.add_argument("--no-debug", action="store_true",
                    help="отключить запись дебаг-картинок")
    args = ap.parse_args()

    if args.zones:
        minimap_rect = rect_from_zones(args.zones, args.minimap_zone)
        print(f"[ring_locator] minimap from zones[{args.minimap_zone!r}] = {minimap_rect}")
        map_bounds = map_bounds_from_zones(args.zones, args.minimap_zone)
        if map_bounds:
            print(f"[ring_locator] map_bounds_in_roi = {map_bounds}")
        zoom_correction = zoom_correction_from_zones(args.zones, args.minimap_zone)
        if zoom_correction:
            print(f"[ring_locator] map_zoom_correction = {zoom_correction}")
    else:
        minimap_rect = parse_rect(args.minimap)
        print(f"[ring_locator] minimap (raw) = {minimap_rect}")
        map_bounds = None
        zoom_correction = None
    rings_data = json.loads(args.rings.read_text(encoding="utf-8"))
    fps = float(rings_data.get("fps") or 30.0)
    phases = rings_data.get("phases") or []
    derived = rings_data.get("derived") or {}
    median_countdown = derived.get("median_countdown")
    debug_dir: Path | None = None
    if not args.no_debug:
        debug_dir = args.debug_dir or (args.out / "debug")
        debug_dir.mkdir(parents=True, exist_ok=True)
        # очистим прошлые ring_*.* — чтобы старые кольца не путали
        for p in debug_dir.glob("ring*"):
            try: p.unlink()
            except OSError: pass
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
        # Пиксельные координаты в ROI
        roi_w, roi_h = minimap_rect[2], minimap_rect[3]
        cx_px = cx * roi_w
        cy_px = cy * roi_h
        r_px  = r  * max(roi_w, roi_h)
        entry: dict[str, Any] = {
            "ring": ring_n,
            "cx_norm": round(cx, 4),
            "cy_norm": round(cy, 4),
            "r_norm": round(r, 4),
            "cx_roi_px": round(cx_px, 1),
            "cy_roi_px": round(cy_px, 1),
            "r_roi_px": round(r_px, 1),
            "roi_size": [roi_w, roi_h],
            "measured_at_t": round(t_avg, 2),
            "samples": len(samples),
            "geometry_confidence": confidence,
            "pov_window": [round(chosen[0], 2), round(chosen[1], 2)] if chosen else None,
            "pov_subwindows_total": n_sub,
        }
        # Координаты, нормализованные в канонический квадрат карты
        # (если задан map_bounds_in_roi).
        if map_bounds:
            mbx, mby, mbw, mbh = map_bounds
            cx_map = (cx_px - mbx) / mbw
            cy_map = (cy_px - mby) / mbh
            r_map = r_px / max(mbw, mbh)
            entry["cx_map_norm"] = round(cx_map, 4)
            entry["cy_map_norm"] = round(cy_map, 4)
            entry["r_map_norm"]  = round(r_map, 4)
            zoomed = apply_zoom_correction(cx_map, cy_map, r_map, ring_n, zoom_correction)
            if zoomed is not None:
                zcx, zcy, zr, zoom = zoomed
                entry["cx_zoom_norm"] = round(zcx, 4)
                entry["cy_zoom_norm"] = round(zcy, 4)
                entry["r_zoom_norm"] = round(zr, 4)
                entry["map_zoom"] = round(zoom, 3)
        # ---- DEBUG: пересчитаем детекцию на центральном кадре и сохраним кропы ----
        if debug_dir is not None:
            t_dbg = samples[len(samples) // 2][0]
            f_dbg = int(round(t_dbg * fps))
            frame = grab_frame(cap, f_dbg)
            if frame is not None:
                fh, fw = frame.shape[:2]
                x, y, ww, hh = minimap_rect
                xx, yy = min(x, fw - 1), min(y, fh - 1)
                ww2, hh2 = min(ww, fw - xx), min(hh, fh - yy)
                crop = frame[yy:yy + hh2, xx:xx + ww2].copy()
                cv2.imwrite(str(debug_dir / f"ring{ring_n}_roi_f{f_dbg}.jpg"),
                            crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
                det = detect_next_ring(crop, return_debug=True)
                if det is not None:
                    _, _, _, dcx, dcy, dr, mask = det
                    cv2.imwrite(str(debug_dir / f"ring{ring_n}_mask_f{f_dbg}.png"),
                                mask)
                    ov = crop.copy()
                    cv2.circle(ov, (int(dcx), int(dcy)), int(dr),
                               (0, 200, 255), 2)
                    cv2.drawMarker(ov, (int(dcx), int(dcy)), (0, 200, 255),
                                   cv2.MARKER_CROSS, 16, 2)
                    cv2.putText(ov, f"R{ring_n} t={t_dbg:.1f}s conf={confidence}",
                                (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                                (0, 0, 0), 3, cv2.LINE_AA)
                    cv2.putText(ov, f"R{ring_n} t={t_dbg:.1f}s conf={confidence}",
                                (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                                (0, 200, 255), 1, cv2.LINE_AA)
                    if map_bounds:
                        mbx, mby, mbw, mbh = map_bounds
                        cv2.rectangle(ov, (mbx, mby), (mbx + mbw, mby + mbh),
                                      (0, 255, 0), 2)
                    cv2.imwrite(str(debug_dir / f"ring{ring_n}_overlay_f{f_dbg}.jpg"),
                                ov, [cv2.IMWRITE_JPEG_QUALITY, 85])
        out_phases.append(entry)
        pov_s = f"[{chosen[0]:.1f}..{chosen[1]:.1f}]" if chosen else "n/a"
        print(f"[ring_locator] R{ring_n}: ({cx:.3f},{cy:.3f}) r={r:.3f} "
              f"n={len(samples)} {confidence} pov={pov_s} (sub={n_sub})")

    cap.release()
    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "ring_geometry.json"
    payload: dict[str, Any] = {
        "video": str(args.video), "fps": fps,
        "minimap": list(minimap_rect),
        "phases": out_phases,
    }
    if map_bounds:
        payload["map_bounds_in_roi"] = {
            "x": map_bounds[0], "y": map_bounds[1],
            "w": map_bounds[2], "h": map_bounds[3],
        }
    if zoom_correction:
        payload["map_zoom_correction"] = zoom_correction
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    print(f"[ring_locator] → {out_path}")
    # ---- DEBUG: «все кольца на одном кадре» ----
    if debug_dir is not None and out_phases:
        cap2 = cv2.VideoCapture(str(args.video))
        try:
            # берём последний измеренный t как «свежий» кадр
            last_t = next((e["measured_at_t"] for e in reversed(out_phases)
                           if e.get("measured_at_t") is not None), None)
            if last_t is not None:
                f_all = int(round(float(last_t) * fps))
                frame = grab_frame(cap2, f_all)
                if frame is not None:
                    fh, fw = frame.shape[:2]
                    x, y, ww, hh = minimap_rect
                    xx, yy = min(x, fw - 1), min(y, fh - 1)
                    ww2, hh2 = min(ww, fw - xx), min(hh, fh - yy)
                    ov = frame[yy:yy + hh2, xx:xx + ww2].copy()
                    if map_bounds:
                        mbx, mby, mbw, mbh = map_bounds
                        cv2.rectangle(ov, (mbx, mby), (mbx + mbw, mby + mbh),
                                      (0, 255, 0), 2)
                        cv2.putText(ov, "map_bounds_in_roi",
                                    (mbx + 6, mby + 22),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                                    (0, 255, 0), 1, cv2.LINE_AA)
                    palette = [(255, 80, 80), (255, 180, 60), (255, 240, 60),
                               (80, 240, 120), (80, 200, 255), (200, 120, 255)]
                    for e in out_phases:
                        if e.get("cx_roi_px") is None: continue
                        col = palette[(e["ring"] - 1) % len(palette)]
                        cv2.circle(ov, (int(e["cx_roi_px"]), int(e["cy_roi_px"])),
                                   int(e["r_roi_px"]), col, 2)
                        cv2.drawMarker(ov,
                                       (int(e["cx_roi_px"]), int(e["cy_roi_px"])),
                                       col, cv2.MARKER_CROSS, 14, 2)
                        cv2.putText(ov, f"R{e['ring']}",
                                    (int(e["cx_roi_px"]) + 6,
                                     int(e["cy_roi_px"]) - 6),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                                    col, 2, cv2.LINE_AA)
                    out_all = debug_dir / "_all_rings_on_roi.jpg"
                    cv2.imwrite(str(out_all), ov,
                                [cv2.IMWRITE_JPEG_QUALITY, 88])
                    print(f"[ring_locator] debug → {out_all}")
        finally:
            cap2.release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
