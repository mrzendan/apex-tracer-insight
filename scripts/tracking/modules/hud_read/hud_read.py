"""hud_read — TODO: чтение HUD VOD по разметке зон из /admin/zones.

Сейчас это скелет, чтобы зафиксировать структуру модуля.
Подробности — см. README.md рядом.
"""
import argparse
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument(
        "--zones",
        type=Path,
        default=Path(__file__).parent / "configs" / "zones.vod2.json",
    )
    ap.add_argument("--frame-step", type=int, default=600)
    ap.add_argument("--start-sec", type=float, default=0.0)
    ap.add_argument("--ocr-lang", default="eng")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "reports")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    print(f"[hud_read] TODO: implement. video={args.video} zones={args.zones} out={args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
