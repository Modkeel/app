"""Scan a release's files on VirusTotal and add the results to its notes.

    python scripts/virustotal.py scan FILE...           # print a Markdown table
    python scripts/virustotal.py release v0.1.1 DIR     # scan DIR's files, add to v0.1.1's notes
    python scripts/virustotal.py release v0.1.1         # the same with the release's own files
    python scripts/virustotal.py release v0.1.1 --rescan   # ask every engine again first

The notes name every engine that flagged a file and what it called it, so anyone can see a
detection without a VirusTotal account; virustotal.json (written next to the files) holds the
same per file. --rescan asks VirusTotal to analyse known files again: after a vendor fixes a
false positive, the table follows (virus-scan.yml runs it weekly on the latest release). A free
key's rescans queue at low priority, so they are all requested at once and waited for at most
RESCAN_WAIT; a file still queued then gets its latest report. Progress goes to stderr.

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
WAIT = 30 * 60                   # a new file's analysis can take a while
RESCAN_WAIT = 10 * 60            # free keys' rescans queue at low priority: then the last report


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


def log(message: str) -> None:
    """Progress on stderr, so a long run shows where it is (stdout is the table)."""
    print(message, file=sys.stderr, flush=True)


def wait_for(analysis: str, name: str, deadline: float | None = None) -> dict | None:
    """The results of a queued analysis once every engine has answered; None when `deadline`
    (a time.time()) passes first. Without a deadline, waits up to WAIT and then gives up."""
    hard = deadline is None
    deadline = deadline or time.time() + WAIT
    while True:
        time.sleep(PAUSE)
        r = call("GET", f"/analyses/{analysis}")
        a = r.json().get("data", {}).get("attributes") if r.ok else None
        if a is None:
            # an API error (quota, unknown analysis): a rescan falls back to the last report
            if hard:
                sys.exit(f"{name}: analysis {analysis}: {r.status_code} {r.text[:300]}")
            log(f"{name}: rescan status unavailable ({r.status_code} {r.text[:200]})")
            return None
        if a["status"] == "completed":
            return a
        if time.time() > deadline:
            if hard:
                sys.exit(f"{name}: analysis not finished after {WAIT // 60} minutes")
            return None


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def request_rescan(path: Path) -> str | None:
    """Ask every engine to analyse a file VirusTotal knows again; the analysis id, or None
    when it does not know the file yet (scan uploads it then)."""
    r = call("POST", f"/files/{sha256(path)}/analyse")
    time.sleep(PAUSE)
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        sys.exit(f"rescan {path.name}: {r.status_code} {r.text[:300]}")
    log(f"{path.name}: rescan requested")
    return r.json()["data"]["id"]


def scan(path: Path, analysis: str | None = None, deadline: float | None = None) -> dict:
    """The VirusTotal verdict on `path`: engine counts, which engines flagged it and as what,
    and the report link. A file VirusTotal has never seen is uploaded and waited for. With
    `analysis` (a requested rescan), its results once finished; if it is still queued at
    `deadline`, the file's latest report instead (the rescan updates it when it finishes)."""
    sha = sha256(path)
    a = wait_for(analysis, path.name, deadline) if analysis else None
    if a is None:
        r = call("GET", f"/files/{sha}")
        if r.status_code == 404:
            log(f"{path.name}: new to VirusTotal, uploading")
            a = wait_for(upload(path), path.name)
        elif r.status_code >= 400:
            sys.exit(f"lookup {path.name}: {r.status_code} {r.text[:300]}")
        else:
            if analysis:
                log(f"{path.name}: rescan still queued, using the latest report")
            attributes = r.json()["data"]["attributes"]
            a = {"stats": attributes["last_analysis_stats"],
                 "results": attributes["last_analysis_results"]}
    time.sleep(PAUSE)
    stats, results = a["stats"], a.get("results", {})
    flagged_by = sorted(
        (engine, res.get("result") or res["category"]) for engine, res in results.items()
        if res.get("category") in ("malicious", "suspicious"))
    flagged = stats.get("malicious", 0) + stats.get("suspicious", 0)
    log(f"{path.name}: {flagged} flagged" + "".join(f"; {e}: {label}" for e, label in flagged_by))
    return {"name": path.name, "sha256": sha, "link": f"{GUI}/{sha}",
            "flagged": flagged,
            "engines": sum(stats.get(k, 0) for k in
                           ("malicious", "suspicious", "undetected", "harmless")),
            "flagged_by": [{"engine": e, "label": label} for e, label in flagged_by]}


def scan_all(paths: list[Path], rescan: bool = False) -> list[dict]:
    """Every file's verdict. With `rescan`, all rescans are requested first and then waited
    for together, at most RESCAN_WAIT in all (one slow queue never holds the others)."""
    analyses = {p: request_rescan(p) for p in paths} if rescan else {}
    deadline = time.time() + RESCAN_WAIT
    return [scan(p, analyses.get(p), deadline) for p in paths]


def table(results: list[dict]) -> str:
    when = time.strftime("%Y-%m-%d", time.gmtime())
    rows = [HEADING, "", f"Each file as VirusTotal's engines judged it on {when} (rescanned "
            "weekly, so a fixed false positive shows here). A flag from one or two engines is "
            "often a false positive on apps that bundle a Python program; the report shows "
            "which engine and why.", "",
            "| File | Engines that flagged it | Which, and what they called it | Report |",
            "|---|---|---|---|"]
    for r in results:
        which = "; ".join(f"{f['engine']}: `{f['label']}`" for f in r["flagged_by"]) or "none"
        rows.append(f"| `{r['name']}` | {r['flagged']} of {r['engines']} | {which} | "
                    f"[VirusTotal]({r['link']}) |")
    return "\n".join(rows) + "\n"


def scannable(folder: Path) -> list[Path]:
    """What players run or install: not latest.json or SHA256SUMS."""
    return sorted(p for p in folder.iterdir()
                  if p.is_file() and p.suffix in (".exe", ".dmg", ".gz", ".AppImage", ".deb"))


def release(tag: str, folder: Path | None, repo: str, rescan: bool = False) -> None:
    """Scan the release files (in `folder`, else downloaded from the release) and put the
    table at the end of `tag`'s notes; virustotal.json beside the files holds the same."""
    if folder is None:
        folder = Path(tempfile.mkdtemp())
        subprocess.run(["gh", "release", "download", tag, "-R", repo, "-D", str(folder)],
                       check=True)
    results = scan_all(scannable(folder), rescan)
    (folder / "virustotal.json").write_text(json.dumps(results, indent=2) + "\n",
                                            encoding="utf-8")
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
    r.add_argument("folder", type=Path, nargs="?",
                   help="the release's files (default: download them from the release)")
    r.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "Modkeel/app"))
    r.add_argument("--rescan", action="store_true",
                   help="ask VirusTotal to analyse files it already knows again")
    args = ap.parse_args()
    if args.cmd == "scan":
        print(table(scan_all(args.files)))
    else:
        release(args.tag, args.folder, args.repo, args.rescan)


if __name__ == "__main__":
    main()
