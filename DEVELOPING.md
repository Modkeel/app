# Modkeel app (desktop, spike)

A window over the Modkeel engine. The app never resolves mods itself: it starts
`modkeel serve --stdio` and speaks its JSON-lines protocol (`modkeel/core/wire.py`), so it
behaves exactly like the CLI by construction (docs/ideas/IDEA-028-engine-core.md, step 4;
docs/ideas/IDEA-023-modkeel-app.md for the product).

```
src/                React + Vite screen (Keel look, docs/companion-ui-style.md)
  protocol.ts       protocol types + a pure reducer: server messages -> screen state
  transport.ts      Tauri in the app, a WebSocket to the dev bridge in a browser
  App.tsx           one screen: ask for a mod, show progress, answer questions, show the result
src-tauri/          Tauri 2 (Rust): starts the engine, relays lines both ways, kills it on exit
  src/engine.rs     the child process (no Tauri inside, unit-tested with sh)
scripts/dev-bridge.mjs   WebSocket <-> `modkeel serve --stdio`, for the browser and the e2e
e2e/get.mjs         Chromium + dev bridge + the real engine: a full get, with screenshots
```

Which engine runs: `MODKEEL_ENGINE` (e.g. `python3 -m modkeel.cli serve --stdio`), else a
`modkeel-engine` bundled next to the executable (packaging step, not built yet), else
`modkeel serve --stdio` from PATH (`pipx install modkeel`).

```bash
npm install
npm test                       # reducer against a recorded engine session
npm run build                  # typecheck + bundle
(cd src-tauri && cargo test)   # engine process relay
npm run e2e                    # real get through the screen (network; Chromium)

# the app itself (Linux needs libwebkit2gtk-4.1-dev; Windows/macOS ship their webview)
MODKEEL_ENGINE="python3 -m modkeel.cli serve --stdio" PYTHONPATH=.. npx tauri dev
npx tauri build --no-bundle    # release binary in src-tauri/target/release/
```

To work on the screen in a browser: `npm run bridge` in one terminal, `npm run dev` in
another, then open http://localhost:1420.
