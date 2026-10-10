"""Build the engine the app bundles, then smoke-test it.

    python app/scripts/build_engine.py            # build + handshake check
    python app/scripts/build_engine.py --get      # also a real get (network: Modrinth)

Windows: python.org's embeddable Python (its python.exe and DLLs signed by the Python Software
Foundation, the zip checked against EMBED_SHA256) with modkeel installed beside it, in
src-tauri/binaries/python/; the installer carries it as the resource folder engine/ and the app
runs `engine/python.exe -X utf8 -B -m modkeel.cli serve --stdio`. No executable of ours is
added: a one-file PyInstaller program (it unpacks Python into a temp folder at start) is what
generic and machine-learning antivirus verdicts flag on unsigned Windows installers.

macOS and Linux: the CLI as one PyInstaller executable, placed where Tauri expects a sidecar
(src-tauri/binaries/modkeel-engine-<target triple>).

The real get asks for Accessories on 1.21.11, which has no build there: it exercises the
questions (token declined, the nearer version accepted), required dependencies, and the
non-ASCII progress lines that broke the engine on Windows pipes (cp1252) before.

Needs the engine (`pip install -r engine/requirements.txt`, the modkeel version releases
bundle) and, on macOS and Linux, PyInstaller. On Windows, run it with a Python of
EMBED_VERSION's minor version (3.12): pip installs the dependencies' wheels for the Python
that runs it. Inside the Modkeel lab the CLI's source next to the app is used instead, so the
app can be tried against unreleased engine changes. The engine only works on the system it was
built on: release builds make one per OS.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
LAB = APP.parent
# the CLI's source beside the app (the lab), else the installed modkeel package
FROM_SOURCE = (LAB / "modkeel" / "cli.py").is_file()
BINARIES = APP / "src-tauri" / "binaries"
EMBEDDED = BINARIES / "python"     # tauri.windows.conf.json bundles it as engine/

# python.org's embeddable package; the hash pins the exact zip (cross-checked with the MD5 on
# its release page). A new version: update both, matching the release builds' Python minor.
EMBED_VERSION = "3.12.10"
EMBED_URL = f"https://www.python.org/ftp/python/{EMBED_VERSION}/python-{EMBED_VERSION}-embed-amd64.zip"
EMBED_SHA256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
# how the app runs the embedded engine (src-tauri/src/engine.rs says the same)
EMBED_ARGS = ["-X", "utf8", "-B", "-m", "modkeel.cli", "serve", "--stdio"]


def target_triple() -> str:
    """Rust's host triple: Tauri looks for the sidecar under this suffix."""
    out = subprocess.run(["rustc", "-vV"], check=True, capture_output=True, text=True).stdout
    return next(line.split(": ", 1)[1] for line in out.splitlines() if line.startswith("host: "))


def build_embedded() -> list[str]:
    """Windows: the embeddable Python with modkeel in Lib/site-packages; returns the command
    that runs it. Its ._pth file lists the import paths, which also keeps it isolated (no
    PYTHONPATH, no user site-packages): it never picks up a Python installed on the machine."""
    if sys.version_info[:2] != tuple(int(n) for n in EMBED_VERSION.split(".")[:2]):
        sys.exit(f"run with Python {EMBED_VERSION.rsplit('.', 1)[0]}: pip installs wheels for "
                 f"this Python ({sys.version.split()[0]}), the bundle runs {EMBED_VERSION}")
    with urllib.request.urlopen(EMBED_URL, timeout=120) as r:
        data = r.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != EMBED_SHA256:
        sys.exit(f"{EMBED_URL}: SHA-256 {digest}, expected {EMBED_SHA256}")
    shutil.rmtree(EMBEDDED, ignore_errors=True)
    EMBEDDED.mkdir(parents=True)
    zipfile.ZipFile(io.BytesIO(data)).extractall(EMBEDDED)
    tag = "python" + "".join(EMBED_VERSION.split(".")[:2])
    (EMBEDDED / f"{tag}._pth").write_text(f"{tag}.zip\n.\nLib\\site-packages\n",
                                         encoding="utf-8")
    engine = [str(LAB)] if FROM_SOURCE else ["-r", str(APP / "engine" / "requirements.txt")]
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "--target",
                    str(EMBEDDED / "Lib" / "site-packages"), *engine], check=True)
    # console scripts pip writes are small launcher .exe files of its own: not needed, and not
    # signed by anyone, so they go
    shutil.rmtree(EMBEDDED / "Lib" / "site-packages" / "bin", ignore_errors=True)
    size = sum(f.stat().st_size for f in EMBEDDED.rglob("*") if f.is_file())
    print(f"engine: {EMBEDDED} (Python {EMBED_VERSION}, {size // (1024 * 1024)} MB)")
    return [str(EMBEDDED / "python.exe"), *EMBED_ARGS]


def build() -> list[str]:
    """The engine for this OS; returns the command that runs it."""
    if sys.platform == "win32":
        return build_embedded()
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [sys.executable, "-m", "PyInstaller", "--onefile", "--noconfirm", "--clean",
             "--name", "modkeel-engine", "--distpath", f"{tmp}/dist",
             "--workpath", f"{tmp}/build", "--specpath", tmp,
             *(["--paths", str(LAB)] if FROM_SOURCE else []),
             str(APP / "engine" / "modkeel_engine.py")],
            check=True, cwd=LAB if FROM_SOURCE else APP)
        BINARIES.mkdir(parents=True, exist_ok=True)
        dest = BINARIES / f"modkeel-engine-{target_triple()}"
        shutil.copy2(Path(tmp) / "dist" / "modkeel-engine", dest)
    print(f"engine: {dest} ({dest.stat().st_size // (1024 * 1024)} MB)")
    return [str(dest), "serve", "--stdio"]


def smoke(command: list[str], get: bool) -> None:
    """The bundled engine speaks the protocol (and, with get, resolves a real mod)."""
    if FROM_SOURCE:
        sys.path.insert(0, str(LAB))
    from modkeel.constants import MODKEEL_VERSION

    with tempfile.TemporaryDirectory() as work:
        proc = subprocess.Popen(command, cwd=work, text=True, encoding="utf-8",
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        hello = json.loads(proc.stdout.readline())
        assert hello["type"] == "hello" and hello["protocol"] == 1, hello
        assert hello["modkeel"] == MODKEEL_VERSION, (hello, MODKEEL_VERSION)
        print(f"handshake ok: {hello}")
        if get:
            proc.stdin.write(json.dumps({"type": "request", "id": "1", "method": "get", "params": {
                "query": "Accessories", "mc_version": "1.21.11", "loader": "fabric"}}) + "\n")
            proc.stdin.flush()
            asked, saved = [], []
            for line in proc.stdout:
                message = json.loads(line)
                if message["type"] == "question":
                    kind = message["question"]["kind"]
                    asked.append(kind)
                    proc.stdin.write(json.dumps({"type": "answer", "qid": message["qid"],
                                                 "value": kind == "change_target"}) + "\n")
                    proc.stdin.flush()
                elif message["type"] == "event" and message["event"]["kind"] == "saved":
                    saved.append(message["event"]["path"])
                elif message["type"] in ("result", "error"):
                    break
            result = message.get("result", {})
            delivered = result.get("delivered")
            assert delivered and result["retargeted"], message
            assert "change_target" in asked, asked
            missing = [p for p in saved if not (Path(work) / p).is_file()]
            assert len(saved) >= 2 and not missing, (saved, missing)   # the mod + its deps
            print(f"get ok: MC {result['target']}, {len(saved)} files, asked {asked}")
        proc.stdin.close()
        proc.wait(timeout=60)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--get", action="store_true", help="also run a real get (network)")
    args = ap.parse_args()
    smoke(build(), args.get)


if __name__ == "__main__":
    main()
