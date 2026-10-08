// The spike's one screen: ask for a mod, show what the engine does, answer its questions,
// show what was delivered. All state comes from protocol.reduce; this file only renders it
// and turns clicks into protocol messages.

import { useEffect, useReducer, useRef, useState } from "react";
import {
  GetParams,
  QuestionPayload,
  ServerMessage,
  State,
  answer,
  answered,
  initialState,
  reduce,
  request,
  started,
  shortDetail,
  strategyLabel,
} from "./protocol";
import Select from "./components/Select";
import { Transport, defaultTransport } from "./transport";

type Action =
  | { type: "server"; message: ServerMessage }
  | { type: "started"; id: string; target: string }
  | { type: "answered"; value: unknown }
  | { type: "lost"; why: string };

function appReducer(state: State, action: Action): State {
  switch (action.type) {
    case "server":
      return reduce(state, action.message);
    case "started":
      return started(state, action.id, action.target);
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

export default function App({ transport: given }: { transport?: Transport }) {
  // One transport (one engine) for the app's life: created once, never per render.
  const [transport] = useState<Transport>(() => given ?? defaultTransport());
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [form, setForm] = useState<GetParams>({ query: "", mc_version: "", loader: "fabric" });
  const nextId = useRef(1);

  useEffect(() => {
    transport
      .start(
        (line) => dispatch({ type: "server", message: JSON.parse(line) as ServerMessage }),
        (why) => dispatch({ type: "lost", why }),
      )
      .catch((e: Error) => dispatch({ type: "lost", why: e.message }));
    return () => transport.stop();
  }, [transport]);

  const busy = state.phase === "running" || state.phase === "asking";
  const canStart = !busy && state.engine !== null && form.query.trim() && form.mc_version.trim();

  function start() {
    const id = String(nextId.current++);
    dispatch({ type: "started", id, target: form.mc_version.trim() });
    transport.send(request(id, { ...form, query: form.query.trim(), mc_version: form.mc_version.trim() }));
  }

  function reply(value: unknown) {
    if (!state.question) return;
    transport.send(answer(state.question.qid, value));
    dispatch({ type: "answered", value });
  }

  return (
    <>
      <header className="strip">
        <h1>Modkeel</h1>
        {state.engine && <span className="pill">engine {state.engine.version}</span>}
      </header>
      <main className="panel">
        <section className="card">
          <div className="title">Get a mod</div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (canStart) start();
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
              <Select
                name="loader"
                value={form.loader}
                options={LOADERS}
                onChange={(loader) => setForm({ ...form, loader })}
              />
            </div>
            <button className="primary" type="submit" disabled={!canStart}>
              {busy ? "Working..." : "Get it"}
            </button>
          </form>
          {state.phase === "connecting" && <p className="detail">Starting the engine...</p>}
        </section>

        {state.requestId && <Progress state={state} />}
        {state.question && <Question payload={state.question.payload} onAnswer={reply} />}
        {state.result && <Result state={state} />}
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

function Question({ payload, onAnswer }: { payload: QuestionPayload; onAnswer: (v: unknown) => void }) {
  const [token, setToken] = useState("");
  if (payload.kind === "change_target") {
    const there = payload.option.mc_version;
    return (
      <section className="card warn" data-testid="question">
        <div className="title">
          MC {there} <span className="pill">nearest that works</span>
        </div>
        <p className="detail act">{payload.option.summary}.</p>
        <p className="detail">Files go to their own folder, never into your game.</p>
        <div className="row">
          <button className="primary" onClick={() => onAnswer(true)}>
            Get it for MC {there}
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
          <li key={f}>{f}</li>
        ))}
      </ul>
    </section>
  );
}
