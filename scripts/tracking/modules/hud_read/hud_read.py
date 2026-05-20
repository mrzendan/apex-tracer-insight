"""hud_read — поверхностный проход по VOD: OCR/кропы по зонам /admin/zones.

См. README.md рядом. Цель — увидеть, какие зоны надо подвинуть,
и собрать таймлайн HUD (game/map/teams/players/ring + по командам).
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np

try:
    import pytesseract
except ImportError:  # pragma: no cover
    pytesseract = None  # type: ignore


MODULE_DIR = Path(__file__).resolve().parent
TRACKING_DIR = MODULE_DIR.parents[1]

# Поля, где не нужен OCR — сохраняем кроп и считаем dHash.
IMAGE_NAMES = {"logo", "hero 1", "hero 2", "hero 3"}

# Поля, состоящие только из цифр.
DIGIT_NAMES = {"pts", "game number", "number of teams alive", "number of players alive"}

RE_MATCH = re.compile(r"MATCH\s+(\d+)", re.I)
RE_TEAMS = re.compile(r"(\d+)\s*TEAMS?", re.I)
RE_PLAYERS = re.compile(r"(\d+)\s*PLAYERS?", re.I)
RE_RING = re.compile(r"RING\s*(\d+).*?(CLOSING|COUNTDOWN)", re.I)
RE_INT = re.compile(r"-?\d+")
RE_ELIM = re.compile(r"ELIMIN", re.I)


# ── helpers ──────────────────────────────────────────────────────────
def resolve_zones_path(arg: Path | None) -> Path:
    if arg is not None:
        return arg
    candidates = [
        MODULE_DIR / "configs" / "zones.vod.json",
        MODULE_DIR / "configs" / "zones.vod2.json",
        TRACKING_DIR / "configs" / "zones.vod.json",
        TRACKING_DIR / "configs" / "zones.vod2.json",
    ]
    for c in candidates:
        if c.exists():
            return c
    raise SystemExit(
        "[hud_read] zones JSON не найден. Положи экспорт из /admin/zones в\n"
        f"  {candidates[0]}\nили передай --zones явно."
    )


def load_zones(path: Path) -> tuple[list[dict[str, Any]], tuple[int, int]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    base = data.get("base") or [1920, 1080]
    zones = data.get("zones") or []
    return zones, (int(base[0]), int(base[1]))


def dhash(img: np.ndarray, hash_size: int = 8) -> str:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    diff = resized[:, 1:] > resized[:, :-1]
    bits = 0
    for b in diff.flatten():
        bits = (bits << 1) | int(b)
    return f"{bits:0{hash_size * hash_size // 4}x}"


def preprocess_for_ocr(crop: np.ndarray) -> np.ndarray:
    if crop.size == 0:
        return crop
    h, w = crop.shape[:2]
    scale = max(1, int(round(48 / max(1, h))))  # тянем до ~48px высоты строки
    big = cv2.resize(crop, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY) if big.ndim == 3 else big
    # HUD у Apex — белый/жёлтый текст на тёмном; берём максимум контраста
    # обоих полярностей и оставляем чёрный текст на белом фоне.
    _, th1 = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th2 = cv2.bitwise_not(th1)
    # Берём ту бинарку, где меньше чёрных пикселей (текст обычно тоньше фона).
    pick = th1 if (th1 == 0).sum() < (th2 == 0).sum() else th2
    return pick


def ocr(crop: np.ndarray, lang: str, digits_only: bool) -> str:
    if pytesseract is None or crop.size == 0:
        return ""
    prep = preprocess_for_ocr(crop)
    config = "--psm 7"
    if digits_only:
        config += " -c tessedit_char_whitelist=0123456789"
    try:
        txt = pytesseract.image_to_string(prep, lang=lang, config=config)
    except Exception as e:  # pragma: no cover
        print(f"[hud_read] tesseract error: {e}")
        return ""
    return txt.strip()


def parse_field(tag: str, name: str, text: str) -> Any:
    if name == "game number":
        m = RE_MATCH.search(text) or RE_INT.search(text)
        return int(m.group(1) if m.re is RE_MATCH else m.group(0)) if m else None
    if name == "number of teams alive":
        m = RE_TEAMS.search(text) or RE_INT.search(text)
        return int(m.group(1) if m.re is RE_TEAMS else m.group(0)) if m else None
    if name == "number of players alive":
        m = RE_PLAYERS.search(text) or RE_INT.search(text)
        return int(m.group(1) if m.re is RE_PLAYERS else m.group(0)) if m else None
    if name == "ring status":
        m = RE_RING.search(text)
        if not m:
            return None
        return {"ring": int(m.group(1)), "state": m.group(2).upper()}
    if name == "pts":
        m = RE_INT.search(text)
        return int(m.group(0)) if m else None
    if name == "eliminated":
        return bool(RE_ELIM.search(text))
    if name == "map name":
        return re.sub(r"[^A-Z' ]", "", text.upper()).strip() or None
    if name == "name":  # team tag, e.g. "TSM"
        return re.sub(r"[^A-Z0-9 ]", "", text.upper()).strip() or None
    return text or None


def team_slot(tag: str) -> int | None:
    m = re.match(r"team[_ ]?(\d+)", tag, re.I)
    return int(m.group(1)) if m else None


# ── overlay ──────────────────────────────────────────────────────────
def draw_overlay(frame: np.ndarray, zones_scaled: list[dict], values: dict[str, Any]) -> np.ndarray:
    out = frame.copy()
    for z in zones_scaled:
        x, y, w, h = z["x"], z["y"], z["w"], z["h"]
        color = (0, 200, 255) if z["tag"] == "hud" else (80, 220, 120)
        cv2.rectangle(out, (x, y), (x + w, y + h), color, 1)
        label = f"{z['tag']}/{z['name']}"
        v = values.get(z["id"])
        if v is not None:
            label += f" = {v}"
        cv2.putText(out, label, (x, max(12, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA)
    return out


# ── main loop ────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--zones", type=Path, default=None)
    ap.add_argument("--frame-step", type=int, default=600)
    ap.add_argument("--start-sec", type=float, default=0.0)
    ap.add_argument("--end-sec", type=float, default=0.0)
    ap.add_argument("--ocr-lang", default="eng")
    ap.add_argument("--tess-cmd", default=None, help="Полный путь к tesseract.exe (Windows)")
    ap.add_argument("--overlay-every", type=int, default=1)
    ap.add_argument("--crop-first-n", type=int, default=3,
                    help="Сохранять кропы текстовых полей только для первых N кадров")
    ap.add_argument("--out", type=Path, default=MODULE_DIR / "reports")
    args = ap.parse_args()

    if args.tess_cmd and pytesseract is not None:
        pytesseract.pytesseract.tesseract_cmd = args.tess_cmd

    zones_path = resolve_zones_path(args.zones)
    zones, (bw, bh) = load_zones(zones_path)
    print(f"[hud_read] zones: {zones_path}  base={bw}x{bh}  count={len(zones)}")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "overlays").mkdir(exist_ok=True)
    (args.out / "crops").mkdir(exist_ok=True)

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise SystemExit(f"[hud_read] не открылся видеофайл: {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sx, sy = fw / bw, fh / bh
    print(f"[hud_read] video: {fw}x{fh} fps={fps:.2f} frames={total}  scale=({sx:.3f},{sy:.3f})")

    zones_scaled = []
    for z in zones:
        zs = dict(z)
        zs["x"] = max(0, int(round(z["x"] * sx)))
        zs["y"] = max(0, int(round(z["y"] * sy)))
        zs["w"] = max(1, int(round(z["w"] * sx)))
        zs["h"] = max(1, int(round(z["h"] * sy)))
        zones_scaled.append(zs)

    start_f = int(args.start_sec * fps)
    end_f = int(args.end_sec * fps) if args.end_sec > 0 else total
    step = max(1, args.frame_step)

    timeline: list[dict[str, Any]] = []
    # stats[(tag,name)] = {"total":N,"ocr":N,"parsed":N,"values":[...], "hashes":[]}
    stats: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {"total": 0, "ocr": 0, "parsed": 0, "values": [], "hashes": []}
    )

    seen_per_field: dict[tuple[str, str], int] = defaultdict(int)
    processed = 0
    f = start_f
    while f < end_f:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, frame = cap.read()
        if not ok:
            break

        per_zone_value: dict[str, Any] = {}
        snap_hud: dict[str, Any] = {}
        teams_acc: dict[int, dict[str, Any]] = defaultdict(dict)

        for z in zones_scaled:
            tag, name, zid = z["tag"], z["name"], z["id"]
            x, y, w, h = z["x"], z["y"], z["w"], z["h"]
            crop = frame[y:y + h, x:x + w]
            st = stats[(tag, name)]
            st["total"] += 1

            if name in IMAGE_NAMES:
                if crop.size:
                    hsh = dhash(crop)
                    st["hashes"].append(hsh)
                    crop_dir = args.out / "crops" / f"{tag}__{name.replace(' ', '_')}"
                    crop_dir.mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(crop_dir / f"f{f:07d}.png"), crop)
                    per_zone_value[zid] = hsh[:8]
                    val = hsh
                else:
                    val = None
            else:
                txt = ocr(crop, args.ocr_lang, digits_only=(name in DIGIT_NAMES))
                if txt:
                    st["ocr"] += 1
                val = parse_field(tag, name, txt)
                if val is not None and val is not False:
                    st["parsed"] += 1
                if val not in (None, "", False):
                    st["values"].append(val)
                per_zone_value[zid] = val if val is not None else txt
                # Сохранить кроп для первых N кадров каждого поля.
                key = (tag, name)
                if seen_per_field[key] < args.crop_first_n and crop.size:
                    seen_per_field[key] += 1
                    crop_dir = args.out / "crops" / f"{tag}__{name.replace(' ', '_')}"
                    crop_dir.mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(crop_dir / f"f{f:07d}.png"), crop)

            slot = team_slot(tag)
            if slot is not None:
                teams_acc[slot][name.replace(" ", "_")] = val
            elif tag == "hud":
                snap_hud[name.replace(" ", "_")] = val

        timeline.append({
            "frame": f,
            "t": round(f / fps, 3),
            "hud": snap_hud,
            "teams": [{"slot": s, **v} for s, v in sorted(teams_acc.items())],
        })

        if processed % max(1, args.overlay_every) == 0:
            ov = draw_overlay(frame, zones_scaled, per_zone_value)
            cv2.imwrite(str(args.out / "overlays" / f"hud_{f:07d}.jpg"), ov,
                        [cv2.IMWRITE_JPEG_QUALITY, 80])

        processed += 1
        f += step
        if processed % 20 == 0:
            print(f"  ... frame {f}/{end_f}")

    cap.release()

    # ── reports ─────────────────────────────────────────────────────
    (args.out / "hud_timeline.json").write_text(
        json.dumps({
            "video": str(args.video),
            "fps": fps,
            "frame_step": step,
            "zones_source": str(zones_path),
            "timeline": timeline,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    lines: list[str] = []
    lines.append(f"hud_read — {processed} frames analyzed (step={step})")
    lines.append(f"video: {args.video}")
    lines.append(f"zones: {zones_path}")
    lines.append("")
    lines.append(f"{'tag':<10} {'name':<26} {'ok%':>5} {'parsed%':>8}  suggest  examples")
    for (tag, name), st in sorted(stats.items()):
        tot = st["total"] or 1
        is_img = name in IMAGE_NAMES
        if is_img:
            uniq = len(set(st["hashes"]))
            ok_pct = 100 if st["hashes"] else 0
            parsed_pct = ok_pct
            suggest = "OK"
            if not st["hashes"]:
                suggest = "EMPTY"
            elif uniq <= max(1, tot // 20):
                suggest = "STATIC?  (zone might be misaligned)"
            examples = f"{uniq} unique hashes / {tot} frames"
        else:
            ok_pct = round(100 * st["ocr"] / tot)
            parsed_pct = round(100 * st["parsed"] / tot)
            if ok_pct < 40:
                suggest = "EMPTY/MISALIGNED"
            elif parsed_pct < max(20, ok_pct - 30):
                suggest = "TIGHTEN"
            else:
                suggest = "OK"
            vals = st["values"][:5]
            examples = ", ".join(str(v) for v in vals)
        lines.append(f"{tag:<10} {name:<26} {ok_pct:>4}% {parsed_pct:>7}%  {suggest:<22} {examples}")

    (args.out / "report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n[hud_read] OK → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
