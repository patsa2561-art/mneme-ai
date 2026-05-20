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

const BANNER = "🔴 MNEME POLYGRAPH";

export interface PolygraphCommandOptions {
  cwd: string;
  mode: "install" | "emit" | "status";
  output?: string;
  bridgeUrl?: string;
  json?: boolean;
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
  const bridgeUrl = opts.bridgeUrl || "http://127.0.0.1:11434";
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
  const url = opts.bridgeUrl || "http://127.0.0.1:11434";
  try {
    const res = await fetch(url + "/v1/ping", { signal: AbortSignal.timeout(1500) });
    return { alive: res.ok, url };
  } catch (e) {
    return { alive: false, url, error: (e as Error).message };
  }
}

export async function polygraphCommand(opts: PolygraphCommandOptions): Promise<void> {
  if (opts.mode === "status") {
    const status = await bridgeStatus(opts);
    if (opts.json) { process.stdout.write(JSON.stringify(status, null, 2) + "\n"); return; }
    process.stdout.write(`${BANNER} — bridge status\n\n`);
    process.stdout.write(`  url:    ${status.url}\n`);
    process.stdout.write(`  alive:  ${status.alive ? "✅ yes" : "❌ no"}\n`);
    if (status.error) process.stdout.write(`  error:  ${status.error}\n`);
    if (!status.alive) {
      process.stdout.write(`\n  start the bridge:  mneme bridge\n`);
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
