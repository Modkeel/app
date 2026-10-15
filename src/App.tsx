// The app's screen: the player's instances first, one engine.
//
//   Instances     the launcher instances (query `instances`); each one: Add a mod (method
//                 `search`, then `add` into its mods folder, with undo) or Move it
//   Get a mod     one mod for a Minecraft version into a folder (method `get`)
//   Move a pack   a mods folder moved to another Minecraft version (method `move`)
//   History       what Modkeel added to which instance (query `history`), each with Undo
//
// All state comes from protocol.reduce; this file only renders it and turns clicks into
// protocol messages. Questions (token, version change) are the same cards for both jobs.

import { useEffect, useReducer, useRef, useState } from "react";
import {
  AddParams,
  AddResult,
  BuildsCheck,
  GetParams,
  InstallRecord,
  InstanceInfo,
  LAUNCHER_LABELS,
  Method,
  MissingBuild,
  PackRow,
  MoveParams,
  SIGN_IN_ANSWER,
  SignInParams,
  QuestionPayload,
  SearchHit,
  SearchResult,
  ServerMessage,
  State,
  answer,
  answered,
  buildsLookup,
  compactCount,
  hitStatusLabel,
  initialState,
  instanceSummary,
  loaderLabel,
  query,
  reduce,
  request,
  started,
  shortDetail,
  strategyLabel,
  UndoResult,
} from "./protocol";
import logo from "./assets/logo.png";
import Select from "./components/Select";
import { Transport, defaultTransport } from "./transport";
import { AvailableUpdate, checkUpdate } from "./updater";

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

// The ids of the queries: requests count from 1, so they never meet a run's id.
const INSTANCES_QUERY = "instances";
const GITHUB_QUERY = "github"; // is a GitHub token saved? (else: offer "Sign in with GitHub")
const HISTORY_QUERY = "history";
// search and undo are quick requests beside the run on screen: their own id prefixes
const SEARCH_ID = "search-";
const BUILDS_ID = "builds:"; // + the instance's mods folder
const UNDO_ID = "undo-";

type Tab = "instances" | "get" | "move" | "history";
const TABS: Array<[Tab, string]> = [
  ["instances", "Instances"],
  ["get", "Get a mod"],
  ["move", "Move a pack"],
  ["history", "History"],
];

interface Search {
  query: string;
  id: string | null; // the search being answered; older replies are dropped
  hits: SearchHit[] | null;
  reason: string;
}

const NO_SEARCH: Search = { query: "", id: null, hits: null, reason: "" };

// For a pack the loader is read from its JARs unless the player picks one.
const PACK_LOADERS = [{ value: "", label: "From the mods" }, ...LOADERS];

export default function App({ transport: given }: { transport?: Transport }) {
  // One transport (one engine) for the app's life: created once, never per render.
  const [transport] = useState<Transport>(() => given ?? defaultTransport());
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [tab, setTab] = useState<Tab>("instances");
  const [addFor, setAddFor] = useState<InstanceInfo | null>(null); // the instance a mod goes into
  const [search, setSearch] = useState<Search>(NO_SEARCH);
  const searchRef = useRef<string | null>(null);
  const [history, setHistory] = useState<InstallRecord[]>([]);
  const [undos, setUndos] = useState<Record<string, UndoResult | "running">>({});
  const undoFor = useRef<Record<string, string>>({}); // undo request id -> record id
  const [addSeen, setAddSeen] = useState<string | null>(null); // the add whose result was put away
  const [getForm, setGetForm] = useState<GetParams>({ query: "", mc_version: "", loader: "fabric" });
  const [moveForm, setMoveForm] = useState<MoveParams>({ mods_dir: "", mc_version: "", loader: "" });
  const nextId = useRef(1);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [builds, setBuilds] = useState<Record<string, BuildsCheck>>({}); // by mods folder
  const buildsAsked = useRef<Record<string, string>>({}); // mods folder -> what was asked
  const [signedIn, setSignedIn] = useState<boolean | null>(null); // null: not known yet
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  // a newer release of the app, asked once at start (null in builds without the updater)
  useEffect(() => {
    checkUpdate().then(setUpdate, () => setUpdate(null));
  }, []);

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
          if ("id" in message && message.id === GITHUB_QUERY) {
            if (message.type === "result") setSignedIn(Boolean((message.result as { signed_in?: boolean }).signed_in));
            return;
          }
          if ("id" in message && message.id === HISTORY_QUERY) {
            if (message.type === "result") setHistory((message.result as unknown as { history: InstallRecord[] }).history);
            return;
          }
          if ("id" in message && message.id?.startsWith(BUILDS_ID)) {
            // a failed lookup shows nothing: the count is a hint, never a blocker
            if (message.type === "result") {
              const dir = message.id.slice(BUILDS_ID.length);
              setBuilds((b) => ({ ...b, [dir]: message.result as unknown as BuildsCheck }));
            }
            return;
          }
          if ("id" in message && message.id?.startsWith(SEARCH_ID)) {
            if (message.id !== searchRef.current || (message.type !== "result" && message.type !== "error")) return;
            const found =
              message.type === "result"
                ? (message.result as unknown as SearchResult)
                : { hits: [], reason: message.error.message };
            setSearch((s) => ({ ...s, id: null, hits: found.hits, reason: found.reason }));
            return;
          }
          if ("id" in message && message.id?.startsWith(UNDO_ID)) {
            if (message.type !== "result" && message.type !== "error") return;
            const record = undoFor.current[message.id];
            const done: UndoResult =
              message.type === "result"
                ? (message.result as unknown as UndoResult)
                : { undone: false, removed: [], restored: [], kept: [], reason: message.error.message };
            setUndos((u) => ({ ...u, [record]: done }));
            transport.send(query(HISTORY_QUERY, "history"));
            transport.send(query(INSTANCES_QUERY, "instances"));
            return;
          }
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

  // each instance's mods without a build for its version: asked again only when its version,
  // loader or mod count changed (an add, an undo, the player's own changes)
  useEffect(() => {
    if (!engineMethods?.includes("builds")) return;
    for (const i of instances) {
      if (!i.mc_version || !i.loader || i.mods === 0) continue;
      const asked = `${i.mc_version}|${i.loader}|${i.mods}`;
      if (buildsAsked.current[i.mods_dir] === asked) continue;
      buildsAsked.current[i.mods_dir] = asked;
      transport.send(buildsLookup(BUILDS_ID + i.mods_dir, i));
    }
  }, [engineMethods, instances, transport]);

  // whether GitHub is signed in: at hello, and after each run (a run may have signed in)
  const finished = state.phase === "done" || state.phase === "failed";
  useEffect(() => {
    if (engineMethods?.includes("github")) transport.send(query(GITHUB_QUERY, "github"));
  }, [engineMethods, finished, transport]);

  // the history, and the instances' mod counts, change after each add
  useEffect(() => {
    if (engineMethods?.includes("history")) transport.send(query(HISTORY_QUERY, "history"));
    if (finished && state.method === "add" && engineMethods?.includes("instances"))
      transport.send(query(INSTANCES_QUERY, "instances"));
  }, [engineMethods, finished, state.method, transport]);

  const busy = state.phase === "running" || state.phase === "asking";
  const ready = !busy && state.engine !== null;

  function start(method: Method, target: string, params: GetParams | MoveParams | SignInParams | AddParams) {
    const id = String(nextId.current++);
    dispatch({ type: "started", id, target, method });
    // get and move write to a folder of their own; add writes into the instance
    const toFolder = outputDir && (method === "get" || method === "move");
    transport.send(request(id, toFolder ? { ...params, output_dir: outputDir } : params, method));
  }

  function find(text: string) {
    if (!addFor?.mc_version || !addFor.loader || busy) return;
    const id = SEARCH_ID + nextId.current++;
    searchRef.current = id;
    setSearch({ query: text, id, hits: null, reason: "" });
    transport.send(request(id, { query: text, mc_version: addFor.mc_version, loader: addFor.loader }, "search"));
  }

  function add(hit: SearchHit) {
    if (!addFor?.mc_version || !addFor.loader) return;
    const params: AddParams = {
      project_id: hit.project_id,
      title: hit.title,
      mods_dir: addFor.mods_dir,
      mc_version: addFor.mc_version,
      loader: addFor.loader,
    };
    if (addFor.loader_version) params.loader_version = addFor.loader_version;
    start("add", addFor.mc_version, params);
  }

  function undo(recordId: string) {
    const id = UNDO_ID + nextId.current++;
    undoFor.current[id] = recordId;
    setUndos((u) => ({ ...u, [recordId]: "running" }));
    transport.send(request(id, { id: recordId }, "undo"));
  }

  function openAdd(instance: InstanceInfo | null) {
    setAddFor(instance);
    setSearch(NO_SEARCH);
    searchRef.current = null;
  }

  function reply(value: unknown) {
    if (!state.question) return;
    transport.send(answer(state.question.qid, value));
    dispatch({ type: "answered", value });
  }

  // the run on screen belongs to the tab that started it (an add: the instances tab)
  const showing = state.requestId !== null && (state.method === "add" ? tab === "instances" : state.method === tab);
  // an add on screen until the player goes back to the search (its hits hide meanwhile)
  const adding = showing && state.method === "add" && state.requestId !== addSeen;

  return (
    <>
      <header className="strip">
        <img className="logo" src={logo} alt="" width={32} height={32} />
        <h1>Modkeel</h1>
        {state.engine && <span className="pill">engine {state.engine.version}</span>}
        <span className="spacer" />
        {signedIn === true && <span className="pill" title="A GitHub token is saved: forks can be searched">GitHub ✓</span>}
        {signedIn === false && engineMethods?.includes("sign_in") && (
          <button disabled={!ready} onClick={() => start("sign_in", "", { open_browser: true })}>
            Sign in with GitHub
          </button>
        )}
      </header>
      <main className="panel">
        {update && <UpdateCard update={update} busy={busy} />}
        <nav className="tabs" role="tablist">
          {TABS.map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={tab === m}
              className={tab === m ? "tab active" : "tab"}
              onClick={() => setTab(m)}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "instances" && !addFor && (
          <InstanceList
            instances={instances}
            builds={builds}
            onOpen={(url) => transport.openUrl(url).catch(() => undefined)}
            canAdd={Boolean(engineMethods?.includes("add"))}
            onAdd={openAdd}
            onMove={(i) => {
              setMoveForm({ ...moveForm, mods_dir: i.mods_dir, loader: i.loader ?? "" });
              setTab("move");
            }}
          />
        )}
        {tab === "instances" && addFor && (
          <AddScreen
            instance={addFor}
            search={search}
            hideHits={adding}
            ready={ready}
            busy={busy}
            onSearch={find}
            onAdd={add}
            onOpen={(url) => transport.openUrl(url).catch(() => undefined)}
            onBack={() => openAdd(null)}
          />
        )}
        {tab === "history" && <HistoryList records={history} undos={undos} busy={busy} onUndo={undo} />}
        {tab === "get" && <GetForm form={getForm} setForm={setGetForm} ready={ready} busy={busy} onStart={start} />}
        {tab === "move" && (
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

        {showing && (state.method === "get" || (adding && !state.addResult)) && <Progress state={state} />}
        {showing && state.method === "move" && state.pack && <PackList state={state} />}
        {showing && state.question && <Question payload={state.question.payload} onAnswer={reply} />}
        {state.githubCode && busy && <GitHubCode code={state.githubCode} />}
        {state.method === "sign_in" && state.signIn && <SignInDone result={state.signIn} />}
        {showing && state.result && !adding && <Result state={state} />}
        {adding && state.addResult && addFor && (
          <AddDone
            result={state.addResult}
            instance={addFor}
            undo={state.addResult.record ? undos[state.addResult.record.id] : undefined}
            busy={busy}
            onUndo={undo}
            onAgain={() => setAddSeen(state.requestId)}
          />
        )}
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

/** A newer app release: install it and restart, never while a run is going (it would stop). */
function UpdateCard({ update, busy }: { update: AvailableUpdate; busy: boolean }) {
  const [progress, setProgress] = useState<number | null | undefined>(undefined); // undefined: not started
  const [failed, setFailed] = useState<string | null>(null);
  const installing = progress !== undefined && failed === null;

  function install() {
    setFailed(null);
    setProgress(null);
    update.install(setProgress).catch((e: Error) => setFailed(e.message ?? String(e)));
  }

  return (
    <section className="card ok">
      <div className="title">
        Modkeel {update.version} is out <span className="pill">update</span>
      </div>
      {update.notes && <p className="detail">{update.notes}</p>}
      {failed && <p className="detail">Update failed: {failed}</p>}
      <button disabled={busy || installing} onClick={install}>
        {installing
          ? progress === null ? "Downloading..." : `Downloading ${Math.round(progress * 100)}%`
          : busy ? "Update after this run" : "Update and restart"}
      </button>
    </section>
  );
}

type StartFn = (method: Method, target: string, params: GetParams | MoveParams) => void;

/** Home: the player's instances, each with what Modkeel can do with it. */
/** The launcher's picture, or the name's initial on a tint of its own. */
function InstanceIcon({ instance }: { instance: InstanceInfo }) {
  if (instance.icon) return <img className="icon" src={instance.icon} alt="" width={48} height={48} />;
  let hue = 0;
  for (const c of instance.name) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="icon initial" style={{ background: `hsl(${hue} 35% 38%)` }} aria-hidden="true">
      {instance.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function InstanceList(props: {
  instances: InstanceInfo[];
  builds: Record<string, BuildsCheck>;
  onOpen: (url: string) => void;
  canAdd: boolean;
  onAdd: (i: InstanceInfo) => void;
  onMove: (i: InstanceInfo) => void;
}) {
  const { instances, builds, onOpen, canAdd, onAdd, onMove } = props;
  if (instances.length === 0) {
    return (
      <section className="card">
        <div className="title">No instances found</div>
        <p className="detail">
          Modkeel reads Prism, PolyMC, Modrinth App, CurseForge, ATLauncher, GDLauncher, FTB App, SKlauncher and the
          Minecraft Launcher. Get a mod and Move a pack also take a folder.
        </p>
      </section>
    );
  }
  return (
    <>
      {instances.map((i) => {
        // without its version and loader there is nothing to search builds for
        const known = Boolean(i.mc_version && i.loader);
        const missing = builds[i.mods_dir]?.missing ?? [];
        return (
          <section className={`card instance${missing.length ? " warn" : ""}`} key={i.mods_dir} data-testid="instance">
            <div className="instance-head">
              <InstanceIcon instance={i} />
              <div className="instance-text">
                <div className="title">{i.name}</div>
                <div className="pills">
                  {i.mc_version && <span className="pill">{i.mc_version}</span>}
                  {i.loader && <span className="pill">{loaderLabel(i.loader)}</span>}
                  <span className="pill">
                    {i.mods} mod{i.mods === 1 ? "" : "s"}
                  </span>
                  <span className="pill">{LAUNCHER_LABELS[i.launcher]}</span>
                </div>
              </div>
            </div>
            {missing.length > 0 && <MissingBuilds instance={i} missing={missing} onOpen={onOpen} />}
            <div className="row">
              {canAdd && (
                <button
                  className="primary"
                  disabled={!known}
                  title={known ? undefined : "Its Minecraft version or loader is unknown"}
                  onClick={() => onAdd(i)}
                >
                  Add a mod
                </button>
              )}
              <button onClick={() => onMove(i)}>Move</button>
            </div>
          </section>
        );
      })}
    </>
  );
}

/** The instance's mods whose project has no build for its version and loader, opened on demand. */
function MissingBuilds(props: { instance: InstanceInfo; missing: MissingBuild[]; onOpen: (url: string) => void }) {
  const { instance, missing, onOpen } = props;
  const n = missing.length;
  return (
    <details className="missing" data-testid="missing-builds">
      <summary className="detail act">
        {n} mod{n === 1 ? " has" : "s have"} no {instance.mc_version} {loaderLabel(instance.loader ?? "")} build on
        Modrinth
      </summary>
      <p className="detail">
        The instance runs an older build or one for another loader. It may work; if the game crashes, these come
        first.
      </p>
      <ul>
        {missing.map((m) => (
          <li key={m.file}>
            {m.slug ? (
              <button className="link" title={m.file} onClick={() => onOpen(`https://modrinth.com/mod/${m.slug}`)}>
                {m.title}
              </button>
            ) : (
              <span title={m.file}>{m.title}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Search Modrinth for the instance's version and loader; the player picks one hit. */
function AddScreen(props: {
  instance: InstanceInfo;
  search: Search;
  ready: boolean;
  busy: boolean;
  onSearch: (query: string) => void;
  onAdd: (hit: SearchHit) => void;
  onOpen: (url: string) => void;
  onBack: () => void;
  hideHits: boolean;
}) {
  const { instance, search, ready, busy, onSearch, onAdd, onOpen, onBack, hideHits } = props;
  const [text, setText] = useState(search.query);
  const loader = instance.loader ?? "";
  return (
    <>
      <section className="card">
        <div className="title">
          Add to {instance.name}
          <span className="pill">{instance.mc_version}</span>
          <span className="pill">{loaderLabel(loader)}</span>
          <span className="spacer" />
          <button disabled={busy} onClick={onBack}>
            Back
          </button>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onSearch(text.trim());
          }}
        >
          <input
            className="grow"
            name="search"
            placeholder="Sodium, Voxy, JEI..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={!ready || !text.trim()}>
            {search.id ? "Searching..." : "Search"}
          </button>
        </form>
      </section>
      {search.reason && (
        <section className="card bad">
          <div className="title">Search failed</div>
          <p className="detail">{search.reason}</p>
        </section>
      )}
      {search.hits?.length === 0 && !search.reason && (
        <section className="card">
          <p className="detail">Nothing on Modrinth for &ldquo;{search.query}&rdquo;.</p>
        </section>
      )}
      {search.hits && search.hits.length > 0 && !hideHits && (
        <section className="card hits" data-testid="hits">
          {search.hits.map((h) => (
            <div className="hit" key={h.project_id}>
              {h.icon_url ? (
                <img className="icon" src={h.icon_url} alt="" width={40} height={40} loading="lazy" />
              ) : (
                <span className="icon" />
              )}
              <div className="hit-text">
                <div className="hit-title">
                  <strong>{h.title}</strong>
                  <span className="by">
                    by {h.author} · {compactCount(h.downloads)} downloads
                  </span>
                </div>
                <div className={`status ${h.status}`}>{hitStatusLabel(h.status, loader)}</div>
                {h.description && <div className="hit-desc">{h.description}</div>}
              </div>
              <div className="hit-actions">
                <button title={h.page_url} onClick={() => onOpen(h.page_url)}>
                  View page
                </button>
                <button
                  className={h.status === "official" ? "primary" : ""}
                  disabled={busy || !ready}
                  onClick={() => onAdd(h)}
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/** An add's outcome: what went into the instance, how far it was checked, and Undo. */
function AddDone(props: {
  result: AddResult;
  instance: InstanceInfo;
  undo: UndoResult | "running" | undefined;
  busy: boolean;
  onUndo: (recordId: string) => void;
  onAgain: () => void;
}) {
  const { result, instance, undo, busy, onUndo, onAgain } = props;
  const again = (
    <button disabled={busy} onClick={onAgain}>
      Back to the search
    </button>
  );
  const record = result.record;
  const d = result.get?.delivered ?? null;
  if (!result.installed) {
    return (
      <section className={`card ${record ? "warn" : "bad"}`} data-testid="result">
        <div className="title">Nothing added to {instance.name}</div>
        <p className="detail act">{result.reason}.</p>
        {result.get?.proposal && <p className="detail">{result.get.proposal.summary}.</p>}
        {record && <UndoLine record={record} undo={undo} busy={busy} onUndo={onUndo} />}
        <div className="row">{again}</div>
      </section>
    );
  }
  const main = d ? fileName(d.jar_path) : null;
  const also = record?.added.filter((a) => a.name !== main) ?? [];
  return (
    <section className="card ok" data-testid="result">
      <div className="title">
        {d?.mod_name ?? record?.mod} is in {instance.name}
        {d && <span className="pill">{d.mod_version}</span>}
        {d && <span className="pill">{d.verb}</span>}
      </div>
      {d?.caveat && <p className="detail act">{d.caveat}</p>}
      {record && record.added.length === 0 && <p className="detail">It was already there: nothing to add.</p>}
      {also.length > 0 && (
        <>
          <p className="detail">Also added, it needs them:</p>
          <ul className="steps mono">
            {also.map((a) => (
              <li key={a.name}>{a.name}</li>
            ))}
          </ul>
        </>
      )}
      {record && record.replaced.length > 0 && (
        <p className="detail">Replaced {record.replaced.join(", ")} (kept: Undo puts it back).</p>
      )}
      {record && record.skipped.length > 0 && <p className="detail">Already in the pack: {record.skipped.join(", ")}.</p>}
      {record && record.added.length > 0 && <UndoLine record={record} undo={undo} busy={busy} onUndo={onUndo} />}
      <div className="row">{again}</div>
    </section>
  );
}

function UndoLine(props: {
  record: InstallRecord;
  undo: UndoResult | "running" | undefined;
  busy: boolean;
  onUndo: (recordId: string) => void;
}) {
  const { record, undo, busy, onUndo } = props;
  if (undo && undo !== "running") {
    if (!undo.undone) return <p className="detail act">Undo failed: {undo.reason}.</p>;
    return (
      <p className="detail" data-testid="undone">
        Undone: removed {undo.removed.length ? undo.removed.join(", ") : "nothing"}
        {undo.restored.length > 0 && <>; put back {undo.restored.join(", ")}</>}
        {undo.kept.length > 0 && <>; left {undo.kept.join(", ")} (changed since)</>}.
      </p>
    );
  }
  if (record.undone) return <p className="detail">Undone.</p>;
  return (
    <div className="row">
      <button disabled={busy || undo === "running"} onClick={() => onUndo(record.id)}>
        {undo === "running" ? "Undoing..." : "Undo"}
      </button>
    </div>
  );
}

function when(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Every add, newest first: what went where, and Undo for the ones still in place. */
function HistoryList(props: {
  records: InstallRecord[];
  undos: Record<string, UndoResult | "running">;
  busy: boolean;
  onUndo: (recordId: string) => void;
}) {
  const { records, undos, busy, onUndo } = props;
  if (records.length === 0) {
    return (
      <section className="card">
        <div className="title">Nothing added yet</div>
        <p className="detail">Mods added to an instance show here, each with Undo.</p>
      </section>
    );
  }
  return (
    <>
      {records.map((r) => (
        <section className={r.undone ? "card" : "card ok"} key={r.id} data-testid="history">
          <div className="title">
            {r.mod}
            <span className="pill">{r.mc_version}</span>
            <span className="pill">{loaderLabel(r.loader)}</span>
            {r.undone && <span className="pill">undone</span>}
          </div>
          <p className="detail">
            {when(r.time)} · <span className="mono">{r.mods_dir}</span>
          </p>
          <p className="detail">
            Added {r.added.length ? r.added.map((a) => a.name).join(", ") : "nothing"}
            {r.replaced.length > 0 && <>; replaced {r.replaced.join(", ")}</>}
          </p>
          {r.added.length > 0 && <UndoLine record={r} undo={undos[r.id]} busy={busy} onUndo={onUndo} />}
        </section>
      ))}
    </>
  );
}


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
  // only Prism instances can be created beside the old one for now (modkeel/newinstance.py)
  const canAdd = picked?.launcher === "prism";
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
      {canAdd && (
        <label className="check">
          <input
            type="checkbox"
            name="new_instance"
            checked={form.new_instance !== false}
            onChange={(e) => setForm({ ...form, new_instance: e.target.checked })}
          />
          Add it to {LAUNCHER_LABELS.prism} as a new instance, next to this one
        </label>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!can) return;
          const params: MoveParams = { mods_dir: form.mods_dir.trim(), mc_version: form.mc_version.trim() };
          if (form.loader) params.loader = form.loader;
          if (canAdd && form.new_instance !== false) params.new_instance = true;
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
      {r?.instance && (
        <p className="detail" data-testid="new-instance">
          Added to {LAUNCHER_LABELS[r.instance.launcher] ?? r.instance.launcher}:{" "}
          <strong>{r.instance.name}</strong>
        </p>
      )}
      {r && !r.instance && r.instance_note && <p className="detail">No new instance: {r.instance_note}.</p>}
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
        <button disabled={!token} onClick={() => onAnswer(token)}>
          Use this token
        </button>
      </div>
      <div className="row">
        <button className="primary" onClick={() => onAnswer(SIGN_IN_ANSWER)}>
          Sign in with GitHub
        </button>
        <button onClick={() => onAnswer(null)}>Skip forks</button>
      </div>
    </section>
  );
}

/** While signing in: the code to type on GitHub's page (the engine opened it). */
function GitHubCode({ code }: { code: { code: string; url: string; expiresIn: number } }) {
  return (
    <section className="card warn" data-testid="github-code">
      <div className="title">
        Sign in with GitHub <span className="pill">{Math.max(1, Math.ceil(code.expiresIn / 60))} min</span>
      </div>
      <p className="detail act">
        Enter this code on <span className="mono">{code.url}</span> (it opened in your browser):
      </p>
      <div className="row">
        <span className="code mono">{code.code}</span>
        <button onClick={() => navigator.clipboard?.writeText(code.code).catch(() => undefined)}>Copy</button>
      </div>
      <p className="detail">Modkeel only reads public data with it; the token stays on this computer.</p>
    </section>
  );
}

function SignInDone({ result }: { result: { signed_in: boolean; user: string | null; reason: string } }) {
  return result.signed_in ? (
    <section className="card ok" data-testid="signed-in">
      <div className="title">Signed in with GitHub{result.user ? ` as ${result.user}` : ""}</div>
      <p className="detail">Forks can be searched now, under your own GitHub limit.</p>
    </section>
  ) : (
    <section className="card bad" data-testid="signed-in">
      <div className="title">Not signed in</div>
      <p className="detail">{result.reason}</p>
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
