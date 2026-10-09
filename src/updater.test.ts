// The app's update check: nothing outside the desktop app or without a release, and an
// offered update downloads with progress, then restarts. The plugins are doubles.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const check = vi.fn();
const relaunch = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

import { checkUpdate } from "./updater";

describe("checkUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    check.mockReset();
    relaunch.mockReset();
  });

  it("offers nothing outside the desktop app", async () => {
    expect(await checkUpdate()).toBeNull();
    vi.stubGlobal("window", {});
    expect(await checkUpdate()).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  describe("in the desktop app", () => {
    beforeEach(() => vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }));

    it("offers nothing when there is no newer release", async () => {
      check.mockResolvedValue(null);
      expect(await checkUpdate()).toBeNull();
    });

    it("offers nothing when the check fails (no updater in this build, offline)", async () => {
      check.mockRejectedValue(new Error("plugin updater not found"));
      expect(await checkUpdate()).toBeNull();
    });

    it("installs with progress, then restarts", async () => {
      const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 200 } });
        onEvent({ event: "Progress", data: { chunkLength: 50 } });
        onEvent({ event: "Progress", data: { chunkLength: 150 } });
        onEvent({ event: "Finished" });
      });
      check.mockResolvedValue({ version: "0.0.3", body: "Faster moves", downloadAndInstall });
      const update = (await checkUpdate())!;
      expect([update.version, update.notes]).toEqual(["0.0.3", "Faster moves"]);
      const seen: Array<number | null> = [];
      await update.install((p) => seen.push(p));
      expect(seen).toEqual([0.25, 1]);
      expect(relaunch).toHaveBeenCalledOnce();
    });

    it("reports unknown progress when the size is not given", async () => {
      check.mockResolvedValue({
        version: "0.0.3", body: null,
        downloadAndInstall: async (onEvent: (e: unknown) => void) => {
          onEvent({ event: "Started", data: {} });
          onEvent({ event: "Progress", data: { chunkLength: 10 } });
        },
      });
      const seen: Array<number | null> = [];
      const update = (await checkUpdate())!;
      expect(update.notes).toBe("");
      await update.install((p) => seen.push(p));
      expect(seen).toEqual([null]);
    });
  });
});
