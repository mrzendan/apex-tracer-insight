#!/usr/bin/env python3
"""Копирует свежие отчёты hud_read в src/data/m-test-g1/
чтобы фронтенд (MatchViewer) подцепил реальные данные.

Создаёт:
  src/data/m-test-g1/eliminations.json
  src/data/m-test-g1/rings.json            (если есть)
  src/data/m-test-g1/hud_timeline.json
  src/data/m-test-g1/slot-to-tag.json      (slot → team tag, из hud_timeline)
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parent
REPO_ROOT = MODULE_DIR.parents[3]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", type=Path,
                    default=MODULE_DIR / "reports")
    ap.add_argument("--out", type=Path,
                    default=REPO_ROOT / "src" / "data" / "m-test-g1")
    ap.add_argument("--ring-geometry", type=Path, default=None,
                    help="Опц. ring_geometry.json из ring_locator — "
                         "будет вмёржен в rings.json как поле 'geometry'.")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    for name in ("eliminations.json", "rings.json", "hud_timeline.json"):
        src = args.reports / name
        if not src.exists():
            print(f"[sync_to_ui] пропускаю {name} — не найден в {args.reports}")
            continue
        dst = args.out / name
        shutil.copy2(src, dst)
        copied.append(name)
        print(f"[sync_to_ui] {src} → {dst}")

    # Мердж геометрии колец в rings.json (если есть).
    if args.ring_geometry and args.ring_geometry.exists():
        rings_dst = args.out / "rings.json"
        if rings_dst.exists():
            try:
                rings = json.loads(rings_dst.read_text(encoding="utf-8"))
                geom = json.loads(args.ring_geometry.read_text(encoding="utf-8"))
                rings["geometry"] = {
                    "minimap": geom.get("minimap"),
                    "phases": geom.get("phases") or [],
                }
                rings_dst.write_text(
                    json.dumps(rings, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                print(f"[sync_to_ui] merged ring geometry "
                      f"({len(rings['geometry']['phases'])} phases) → {rings_dst}")
            except Exception as e:
                print(f"[sync_to_ui] не смог вмёржить ring_geometry: {e}")
        else:
            print(f"[sync_to_ui] нет {rings_dst} — пропускаю ring-geometry merge")

    # slot-to-tag из hud_timeline
    tl_path = args.reports / "hud_timeline.json"
    if tl_path.exists():
        try:
            tl = json.loads(tl_path.read_text(encoding="utf-8"))
            slot_to_tag: dict[int, str] = {}
            for entry in tl.get("timeline", []):
                for t in entry.get("teams", []) or []:
                    slot = t.get("slot")
                    name = t.get("name")
                    if slot is None or not name:
                        continue
                    slot_to_tag.setdefault(int(slot), str(name))
                if len(slot_to_tag) >= 20:
                    break
            (args.out / "slot-to-tag.json").write_text(
                json.dumps(slot_to_tag, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"[sync_to_ui] slot-to-tag.json ({len(slot_to_tag)} teams)")
        except Exception as e:
            print(f"[sync_to_ui] не смог собрать slot-to-tag.json: {e}")

    print(f"[sync_to_ui] готово ({len(copied)} файлов скопировано)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())