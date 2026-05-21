#!/usr/bin/env python3
"""Жёсткий sanity-check данных матча перед коммитом в UI.

Сравнивает три источника:
  - hud_timeline.json  (HUD по кадрам + встроенный блок eliminations)
  - tracks.json        (мировые координаты команд по кадрам)
  - slot-to-tag.json   (slot → команда)

И печатает по каждой команде:
  hud_dead | track_first | track_last | drawable_pts | states | verdict

Drawable points = точки, которые фронт реально нарисует
(world != null, state ∉ {lost, wiped}, t ≤ hud_dead).

Использование:
  python scripts/tracking/debug_match_data.py
  python scripts/tracking/debug_match_data.py --dir src/data/m-test-g1
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path,
                    default=Path("src/data/m-test-g1"),
                    help="Папка с UI-данными матча.")
    args = ap.parse_args()

    base: Path = args.dir
    tl = json.loads((base / "hud_timeline.json").read_text(encoding="utf-8"))
    tracks = json.loads((base / "tracks.json").read_text(encoding="utf-8"))
    slot_to_tag = json.loads((base / "slot-to-tag.json").read_text(encoding="utf-8"))

    elim_block = (tl.get("eliminations") or {}).get("teams") or {}
    if not elim_block:
        # fallback на старый отдельный файл
        ef = base / "eliminations.json"
        if ef.exists():
            elim_block = json.loads(ef.read_text(encoding="utf-8")).get("teams") or {}
            print(f"[debug] WARN: eliminations не встроены в hud_timeline; "
                  f"использую {ef}")
        else:
            print("[debug] FATAL: нет eliminations ни в timeline, ни рядом")
            return 2

    # Индексируем треки по slot
    per_slot: dict[str, dict] = {}
    for fr in tracks.get("frames", []):
        t = fr.get("t")
        for tr in fr.get("tracks", []) or []:
            sid = tr.get("team_id")
            if not sid:
                continue
            d = per_slot.setdefault(sid, {
                "first": None, "last": None,
                "has_world": 0, "states": {},
            })
            d["states"][tr.get("state")] = d["states"].get(tr.get("state"), 0) + 1
            if tr.get("world"):
                d["has_world"] += 1
                if d["first"] is None or t < d["first"]:
                    d["first"] = t
                if d["last"] is None or t > d["last"]:
                    d["last"] = t

    print(f"\nMatch data sanity check — {base}")
    print(f"  HUD timeline frames: {len(tl.get('timeline', []))}")
    print(f"  HUD eliminations:    {len(elim_block)} slots "
          f"({sum(1 for v in elim_block.values() if v.get('t_first_dead') is not None)} dead)")
    print(f"  Tracks frames:       {len(tracks.get('frames', []))}")
    print(f"  Tracks slots seen:   {len(per_slot)}")
    print()
    header = f"{'slot':>4} {'tag':<6} {'hud_dead':>10} {'trk_first':>10} {'trk_last':>10} {'drawable':>8}  states                            verdict"
    print(header)
    print("-" * len(header))

    bad = 0
    for i in range(1, 21):
        slot = str(i)
        tag = slot_to_tag.get(slot, "?")
        hud_dead = elim_block.get(slot, {}).get("t_first_dead")
        trk = per_slot.get(f"slot_{i}", {})
        first = trk.get("first")
        last = trk.get("last")
        states = trk.get("states", {})

        # drawable = world != null, state not in {lost, wiped}, t <= hud_dead
        drawable = 0
        for fr in tracks.get("frames", []):
            t = fr.get("t")
            for tr in fr.get("tracks", []) or []:
                if tr.get("team_id") != f"slot_{i}":
                    continue
                if not tr.get("world"):
                    continue
                if tr.get("state") in ("lost", "wiped"):
                    continue
                if hud_dead is not None and t > hud_dead:
                    continue
                drawable += 1

        verdict = "OK"
        if drawable == 0:
            verdict = "BAD: no drawable points"
            bad += 1
        elif hud_dead is None and last is not None and last < (tl.get("timeline", [{}])[-1].get("t") or 0) - 60:
            verdict = f"WARN: alive по HUD, но трек обрывается на {last:.1f}"
        elif hud_dead is not None and last is not None and last < hud_dead - 60:
            verdict = f"WARN: трек обрывается за {hud_dead - last:.0f}с до HUD-смерти"

        hud_s = f"{hud_dead:.1f}" if hud_dead is not None else "alive"
        first_s = f"{first:.1f}" if first is not None else "—"
        last_s = f"{last:.1f}" if last is not None else "—"
        states_s = ",".join(f"{k}:{v}" for k, v in sorted(states.items()))[:32]
        print(f"{i:>4} {tag:<6} {hud_s:>10} {first_s:>10} {last_s:>10} {drawable:>8}  {states_s:<34}{verdict}")

    print()
    print(f"BAD команд (без точек на карте): {bad} / 20")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())