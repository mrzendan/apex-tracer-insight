"""hud_read orchestrator — параллельный forward по кадровым блокам.

Шаги:
1) (опц.) scout-проход → eliminations.json.
2) Делим [start_f, end_f] на N равных блоков.
3) Запускаем N процессов hud_read.py --mode forward --start-frame --end-frame
   --chunk-id <i> --eliminations <path>.
4) Мерджим hud_timeline.<i>.json → hud_timeline.json и report.<i>.txt → report.txt.

Запускается из push.ps1 при -Workers > 0.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import cv2

MODULE_DIR = Path(__file__).resolve().parent
HUD_READ = MODULE_DIR / "hud_read.py"


def video_frames(video: Path) -> tuple[int, float]:
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"[orchestrate] не открылся видеофайл: {video}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()
    return total, fps


def spawn(args_list: list[str], chunk_id: str, log_lines: list[str]) -> subprocess.Popen:
    print(f"[orchestrate] spawn chunk{chunk_id}: " + " ".join(args_list))
    return subprocess.Popen(
        args_list,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
    )


def stream_until_done(procs: list[tuple[str, subprocess.Popen]]) -> int:
    """Читает stdout всех процессов параллельно, печатает с префиксом [wN].
    Возвращает 0 если все ОК, иначе ненулевой код."""
    import selectors
    sel = selectors.DefaultSelector()
    for cid, p in procs:
        if p.stdout is not None:
            sel.register(p.stdout, selectors.EVENT_READ, cid)
    alive = {cid for cid, _ in procs}
    while alive:
        for key, _ in sel.select(timeout=0.5):
            line = key.fileobj.readline()
            if not line:
                sel.unregister(key.fileobj)
                alive.discard(key.data)
                continue
            sys.stdout.write(f"[w{key.data}] {line}")
        # проверим завершившиеся
        for cid, p in procs:
            if p.poll() is not None and cid in alive:
                # дочитаем хвост
                if p.stdout:
                    for line in p.stdout:
                        sys.stdout.write(f"[w{cid}] {line}")
                    try:
                        sel.unregister(p.stdout)
                    except (KeyError, ValueError):
                        pass
                alive.discard(cid)
    codes = [p.returncode for _, p in procs]
    bad = [c for c in codes if c != 0]
    return bad[0] if bad else 0


def merge_timelines(out_dir: Path, n_chunks: int) -> None:
    """Склеить hud_timeline.<i>.json → hud_timeline.json (sort by frame)."""
    snaps: list[dict] = []
    meta: dict = {}
    for i in range(n_chunks):
        path = out_dir / f"hud_timeline.{i}.json"
        if not path.exists():
            print(f"[orchestrate][merge] missing {path.name}")
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        if not meta:
            meta = {k: v for k, v in data.items()
                    if k not in ("timeline", "chunk_id", "start_frame", "end_frame")}
        snaps.extend(data.get("timeline", []))
    # дедуп по frame (на стыках чанков может быть дубль)
    by_frame: dict[int, dict] = {}
    for s in snaps:
        by_frame[s["frame"]] = s
    merged = sorted(by_frame.values(), key=lambda s: s["frame"])
    out = {**meta, "timeline": merged}
    (out_dir / "hud_timeline.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[orchestrate][merge] hud_timeline.json ← {len(merged)} snapshots "
          f"({n_chunks} chunks)")


def merge_reports(out_dir: Path, n_chunks: int) -> None:
    """Простая агрегация: склеить report.<i>.txt с заголовками по чанкам."""
    parts = []
    for i in range(n_chunks):
        path = out_dir / f"report.{i}.txt"
        if not path.exists():
            continue
        parts.append(f"=== chunk {i} ===\n" + path.read_text(encoding="utf-8"))
    (out_dir / "report.txt").write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    print(f"[orchestrate][merge] report.txt ← {n_chunks} chunks")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--zones", type=Path, default=None)
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 2) // 2))
    ap.add_argument("--mode", choices=("forward", "two-pass"), default="two-pass")
    ap.add_argument("--reverse-step", type=int, default=1800)
    ap.add_argument("--refine-budget", type=int, default=10)
    ap.add_argument("--refine-linear", type=int, default=4)
    ap.add_argument("--refine-rollback", type=int, default=0)
    ap.add_argument("--frame-step", type=int, default=600)
    ap.add_argument("--start-sec", type=float, default=0.0)
    ap.add_argument("--end-sec", type=float, default=0.0)
    ap.add_argument("--ocr-lang", default="eng")
    ap.add_argument("--tess-cmd", default="")
    ap.add_argument("--overlay-every", type=int, default=1)
    ap.add_argument("--crop-first-n", type=int, default=3)
    ap.add_argument("--static-confirm", type=int, default=3)
    ap.add_argument("--static-max-frames", type=int, default=8)
    ap.add_argument("--out", type=Path, default=MODULE_DIR / "reports")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    total, fps = video_frames(args.video)
    start_f = int(args.start_sec * fps)
    end_f = int(args.end_sec * fps) if args.end_sec > 0 else total
    print(f"[orchestrate] video={args.video} frames={total} fps={fps:.2f} "
          f"workers={args.workers} mode={args.mode}")

    # ── 1) scout (опц.) ─────────────────────────────────────────────
    elim_path = args.out / "eliminations.json"
    if args.mode == "two-pass":
        print("[orchestrate] === pass 1: scout ===")
        scout_cmd = [sys.executable, str(HUD_READ),
                     "--video", str(args.video),
                     "--mode", "scout",
                     "--reverse-step", str(args.reverse_step),
                     "--refine-budget", str(args.refine_budget),
                     "--refine-linear", str(args.refine_linear),
                     "--refine-rollback", str(args.refine_rollback),
                     "--start-sec", str(args.start_sec),
                     "--end-sec", str(args.end_sec),
                     "--ocr-lang", args.ocr_lang,
                     "--out", str(args.out)]
        if args.zones:
            scout_cmd += ["--zones", str(args.zones)]
        if args.tess_cmd:
            scout_cmd += ["--tess-cmd", args.tess_cmd]
        rc = subprocess.call(scout_cmd)
        if rc != 0:
            print(f"[orchestrate] scout упал rc={rc}")
            return rc
        # сузим окно до старта матча
        try:
            data = json.loads(elim_path.read_text(encoding="utf-8"))
            earliest = min(
                (v["f_last_alive"] for v in data["teams"].values()
                 if v.get("f_last_alive") is not None),
                default=start_f,
            )
            if earliest > start_f:
                print(f"[orchestrate] forward-окно сужено до f{earliest}+")
                start_f = earliest
        except Exception as e:
            print(f"[orchestrate] eliminations.json read err: {e}")

    # ── 2) split ───────────────────────────────────────────────────
    span = end_f - start_f
    if span <= 0 or args.workers <= 1:
        print(f"[orchestrate] span={span} workers={args.workers} — fallback single forward")
        chunks = [(start_f, end_f)]
    else:
        per = span // args.workers
        chunks = []
        for i in range(args.workers):
            a = start_f + i * per
            b = end_f if i == args.workers - 1 else start_f + (i + 1) * per
            # перекрытие на 1 шаг — чтоб стык не потерялся
            if i > 0:
                a = max(start_f, a - args.frame_step)
            chunks.append((a, b))
    print(f"[orchestrate] === pass 2: forward × {len(chunks)} ===")
    for i, (a, b) in enumerate(chunks):
        print(f"  chunk{i}: f{a}..{b}  ({(b-a)/fps:.1f}s, ~{(b-a)//args.frame_step} probes)")

    # ── 3) spawn ───────────────────────────────────────────────────
    t0 = time.time()
    procs: list[tuple[str, subprocess.Popen]] = []
    for i, (a, b) in enumerate(chunks):
        cmd = [sys.executable, str(HUD_READ),
               "--video", str(args.video),
               "--mode", "forward",
               "--start-frame", str(a),
               "--end-frame", str(b),
               "--chunk-id", str(i),
               "--frame-step", str(args.frame_step),
               "--ocr-lang", args.ocr_lang,
               "--overlay-every", str(args.overlay_every),
               "--crop-first-n", str(args.crop_first_n),
               "--static-confirm", str(args.static_confirm),
               "--static-max-frames", str(args.static_max_frames),
               "--out", str(args.out)]
        if args.zones:
            cmd += ["--zones", str(args.zones)]
        if args.tess_cmd:
            cmd += ["--tess-cmd", args.tess_cmd]
        if elim_path.exists():
            cmd += ["--eliminations", str(elim_path)]
        procs.append((str(i), spawn(cmd, str(i), [])))

    rc = stream_until_done(procs)
    print(f"[orchestrate] all workers done in {time.time()-t0:.1f}s rc={rc}")
    if rc != 0:
        return rc

    # ── 4) merge ───────────────────────────────────────────────────
    print("[orchestrate] === pass 3: merge ===")
    merge_timelines(args.out, len(chunks))
    merge_reports(args.out, len(chunks))
    print(f"[orchestrate] OK → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())