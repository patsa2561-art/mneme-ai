/**
 * `mneme distill` (v2.111.0) — turn a verbose {error log + diff} into the
 * minimal causal BRIEF an agent needs, with a MEASURED token-budget receipt.
 * Send the signal, not the raw logs. The known fix is recalled from the Cortex.
 *
 *   mycmd 2>&1 | mneme distill --cmd "mycmd" --code $? --diff-file change.diff
 *
 * Honest: the token figure is an explicit ≈chars/4 estimate (not a vendor
 * tokenizer); the CHARACTER reduction is exact. We report the real per-call
 * numbers — never a fabricated "wisdom score".
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface CoreD {
  distill: { distill: (i: unknown) => { brief: string; signature: string; hadError: boolean; measured: { charsBefore: number; charsAfter: number; reductionPct: number; tokEstBefore: number; tokEstAfter: number; tokEstSaved: number; note: string } } };
  cortex: { activeView: (s: unknown) => Map<string, { value: string }> };
  shellAutopilot: { recoveryKey: (sig: string) => string };
  loopguard: { LOOPGUARD_LEDGER: string; parseLedger: (t: string) => unknown[] };
  nkl: { checkApproach: (e: unknown[], cmd: string) => { isDeadEnd: boolean; base: string; failures: number } };
}
async function core(): Promise<CoreD | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreD; if (c.distill) return c; } catch { /* */ }
  return null;
}
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = ""; let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; if (data.length > 4_000_000) finish(); });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 4000);
  });
}
function makeRecall(m: CoreD, cwd: string): (sig: string) => string | null {
  let view = new Map<string, { value: string }>();
  try { const p = join(cwd, ".mneme", "cortex", "store.json"); if (existsSync(p)) view = m.cortex.activeView(JSON.parse(readFileSync(p, "utf8"))); } catch { /* */ }
  return (sig: string) => { try { const e = view.get(m.shellAutopilot.recoveryKey(sig)); return e && typeof e.value === "string" && e.value.length > 0 ? e.value : null; } catch { return null; } };
}

export function registerDistillCommands(program: Command): void {
  program
    .command("distill")
    .description("✂️ DISTILL — compress a verbose {error log + diff} into the minimal causal BRIEF an agent needs, with a MEASURED token-budget receipt (send the signal, not the raw logs). The known fix is recalled from the Cortex. Honest: char reduction is exact; token figure is a labeled ≈chars/4 estimate. Usage: `mycmd 2>&1 | mneme distill --cmd \"mycmd\" --code $? --diff-file d.diff`")
    .option("--cmd <c>", "the command that produced the output", "")
    .option("--code <n>", "exit code (else inferred from output)", (v) => parseInt(v, 10))
    .option("--text <t>", "the error/log text inline (else read from stdin)")
    .option("--diff-file <f>", "path to a unified diff of the change under test")
    .option("--json", "JSON output (brief + measured receipt).")
    .action(async (opts: { cmd?: string; code?: number; text?: string; diffFile?: string; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const output = typeof opts.text === "string" ? opts.text : await readStdin();
      let diff = "";
      if (opts.diffFile) { try { if (existsSync(opts.diffFile)) diff = readFileSync(opts.diffFile, "utf8"); } catch { /* */ } }
      const recall = makeRecall(m, cwd);
      // AUTO negative-knowledge: derive whether this approach is a proven
      // dead-end from the absorb ledger (no manual recording, no command).
      let deadEnd: { isDeadEnd: boolean; base: string; failures: number } | null = null;
      try {
        const lp = join(cwd, m.loopguard.LOOPGUARD_LEDGER);
        if (existsSync(lp)) deadEnd = m.nkl.checkApproach(m.loopguard.parseLedger(readFileSync(lp, "utf8")), opts.cmd ?? "");
      } catch { /* */ }
      const r = m.distill.distill({ command: opts.cmd ?? "", output, exitCode: typeof opts.code === "number" ? opts.code : NaN, diff, recall, deadEnd });
      // AUTO-RECORD the measured saving into the Token Treasury (the user never
      // logs anything — `mneme savings` fills itself from normal distill use).
      try { const { appendSaving } = await import("./savings.js"); appendSaving(cwd, { source: "distill", tokensBefore: r.measured.tokEstBefore, tokensAfter: r.measured.tokEstAfter }); } catch { /* */ }
      if (opts.json) { writeJson({ brief: r.brief, signature: r.signature, measured: r.measured }); return; }
      writeText(r.brief || "(nothing to distill)");
      const mr = r.measured;
      writeText("");
      writeText(`📉 ${mr.charsBefore}→${mr.charsAfter} chars (−${mr.reductionPct}%) · ≈${mr.tokEstBefore}→${mr.tokEstAfter} tok est (saved ≈${mr.tokEstSaved})`);
      writeText(`   ${mr.note}`);
    });
}
