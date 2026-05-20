/**
 * v2.19.80 — `mneme polygraph` CLI.
 *
 * Closes IDEA #1 (AI POLYGRAPH) gap from the user perspective:
 *   User asked "ติดตั้ง mneme แล้ว claude app จะรู้จัก polygraph ไหม"
 *   Answer (now): YES — run `mneme polygraph install`, install the
 *   emitted .user.js into Tampermonkey, start the bridge with `mneme
 *   bridge`, and every AI sentence in claude.ai / chatgpt / gemini /
 *   copilot / deepseek / qwen gets a green/yellow/red dot in real time.
 *
 * Subcommands:
 *   mneme polygraph install     emit userscript + print 3-step setup
 *   mneme polygraph emit        emit userscript only (no instructions)
 *   mneme polygraph status      is bridge alive? where's the userscript?
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { platform } from "node:os";

const BANNER = "🔴 MNEME POLYGRAPH";

export interface PolygraphCommandOptions {
  cwd: string;
  mode: "install" | "emit" | "status" | "autosetup";
  output?: string;
  bridgeUrl?: string;
  json?: boolean;
  /** v2.19.82 — `autosetup` mode skips opening the .user.js if true. */
  skipOpen?: boolean;
}

function ensureBridgeToken(cwd: string): string {
  const tokenPath = join(cwd, ".mneme", "http-token");
  if (existsSync(tokenPath)) return readFileSync(tokenPath, "utf8").trim();
  const dir = join(cwd, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const t = "mneme_" + randomBytes(24).toString("base64url");
  writeFileSync(tokenPath, t, "utf8");
  return t;
}

async function loadMnemeVersion(): Promise<string> {
  try {
    const pkgPath = new URL("../../package.json", import.meta.url);
    const raw = readFileSync(pkgPath, "utf8");
    const json = JSON.parse(raw) as { version?: string };
    return json.version || "0.0.0";
  } catch { return "0.0.0"; }
}

async function emitUserscript(opts: PolygraphCommandOptions): Promise<{ path: string; bytes: number }> {
  const core = await import("@mneme-ai/core");
  const version = await loadMnemeVersion();
  const token = ensureBridgeToken(opts.cwd);
  const bridgeUrl = opts.bridgeUrl || "http://127.0.0.1:17741";
  const artifact = core.permeate.generateUserscript({
    mnemeVersion: version,
    bridgeUrl,
    bridgeToken: token,
    polygraph: true,
  });
  const outPath = opts.output || join(opts.cwd, artifact.filename);
  writeFileSync(outPath, artifact.content, "utf8");
  return { path: outPath, bytes: artifact.content.length };
}

async function bridgeStatus(opts: PolygraphCommandOptions): Promise<{ alive: boolean; url: string; error?: string }> {
  // v2.19.83 — port ladder rendezvous. Honour explicit --bridge-url first;
  // otherwise read .mneme/bridge.json (beacon written by startBridge);
  // otherwise probe the ladder 17741..17750 and use the first live port.
  if (opts.bridgeUrl) {
    try {
      const res = await fetch(opts.bridgeUrl + "/v1/ping", { signal: AbortSignal.timeout(1500) });
      return { alive: res.ok, url: opts.bridgeUrl };
    } catch (e) { return { alive: false, url: opts.bridgeUrl, error: (e as Error).message }; }
  }
  const beaconPath = join(opts.cwd, ".mneme", "bridge.json");
  if (existsSync(beaconPath)) {
    try {
      const beacon = JSON.parse(readFileSync(beaconPath, "utf8")) as { baseUrl?: string };
      if (beacon.baseUrl) {
        const res = await fetch(beacon.baseUrl + "/v1/ping", { signal: AbortSignal.timeout(800) });
        if (res.ok) return { alive: true, url: beacon.baseUrl };
      }
    } catch { /* fall through to ladder probe */ }
  }
  // Cold-scan the ladder in parallel.
  const probes = [];
  for (let i = 0; i < 10; i++) {
    const port = 17741 + i;
    const url = `http://127.0.0.1:${port}`;
    probes.push((async () => {
      try {
        const res = await fetch(url + "/v1/ping", { signal: AbortSignal.timeout(400) });
        return { url, alive: res.ok };
      } catch { return { url, alive: false }; }
    })());
  }
  const results = await Promise.all(probes);
  const winner = results.find((r) => r.alive);
  if (winner) return { alive: true, url: winner.url };
  return { alive: false, url: "http://127.0.0.1:17741", error: "no bridge alive on ladder 17741..17750" };
}

/** v2.19.82 — Open a file path with the OS default handler.  Used by
 *  autosetup to fire Tampermonkey for the emitted .user.js, and to open
 *  the Tampermonkey install page when the user hasn't installed it yet.
 *  Returns true on a clean handoff; false if the open command failed. */
function openWithOsDefault(target: string): boolean {
  try {
    const opener =
      platform() === "darwin" ? "open"
      : platform() === "win32" ? "explorer"
      : "xdg-open";
    const child = spawn(opener, [target], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch { return false; }
}

function parseBridgePort(url: string | undefined): number | undefined {
  if (!url) return undefined;
  try { return parseInt(new URL(url).port || "0", 10) || undefined; } catch { return undefined; }
}

async function runAutosetup(opts: PolygraphCommandOptions): Promise<void> {
  // 1) Bridge: start detached if not already alive.  v2.19.83 — when no
  //    fixed port is requested, let the bridge walk the ladder
  //    17741..17750 to dodge Ollama / sibling Mneme installs / squatters.
  //    After spawning, re-poll status so we report the ACTUAL bound port
  //    (which may be 17742+ if the ladder walked).
  let status = await bridgeStatus(opts);
  let bridgePid: number | null = null;
  if (!status.alive) {
    const { spawnDetachedBridge } = await import("./bridge.js");
    const port = parseBridgePort(opts.bridgeUrl);
    const r = await spawnDetachedBridge({ cwd: opts.cwd, port });
    bridgePid = r.pid;
    // Tiny grace window so the bridge has time to bind + write beacon.
    await new Promise((r) => setTimeout(r, 800));
    // Re-poll so the printed URL reflects the actual ladder-walked port.
    status = await bridgeStatus(opts);
  }
  // 2) Userscript: emit to repo root (or --output).
  const emitted = await emitUserscript(opts);
  // 3) Hand off to OS: open the .user.js so Tampermonkey prompts.
  const opened = opts.skipOpen ? false : openWithOsDefault(emitted.path);
  // 4) JSON early-return for AI-agent consumers.
  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      mode: "autosetup",
      bridge: { alreadyRunning: status.alive, pid: bridgePid, url: status.url },
      userscript: { path: emitted.path, bytes: emitted.bytes, opened },
      manualStepsRemaining: [
        "Install Tampermonkey at https://tampermonkey.net (one-time, browser).",
        "When Tampermonkey prompts to install the userscript, click Install.",
        "Open claude.ai / chatgpt.com / gemini.google.com — polygraph dots will appear.",
      ],
    }, null, 2) + "\n");
    return;
  }
  // 5) Human-readable summary tells user EXACTLY the two remaining clicks.
  process.stdout.write(`${BANNER} — autosetup complete\n\n`);
  process.stdout.write(`  🌉 bridge:     ${status.alive ? "already running" : `started (pid ${bridgePid})`}  ·  ${status.url}\n`);
  process.stdout.write(`  📜 userscript: ${emitted.path}\n`);
  process.stdout.write(`  🪟 opened:     ${opened ? "yes (Tampermonkey should prompt now)" : "no (open the .user.js manually)"}\n\n`);
  process.stdout.write(`  TWO MANUAL STEPS REMAIN (the AI agent cannot click in your browser):\n\n`);
  process.stdout.write(`    1. Install Tampermonkey once: https://tampermonkey.net\n`);
  process.stdout.write(`       (free; one-time; Chrome / Firefox / Edge / Safari)\n\n`);
  process.stdout.write(`    2. When Tampermonkey asks "Install this script?", click Install.\n\n`);
  process.stdout.write(`  THEN: open claude.ai / chatgpt.com / gemini.google.com — polygraph dots\n`);
  process.stdout.write(`  appear next to every AI sentence; EKG pulses bottom-right.\n`);
}

export async function polygraphCommand(opts: PolygraphCommandOptions): Promise<void> {
  if (opts.mode === "autosetup") {
    return await runAutosetup(opts);
  }
  if (opts.mode === "status") {
    const status = await bridgeStatus(opts);
    if (opts.json) { process.stdout.write(JSON.stringify(status, null, 2) + "\n"); return; }
    process.stdout.write(`${BANNER} — bridge status\n\n`);
    process.stdout.write(`  url:    ${status.url}\n`);
    process.stdout.write(`  alive:  ${status.alive ? "✅ yes" : "❌ no"}\n`);
    if (status.error) process.stdout.write(`  error:  ${status.error}\n`);
    if (!status.alive) {
      process.stdout.write(`\n  start the bridge:  mneme bridge  (or:  mneme polygraph autosetup)\n`);
    }
    return;
  }

  // emit + install paths both write the userscript first.
  const emitted = await emitUserscript(opts);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: true, mode: opts.mode, userscript: emitted.path, bytes: emitted.bytes }, null, 2) + "\n");
    return;
  }

  if (opts.mode === "emit") {
    process.stdout.write(`${BANNER} — userscript emitted\n\n  ${emitted.path}  (${emitted.bytes.toLocaleString()} bytes)\n`);
    return;
  }

  // install mode: emit + print 3-step guide.
  const status = await bridgeStatus(opts);
  process.stdout.write(`${BANNER} — install\n`);
  process.stdout.write(`\n  Per-sentence truth-check dots on every AI response in claude.ai /\n`);
  process.stdout.write(`  chatgpt.com / gemini.google.com / copilot.microsoft.com / deepseek /\n`);
  process.stdout.write(`  qwen — green/yellow/red live, plus a floating EKG indicator.\n`);
  process.stdout.write(`\n  ┌─────────────────────────────────────────────────────────────┐\n`);
  process.stdout.write(`  │ 3-step setup                                                │\n`);
  process.stdout.write(`  ├─────────────────────────────────────────────────────────────┤\n`);
  process.stdout.write(`  │ 1. Install Tampermonkey (or Violentmonkey / Greasemonkey)   │\n`);
  process.stdout.write(`  │    in your browser. Free, single click.                     │\n`);
  process.stdout.write(`  │                                                             │\n`);
  process.stdout.write(`  │ 2. Open this file — Tampermonkey will offer to install:     │\n`);
  process.stdout.write(`  │    ${emitted.path.padEnd(57)}│\n`);
  process.stdout.write(`  │                                                             │\n`);
  process.stdout.write(`  │ 3. Start the Mneme bridge (must be running):                │\n`);
  process.stdout.write(`  │      mneme bridge                                           │\n`);
  process.stdout.write(`  │    Then visit claude.ai (or any supported AI) and ask any   │\n`);
  process.stdout.write(`  │    factual question — dots appear next to each sentence.   │\n`);
  process.stdout.write(`  └─────────────────────────────────────────────────────────────┘\n`);
  process.stdout.write(`\n  Bridge: ${status.alive ? "🟢 running" : "🔴 not running — run `mneme bridge` in a separate terminal"}\n`);
}
