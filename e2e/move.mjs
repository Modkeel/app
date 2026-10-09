// End-to-end "Move a pack": the screen in Chromium, the real engine behind the dev bridge,
// a real mods folder (MODKEEL_E2E_PACK: a 1.21.1 Fabric pack) moved to 1.21.10. With
// MODKEEL_E2E_INSTANCE the pack is picked by that name from "Your instances" instead (the
// engine finds it in its HOME's launchers, so set HOME to where that instance lives).
//
//   npm run build && MODKEEL_E2E_PACK=/path/to/mods node e2e/move.mjs     (network: Modrinth)

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const pack = process.env.MODKEEL_E2E_PACK;
const instance = process.env.MODKEEL_E2E_INSTANCE;
if (!pack && !instance) throw new Error("set MODKEEL_E2E_PACK to a mods folder (or MODKEEL_E2E_INSTANCE)");
const shots = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "modkeel-e2e-"));
const bridge = spawn("node", ["scripts/dev-bridge.mjs", "8798"], { env: { ...process.env, MODKEEL_WORKDIR: work }, stdio: "inherit" });
const preview = spawn("npx", ["vite", "preview", "--port", "4798", "--strictPort"], { stdio: "ignore" });
try {
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto("http://127.0.0.1:4798/?bridge=8798");
  await page.getByText(/engine \d/).waitFor({ timeout: 20000 });
  await page.getByRole("tab", { name: "Move a pack" }).click();
  if (instance) {
    await page.click("button[name=instance]");
    await page.getByRole("option", { name: instance }).click();
    if (!(await page.inputValue("input[name=mods_dir]"))) throw new Error("the instance filled no folder");
  } else {
    await page.fill("input[name=mods_dir]", pack);
  }
  await page.fill("input[name=move_mc_version]", "1.21.10");
  await page.screenshot({ path: shots + "move-1-form.png" });
  await page.click("text=Move it");
  await page.getByText(/of \d+ ready/).waitFor({ timeout: 60000 });
  await page.screenshot({ path: shots + "move-2-progress.png" });
  // a token question may come (forks): skip it
  const result = page.getByTestId("result");
  while (!(await result.count())) {
    if (await page.getByText("Skip forks").count()) await page.click("text=Skip forks");
    if (await page.getByText(/Stay on MC/).count()) await page.click(`text=/Stay on MC/`);
    await page.waitForTimeout(1000);
  }
  const text = await result.innerText();
  await page.screenshot({ path: shots + "move-3-done.png", fullPage: true });
  await browser.close();
  if (!/\d+ of \d+ ready/.test(text) || !text.includes("mc-1.21.10")) throw new Error("result card:\n" + text);
  console.log("e2e move ok: " + text.split("\n")[0]);
} finally {
  bridge.kill();
  preview.kill();
}
