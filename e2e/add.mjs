// End-to-end: Add a mod into an instance, then undo it. A Prism instance (Fabric 1.21.11,
// empty mods folder) is made in a temporary home, the real engine runs behind the dev bridge
// and searches Modrinth for real. Clicks what a player would click: the instance's "Add a
// mod", search "Sodium", Add on the first official hit, Undo; then the History tab.
// Screenshots go to e2e/screenshots/add-*.png.
//
//   npm run build && node e2e/add.mjs          (needs network: Modrinth)

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const shots = fileURLToPath(new URL("./screenshots/", import.meta.url));
mkdirSync(shots, { recursive: true });
const home = mkdtempSync(join(tmpdir(), "modkeel-e2e-add-"));
const appdata = join(home, "AppData", "Roaming");
const instance = join(process.platform === "win32" ? appdata : join(home, ".local", "share"), "PrismLauncher", "instances", "Test pack");
const mods = join(instance, "minecraft", "mods");
mkdirSync(mods, { recursive: true });
writeFileSync(join(instance, "instance.cfg"), "[General]\nname=Test pack\n");
writeFileSync(
  join(instance, "mmc-pack.json"),
  JSON.stringify({
    components: [
      { uid: "net.minecraft", version: "1.21.11" },
      { uid: "net.fabricmc.fabric-loader", version: "0.17.2" },
    ],
  }),
);

const win = process.platform === "win32";
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: appdata,
  LOCALAPPDATA: join(home, "AppData", "Local"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  MODKEEL_HOME: join(home, ".modkeel"),
  MODKEEL_WORKDIR: home,
};
// Python's user site lives under the real APPDATA on Windows: keep it, or modkeel's
// packages vanish with the temporary home
if (win && process.env.APPDATA && !process.env.PYTHONUSERBASE) env.PYTHONUSERBASE = join(process.env.APPDATA, "Python");
if (win && !process.env.MODKEEL_ENGINE) env.MODKEEL_ENGINE = "python -m modkeel.cli serve --stdio";
const bridge = spawn("node", ["scripts/dev-bridge.mjs", "8797"], { env, stdio: "inherit" });
// vite through node itself, not npx: no shell in between, so kill() stops the server
const preview = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4797", "--strictPort"],
  { stdio: "ignore" },
);
const stop = () => {
  bridge.kill();
  preview.kill();
};

try {
  // the preview server takes its time (npx through a shell on Windows): wait until it answers
  for (let i = 0; ; i++) {
    const up = await fetch("http://127.0.0.1:4797/").then(() => true, () => false);
    if (up) break;
    if (i > 60) throw new Error("vite preview did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? (win ? undefined : "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"),
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  await page.goto("http://127.0.0.1:4797/?bridge=8797");
  const card = page.getByTestId("instance").filter({ hasText: "Test pack" });
  await card.waitFor({ timeout: 20000 });
  await page.screenshot({ path: shots + "add-1-instances.png" });

  await card.getByRole("button", { name: "Add a mod" }).click();
  await page.fill("input[name=search]", "Sodium");
  await page.getByRole("button", { name: "Search" }).click();
  const hits = page.getByTestId("hits");
  await hits.waitFor({ timeout: 60000 });
  await page.screenshot({ path: shots + "add-2-search.png" });

  const sodium = hits.locator(".hit").filter({ hasText: "Official build" }).filter({ hasText: /^Sodium/ }).first();
  await sodium.getByRole("button", { name: "Add" }).click();
  const result = page.getByTestId("result");
  await result.waitFor({ timeout: 300000 });
  const text = await result.innerText();
  await page.screenshot({ path: shots + "add-3-done.png", fullPage: true });
  if (!text.includes("is in Test pack")) throw new Error(`result card:\n${text}`);
  const added = readdirSync(mods);
  if (!added.some((f) => /^sodium/i.test(f))) throw new Error(`mods folder: ${added}`);

  await result.getByRole("button", { name: "Undo" }).click();
  await page.getByTestId("undone").waitFor({ timeout: 30000 });
  await page.screenshot({ path: shots + "add-4-undone.png", fullPage: true });
  if (readdirSync(mods).length !== 0) throw new Error(`left after undo: ${readdirSync(mods)}`);
  await page.getByRole("button", { name: "Back to the search" }).click();
  await hits.waitFor({ timeout: 5000 });

  await page.getByRole("tab", { name: "History" }).click();
  await page.getByTestId("history").first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: shots + "add-5-history.png", fullPage: true });
  await browser.close();
  console.log("e2e ok: " + text.replace(/\n+/g, " | ") + " | added " + added.join(", "));
} finally {
  stop();
}
