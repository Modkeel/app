# Architecture

A map of the Modkeel desktop app's code, for people and AI assistants reading it. How to build,
test and release it is in [DEVELOPING.md](DEVELOPING.md).

## The shape

```
React screen (src/)  <-- JSON lines -->  Rust shell (src-tauri/)  <-- stdin/stdout -->  engine
  renders state,                           starts the engine,                        modkeel serve --stdio
  turns clicks into requests               relays lines, never parses them           (the Modkeel CLI)
```

The app never resolves mods itself. Everything it does (find a build, add it to an instance,
move a pack, undo) is a request to the engine, the same Python code as the `modkeel` CLI
([Modkeel/modkeel](https://github.com/Modkeel/modkeel), protocol in `modkeel/core/wire.py`).
So the app behaves exactly like the CLI by construction, and its own logic is small enough to
test without a window.

## src/ (the screen, React + Vite)

| File | What it does |
|------|--------------|
| `protocol.ts` | The protocol seen from the app: message types, request builders (`request`, `query`, `answer`, `cancel`) and `reduce`, a pure function that folds engine messages into the screen's state |
| `App.tsx` | Renders that state: the player's launcher instances first (each with "Add a mod" and "Move"), then Get a mod, Move a pack and History (what Modkeel added, each with Undo). Questions only the player can answer (a GitHub sign-in, a Minecraft version change) are cards with safe defaults |
| `transport.ts` | How lines travel: Tauri commands and events in the app, a WebSocket to the dev bridge in a browser |
| `updater.ts` | Offers a new release: reads `latest.json` from the latest GitHub release; Tauri's updater plugin refuses a download whose signature does not match the key built into the app |
| `components/`, `keel.css`, `assets/` | The look (Keel): a custom select, the stylesheet, logo and fonts |
| `*.test.ts`, `__fixtures__/` | vitest: the reducer replays real engine sessions recorded from `serve --stdio` (a get, a pack moved), plus add/undo and the updater |

Engine methods the screen uses: `get`, `move`, `add`, `undo`, `search`, `builds` (an
instance's mods with no build for its version), `sign_in`, and the queries `instances`,
`history`, `github`.

## src-tauri/ (the native side, Tauri 2 + Rust)

| File | What it does |
|------|--------------|
| `src/lib.rs` | Commands for the screen: `engine_start` (once; a reload reconnects), `engine_send`, `output_dir`; events `engine-line` and `engine-exit`; registers the updater only when the build has its public key (`has_updater`) |
| `src/engine.rs` | The engine child process: which one to start, lines both ways, killed when the window closes. No Tauri inside, unit-tested |
| `tauri.conf.json`, `tauri.windows.conf.json` | Window, bundles, the updater's public key; on Windows the engine folder bundled beside the app |
| `capabilities/default.json` | What the screen may call: the app's commands, the folder picker (open only), opening web pages in the browser, its own updates and restart |

Which engine runs: `MODKEEL_ENGINE` if set, else the bundled one next to the executable
(`engine/python.exe` on Windows, `modkeel-engine` on macOS and Linux), else `modkeel` from
PATH. It runs in, and writes to, `Downloads/Modkeel`, never next to the app. Launcher instances
are only read; adding a mod goes through a staging folder and is recorded so it can be undone.

## engine/ and scripts/

| File | What it does |
|------|--------------|
| `engine/requirements.txt` | The engine the installers carry: `modkeel==<version>` from PyPI, pinned |
| `scripts/build_engine.py` | Builds that engine for this OS and smoke-tests it: on Windows python.org's embeddable Python (its files signed by the Python Software Foundation) with modkeel installed in it; elsewhere one PyInstaller executable |
| `scripts/release_manifest.py` | A release's files: installers, `latest.json`, `SHA256SUMS` |
| `scripts/virustotal.py` | Scans each release file and writes the VirusTotal table into the release notes |
| `scripts/dev-bridge.mjs` | WebSocket <-> `modkeel serve --stdio`, for working on the screen in a browser and for e2e |

## e2e/ and workflows

| File | What it does |
|------|--------------|
| `e2e/get.mjs`, `move.mjs`, `add.mjs` | Chromium + the dev bridge + the real engine on the live APIs: a get, a pack moved, a mod added to a throwaway Prism instance and undone; with screenshots |
| `e2e/windows-shot.ps1` | Installs the real NSIS build silently in CI, uses it as a player would, takes screenshots |
| `.github/workflows/ci.yml` | Tests, typecheck, `cargo test` |
| `.github/workflows/release.yml` | Installers for Windows, macOS and Linux on every push (as run artifacts); on a `v<version>` tag also provenance attestations, the release and its VirusTotal scan |
| `.github/workflows/virus-scan.yml` | Weekly re-scan of the latest release; the table in its notes is replaced with the new results |
| `.github/workflows/codeql.yml`, `scorecard.yml` | Code scanning on every push and weekly; OpenSSF Scorecard |

## Where to start reading

- One click to one result: `App.tsx` (button) -> `protocol.ts` `request` -> `transport.ts` ->
  `src-tauri/src/lib.rs` `engine_send` -> the engine -> `engine-line` -> `protocol.ts` `reduce`.
- What the engine can be asked: `modkeel/core/wire.py` in Modkeel/modkeel.
- What an update must pass: `updater.ts` and `plugins.updater.pubkey` in `tauri.conf.json`.
