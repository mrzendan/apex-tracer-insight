#!/usr/bin/env python3
"""diagnose_inputs.py — быстрый аудит входов перед свипом.

Для каждой GT-точки в окне [0..end_sec] печатает:
  - сколько motion-points из anchors-файла лежит в радиусе 200px,
  - расстояние до ближайшей motion-точки.

Если у большинства слотов n_near=0 — сначала пересобери motion_tracks
с `-StartSec 0 -Window <end*60+60>`, иначе свип бесполезен.

Запуск:
  python scripts/tracking/modules/track_teams/diagnose_inputs.py \
      --anchors scripts/tracking/modules/motion_detect/reports/motion_tracks.json \
      --end 30
"""
from __future__ import annotations
import argparse, json, math, sys
from pathlib import Path

MOD = Path(__file__).resolve().parent


def load_pts(doc: dict):
    fps = float(doc.get("fps") or 60.0)
    pts = []
    for item in (doc.get("results") or []):
        fr = item.get("frame"); t = (fr / fps) if isinstance(fr, (int, float)) else item.get("t")
        if t is None: continue
        for k in ("points", "moving", "tracks", "detections"):
            for p in (item.get(k) or []):
                xy = p.get("xy") or p.get("canonical_px") or p.get("world") or p.get("pos")
                if xy and len(xy) >= 2:
                    pts.append((float(t), float(xy[0]), float(xy[1])))
    for tr in (doc.get("tracks") or doc.get("moving") or []):
        for p in (tr.get("points") or []):
            t = p.get("t"); xy = p.get("xy") or p.get("canonical_px")
            if t is not None and xy:
                pts.append((float(t), float(xy[0]), float(xy[1])))
    return pts, fps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--anchors", default=str(MOD.parent / "motion_detect" / "reports" / "motion_tracks.json"))
    ap.add_argument("--gt", default=str(MOD / "assets" / "gt_anchors.json"))
    ap.add_argument("--end", type=float, default=30.0)
    ap.add_argument("--radius", type=float, default=200.0)
    args = ap.parse_args()

    for label, p in [("anchors", args.anchors), ("gt", args.gt)]:
        if not Path(p).exists():
            print(f"[err] {label} не найден: {p}", file=sys.stderr); return 2

    doc = json.loads(Path(args.anchors).read_text(encoding="utf-8"))
    pts, fps = load_pts(doc)
    print(f"anchors file: {args.anchors}")
    print(f"  fps={fps:.2f}  start_sec={doc.get('start_sec')}  window={doc.get('window')}  step={doc.get('step')}")
    if pts:
        t_min = min(p[0] for p in pts); t_max = max(p[0] for p in pts)
        print(f"  motion-points total={len(pts)}, t=[{t_min:.1f}..{t_max:.1f}]s")
    else:
        print("  [WARN] motion-points = 0!")
        t_min = t_max = 0.0

    win = [p for p in pts if 0.0 <= p[0] <= args.end]
    print(f"  in window [0..{args.end}]s: {len(win)} pts")
    if t_max < args.end:
        need_window = int(args.end * fps) + 60
        print(f"\n  [!!] anchors заканчиваются на {t_max:.1f}s, а свип нужен на {args.end}s.")
        print(f"  [!!] ПЕРЕСОБЕРИ motion_tracks командой:")
        print(f"       powershell -ExecutionPolicy Bypass -File "
              f"scripts\\tracking\\modules\\motion_detect\\push.ps1 `")
        print(f"         -Video scripts\\tracking\\game_sp.mp4 -StartSec 0 -Window {need_window} -Step 5 -NoPush")
        print()

    gt = json.loads(Path(args.gt).read_text(encoding="utf-8"))["points"]
    gt = [g for g in gt if float(g["t"]) <= args.end + 0.5]

    print(f"\nPER-SLOT (radius={args.radius}px in [0..{args.end}]s):")
    print(f"  {'slot':<10} {'n_near':>7}  {'nearest_px':>11}  verdict")
    n_dead = 0
    for g in sorted(gt, key=lambda s: int(s['slot_id'].split('_')[-1])):
        sid = g["slot_id"]; gx, gy = g["world_xy"]
        dists = [math.hypot(p[1] - gx, p[2] - gy) for p in win]
        n_near = sum(1 for d in dists if d <= args.radius)
        nx = min(dists) if dists else None
        verdict = "OK" if n_near >= 3 else ("WEAK" if n_near >= 1 else "DEAD")
        if verdict == "DEAD": n_dead += 1
        nxs = "—" if nx is None else f"{nx:.1f}"
        print(f"  {sid:<10} {n_near:>7}  {nxs:>11}  {verdict}")
    print(f"\nИТОГ: DEAD слотов = {n_dead}/{len(gt)}")
    if n_dead > len(gt) // 3:
        print("  → motion_detect/HSV — основной баг. Свип DA-параметров не поможет.")
    else:
        print("  → anchors норм, можно свипить DA-параметры.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())