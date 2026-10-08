"""Build the engine the app bundles: the modkeel CLI as one executable, placed where Tauri
expects a sidecar (src-tauri/binaries/modkeel-engine-<target triple>[.exe]), then smoke-test it.

    python app/scripts/build_engine.py            # build + handshake check
    python app/scripts/build_engine.py --get      # also a real get (network: Modrinth)

The real get asks for Accessories on 1.21.11, which has no build there: it exercises the
questions (token declined, the nearer version accepted), required dependencies, and the
non-ASCII progress lines that broke the engine on Windows pipes (cp1252) before.

Needs `pip install pyinstaller` and the lab's modkeel importable (run from the lab root or
with `pip install .`). The binary only works on the system it was built on: CI builds one
per OS (.github/workflows/app-release.yml).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
LAB = APP.parent
BINARIES = APP / "src-tauri" / "binaries"


def target_triple() -> str:
    """Rust's host triple: Tauri looks for the sidecar under this suffix."""
    out = subprocess.run(["rustc", "-vV"], check=True, capture_output=True, text=True).stdout
    return next(line.split(": ", 1)[1] for line in out.splitlines() if line.startswith("host: "))


def build() -> Path:
    exe = ".exe" if sys.platform == "win32" else ""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [sys.executable, "-m", "PyInstaller", "--onefile", "--noconfirm", "--clean",
             "--name", "modkeel-engine", "--distpath", f"{tmp}/dist",
             "--workpath", f"{tmp}/build", "--specpath", tmp,
             "--paths", str(LAB), str(APP / "engine" / "modkeel_engine.py")],
            check=True, cwd=LAB)
        BINARIES.mkdir(parents=True, exist_ok=True)
        dest = BINARIES / f"modkeel-engine-{target_triple()}{exe}"
        shutil.copy2(Path(tmp) / "dist" / f"modkeel-engine{exe}", dest)
    print(f"engine: {dest} ({dest.stat().st_size // (1024 * 1024)} MB)")
    return dest


def smoke(engine: Path, get: bool) -> None:
    """The bundled engine speaks the protocol (and, with get, resolves a real mod)."""
    sys.path.insert(0, str(LAB))
    from modkeel.constants import MODKEEL_VERSION

    with tempfile.TemporaryDirectory() as work:
        proc = subprocess.Popen([str(engine), "serve", "--stdio"], cwd=work, text=True,
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
