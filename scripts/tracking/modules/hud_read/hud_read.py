"""hud_read — поверхностный проход по VOD: OCR/кропы по зонам /admin/zones.

См. README.md рядом. Цель — увидеть, какие зоны надо подвинуть,
и собрать таймлайн HUD (game/map/teams/players/ring + по командам).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
from tqdm import tqdm

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

# Поля, которые в матче не меняются — достаточно зафиксировать первые стабильные значения.
# Для команд "name"/"logo" и для HUD "map name"/"game number".
STATIC_TEAM_NAMES = {"name", "logo"}
STATIC_HUD_NAMES = {"map name", "game number"}

# Известные карты Apex — для snap-фикса OCR-ошибок (G↔C, O↔0 и т.п.).
KNOWN_MAPS = [
    "STORM POINT", "WORLDS EDGE", "KINGS CANYON",
    "OLYMPUS", "BROKEN MOON", "E-DISTRICT",
]

RE_MATCH = re.compile(r"MATCH\s+(\d+)", re.I)
RE_TEAMS = re.compile(r"(\d+)\s*TEAMS?", re.I)
RE_PLAYERS = re.compile(r"(\d+)\s*PLAYERS?", re.I)
RE_RING = re.compile(r"RING\s*(\d+).*?(CLOSING|COUNTDOWN|CLOSED|OPEN)", re.I)
RE_INT = re.compile(r"-?\d+")
RE_ELIM = re.compile(r"ELIMIN", re.I)
_OCR_ERRORS_SEEN: set[str] = set()

# Глобальные кеши, работают на протяжении всего прогона.
# Кеш OCR по (tag, name, dhash(crop)) → последнее распарсенное value.
_OCR_CACHE: dict[tuple[str, str, str], Any] = {}
_OCR_CACHE_HITS = 0
_OCR_CACHE_MISS = 0
# Калибровка: после первой удачной комбинации (psm_idx, prep_idx)
# для зоны фиксируем «победителя» и больше не перебираем варианты.
_OCR_CALIB: dict[tuple[str, str], tuple[int, int]] = {}


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
    # Тянем до ~64px высоты строки — мелкие цифры pts вроде "11" иначе склеиваются.
    scale = max(2, int(round(64 / max(1, h))))
    big = cv2.resize(crop, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY) if big.ndim == 3 else big
    # HUD Apex бывает и белый-на-тёмном, и тёмно-красный на светлом
    # (например, "20 TEAMS"/"60 PLAYERS"). Возвращаем ОБА варианта —
    # OCR прогонит и выберет лучший.
    _, th1 = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th2 = cv2.bitwise_not(th1)
    pad = lambda im: cv2.copyMakeBorder(im, 8, 8, 8, 8, cv2.BORDER_CONSTANT, value=255)
    return pad(th1), pad(th2)


def ocr(crop: np.ndarray, lang: str, digits_only: bool, alnum_only: bool = False,
        calib_key: Optional[tuple[str, str]] = None) -> str:
    if pytesseract is None or crop.size == 0:
        return ""
    preps = preprocess_for_ocr(crop)
    if not isinstance(preps, tuple):
        preps = (preps,)
    whitelist = ""
    if digits_only:
        whitelist = "0123456789"
    elif alnum_only:
        # Не добавляем пробелы/апострофы в whitelist: pytesseract передаёт config
        # через парсер аргументов, и такие символы на Windows дают "No closing quotation".
        whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    # Пробуем несколько PSM и берём непустой/самый длинный результат.
    # Если для этой зоны уже зафиксирована «победившая» комбинация —
    # используем только её (экономия x3–x6 на вызовах tesseract).
    psms = (7, 8, 6) if not digits_only else (8, 7, 10)
    locked = _OCR_CALIB.get(calib_key) if calib_key is not None else None
    if locked is not None:
        psm_i, prep_i = locked
        try:
            prep = preps[prep_i]
            psm = psms[psm_i]
            cfg = f"--psm {psm} --oem 1"
            if whitelist:
                cfg += f" -c tessedit_char_whitelist={whitelist}"
            return pytesseract.image_to_string(prep, lang=lang, config=cfg).strip()
        except Exception as e:  # pragma: no cover
            msg = str(e)
            if msg not in _OCR_ERRORS_SEEN:
                _OCR_ERRORS_SEEN.add(msg)
                print(f"[hud_read] tesseract error: {msg}", file=sys.stderr)
            return ""
    best = ""
    best_combo: Optional[tuple[int, int]] = None
    for prep_i, prep in enumerate(preps):
        for psm_i, psm in enumerate(psms):
            cfg = f"--psm {psm} --oem 1"
            if whitelist:
                cfg += f" -c tessedit_char_whitelist={whitelist}"
            try:
                txt = pytesseract.image_to_string(prep, lang=lang, config=cfg).strip()
            except Exception as e:  # pragma: no cover
                msg = str(e)
                if msg not in _OCR_ERRORS_SEEN:
                    _OCR_ERRORS_SEEN.add(msg)
                    print(f"[hud_read] tesseract error: {msg}", file=sys.stderr)
                return ""
            if len(txt) > len(best):
                best = txt
                best_combo = (psm_i, prep_i)
    if calib_key is not None and best and best_combo is not None:
        _OCR_CALIB[calib_key] = best_combo
    return best


def snap_to_known(text: str, vocab: list[str], max_dist: int = 2) -> str | None:
    """Возвращает ближайшее слово из vocab по расстоянию Левенштейна, либо None."""
    if not text:
        return None
    t = re.sub(r"[^A-Z' -]", "", text.upper()).strip()
    if not t:
        return None
    if t in vocab:
        return t
    # маленькая реализация расстояния (vocab короткий)
    def lev(a: str, b: str) -> int:
        if a == b:
            return 0
        if not a:
            return len(b)
        if not b:
            return len(a)
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            cur = [i]
            for j, cb in enumerate(b, 1):
                cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + (ca != cb)))
            prev = cur
        return prev[-1]
    best, best_d = None, max_dist + 1
    for w in vocab:
        d = lev(t, w)
        if d < best_d:
            best, best_d = w, d
    return best


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
        cleaned = re.sub(r"[^A-Z' -]", "", text.upper()).strip()
        snapped = snap_to_known(cleaned, KNOWN_MAPS, max_dist=3)
        return snapped or (cleaned or None)
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
    ap.add_argument("--static-confirm", type=int, default=3,
                    help="Сколько одинаковых подряд значений считаем подтверждением статичного поля")
    ap.add_argument("--static-max-frames", type=int, default=8,
                    help="Максимум попыток на статичное поле, после — фиксируем мажоритарное значение")
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
    # Статичные поля: фиксируем итог после N подтверждений (или N попыток).
    static_state: dict[tuple[str, str], dict[str, Any]] = {}
    for z in zones_scaled:
        tag, name = z["tag"], z["name"]
        is_static = (
            (tag == "hud" and name in STATIC_HUD_NAMES)
            or (team_slot(tag) is not None and name in STATIC_TEAM_NAMES)
        )
        if is_static:
            static_state[(tag, name)] = {"locked": None, "votes": defaultdict(int), "tries": 0}

    def is_static_key(tag: str, name: str) -> bool:
        return (tag, name) in static_state

    processed = 0
    f = start_f
    total_iters = max(1, (end_f - start_f + step - 1) // step)
    pbar = tqdm(total=total_iters, unit="f", desc="hud-scan", dynamic_ncols=True)
    t0 = time.time()
    skipped_static = 0
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

            # Статичное поле уже зафиксировано — просто переиспользуем.
            if is_static_key(tag, name) and static_state[(tag, name)]["locked"] is not None:
                val = static_state[(tag, name)]["locked"]
                per_zone_value[zid] = val
                st["parsed"] += 1
                if name in IMAGE_NAMES:
                    st["hashes"].append(str(val))
                else:
                    st["ocr"] += 1
                skipped_static += 1
                slot = team_slot(tag)
                if slot is not None:
                    teams_acc[slot][name.replace(" ", "_")] = val
                elif tag == "hud":
                    snap_hud[name.replace(" ", "_")] = val
                continue

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
                alnum = name in ("name", "map name", "ring status")
                global _OCR_CACHE_HITS, _OCR_CACHE_MISS
                # dHash-кеш: если кроп визуально не изменился —
                # переиспользуем последний распарсенный value.
                crop_hash = dhash(crop) if crop.size else ""
                cache_key = (tag, name, crop_hash)
                if cache_key in _OCR_CACHE:
                    val = _OCR_CACHE[cache_key]
                    _OCR_CACHE_HITS += 1
                    st["ocr"] += 1  # считаем как успех
                    txt = "" if val is None else str(val)
                else:
                    txt = ocr(crop, args.ocr_lang,
                              digits_only=(name in DIGIT_NAMES),
                              alnum_only=alnum,
                              calib_key=(tag, name))
                    if txt:
                        st["ocr"] += 1
                    val = parse_field(tag, name, txt)
                    _OCR_CACHE[cache_key] = val
                    _OCR_CACHE_MISS += 1
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

            # Голосование для статичных полей.
            if is_static_key(tag, name):
                ss = static_state[(tag, name)]
                ss["tries"] += 1
                if val not in (None, "", False):
                    ss["votes"][val] += 1
                # Зафиксировать если есть N подтверждений или исчерпали бюджет.
                top_val, top_n = (None, 0)
                if ss["votes"]:
                    top_val, top_n = max(ss["votes"].items(), key=lambda kv: kv[1])
                if top_n >= args.static_confirm or ss["tries"] >= args.static_max_frames:
                    ss["locked"] = top_val

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

        # ── живой лог по кадру ─────────────────────────────────────
        alive_t = snap_hud.get("number_of_teams_alive")
        alive_p = snap_hud.get("number_of_players_alive")
        ring = snap_hud.get("ring_status")
        mp = snap_hud.get("map_name")
        gn = snap_hud.get("game_number")
        top_teams = []
        for slot in sorted(teams_acc)[:3]:
            td = teams_acc[slot]
            nm = td.get("name") or f"T{slot}"
            pts = td.get("pts")
            elim = "x" if td.get("eliminated") else ""
            top_teams.append(f"{slot}:{nm}{'/'+str(pts) if pts is not None else ''}{elim}")
        ring_str = (f"R{ring['ring']}{ring['state'][:3]}"
                    if isinstance(ring, dict) else "R?")
        elapsed = time.time() - t0
        rate = processed / elapsed if elapsed > 0 else 0
        line = (f"f{f:>7} t={f/fps:6.1f}s  M{gn or '?'} {mp or '?':<12}"
                f"  {alive_t or '?':>2}T/{alive_p or '?':>2}P  {ring_str:<8}"
                f"  {' '.join(top_teams)}")
        tqdm.write(line)
        pbar.set_postfix(fps=f"{rate:.2f}", static_skip=skipped_static,
                         ocr_cache=f"{_OCR_CACHE_HITS}/{_OCR_CACHE_HITS + _OCR_CACHE_MISS}",
                         refresh=False)
        pbar.update(1)

        processed += 1
        f += step

    pbar.close()
    cap.release()
    total_ocr = _OCR_CACHE_HITS + _OCR_CACHE_MISS
    cache_pct = round(100 * _OCR_CACHE_HITS / total_ocr) if total_ocr else 0
    print(f"[hud_read] processed={processed} static_skips={skipped_static} "
          f"ocr_cache_hits={_OCR_CACHE_HITS}/{total_ocr} ({cache_pct}%) "
          f"elapsed={time.time()-t0:.1f}s")

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
