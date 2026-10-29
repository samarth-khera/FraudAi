#!/usr/bin/env python3
"""Download the model binaries listed in deploy/model_artifacts.json and verify their SHA-256.

Model binaries are git-ignored. For deployment they are published as GitHub release assets; this script
fetches them into ml/artifacts/ and fails (non-zero exit) on any missing file or checksum mismatch, so a
build never silently ships without a model. Files already present with the right checksum are kept.

Usage (repository root):
    python scripts/fetch_model_artifacts.py                 # from the release in the manifest
    MODEL_ARTIFACT_BASE_URL=file:///path/to/dir python scripts/fetch_model_artifacts.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "deploy" / "model_artifacts.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    manifest = json.loads(MANIFEST.read_text())
    base = os.environ.get("MODEL_ARTIFACT_BASE_URL", manifest["base_url"]).rstrip("/")
    failures = 0
    for entry in manifest["files"]:
        dest = ROOT / entry["path"]
        if dest.exists() and sha256(dest) == entry["sha256"]:
            print(f"[ok]   {entry['path']} already present")
            continue
        url = f"{base}/{entry['asset']}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as out:
                out.write(resp.read())
        except Exception as exc:  # noqa: BLE001 - report and fail the build
            print(f"[FAIL] {entry['path']}: could not download {url}: {exc}")
            failures += 1
            continue
        digest = sha256(tmp)
        if digest != entry["sha256"]:
            tmp.unlink(missing_ok=True)
            print(f"[FAIL] {entry['path']}: checksum mismatch (got {digest})")
            failures += 1
            continue
        tmp.replace(dest)
        print(f"[ok]   {entry['path']} downloaded and verified")
    if failures:
        print(f"{failures} model artifact(s) missing or invalid; refusing to continue.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
