// How the app reaches the engine. Two ways, same contract (send a line, receive lines):
//
//   TauriTransport   the desktop app: Rust starts `modkeel serve --stdio` and relays lines
//                    (src-tauri/src/engine.rs) through a command and an event
//   BridgeTransport  a browser during development and the e2e test: a WebSocket to
//                    scripts/dev-bridge.mjs, which starts the same `serve --stdio`
//
// The screen code never knows which one it has.

export interface Transport {
  start(onLine: (line: string) => void, onExit: (why: string) => void): Promise<void>;
  send(message: object): Promise<void>;
  /** Stop listening (and, for the bridge, close the connection: its engine exits). */
  stop(): void;
  /** Where the player's files go (the app: Downloads/Modkeel); null: the engine's default. */
  outputDir(): Promise<string | null>;
  /** The system's folder picker (the app); null when there is none (a browser): type it. */
  pickFolder(): Promise<string | null>;
}

export class TauriTransport implements Transport {
  private unlisten: Array<() => void> = [];

  async start(onLine: (line: string) => void, onExit: (why: string) => void) {
    const { listen } = await import("@tauri-apps/api/event");
    const { invoke } = await import("@tauri-apps/api/core");
    this.unlisten.push(await listen<string>("engine-line", (e) => onLine(e.payload)));
    this.unlisten.push(await listen<string>("engine-exit", (e) => onExit(e.payload)));
    // The engine lives as long as the app; starting it again replays its hello.
    await invoke("engine_start");
  }

  stop() {
    this.unlisten.forEach((u) => u());
    this.unlisten = [];
  }

  async outputDir() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("output_dir");
  }

  async pickFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title: "The pack's mods folder" });
    return typeof picked === "string" ? picked : null;
  }

  async send(message: object) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("engine_send", { line: JSON.stringify(message) });
  }
}

export class BridgeTransport implements Transport {
  private socket: WebSocket | null = null;

  constructor(private url: string) {}

  start(onLine: (line: string) => void, onExit: (why: string) => void) {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`no engine bridge at ${this.url}`));
      socket.onmessage = (e) => onLine(String(e.data));
      socket.onclose = () => onExit("the engine bridge closed");
    });
  }

  async send(message: object) {
    this.socket?.send(JSON.stringify(message));
  }

  async outputDir() {
    return null;
  }

  async pickFolder() {
    return null;
  }

  stop() {
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }
}

/** Tauri inside the app; the bridge in a plain browser (dev server, e2e). */
export function defaultTransport(): Transport {
  if ("__TAURI_INTERNALS__" in window) return new TauriTransport();
  const port = new URLSearchParams(location.search).get("bridge") ?? "8765";
  return new BridgeTransport(`ws://127.0.0.1:${port}`);
}
