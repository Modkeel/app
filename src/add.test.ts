// The Add a mod screen's pure parts: hit labels, counts, and the add result in state.

import { describe, expect, it } from "vitest";
import { AddResult, compactCount, hitStatusLabel, initialState, loaderLabel, reduce, started } from "./protocol";

describe("search hits", () => {
  it("reads downloads the way the stores print them", () => {
    expect(compactCount(7242602)).toBe("7.2M");
    expect(compactCount(41_000_000)).toBe("41M");
    expect(compactCount(999_999)).toBe("1M");
    expect(compactCount(12_400)).toBe("12k");
    expect(compactCount(512)).toBe("512");
  });

  it("says what Add does for each status", () => {
    expect(hitStatusLabel("official", "fabric")).toBe("Official build");
    expect(hitStatusLabel("other_versions", "fabric")).toMatch(/looks for one/);
    expect(hitStatusLabel("other_loader", "neoforge")).toBe("Not made for NeoForge");
    expect(loaderLabel("quilt")).toBe("Quilt");
  });
});

describe("an add", () => {
  const record = {
    id: "r1",
    time: 1,
    mods_dir: "/i/mods",
    mod: "Voxy",
    mc_version: "1.21.11",
    loader: "fabric",
    added: [{ name: "voxy-1.0.jar", sha1: "a" }],
    replaced: [],
    skipped: [],
    undone: false,
  };

  it("keeps the add result and its get result", () => {
    const get = {
      mod: "Voxy",
      identified: true,
      target: "1.21.11",
      output_dir: "/staging",
      retargeted: false,
      delivered: null,
      proposal: null,
    };
    const result: AddResult = { installed: true, reason: "", record, get };
    const state = reduce(started(initialState, "3", "1.21.11", "add"), {
      type: "result",
      id: "3",
      result,
    } as never);
    expect(state.phase).toBe("done");
    expect(state.addResult).toEqual(result);
    expect(state.result).toEqual(get);
  });

  it("a new run forgets the last add", () => {
    const done = { ...initialState, addResult: { installed: false, reason: "x", record: null, get: null } };
    expect(started(done, "4", "1.21.11", "get").addResult).toBeNull();
  });
});
