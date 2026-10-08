// The "Move a pack" state from a real engine session (recorded from `serve --stdio`: a
// 1.21.1 Fabric pack of 8 JARs moved to 1.21.10; one JAR identified by name, one private
// JAR reused because it passes on 1.21.10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ServerMessage, State, answered, initialState, reduce, request, started } from "./protocol";

type Line = { from: "server" | "client"; message: Record<string, unknown> };

const session: Line[] = readFileSync(new URL("./__fixtures__/port-pack.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l: string) => JSON.parse(l));

function replay(until?: (s: State) => boolean): State {
  let state = initialState;
  for (const { from, message } of session) {
    if (from === "server") state = reduce(state, message as unknown as ServerMessage);
    else if (message.type === "request") state = started(state, String(message.id), "1.21.10", "port");
    else if (message.type === "answer") state = answered(state, message.value);
    if (until?.(state)) return state;
  }
  return state;
}

describe("a recorded port", () => {
  it("lists every JAR as soon as the folder is read, all waiting", () => {
    const state = replay((s) => s.pack !== null);
    expect(state.pack).toHaveLength(8);
    expect(state.pack!.every((r) => r.status === "waiting")).toBe(true);
    const by = Object.fromEntries(state.pack!.map((r) => [r.file, r.identifiedBy]));
    expect(by["cloth-config-repacked.jar"]).toBe("name");
    expect(by["private-menu-2.0.jar"]).toBeNull();
    expect(Object.values(by).filter((v) => v === "hash")).toHaveLength(6);
  });

  it("marks each mod as the engine resolves it", () => {
    const state = replay((s) => (s.pack ?? []).filter((r) => r.status !== "waiting").length === 3);
    expect(state.pack!.filter((r) => r.status === "delivered")).toHaveLength(3);
    expect(state.phase).toBe("running");
  });

  it("ends with every row's final status, the private JAR reused", () => {
    const state = replay();
    expect(state.phase).toBe("done");
    expect(state.portResult).toMatchObject({ ready: 8, target: "1.21.10", loader: "fabric" });
    const status = Object.fromEntries(state.pack!.map((r) => [r.file, r.status]));
    expect(status["private-menu-2.0.jar"]).toBe("reused");
    expect(Object.values(status).filter((s) => s === "delivered")).toHaveLength(7);
    expect(state.result).toBeNull(); // a port result never lands in the get result
  });
});

describe("rules", () => {
  it("builds a port request", () => {
    expect(request("2", { mods_dir: "/m", mc_version: "1.21.10" }, "port")).toEqual({
      type: "request",
      id: "2",
      method: "port",
      params: { mods_dir: "/m", mc_version: "1.21.10" },
    });
  });

  it("an accepted version change puts every row back to waiting", () => {
    let state = started(initialState, "1", "1.21.10", "port");
    state = { ...state, pack: [{ file: "a.jar", name: "A", slug: "a", identifiedBy: "hash", status: "missing", detail: "x" }] };
    state = {
      ...state,
      question: {
        qid: "1.1",
        payload: { kind: "change_target", current: "1.21.10", scope: "pack",
                   option: { mc_version: "1.21.1", covered: ["A"], missing: [], older: [], summary: "s" } },
      },
    };
    const after = answered(state, true);
    expect(after.target).toBe("1.21.1");
    expect(after.pack![0]).toMatchObject({ status: "waiting", detail: "" });
  });
});
