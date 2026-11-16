"""Validate that the asset-and-licence-register markdown includes required provenance columns."""
import sys
from pathlib import Path

REQUIRED_HEADERS = ["Asset", "Creator", "Licence", "Status"]


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: validate_asset_manifest.py <path-to-register.md>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"Missing asset register: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    missing = [h for h in REQUIRED_HEADERS if h.lower() not in text.lower()]
    if missing:
        print(f"Register missing required fields: {', '.join(missing)}", file=sys.stderr)
        return 1
    if "provisional" not in text.lower() and "missing" not in text.lower():
        print("Register must explicitly mark provisional or missing club/custom assets.", file=sys.stderr)
        return 1
    print(f"Asset register OK: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
