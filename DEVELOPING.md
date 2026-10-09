# Modkeel app (desktop, spike)

A window over the Modkeel engine. The app never resolves mods itself: it starts
`modkeel serve --stdio` and speaks its JSON-lines protocol (`modkeel/core/wire.py`), so it
behaves exactly like the CLI by construction (docs/ideas/IDEA-028-engine-core.md, step 4;
docs/ideas/IDEA-023-modkeel-app.md for the product).

```
src/                React + Vite screen (Keel look, docs/companion-ui-style.md)
  protocol.ts       protocol types + a pure reducer: server messages -> screen state
  transport.ts      Tauri in the app, a WebSocket to the dev bridge in a browser
  App.tsx           two tabs: Get a mod (method get), Move a pack (method move: the
                    player's launcher instances (query instances) or a mods folder, the
                    system folder picker, one row per JAR as it resolves)
src-tauri/          Tauri 2 (Rust): starts the engine, relays lines both ways, kills it on exit
  src/engine.rs     the child process (no Tauri inside, unit-tested with sh)
scripts/dev-bridge.mjs   WebSocket <-> `modkeel serve --stdio`, for the browser and the e2e
e2e/get.mjs, move.mjs  Chromium + dev bridge + the real engine: a full get / a pack moved
                    (MODKEEL_E2E_PACK=<mods folder>, or MODKEEL_E2E_INSTANCE=<name> picked
                    from the list), with screenshots
```

Which engine runs: `MODKEEL_ENGINE` (e.g. `python3 -m modkeel.cli serve --stdio`), else the
`modkeel-engine` bundled next to the executable (the installers carry it), else
`modkeel serve --stdio` from PATH (`pipx install modkeel`). The engine runs in, and writes
to, `Downloads/Modkeel` (home/Modkeel without a Downloads folder), never beside the app.

## Installers

`python app/scripts/build_engine.py --get` builds the engine for this OS with PyInstaller
(`src-tauri/binaries/modkeel-engine-<target triple>`, not committed) and checks it with a
real get; `npx tauri build` then bundles it. CI does both on Windows (NSIS .exe), macOS
(Apple Silicon .dmg) and Linux (.deb, .AppImage): `.github/workflows/app-release.yml`, on
work branches that touch `app/` and by hand; the installers are the run's artifacts.
Unsigned: Windows SmartScreen and macOS Gatekeeper warn the first time.

## Public releases and updates

Players download from the public repo [Modkeel/app](https://github.com/Modkeel/app): only
releases and a README (`release/README.md` here, synced on each release); the code stays in
the lab. The installed app checks `releases/latest/download/latest.json` there at start
(`src/updater.ts`, Tauri's updater plugin) and offers "Update and restart".

Updates are signed with the app's updater key (Tauri's minisign key, unrelated to OS code
signing). Its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`; a build
without it has no updater plugin at all (`lib.rs` `has_updater`). The private half is only the
lab secret `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) and the maintainer's backup: if it is
lost, installed apps can never update again and players must reinstall by hand.

Releasing:
1. A PR bumping the version in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml` (+ `npm install`, `cargo update -p modkeel-app` for the lockfiles),
   with `release-notes/<version>.md` (shown on the release page and in the update card).
2. Merge, then Actions -> app-release -> Run workflow on main with **publish** ticked: it
   builds, signs the update bundles, writes `latest.json` and `SHA256SUMS`
   (`scripts/release_manifest.py`) and publishes `v<version>` to Modkeel/app.

```bash
npm install
npm test                       # reducer against a recorded engine session
npm run build                  # typecheck + bundle
(cd src-tauri && cargo test)   # engine process relay
npm run e2e                    # real get through the screen (network; Chromium)

# the app itself (Linux needs libwebkit2gtk-4.1-dev; Windows/macOS ship their webview)
MODKEEL_ENGINE="python3 -m modkeel.cli serve --stdio" PYTHONPATH=.. npx tauri dev
python scripts/build_engine.py # the bundled engine (needed by tauri build)
npx tauri build --bundles deb  # installer in src-tauri/target/release/bundle/
```

To work on the screen in a browser: `npm run bridge` in one terminal, `npm run dev` in
another, then open http://localhost:1420.
