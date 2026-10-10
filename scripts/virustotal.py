"""Scan a release's files on VirusTotal and add the results to its notes.

    python scripts/virustotal.py scan FILE...           # print a Markdown table
    python scripts/virustotal.py release v0.1.1 DIR     # scan DIR's files, add to v0.1.1's notes

Run by release.yml after each release with the VIRUSTOTAL_API_KEY secret (a free account's key
works; it is never printed). Whatever the result, it is published: the release notes link each
file's report, so players can read what every engine said, including a false positive.
Installers that bundle a Python program (the engine, built with PyInstaller) are often flagged
by one or two engines for that reason alone; the report names which.

Needs `requests` and, for `release`, the GitHub CLI with a token that can edit releases.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import requests

API = "https://www.virustotal.com/api/v3"
GUI = "https://www.virustotal.com/gui/file"
HEADING = "## Virus scans"
PAUSE = 16                       # the free API allows 4 requests a minute
DIRECT_UPLOAD = 32 * 1024 * 1024  # bigger files go through an upload URL
WAIT = 30 * 60                   # a big file's analysis can take a while


def key() -> str:
    value = os.environ.get("VIRUSTOTAL_API_KEY", "").strip()
    if not value:
        sys.exit("VIRUSTOTAL_API_KEY is not set")
    return value


def call(method: str, url: str, **kw) -> requests.Response:
    """One API request, waiting out the rate limit (429) a few times."""
    url = url if url.startswith("https://") else API + url
    for _ in range(10):
        r = requests.request(method, url, headers={"x-apikey": key()}, timeout=600, **kw)
        if r.status_code != 429:
            return r
        time.sleep(60)
    sys.exit(f"{method} {url}: still rate limited")


def upload(path: Path) -> str:
    """Send the file; returns the analysis id."""
    url = "/files"
    if path.stat().st_size > DIRECT_UPLOAD:
        url = call("GET", "/files/upload_url").json()["data"]
        time.sleep(PAUSE)
    with path.open("rb") as f:
        r = call("POST", url, files={"file": (path.name, f)})
    if r.status_code >= 400:
        sys.exit(f"upload {path.name}: {r.status_code} {r.text[:300]}")
    return r.json()["data"]["id"]


def scan(path: Path) -> dict:
    """The finished VirusTotal analysis of `path`: its engine counts and report link."""
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    r = call("GET", f"/files/{sha}")
    if r.status_code == 404:
        analysis, deadline = upload(path), time.time() + WAIT
        while True:
            time.sleep(PAUSE)
            a = call("GET", f"/analyses/{analysis}").json()["data"]["attributes"]
            if a["status"] == "completed":
                stats = a["stats"]
                break
            if time.time() > deadline:
                sys.exit(f"{path.name}: analysis not finished after {WAIT // 60} minutes")
    elif r.status_code >= 400:
        sys.exit(f"lookup {path.name}: {r.status_code} {r.text[:300]}")
    else:
        stats = r.json()["data"]["attributes"]["last_analysis_stats"]
    time.sleep(PAUSE)
    return {"name": path.name, "sha256": sha, "link": f"{GUI}/{sha}",
            "flagged": stats.get("malicious", 0) + stats.get("suspicious", 0),
            "engines": sum(stats.get(k, 0) for k in
                           ("malicious", "suspicious", "undetected", "harmless"))}


def table(results: list[dict]) -> str:
    rows = [HEADING, "", "Each file as VirusTotal scanned it right after this release was "
            "built. A flag from one or two engines is often a false positive on apps that "
            "bundle a Python program; the report shows which engine and why.", "",
            "| File | Engines that flagged it | Report |", "|---|---|---|"]
    rows += [f"| `{r['name']}` | {r['flagged']} of {r['engines']} | [VirusTotal]({r['link']}) |"
             for r in results]
    return "\n".join(rows) + "\n"


def scannable(folder: Path) -> list[Path]:
    """What players run or install: not latest.json or SHA256SUMS."""
    return sorted(p for p in folder.iterdir()
                  if p.is_file() and p.suffix in (".exe", ".dmg", ".gz", ".AppImage", ".deb"))


def release(tag: str, folder: Path, repo: str) -> None:
    """Scan the release files in `folder` and put the table at the end of `tag`'s notes."""
    results = [scan(p) for p in scannable(folder)]
    body = json.loads(subprocess.run(["gh", "release", "view", tag, "-R", repo, "--json",
                                      "body"], check=True, capture_output=True,
                                     text=True).stdout)["body"]
    body = body.replace("\r", "").split(HEADING)[0].rstrip() + "\n\n" + table(results)
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8",
                                     newline="\n") as f:
        f.write(body)
    subprocess.run(["gh", "release", "edit", tag, "-R", repo, "--notes-file", f.name],
                   check=True)
    Path(f.name).unlink()
    print(table(results))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan")
    s.add_argument("files", nargs="+", type=Path)
    r = sub.add_parser("release")
    r.add_argument("tag")
    r.add_argument("folder", type=Path)
    r.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "Modkeel/app"))
    args = ap.parse_args()
    if args.cmd == "scan":
        print(table([scan(p) for p in args.files]))
    else:
        release(args.tag, args.folder, args.repo)


if __name__ == "__main__":
    main()
