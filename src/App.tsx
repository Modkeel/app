// The app's screen: two jobs in tabs, one engine.
//
//   Get a mod     one mod for a Minecraft version (engine method `get`)
//   Move a pack   a mods folder moved to another Minecraft version (method `move`); the
//                 player's launcher instances are offered first (query `instances`)
//
// All state comes from protocol.reduce; this file only renders it and turns clicks into
// protocol messages. Questions (token, version change) are the same cards for both jobs.

import { useEffect, useReducer, useRef, useState } from "react";
import {
  GetParams,
  InstanceInfo,
  Method,
  PackRow,
  MoveParams,
  QuestionPayload,
  ServerMessage,
  State,
  answer,
  answered,
  initialState,
  instanceSummary,
  query,
  reduce,
  request,
  started,
  shortDetail,
  strategyLabel,
} from "./protocol";
import logo from "./assets/logo.png";
import Select from "./components/Select";
import { Transport, defaultTransport } from "./transport";

type Action =
  | { type: "server"; message: ServerMessage }
  | { type: "started"; id: string; target: string; method: Method }
  | { type: "answered"; value: unknown }
  | { type: "lost"; why: string };

function appReducer(state: State, action: Action): State {
  switch (action.type) {
    case "server":
      return reduce(state, action.message);
    case "started":
      return started(state, action.id, action.target, action.method);
    case "answered":
      return answered(state, action.value);
    case "lost":
      return { ...state, phase: "failed", error: { code: "engine", message: action.why } };
  }
}

const LOADERS = [
  { value: "fabric", label: "Fabric" },
  { value: "neoforge", label: "NeoForge" },
  { value: "forge", label: "Forge" },
  { value: "quilt", label: "Quilt" },
];

// The id of the instances query: requests count from 1, so it never meets a run's id.
const INSTANCES_QUERY = "instances";

// For a pack the loader is read from its JARs unless the player picks one.
const PACK_LOADERS = [{ value: "", label: "From the mods" }, ...LOADERS];

export default function App({ transport: given }: { transport?: Transport }) {
  // One transport (one engine) for the app's life: created once, never per render.
  const [transport] = useState<Transport>(() => given ?? defaultTransport());
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [tab, setTab] = useState<Method>("get");
  const [getForm, setGetForm] = useState<GetParams>({ query: "", mc_version: "", loader: "fabric" });
  const [moveForm, setMoveForm] = useState<MoveParams>({ mods_dir: "", mc_version: "", loader: "" });
  const nextId = useRef(1);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);

  useEffect(() => {
    transport
      .start(
        (line) => {
          const message = JSON.parse(line) as ServerMessage;
          // the instances query's reply is not part of any run: keep it out of reduce()
          if (message.type === "result" && message.id === INSTANCES_QUERY) {
            setInstances((message.result as unknown as { instances: InstanceInfo[] }).instances);
            return;
          }
          if (message.type === "error" && message.id === INSTANCES_QUERY) return; // folder still works
          dispatch({ type: "server", message });
        },
        (why) => dispatch({ type: "lost", why }),
      )
      .catch((e: Error) => dispatch({ type: "lost", why: e.message }));
    transport.outputDir().then(setOutputDir, () => setOutputDir(null));
    return () => transport.stop();
  }, [transport]);

  // once the engine says hello (again, after a reload too), ask for the instances if it can
  const engineMethods = state.engine?.methods;
  useEffect(() => {
    if (engineMethods?.includes("instances")) transport.send(query(INSTANCES_QUERY, "instances"));
  }, [engineMethods, transport]);

  const busy = state.phase === "running" || state.phase === "asking";
  const ready = !busy && state.engine !== null;

  function start(method: Method, target: string, params: GetParams | MoveParams) {
    const id = String(nextId.current++);
    dispatch({ type: "started", id, target, method });
    transport.send(request(id, outputDir ? { ...params, output_dir: outputDir } : params, method));
  }

  function reply(value: unknown) {
    if (!state.question) return;
    transport.send(answer(state.question.qid, value));
    dispatch({ type: "answered", value });
  }

  // the run on screen belongs to the tab that started it
  const showing = state.requestId !== null && state.method === tab;

  return (
    <>
      <header className="strip">
        <img className="logo" src={logo} alt="" width={32} height={32} />
        <h1>Modkeel</h1>
        {state.engine && <span className="pill">engine {state.engine.version}</span>}
      </header>
      <main className="panel">
        <nav className="tabs" role="tablist">
          {(["get", "move"] as Method[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={tab === m}
              className={tab === m ? "tab active" : "tab"}
              onClick={() => setTab(m)}
            >
              {m === "get" ? "Get a mod" : "Move a pack"}
            </button>
          ))}
        </nav>

        {tab === "get" ? (
          <GetForm form={getForm} setForm={setGetForm} ready={ready} busy={busy} onStart={start} />
        ) : (
          <MoveForm
            form={moveForm}
            setForm={setMoveForm}
            ready={ready}
            busy={busy}
            onStart={start}
            pickFolder={() => transport.pickFolder()}
            instances={instances}
          />
        )}
        {state.phase === "connecting" && <p className="detail">Starting the engine...</p>}

        {showing && state.method === "get" && <Progress state={state} />}
        {showing && state.method === "move" && state.pack && <PackList state={state} />}
        {showing && state.question && <Question payload={state.question.payload} onAnswer={reply} />}
        {showing && state.result && <Result state={state} />}
        {state.error && (
          <section className="card bad">
            <div className="title">
              Stopped <span className="pill">{state.error.code}</span>
            </div>
            <p className="detail">{state.error.message}</p>
          </section>
        )}
      </main>
    </>
  );
}

type StartFn = (method: Method, target: string, params: GetParams | MoveParams) => void;

function GetForm(props: {
  form: GetParams;
  setForm: (f: GetParams) => void;
  ready: boolean;
  busy: boolean;
  onStart: StartFn;
}) {
  const { form, setForm, ready, busy, onStart } = props;
  const can = ready && form.query.trim() !== "" && form.mc_version.trim() !== "";
  return (
    <section className="card">
      <div className="title">Get a mod</div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (can)
            onStart("get", form.mc_version.trim(), {
              ...form,
              query: form.query.trim(),
              mc_version: form.mc_version.trim(),
            });
        }}
      >
        <label className="grow">
          Mod
          <input
            name="query"
            placeholder="Sodium, JEI, Create..."
            value={form.query}
            onChange={(e) => setForm({ ...form, query: e.target.value })}
          />
        </label>
        <label>
          Minecraft
          <input
            name="mc_version"
            placeholder="1.21.10"
            size={8}
            value={form.mc_version}
            onChange={(e) => setForm({ ...form, mc_version: e.target.value })}
          />
        </label>
        {/* not a <label>: a label forwards clicks inside it to the button, which
            would reopen the list right after an option is picked */}
        <div className="field">
          Loader
          <Select name="loader" value={form.loader} options={LOADERS} onChange={(loader) => setForm({ ...form, loader })} />
        </div>
        <button className="primary" type="submit" disabled={!can}>
          {busy ? "Working..." : "Get it"}
        </button>
      </form>
    </section>
  );
}

function MoveForm(props: {
  form: MoveParams;
  setForm: (f: MoveParams) => void;
  ready: boolean;
  busy: boolean;
  onStart: StartFn;
  pickFolder: () => Promise<string | null>;
  instances: InstanceInfo[];
}) {
  const { form, setForm, ready, busy, onStart, pickFolder, instances } = props;
  const can = ready && form.mods_dir.trim() !== "" && form.mc_version.trim() !== "";
  const picked = instances.find((i) => i.mods_dir === form.mods_dir) ?? null;
  const options = [
    { value: "", label: instances.length ? "Pick one, or a folder below" : "None found" },
    ...instances.map((i) => ({ value: i.mods_dir, label: i.name })),
  ];
  return (
    <section className="card">
      <div className="title">Move a pack</div>
      <p className="detail">Your mods folder is only read; the new pack goes to its own folder.</p>
      {instances.length > 0 && (
        <div className="row instances">
          <div className="field">
            Your instances
            <Select
              name="instance"
              value={picked?.mods_dir ?? ""}
              options={options}
              onChange={(dir) => {
                const i = instances.find((x) => x.mods_dir === dir);
                // the instance's own loader: no need to read it from the JARs
                setForm({ ...form, mods_dir: dir, loader: i?.loader ?? "" });
              }}
            />
          </div>
          {picked && <p className="detail instance-summary">{instanceSummary(picked)}</p>}
        </div>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!can) return;
          const params: MoveParams = { mods_dir: form.mods_dir.trim(), mc_version: form.mc_version.trim() };
          if (form.loader) params.loader = form.loader;
          onStart("move", params.mc_version, params);
        }}
      >
        <label className="grow">
          Mods folder
          <input
            name="mods_dir"
            placeholder=".minecraft/mods or an instance's mods folder"
            value={form.mods_dir}
            onChange={(e) => setForm({ ...form, mods_dir: e.target.value })}
          />
        </label>
        <button
          type="button"
          onClick={async () => {
            const dir = await pickFolder();
            if (dir) setForm({ ...form, mods_dir: dir });
          }}
        >
          Choose...
        </button>
        <label>
          To Minecraft
          <input
            name="move_mc_version"
            placeholder="1.21.10"
            size={8}
            value={form.mc_version}
            onChange={(e) => setForm({ ...form, mc_version: e.target.value })}
          />
        </label>
        <div className="field">
          Loader
          <Select
            name="move_loader"
            value={form.loader ?? ""}
            options={PACK_LOADERS}
            onChange={(loader) => setForm({ ...form, loader })}
          />
        </div>
        <button className="primary" type="submit" disabled={!can}>
          {busy ? "Working..." : "Move it"}
        </button>
      </form>
    </section>
  );
}

function Progress({ state }: { state: State }) {
  return (
    <section className="card" data-testid="progress">
      <div className="title">
        {state.mod?.title ?? "Looking it up"}
        {state.mod?.slug && <span className="pill">{state.mod.slug}</span>}
        {state.target && <span className="pill">MC {state.target}</span>}
      </div>
      {state.activity && <p className="activity">{state.activity}</p>}
      <ul className="steps">
        {state.steps.map((s, i) => (
          <li key={i}>
            <span className={`mark ${s.ok ? "ok" : "no"}`}>{s.ok ? "✓" : "✗"}</span>
            <span className="label">{strategyLabel(s.strategy)}</span>
            <span title={s.detail}>{shortDetail(s.detail)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const MARK: Record<PackRow["status"], [string, string]> = {
  waiting: ["…", "wait"],
  delivered: ["✓", "ok"],
  reused: ["↻", "ok"],
  missing: ["✗", "no"],
  unknown: ["?", "warn"],
};

function PackList({ state }: { state: State }) {
  const rows = state.pack!;
  const done = rows.filter((r) => r.status === "delivered" || r.status === "reused").length;
  const r = state.moveResult;
  const edge = r ? (r.ready === rows.length ? "ok" : r.ready > 0 ? "warn" : "bad") : "";
  return (
    <section className={`card ${edge}`} data-testid={r ? "result" : "progress"}>
      <div className="title">
        {done} of {rows.length} ready
        {state.target && <span className="pill">MC {state.target}</span>}
        {r && <span className="pill">{r.loader}</span>}
      </div>
      {state.activity && <p className="activity">{state.activity}</p>}
      {r?.retargeted && <p className="detail">Moved to MC {r.target}: more of the pack runs there.</p>}
      <ul className="steps pack">
        {rows.map((row) => {
          const [mark, tone] = MARK[row.status];
          return (
            <li key={row.file} title={row.file}>
              <span className={`mark ${tone}`}>{mark}</span>
              <span className="label">
                {row.name}
                {row.identifiedBy === "name" && <span className="pill guess">by name</span>}
              </span>
              <span title={row.detail}>
                {row.status === "reused" ? "your JAR runs there" : shortDetail(row.detail)}
              </span>
            </li>
          );
        })}
      </ul>
      {r && (
        <p className="detail">
          In <span className="mono">{r.output_dir}</span>
        </p>
      )}
    </section>
  );
}

function Question({ payload, onAnswer }: { payload: QuestionPayload; onAnswer: (v: unknown) => void }) {
  const [token, setToken] = useState("");
  if (payload.kind === "change_target") {
    const there = payload.option.mc_version;
    const pack = payload.scope === "pack";
    return (
      <section className="card warn" data-testid="question">
        <div className="title">
          MC {there} <span className="pill">nearest that works</span>
        </div>
        <p className="detail act">{payload.option.summary}.</p>
        <p className="detail">Files go to their own folder, never into your game.</p>
        <div className="row">
          <button className="primary" onClick={() => onAnswer(true)}>
            {pack ? `Move the pack to MC ${there}` : `Get it for MC ${there}`}
          </button>
          <button onClick={() => onAnswer(false)}>Stay on MC {payload.current}</button>
        </div>
      </section>
    );
  }
  return (
    <section className="card warn" data-testid="question">
      <div className="title">
        GitHub token <span className="pill">optional</span>
      </div>
      <p className="detail act">Community forks are the only source left; searching them needs a token.</p>
      <div className="row">
        <input
          className="grow"
          type="password"
          placeholder="ghp_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="primary" disabled={!token} onClick={() => onAnswer(token)}>
          Search forks
        </button>
        <button onClick={() => onAnswer(null)}>Skip forks</button>
      </div>
    </section>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function Result({ state }: { state: State }) {
  const r = state.result!;
  if (!r.delivered) {
    return (
      <section className="card bad" data-testid="result">
        <div className="title">
          No build of {r.mod} <span className="pill">MC {r.target}</span>
        </div>
        {r.proposal && !r.retargeted && <p className="detail">{r.proposal.summary}.</p>}
      </section>
    );
  }
  const d = r.delivered;
  return (
    <section className="card ok" data-testid="result">
      <div className="title">
        {d.mod_name} {d.mod_version}
        <span className="pill">MC {r.target}</span>
        <span className="pill">{d.verb}</span>
      </div>
      {r.retargeted && <p className="detail">For MC {r.target}: the version you asked for has no build.</p>}
      {d.caveat && <p className="detail act">{d.caveat}</p>}
      <ul className="steps mono">
        {state.files.map((f) => (
          <li key={f} title={f}>
            {fileName(f)}
          </li>
        ))}
      </ul>
      <p className="detail">
        In <span className="mono">{r.output_dir}</span>
      </p>
    </section>
  );
}
