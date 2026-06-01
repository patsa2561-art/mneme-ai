/**
 * `mneme axia` (v2.138.0) — AXIA (ἀξία, "worth"), membrane pillar 2: the Value
 * Ledger. One signed, hash-chained, OFFLINE-verifiable summary of the value
 * events Mneme's organs actually produced:
 *   - tokens-saved          (pulled live from the treasury ledger)
 *   - destructive-gated · secret-redacted · injection-neutralized ·
 *     claim-corrected · omission-flagged  (recorded into AXIA's own ledger)
 *
 *   mneme axia                          # the signed value summary
 *   mneme axia --price-per-1k 0.003     # …with USD from tokens-saved × your rate
 *   mneme axia record --kind destructive-gated --source heph
 *
 * HONEST: counts are signed facts (events that HAPPENED). NOT "attacks
 * prevented" and NEVER an estimated $ of damage — the only $ is
 * tokens-saved × the price-per-1k YOU supply.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

export const AXIA_LEDGER = ".mneme/axia/ledger.jsonl";
export const TREASURY_LEDGER = ".mneme/treasury/ledger.jsonl";

/** Shared appender — any organ records a value event. Total: never throws. */
export function appendAxiaEvent(cwd: string, e: { kind: string; count?: number; source: string }): void {
  try {
    const p = join(cwd, AXIA_LEDGER);
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
    const count = Number.isFinite(e.count) && (e.count as number) > 0 ? Math.floor(e.count as number) : 1;
    appendFileSync(p, JSON.stringify({ kind: e.kind, count, source: e.source, at: Date.now() }) + "\n");
  } catch { /* best-effort — accounting never blocks work */ }
}

interface CoreT {
  axia: {
    buildAxiaLedger: (events: unknown[]) => unknown[];
    axiaSummary: (records: unknown[], opts?: { pricePer1k?: number }) => Record<string, unknown>;
    AXIA_KINDS: readonly string[];
  };
  treasury?: { parseLedger: (t: string) => unknown[]; aggregate: (e: unknown[]) => { tokensSaved: number } };
  notary?: { issueReceipt: (cwd: string, o: unknown) => unknown };
}
async function core(): Promise<CoreT | null> {
  try { const c = (await import("@mneme-ai/core")) as unknown as CoreT; if (c.axia) return c; } catch { /* */ }
  return null;
}

/** Read AXIA's own event ledger + the treasury tokens-saved into a fused event list. */
function gatherEvents(m: CoreT, cwd: string): Array<{ kind: string; count: number; source: string; at?: number }> {
  const events: Array<{ kind: string; count: number; source: string; at?: number }> = [];
  // AXIA's own recorded events (gated / redacted / corrected / neutralized / flagged)
  const ap = join(cwd, AXIA_LEDGER);
  if (existsSync(ap)) {
    for (const line of readFileSync(ap, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j && typeof j.kind === "string") events.push({ kind: j.kind, count: Number(j.count) || 1, source: String(j.source ?? "unknown"), at: Number(j.at) || undefined }); } catch { /* skip */ }
    }
  }
  // tokens-saved pulled LIVE from the treasury (single fused event, source=treasury)
  try {
    const tp = join(cwd, TREASURY_LEDGER);
    if (m.treasury && existsSync(tp)) {
      const tokensSaved = m.treasury.aggregate(m.treasury.parseLedger(readFileSync(tp, "utf8"))).tokensSaved;
      if (tokensSaved > 0) events.push({ kind: "tokens-saved", count: tokensSaved, source: "treasury" });
    }
  } catch { /* */ }
  return events;
}

export function registerAxiaCommands(program: Command): void {
  const axia = program
    .command("axia")
    .description("💎 AXIA — the signed, hash-chained, OFFLINE-verifiable VALUE LEDGER (membrane pillar 2). Fuses what Mneme's organs actually did — tokens saved (treasury), destructive commands GATED, secrets redacted, injections neutralized, claims corrected, omissions flagged — into one number an auditor/insurer checks with a public key. HONEST: counts are facts, NOT 'attacks prevented'; the only $ is tokens-saved × YOUR price-per-1k — never an invented $ of damage.")
    .option("--price-per-1k <usd>", "your vendor's INPUT price per 1k tokens → USD from tokens-saved only", (v) => parseFloat(v))
    .option("--json", "JSON output (signed).")
    .action(async (opts: { pricePer1k?: number; json?: boolean }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      const cwd = process.cwd();
      const events = gatherEvents(m, cwd);
      const led = m.axia.buildAxiaLedger(events);
      const s = m.axia.axiaSummary(led, opts.pricePer1k !== undefined ? { pricePer1k: opts.pricePer1k } : undefined) as {
        byKind: Record<string, number>; totalEvents: number; tokensSaved: number; usdSaved: number | null; chainValid: boolean; note: string;
      };
      let receipt: unknown = null;
      try { receipt = m.notary?.issueReceipt(cwd, { kind: "claim-verdict", subject: `axia:${s.totalEvents}ev/${s.tokensSaved}tok`, payload: { totalEvents: s.totalEvents, tokensSaved: s.tokensSaved, byKind: s.byKind }, includePayload: true }); } catch { /* */ }
      if (opts.json) { writeJson({ ...s, signed: receipt }); return; }
      writeText(`💎 AXIA value ledger — ${s.totalEvents} value events · ${s.tokensSaved.toLocaleString()} tokens saved`);
      const labels: Record<string, string> = { "destructive-gated": "destructive cmds GATED", "secret-redacted": "secrets redacted", "injection-neutralized": "injections neutralized", "claim-corrected": "claims corrected", "omission-flagged": "omissions flagged" };
      for (const [k, label] of Object.entries(labels)) { const n = s.byKind[k] ?? 0; if (n > 0) writeText(`     ${String(n).padStart(6)}  ${label}`); }
      if (s.tokensSaved > 0) writeText(`     ${s.tokensSaved.toLocaleString().padStart(6)}  input tokens saved (treasury, ≈chars/4)`);
      if (s.usdSaved !== null) writeText(`   ≈ $${s.usdSaved.toLocaleString(undefined, { minimumFractionDigits: 2 })} saved at $${opts.pricePer1k}/1k tokens (your supplied price)`);
      writeText(`   chain ${s.chainValid ? "✓ valid" : "🛑 BROKEN"}${receipt ? " · signed (verify offline with the NOTARY public key)" : ""}`);
      writeText(`   ${s.note}`);
      if (s.totalEvents === 0 && s.tokensSaved === 0) writeText("   (no value events yet — they accrue as Mneme's organs gate/redact/correct/save during normal use.)");
    });

  axia
    .command("record")
    .description("Record one value event into AXIA's signed ledger (organs call this; you rarely do).")
    .requiredOption("--kind <k>", "tokens-saved | destructive-gated | secret-redacted | injection-neutralized | claim-corrected | omission-flagged")
    .option("--count <n>", "how many (default 1)", (v) => parseInt(v, 10))
    .option("--source <s>", "which organ produced it", "manual")
    .action(async (opts: { kind: string; count?: number; source: string }) => {
      const m = await core(); if (!m) { writeText("✗ core unavailable"); process.exitCode = 1; return; }
      if (!m.axia.AXIA_KINDS.includes(opts.kind)) { writeText(`✗ unknown kind '${opts.kind}'. one of: ${m.axia.AXIA_KINDS.join(", ")}`); process.exitCode = 2; return; }
      appendAxiaEvent(process.cwd(), { kind: opts.kind, count: opts.count, source: opts.source });
      writeText(`✓ recorded ${opts.count ?? 1}× ${opts.kind} (source: ${opts.source})`);
    });
}
