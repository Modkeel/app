"""The files of one public app release (Modkeel/app), from the installers CI built.

    python app/scripts/release_manifest.py <built-dir> <out-dir> --version 0.1.0 \
        --repo Modkeel/app --notes app/release-notes/0.1.0.md

<built-dir> holds what the release build jobs uploaded (any depth): the installers and, for the
updater, each platform's update bundle with its .sig (Tauri's updater signature, made with
the TAURI_SIGNING_PRIVATE_KEY secret). Into <out-dir> go:

  the installers, renamed Modkeel_<version>_<platform>.<ext> (one name scheme, every release)
  latest.json   what the installed app's updater reads from releases/latest/download/: the
                version, the notes, and per platform the update bundle's URL and signature
  SHA256SUMS    of every file above, for players who check what they downloaded

A release without an update bundle for every platform is refused: players on the missing
platform would never hear of later versions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

# (updater platform key, glob of the update bundle, the name it gets in the release)
UPDATE_BUNDLES = [
    ("windows-x86_64", "*-setup.exe", "Modkeel_{v}_windows_x64-setup.exe"),
    ("darwin-aarch64", "*.app.tar.gz", "Modkeel_{v}_macos_aarch64.app.tar.gz"),
    ("linux-x86_64", "*.AppImage", "Modkeel_{v}_linux_amd64.AppImage"),
]
# installers that are not update bundles
INSTALLERS = [
    ("*.dmg", "Modkeel_{v}_macos_aarch64.dmg"),
    ("*.deb", "Modkeel_{v}_linux_amd64.deb"),
]


def _one(built: Path, pattern: str) -> Path:
    found = sorted(p for p in built.rglob(pattern) if p.is_file())
    if len(found) != 1:
        raise SystemExit(f"expected one {pattern} in {built}, found {len(found)}: "
                         f"{[str(p) for p in found]}")
    return found[0]


def build(built: Path, out: Path, version: str, repo: str, notes: str,
          now: datetime | None = None) -> Dict:
    """Copy the release files into `out`, write latest.json and SHA256SUMS; returns latest."""
    out.mkdir(parents=True, exist_ok=True)
    base = f"https://github.com/{repo}/releases/download/v{version}"
    platforms: Dict[str, Dict[str, str]] = {}
    files: List[Tuple[Path, str]] = []
    for key, pattern, name in UPDATE_BUNDLES:
        bundle = _one(built, pattern)
        sig = bundle.with_name(bundle.name + ".sig")
        if not sig.is_file():
            raise SystemExit(f"{bundle.name} has no .sig: was TAURI_SIGNING_PRIVATE_KEY set?")
        final = name.format(v=version)
        files.append((bundle, final))
        platforms[key] = {"signature": sig.read_text().strip(), "url": f"{base}/{final}"}
    for pattern, name in INSTALLERS:
        files.append((_one(built, pattern), name.format(v=version)))

    for source, final in files:
        shutil.copy2(source, out / final)
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    latest = {"version": version, "notes": notes.strip(), "pub_date": stamp,
              "platforms": platforms}
    (out / "latest.json").write_text(json.dumps(latest, indent=2) + "\n")
    names = sorted(final for _, final in files) + ["latest.json"]
    sums = [f"{hashlib.sha256((out / n).read_bytes()).hexdigest()}  {n}" for n in names]
    (out / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    return latest


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("built", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--notes", type=Path, required=True)
    args = parser.parse_args(argv)
    if not args.notes.is_file():
        raise SystemExit(f"no release notes at {args.notes}: write them before publishing")
    latest = build(args.built, args.out, args.version, args.repo, args.notes.read_text())
    print(json.dumps(latest, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
