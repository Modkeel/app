// The engine's JSON-lines protocol (modkeel/core/wire.py, protocol 1) seen from the app.
//
// `reduce` folds server messages into the screen's state; it is pure, so the whole flow is
// tested by replaying a recorded session (src/__fixtures__) without Tauri or a window.
// Outgoing messages are built by `request`, `answer` and `cancel`.

export const PROTOCOL = 1;

export interface EngineEvent {
  kind: string;
  [field: string]: unknown;
}

export interface TargetOption {
  mc_version: string;
  covered: string[];
  missing: string[];
  older: string[];
  summary: string;
}

export type QuestionPayload =
  | { kind: "change_target"; option: TargetOption; current: string; scope: string }
  | { kind: "need_token"; reason: string };

export interface Delivery {
  jar_path: string;
  mod_name: string;
  mod_version: string;
  verb: string;
  evidence: string[];
  caveat: string | null;
  unverified: string | null;
}

export interface GetResult {
  mod: string;
  identified: boolean;
  target: string;
  output_dir: string;
  retargeted: boolean;
  delivered: Delivery | null;
  proposal: TargetOption | null;
}

export type ModStatus = "waiting" | "delivered" | "reused" | "missing" | "unknown";

/** One JAR of a pack being moved (port): who it is and what became of it. */
export interface PackRow {
  file: string;
  name: string;
  slug: string | null;
  identifiedBy: "hash" | "launcher" | "name" | null; // name: a guess the player may want to check
  status: ModStatus;
  detail: string;
}

export interface MoveResult {
  target: string;
  loader: string;
  output_dir: string;
  retargeted: boolean;
  ready: number;
  mods: Array<{
    file: string;
    name: string;
    identified_by: "hash" | "launcher" | "name" | null;
    slug: string | null;
    status: ModStatus;
    delivered: Delivery | null;
    detail: string;
  }>;
  proposal: TargetOption | null;
}

export interface MoveParams {
  mods_dir: string;
  mc_version: string;
  loader?: string;
  output_dir?: string;
}

export type Method = "get" | "move";

/** One launcher instance (modkeel/instances.py), from the engine's `instances` query. */
export interface InstanceInfo {
  launcher: "prism" | "modrinth" | "curseforge" | "minecraft";
  name: string;
  path: string;
  mods_dir: string;
  mc_version: string | null;
  loader: string | null;
  loader_version: string | null;
  mods: number;
}

export const LAUNCHER_LABELS: Record<InstanceInfo["launcher"], string> = {
  prism: "Prism Launcher",
  modrinth: "Modrinth App",
  curseforge: "CurseForge",
  minecraft: "Minecraft Launcher",
};

/** "1.21.1 · NeoForge · 84 mods · Prism Launcher": what an instance runs, in one line. */
export function instanceSummary(i: InstanceInfo): string {
  const loader = i.loader ? i.loader.replace(/^neoforge$/, "NeoForge").replace(/^./, (c) => c.toUpperCase()) : null;
  return [i.mc_version, loader, `${i.mods} mod${i.mods === 1 ? "" : "s"}`, LAUNCHER_LABELS[i.launcher]]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A query (the engine's QUERIES: read-only, answered at once, even during a run). Its reply
 * carries its own id and never touches the run's state: the app routes it before reduce().
 */
export function query(id: string, method: "instances") {
  return { type: "request", id, method, params: {} };
}

export type ServerMessage =
  | { type: "hello"; protocol: number; modkeel: string; methods: string[] }
  | { type: "event"; id: string; event: EngineEvent }
  | { type: "question"; id: string; qid: string; question: QuestionPayload }
  | { type: "result"; id: string; result: GetResult | MoveResult }
  | { type: "error"; id?: string; error: { code: string; message: string } };

export interface GetParams {
  query: string;
  mc_version: string;
  loader: string;
  loader_version?: string;
  output_dir?: string;
  instance?: string;
}

// Same words as the CLI's trail (modkeel/sources.py STRATEGY_LABELS).
export const STRATEGY_LABELS: Record<string, string> = {
  official: "Official build",
  official_source: "Author's branch",
  older_official: "Older official build",
  fork: "Community fork",
  relaxed_official: "Official build, relaxed",
};

export function strategyLabel(name: string): string {
  return STRATEGY_LABELS[name] ?? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * A trail detail without its evidence lists: "11 Minecraft classes it uses don't exist in
 * 1.21.11 (class_1921$class_4687, ...)" -> "... in 1.21.11". The full text stays available
 * (the step's tooltip); the card keeps one short sentence (Keel: as little text as possible).
 */
export function shortDetail(detail: string): string {
  let out = "";
  let group = ""; // a " (...)" group being read, kept unless it is a list
  let depth = 0;
  for (let i = 0; i < detail.length; i++) {
    const c = detail[i];
    if (depth === 0 && c === "(" && detail[i - 1] === " ") {
      depth = 1;
      group = c;
    } else if (depth > 0) {
      group += c;
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        const isList = group.includes(", ") || group.includes("...");
        out = isList ? out.replace(/ $/, "") : out + group;
      }
    } else {
      out += c;
    }
  }
  return (out + (depth > 0 ? group : "")).trim();
}

export interface Step {
  target: string;
  strategy: string;
  ok: boolean;
  detail: string;
}

export type Phase = "connecting" | "ready" | "running" | "asking" | "done" | "failed";

export interface State {
  phase: Phase;
  method: Method;
  engine: { version: string; methods: string[] } | null;
  requestId: string | null;
  target: string | null; // the version being resolved right now
  mod: { title: string; slug: string | null; identified: boolean; sourceRepo: string | null } | null;
  steps: Step[];
  activity: string | null; // what the engine is doing now (one line)
  files: string[]; // every JAR written, in order
  question: { qid: string; payload: QuestionPayload } | null;
  result: GetResult | null;
  pack: PackRow[] | null; // move: one row per JAR, from pack_scanned on
  moveResult: MoveResult | null;
  error: { code: string; message: string } | null;
}

export const initialState: State = {
  phase: "connecting",
  method: "get",
  engine: null,
  requestId: null,
  target: null,
  mod: null,
  steps: [],
  activity: null,
  files: [],
  question: null,
  result: null,
  pack: null,
  moveResult: null,
  error: null,
};

/** A request starts: reset what the previous run showed, keep the engine handshake. */
export function started(state: State, requestId: string, target: string, method: Method = "get"): State {
  return { ...initialState, phase: "running", engine: state.engine, requestId, target, method };
}

export function reduce(state: State, message: ServerMessage): State {
  switch (message.type) {
    case "hello":
      if (message.protocol !== PROTOCOL) {
        return {
          ...state,
          phase: "failed",
          error: {
            code: "protocol",
            message: `This app speaks protocol ${PROTOCOL}; the engine speaks ${message.protocol}.`,
          },
        };
      }
      return { ...state, phase: "ready", engine: { version: message.modkeel, methods: message.methods } };
    case "event":
      return message.id === state.requestId ? onEvent(state, message.event) : state;
    case "question":
      if (message.id !== state.requestId) return state;
      // while it waits for the player nothing is in progress: drop the last activity line
      return { ...state, phase: "asking", activity: null, question: { qid: message.qid, payload: message.question } };
    case "result":
      if (message.id !== state.requestId) return state;
      if (state.method === "move") {
        const r = message.result as MoveResult;
        const pack: PackRow[] = r.mods.map((m) => ({
          file: m.file,
          name: m.name,
          slug: m.slug,
          identifiedBy: m.identified_by,
          status: m.status,
          detail: m.detail,
        }));
        return { ...state, phase: "done", activity: null, question: null, moveResult: r, pack, target: r.target };
      }
      return { ...state, phase: "done", activity: null, question: null, result: message.result as GetResult };
    case "error":
      // An error without an id is about a line the app sent badly; with another id it is
      // about an older request. Both still mean this run cannot go on if it was ours.
      if (message.id !== undefined && message.id !== state.requestId) return state;
      return { ...state, phase: "failed", activity: null, question: null, error: message.error };
  }
}

function onEvent(state: State, event: EngineEvent): State {
  switch (event.kind) {
    case "mod_identified":
      return {
        ...state,
        mod: {
          title: String(event.title),
          slug: (event.slug as string | null) ?? null,
          identified: Boolean(event.identified),
          sourceRepo: (event.source_repo as string | null) ?? null,
        },
      };
    case "source_tried":
      return {
        ...state,
        steps: [
          ...state.steps,
          {
            target: state.target ?? "",
            strategy: String(event.strategy),
            ok: Boolean(event.ok),
            detail: String(event.detail),
          },
        ],
      };
    case "downloading":
      return {
        ...state,
        activity:
          event.purpose === "check"
            ? `Checking ${event.filename} (made for MC ${event.built_for})`
            : `Downloading ${event.filename}`,
      };
    case "target_search":
      return { ...state, activity: "Looking for the nearest Minecraft version where it runs" };
    case "saved":
      return { ...state, files: [...state.files, String(event.path)] };
    case "pack_scanned":
      return {
        ...state,
        pack: (event.mods as Array<[string, string, string | null, "hash" | "launcher" | "name" | null]>).map(
          ([file, name, slug, identifiedBy]) => ({ file, name, slug, identifiedBy, status: "waiting", detail: "" }),
        ),
      };
    case "mod_resolved": {
      if (!state.pack) return { ...state, activity: null };
      // the first row of that mod still waiting takes the outcome (names can repeat)
      const i = state.pack.findIndex((r) => r.name === event.mod && r.status === "waiting");
      if (i < 0) return { ...state, activity: null };
      const trail = event.trail as Array<[string, boolean, string]>;
      const delivered = event.delivered !== null && event.delivered !== undefined;
      const row: PackRow = {
        ...state.pack[i],
        status: delivered ? "delivered" : "missing",
        detail: delivered ? "" : (trail.at(-1)?.[2] ?? ""),
      };
      return { ...state, activity: null, pack: state.pack.map((r, j) => (j === i ? row : r)) };
    }
    default:
      return state; // messages, progress...: not shown in this spike
  }
}

// After a change_target answer the next steps belong to the proposed version.
export function answered(state: State, value: unknown): State {
  const q = state.question;
  const target =
    q && q.payload.kind === "change_target" && value === true ? q.payload.option.mc_version : state.target;
  const again = state.pack && target !== state.target
    ? state.pack.map((r) => ({ ...r, status: "waiting" as ModStatus, detail: "" }))
    : state.pack;
  return { ...state, phase: "running", question: null, target, pack: again };
}

export function request(id: string, params: GetParams | MoveParams, method: Method = "get") {
  return { type: "request", id, method, params };
}

export function answer(qid: string, value: unknown) {
  return { type: "answer", qid, value };
}

export function cancel(id: string) {
  return { type: "cancel", id };
}
