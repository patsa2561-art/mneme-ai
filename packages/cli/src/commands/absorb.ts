/**
 * `mneme absorb` (v2.109.0) — pipe a command's output in; Mneme deterministically
 * extracts {intent, error-class, excerpt} and files it as a SIGNED Cortex fact
 * (recall by any agent). If it's an error and you pass --fix, it also teaches
 * the Shell Autopilot — closing the loop: absorb (learn) → autopilot (suggest).
 *
 *   mycmd 2>&1 | mneme absorb --cmd "mycmd" --code $?
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface CoreLog {
  logpipe: { extractLogEntry: (c: string, o: string, e: number) => { command: string; exitCode: number; hadError: boolean; errorClass: string; excerpt: string; intent: string; signature: string; kind: string }; formatForCortex: (e: unknown) => { key: string; value: string; kind: "warning" | "fact" } };
  cortex: { contribute: (repo: string, store: unknown, c: unknown, at: number, opts?: unknown) => { store: unknown; result: { verdict: string } } };
  shellAutopilot: { recoveryKey: (sig: string) => string };
  loopguard: { LOOPGUARD_LEDGER: string; toEvent: (e: unknown, at: number) => unknown };
}
async function core(): Promise<CoreLog | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreLog; if (c.logpipe && c.cortex) return c; } catch { /* */ }
  return null;
}
function cortexPath(cwd: string): string { return join(cwd, ".mneme", "cortex", "store.json"); }
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = ""; let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; if (data.length > 2_000_000) finish(); });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 4000);   // never hang
  });
}

export function registerAbsorbCommands(program: Command): void {
  program
    .command("absorb")
    .description("📥 LOGPIPE — pipe a command's output in; Mneme extracts {intent, error, fix} deterministically and files it as a SIGNED, recallable Cortex fact (cross-agent). With --fix it also teaches the Shell Autopilot (absorb→autopilot loop). Usage: `mycmd 2>&1 | mneme absorb --cmd \"mycmd\" --code $?`")
    .option("--cmd <c>", "the command that produced the output", "")
    .option("--code <n>", "exit code (else inferred from output)", (v) => parseInt(v, 10))
    .option("--fix <f>", "the command that FIXED this error (teaches the autopilot)")
    .option("--text <t>", "output text inline (else read from stdin)")
    .option("--agent <a>", "agent id", "absorb")
    .option("--json", "JSON output.")
    .action(async (opts: { cmd?: string; code?: number; fix?: string; text?: string; agent?: string; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const output = typeof opts.text === "string" ? opts.text : await readStdin();
      const entry = m.logpipe.extractLogEntry(opts.cmd ?? "", output, typeof opts.code === "number" ? opts.code : NaN);
      const f = m.logpipe.formatForCortex(entry);
      // store as a signed cortex fact
      let store: unknown = { v: 1, entries: [] };
      try { if (existsSync(cortexPath(cwd))) store = JSON.parse(readFileSync(cortexPath(cwd), "utf8")); } catch { /* */ }
      const out = m.cortex.contribute(cwd, store, { agent: opts.agent ?? "absorb", key: f.key, value: f.value, kind: f.kind }, Date.now());
      store = out.store;
      // close the loop: an error + a known fix → teach the autopilot
      let taught = false;
      if (entry.hadError && opts.fix) {
        const rk = m.shellAutopilot.recoveryKey(entry.signature);
        const o2 = m.cortex.contribute(cwd, store, { agent: opts.agent ?? "absorb", key: rk, value: opts.fix, kind: "fact" }, Date.now(), { update: true });
        store = o2.store; taught = true;
      }
      try { const dir = join(cwd, ".mneme", "cortex"); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(cortexPath(cwd), JSON.stringify(store, null, 2)); } catch { /* */ }
      // feed the LOOPGUARD ledger (objective thrash detection + `mneme resume`)
      try {
        const ev = m.loopguard.toEvent(entry, Date.now());
        const lp = join(cwd, m.loopguard.LOOPGUARD_LEDGER);
        if (!existsSync(dirname(lp))) mkdirSync(dirname(lp), { recursive: true });
        appendFileSync(lp, JSON.stringify(ev) + "\n");
      } catch { /* */ }
      if (opts.json) { writeJson({ entry, cortex: out.result.verdict, taughtAutopilot: taught }); return; }
      writeText(`📥 ${entry.intent}`);
      if (entry.hadError) writeText(`   error[${entry.errorClass}]: ${entry.excerpt}`);
      writeText(`   → cortex (${out.result.verdict})${taught ? " · taught the autopilot a recovery" : ""}`);
    });
}
