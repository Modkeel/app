// Dev bridge: lets the app's screen run in a plain browser (vite dev server, the e2e test)
// by relaying a WebSocket to `modkeel serve --stdio`, as the Rust side does in the app.
//
//   node scripts/dev-bridge.mjs [port]      (default 8765; one engine per connection)
//
// MODKEEL_ENGINE overrides the command (default: python3 -m modkeel.cli serve --stdio, run
// with the parent folder on PYTHONPATH, for a checkout beside the CLI's source; else the
// installed modkeel); MODKEEL_WORKDIR is where the engine writes out/.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 8765);
const labRoot = fileURLToPath(new URL("../..", import.meta.url));
const [cmd, ...args] = (process.env.MODKEEL_ENGINE ?? "python3 -m modkeel.cli serve --stdio").split(" ");

const server = new WebSocketServer({ host: "127.0.0.1", port });
server.on("connection", (socket) => {
  const engine = spawn(cmd, args, {
    cwd: process.env.MODKEEL_WORKDIR ?? process.cwd(),
    env: { ...process.env, PYTHONPATH: [labRoot, process.env.PYTHONPATH].filter(Boolean).join(":") },
    stdio: ["pipe", "pipe", "inherit"],
  });
  createInterface({ input: engine.stdout }).on("line", (line) => socket.send(line));
  socket.on("message", (data) => engine.stdin.write(String(data) + "\n"));
  socket.on("close", () => engine.stdin.end());
  engine.on("exit", () => socket.close());
});
console.log(`engine bridge on ws://127.0.0.1:${port}`);
