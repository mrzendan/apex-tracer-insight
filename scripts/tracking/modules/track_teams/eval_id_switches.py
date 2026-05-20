#!/usr/bin/env python3
"""
eval_id_switches.py — простая метрика качества трекинга команд.

Принимает tracks.json (выход track_teams) и assets/gt_anchors.json
(ручные опорные точки {t, slot_id, world_xy}). Для каждой GT-точки
находит ближайший трек на ближайшем по времени кадре. Считает:

  - id_switches per slot: сколько раз меняется team_id ближайшего трека
    между соседними GT одного и того же slot_id;
  - coverage: % GT-точек, где slot реально имеет alive/low_conf трек;
  - px_error_med: медианное расстояние ближайшего трека до GT (canonical_px).

Запуск:
    python eval_id_switches.py --tracks reports/tracks.json \\
        --gt assets/gt_anchors.json --out reports/eval_id_switches.json
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", required=True, type=Path)
    ap.add_argument("--gt",     required=True, type=Path)
    ap.add_argument("--out",    required=True, type=Path)
    args = ap.parse_args()

    tracks = json.loads(args.tracks.read_text(encoding="utf-8"))
    gt = json.loads(args.gt.read_text(encoding="utf-8"))
    frames = tracks["frames"]
    if not frames:
        print("[err] empty frames"); return
    times = [f["t"] for f in frames]

    def nearest_frame(t: float) -> dict:
        idx = min(range(len(times)), key=lambda i: abs(times[i] - t))
        return frames[idx]

    per_slot: dict[str, list[dict]] = defaultdict(list)
    px_errors: list[float] = []
    coverage_hits = 0
    coverage_total = 0

    for p in gt.get("points", []):
        f = nearest_frame(float(p["t"]))
        gx, gy = p["world_xy"]
        best = None; best_d = float("inf")
        for tr in f["tracks"]:
            xy = tr.get("canonical_px") or tr.get("world")
            if not xy: continue
            d = math.hypot(xy[0] - gx, xy[1] - gy)
            if d < best_d:
                best_d, best = d, tr
        coverage_total += 1
        if best is None or best_d > 200:
            per_slot[p["slot_id"]].append({"t": p["t"], "team_id": None, "d": None})
            continue
        coverage_hits += 1
        px_errors.append(best_d)
        per_slot[p["slot_id"]].append({
            "t": p["t"], "team_id": best.get("team_id"),
            "slot_id": best.get("slot_id"), "d": round(best_d, 1),
        })

    switches: dict[str, int] = {}
    switch_events: list[dict] = []
    for slot_id, rows in per_slot.items():
        rows.sort(key=lambda r: r["t"])
        n = 0; prev = None
        for r in rows:
            tid = r.get("slot_id") or r.get("team_id")
            if tid is None: continue
            if prev is not None and tid != prev:
                n += 1
                switch_events.append({"slot_id": slot_id, "t": r["t"],
                                       "from": prev, "to": tid})
            prev = tid
        switches[slot_id] = n

    summary = {
        "tracks_file": str(args.tracks),
        "gt_file": str(args.gt),
        "gt_points": coverage_total,
        "coverage_pct": round(100.0 * coverage_hits / max(1, coverage_total), 1),
        "px_error_med": round(statistics.median(px_errors), 1) if px_errors else None,
        "px_error_p95": round(statistics.quantiles(px_errors, n=20)[-1], 1) if len(px_errors) >= 20 else None,
        "id_switches_total": sum(switches.values()),
        "id_switches_per_slot": switches,
        "switch_events": switch_events,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    txt_path = args.out.with_suffix(".txt")
    with txt_path.open("w", encoding="utf-8") as f:
        f.write(f"GT points:        {summary['gt_points']}\n")
        f.write(f"Coverage:         {summary['coverage_pct']}%\n")
        f.write(f"px error median:  {summary['px_error_med']}\n")
        f.write(f"px error p95:     {summary['px_error_p95']}\n")
        f.write(f"ID-switches total:{summary['id_switches_total']}\n\n")
        for s, n in sorted(switches.items(), key=lambda kv: -kv[1]):
            f.write(f"  {s:>10}  switches={n}\n")
        if switch_events:
            f.write("\nSwitch events:\n")
            for e in switch_events:
                f.write(f"  t={e['t']:>7.1f}  {e['slot_id']:>10}  {e['from']} -> {e['to']}\n")
    print(f"[ok] {summary['gt_points']} GT pts | coverage={summary['coverage_pct']}% | "
          f"id_switches={summary['id_switches_total']} | px_med={summary['px_error_med']}")
    print(f"[ok] -> {args.out}")
    print(f"[ok] -> {txt_path}")


if __name__ == "__main__":
    main()