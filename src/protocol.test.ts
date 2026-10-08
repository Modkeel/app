// The screen's state from a real engine session (recorded from `modkeel serve --stdio`:
// get Accessories for 1.21.11, no token, the 1.21.10 proposal accepted).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ServerMessage,
  State,
  answered,
  shortDetail,
  initialState,
  reduce,
  request,
  started,
  strategyLabel,
} from "./protocol";

type Line = { from: "server" | "client"; message: Record<string, unknown> };

const session: Line[] = readFileSync(new URL("./__fixtures__/get-accessories.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l: string) => JSON.parse(l));

/** Replay the session as the app lives it: server messages reduced, client answers applied. */
function replay(until?: (s: State) => boolean): State {
  let state = initialState;
  for (const { from, message } of session) {
    if (from === "server") state = reduce(state, message as unknown as ServerMessage);
    else if (message.type === "request") state = started(state, String(message.id), "1.21.11");
    else if (message.type === "answer") state = answered(state, message.value);
    if (until?.(state)) return state;
  }
  return state;
}

describe("a recorded get", () => {
  it("starts ready once the engine says hello", () => {
    const state = reduce(initialState, session[0].message as unknown as ServerMessage);
    expect(state.phase).toBe("ready");
    expect(state.engine?.methods).toEqual(["get"]);
  });

  it("asks for a token, then for the version change, and stops while it waits", () => {
    const first = replay((s) => s.phase === "asking");
    expect(first.question?.payload.kind).toBe("need_token");
    expect(first.activity).toBeNull();
    expect(first.mod).toMatchObject({ title: "Accessories", slug: "accessories", identified: true });
    expect(first.steps.map((s) => s.strategy)).toEqual([
      "official",
      "older_official",
      "older_official",
      "older_official",
    ]);

    let asked = 0;
    const second = replay((s) => s.phase === "asking" && ++asked === 2);
    expect(second.question?.payload).toMatchObject({
      kind: "change_target",
      current: "1.21.11",
      option: { mc_version: "1.21.10", summary: "MC 1.21.10 has an official build of Accessories" },
    });
  });

  it("ends with the JAR for the proposed version and every file it wrote", () => {
    const state = replay();
    expect(state.phase).toBe("done");
    expect(state.result).toMatchObject({ retargeted: true, target: "1.21.10" });
    expect(state.result?.delivered?.mod_version).toBe("1.4.3-beta");
    expect(state.files).toEqual([
      "out/mc-1.21.10/accessories-fabric-1.4.3-beta+1.21.10.jar",
      "out/mc-1.21.10/owo-lib-0.12.24+1.21.9.jar",
      "out/mc-1.21.10/fabric-api-0.138.4+1.21.10.jar",
    ]);
    // steps after the accepted change belong to the new version
    expect(state.steps.at(-1)).toMatchObject({ target: "1.21.10", strategy: "official", ok: true });
    expect(state.steps[0].target).toBe("1.21.11");
  });
});

describe("rules", () => {
  it("refuses an engine that speaks another protocol", () => {
    const state = reduce(initialState, { type: "hello", protocol: 2, modkeel: "9", methods: [] });
    expect(state.phase).toBe("failed");
    expect(state.error?.code).toBe("protocol");
  });

  it("ignores messages of another request", () => {
    const running = started(initialState, "2", "1.21.10");
    const state = reduce(running, { type: "result", id: "1", result: {} as never });
    expect(state).toBe(running);
  });

  it("an error for this request or about a bad line stops the run", () => {
    const running = started(initialState, "2", "1.21.10");
    for (const id of ["2", undefined]) {
      const state = reduce(running, { type: "error", id, error: { code: "busy", message: "x" } });
      expect(state.phase).toBe("failed");
    }
  });

  it("builds requests the engine accepts and labels steps like the CLI", () => {
    expect(request("1", { query: "Sodium", mc_version: "1.21.10", loader: "fabric" })).toEqual({
      type: "request",
      id: "1",
      method: "get",
      params: { query: "Sodium", mc_version: "1.21.10", loader: "fabric" },
    });
    expect(strategyLabel("older_official")).toBe("Older official build");
    expect(strategyLabel("new_source")).toBe("New source");
  });
});

describe("shortDetail", () => {
  it("drops the evidence lists, nested calls included, and keeps the sentence", () => {
    const detail =
      "1.4.3-beta for MC 1.21.10: 11 Minecraft classes it uses don't exist in 1.21.11 " +
      "(class_1921$class_4687, class_1921$class_4688, ...); 15 methods/fields it calls were " +
      "removed or renamed after 1.21.10 (class_11231.method_70900(), class_1297.method_32318(), ...)";
    expect(shortDetail(detail)).toBe(
      "1.4.3-beta for MC 1.21.10: 11 Minecraft classes it uses don't exist in 1.21.11; " +
        "15 methods/fields it calls were removed or renamed after 1.21.10",
    );
  });

  it("keeps short notes and calls, and text without lists", () => {
    expect(shortDetail("Accessories 1.4.3-beta (beta)")).toBe("Accessories 1.4.3-beta (beta)");
    expect(shortDetail("needs a GitHub token: modkeel token --set ghp_YOUR_TOKEN")).toBe(
      "needs a GitHub token: modkeel token --set ghp_YOUR_TOKEN",
    );
    expect(shortDetail("calls Foo.bar(int) at runtime")).toBe("calls Foo.bar(int) at runtime");
  });
});
