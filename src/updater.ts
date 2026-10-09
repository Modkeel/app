// Updates of the desktop app (Tauri's updater plugin): at start the app asks the latest
// release of Modkeel/app for latest.json and, when it names a newer version, offers it. The
// update is signed with the app's updater key (not an OS signature): the plugin refuses a
// download whose signature does not match the public key built into the app.
//
// Builds without an updater key (work branches, a self-built copy) have no updater plugin:
// checkUpdate() then answers null and the app simply never offers updates. So does a browser
// on the dev bridge.

export interface AvailableUpdate {
  version: string;
  notes: string;
  /** Download, install and restart into the new version. Progress: 0..1, or null if unknown. */
  install(onProgress: (fraction: number | null) => void): Promise<void>;
}

export async function checkUpdate(): Promise<AvailableUpdate | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? "",
      async install(onProgress) {
        let total = 0;
        let done = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") total = event.data.contentLength ?? 0;
          if (event.event === "Progress") {
            done += event.data.chunkLength;
            onProgress(total > 0 ? Math.min(1, done / total) : null);
          }
        });
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch {
    // no updater in this build, offline, or no release yet: nothing to offer
    return null;
  }
}
