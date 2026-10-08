// End-to-end: the app's screen in Chromium, the real engine behind the dev bridge, a real
// get (Accessories for 1.21.11: no build there, so the app proposes 1.21.10). Clicks what a
// player would click and takes screenshots of each step into e2e/screenshots/.
//
//   npm run build && node e2e/get.mjs          (needs network: Modrinth)

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const shots = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "modkeel-e2e-"));

const bridge = spawn("node", ["scripts/dev-bridge.mjs", "8799"], {
  env: { ...process.env, MODKEEL_WORKDIR: work },
  stdio: "inherit",
});
const preview = spawn("npx", ["vite", "preview", "--port", "4799", "--strictPort"], { stdio: "ignore" });
const stop = () => { bridge.kill(); preview.kill(); };

try {
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  await page.goto("http://127.0.0.1:4799/?bridge=8799");
  await page.getByText(/engine \d/).waitFor({ timeout: 20000 });
  await page.screenshot({ path: shots + "1-ready.png" });

  await page.fill("input[name=query]", "Accessories");
  await page.fill("input[name=mc_version]", "1.21.11");
  await page.click("button[name=loader]");
  await page.screenshot({ path: shots + "1b-loader-open.png" });
  await page.getByRole("option", { name: "Fabric" }).click();
  await page.click("button[type=submit]");

  // first question: a token for forks; skip it
  await page.getByText("GitHub token").waitFor({ timeout: 180000 });
  await page.screenshot({ path: shots + "2-token.png" });
  await page.click("text=Skip forks");

  // then the proposal: take it
  await page.getByText("nearest that works").waitFor({ timeout: 180000 });
  await page.screenshot({ path: shots + "3-proposal.png" });
  await page.click("text=Get it for MC 1.21.10");

  const result = page.getByTestId("result");
  await result.waitFor({ timeout: 300000 });
  const text = await result.innerText();
  await page.screenshot({ path: shots + "4-done.png", fullPage: true });
  await browser.close();

  for (const want of ["Accessories", "MC 1.21.10", "downloaded", "out/mc-1.21.10/"]) {
    if (!text.includes(want)) throw new Error(`result card lacks "${want}":\n${text}`);
  }
  console.log("e2e ok: " + text.replace(/\n+/g, " | "));
} finally {
  stop();
}
