# Developing Modkeel for desktop

A window over the Modkeel engine. The app never resolves mods itself: it starts
`modkeel serve --stdio` and speaks its JSON-lines protocol (`modkeel/core/wire.py` in
[Modkeel/modkeel](https://github.com/Modkeel/modkeel)), so it behaves exactly like the CLI by
construction.

```
src/                React + Vite screen
  protocol.ts       protocol types + a pure reducer: server messages -> screen state
  transport.ts      Tauri in the app, a WebSocket to the dev bridge in a browser
  updater.ts        offers new releases (Tauri's updater plugin)
  App.tsx           two tabs: Get a mod (method get), Move a pack (method move: the
                    player's launcher instances (query instances) or a mods folder, the
                    system folder picker, one row per JAR as it resolves)
src-tauri/          Tauri 2 (Rust): starts the engine, relays lines both ways, kills it on exit
  src/engine.rs     the child process (no Tauri inside, unit-tested with sh)
engine/             the bundled engine: the modkeel CLI from PyPI, pinned in requirements.txt
scripts/build_engine.py   the engine for this OS + a smoke test: on Windows python.org's
                    embeddable Python with modkeel in it (src-tauri/binaries/python, bundled
                    as engine/ by tauri.windows.conf.json); elsewhere one PyInstaller executable
scripts/release_manifest.py   a release's files: installers, latest.json, SHA256SUMS
scripts/dev-bridge.mjs   WebSocket <-> `modkeel serve --stdio`, for the browser and the e2e
e2e/get.mjs, move.mjs  Chromium + dev bridge + the real engine: a full get / a pack moved
                    (MODKEEL_E2E_PACK=<mods folder>, or MODKEEL_E2E_INSTANCE=<name>), with
                    screenshots
release-notes/      notes per release (the release page and the in-app update card)
```

Which engine runs: `MODKEEL_ENGINE` (e.g. `python3 -m modkeel.cli serve --stdio`), else the
embedded `engine/python.exe` next to the executable (the Windows installer), else the
`modkeel-engine` bundled next to it (macOS, Linux), else
`modkeel serve --stdio` from PATH (`pipx install modkeel`). The engine runs in, and writes
to, `Downloads/Modkeel` (home/Modkeel without a Downloads folder), never beside the app.

## Build and test

```bash
npm install
npm test                       # reducer against recorded engine sessions, the updater
npm run build                  # typecheck + bundle
(cd src-tauri && cargo test)   # engine process relay, updater registration
npm run e2e                    # real get through the screen (network; Chromium)

# the engine the installers carry, built for this OS and smoke-tested
pip install -r engine/requirements.txt   # + pyinstaller on macOS and Linux
python scripts/build_engine.py --get     # on Windows, run it with Python 3.12

# the app itself (Linux needs libwebkit2gtk-4.1-dev; Windows/macOS ship their webview)
npx tauri dev
npx tauri build --bundles deb  # installer in src-tauri/target/release/bundle/
```

To work on the screen in a browser: `npm run bridge` in one terminal, `npm run dev` in
another, then open http://localhost:1420.

## Releases

`.github/workflows/release.yml` builds the installers on GitHub's machines for Windows (NSIS
.exe), macOS (Apple Silicon .dmg) and Linux (.AppImage, .deb), with the engine from PyPI at the
version `engine/requirements.txt` pins: on every push to main and every pull request (unsigned,
as the run's artifacts) and on every `v<version>` tag, which publishes the release. Each file on
the release page carries a build provenance attestation, so anyone can check it came from the
tagged commit, and the release notes link each file's VirusTotal report
(`scripts/virustotal.py`, secret `VIRUSTOTAL_API_KEY`):

    gh attestation verify Modkeel_<version>_windows_x64-setup.exe -R Modkeel/app

`codeql.yml` scans the code on every push and weekly; `scorecard.yml` publishes the OpenSSF
Scorecard. Security reports: [SECURITY.md](SECURITY.md).

Updates are signed with the app's updater key (Tauri's minisign key, unrelated to OS code
signing). Its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`; a build
without it has no updater plugin at all (`lib.rs` `has_updater`). The private half is the
repository secret `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) and the maintainer's backup.
The installed app reads `latest.json` from the latest release at start and offers
"Update and restart"; it refuses an update whose signature does not match its key.

A release is a version bump in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` (with their lockfiles) and `release-notes/<version>.md`; the tag
`v<version>` then builds, attests and publishes it. Not signed by Microsoft or Apple yet: the
README says how players open it the first time.
