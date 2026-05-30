/**
 * `mneme savings` (v2.115.0) — the Token Treasury report. Shows the MEASURED,
 * SIGNED total of input-context tokens Mneme has saved you (via distill /
 * loopguard / nkl), with an optional USD figure at YOUR vendor's price. The
 * substrate for the "Pay-per-Token-Saved" business model — falsifiable, not
 * marketing (the ledger is append-only + the report is NOTARY-signed).
 *
 *   mneme savings                       # measured tokens saved + breakdown
 *   mneme savings --price-per-1k 0.003  # …in USD at your vendor's input price
 *
 * Auto-fed: `mneme distill` records each reduction into the ledger as a
 * side-effect, so this fills itself from normal use — you never log anything.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

export const TREASURY_LEDGER = ".mneme/treasury/ledger.jsonl";

/** Shared appender — distill (and any organ) calls this to record a measured
 *  saving. Total: never throws, never blocks the caller. */
export function appendSaving(cwd: string, e: { source: string; tokensBefore: number; tokensAfter: number }): void {
  try {
    if (!Number.isFinite(e.tokensBefore) || !Number.isFinite(e.tokensAfter)) return;
    if (e.tokensBefore <= 0) return;
    const p = join(cwd, TREASURY_LEDGER);
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({ source: e.source, tokensBefore: Math.round(e.tokensBefore), tokensAfter: Math.round(e.tokensAfter), at: Date.now() }) + "\n");
  } catch { /* best-effort — accounting never blocks work */ }
}

interface CoreT {
  treasury: { parseLedger: (t: string) => unknown[]; aggregate: (e: unknown[], o?: { pricePer1kUSD?: number }) => { events: number; totalBefore: number; totalAfter: number; tokensSaved: number; savedPct: number; bySource: Record<string, { events: number; tokensSaved: number }>; usdSaved?: number; pricePer1kUSD?: number; note: string } };
  notary?: { issueReceipt: (cwd: string, o: unknown) => unknown };
}
async function core(): Promise<CoreT | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreT; if (c.treasury) return c; } catch { /* */ }
  return null;
}

export function registerSavingsCommands(program: Command): void {
  program
    .command("savings")
    .alias("treasury")
    .description("💰 TOKEN TREASURY — the MEASURED, signed total of input-context tokens Mneme saved you (distill / loopguard / nkl), with an optional USD figure at YOUR vendor's price. The 'Pay-per-Token-Saved' substrate — falsifiable, not marketing. Auto-fed by `mneme distill`. Token figures are a labeled ≈chars/4 estimate.")
    .option("--price-per-1k <usd>", "your vendor's INPUT price per 1k tokens (e.g. 0.003) → report USD saved", (v) => parseFloat(v))
    .option("--json", "JSON output (signed).")
    .action(async (opts: { pricePer1k?: number; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const p = join(cwd, TREASURY_LEDGER);
      const events = existsSync(p) ? m.treasury.parseLedger(readFileSync(p, "utf8")) : [];
      const agg = m.treasury.aggregate(events, opts.pricePer1k !== undefined ? { pricePer1kUSD: opts.pricePer1k } : undefined);
      let receipt: unknown = null;
      try { receipt = m.notary?.issueReceipt(cwd, { kind: "reasoning-trace", subject: `treasury:${agg.tokensSaved}`, payload: { tokensSaved: agg.tokensSaved, events: agg.events }, includePayload: true }); } catch { /* */ }
      if (opts.json) { writeJson({ ...agg, signed: receipt }); return; }
      if (agg.events === 0) {
        writeText("💰 Token Treasury — no savings recorded yet.");
        writeText("   Pipe a verbose error+diff through `mneme distill` and savings accrue automatically.");
        return;
      }
      writeText(`💰 Token Treasury — ${agg.tokensSaved.toLocaleString()} input tokens saved across ${agg.events} events (−${agg.savedPct}%)`);
      writeText(`   ${agg.totalBefore.toLocaleString()} → ${agg.totalAfter.toLocaleString()} tokens (≈chars/4 estimate)`);
      const srcs = Object.entries(agg.bySource).sort((a, b) => b[1].tokensSaved - a[1].tokensSaved);
      for (const [src, s] of srcs) writeText(`     ${src.padEnd(10)} ${s.tokensSaved.toLocaleString().padStart(10)} saved · ${s.events} events`);
      if (agg.usdSaved !== undefined) writeText(`   ≈ $${agg.usdSaved.toLocaleString(undefined, { minimumFractionDigits: 2 })} saved at $${agg.pricePer1kUSD}/1k input tokens (your supplied price)`);
      writeText(`   ${agg.note}`);
      if (receipt) writeText(`   ✓ signed (verify offline with the NOTARY public key)`);
    });
}
