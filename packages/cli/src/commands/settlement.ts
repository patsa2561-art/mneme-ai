/**
 * `mneme settlement` (v2.129.0) — the Context Transaction Settlement Ledger:
 * a signed, hash-chained, offline-auditable record of every AI↔local context
 * exchange (what was blinded, what changed, whether it passed local verify, the
 * tokens metered). The honest "Stripe of AI Context / settlement layer".
 *
 *   mneme settlement record --tx '{"kind":"channel-op","namesHidden":3,"localVerified":"pass","tokensSent":40,"tokensSaved":600}'
 *   mneme settlement verify
 *   mneme settlement statement --price-per-1k 0.003 --fee-pct 0.10
 */

import type { Command } from "commander";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { settlement, notary } from "@mneme-ai/core";

const LEDGER = ".mneme/settlement/ledger.jsonl";
function out(s: string): void { process.stdout.write(s + "\n"); }
function outJson(o: unknown): void { process.stdout.write(JSON.stringify(o, null, 2) + "\n"); }
function loadRecords(cwd: string): settlement.LedgerRecord[] {
  try { const p = join(cwd, LEDGER); if (!existsSync(p)) return []; return readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as settlement.LedgerRecord); } catch { return []; }
}

export function registerSettlementCommands(program: Command): void {
  const s = program.command("settlement").description("💳 CONTEXT TRANSACTION SETTLEMENT LEDGER — a signed, hash-chained, offline-auditable record of every AI↔local context exchange (blinded-proof + local-verify-proof + token metering). The honest 'Stripe of AI Context' settlement/audit layer.");

  s.command("record")
    .description("Append one context transaction to the chained ledger (links to the previous record's hash).")
    .requiredOption("--tx <json>", "the transaction: {kind, sentHash?, namesHidden?, secretsRemoved?, localVerified?, tokensSent?, tokensSaved?, note?}")
    .option("--json", "JSON output.")
    .action((opts: { tx: string; json?: boolean }) => {
      const cwd = process.cwd();
      let txIn: Record<string, unknown>; try { txIn = JSON.parse(opts.tx); } catch (e) { out(`✗ invalid --tx JSON: ${(e as Error).message}`); process.exitCode = 1; return; }
      const records = loadRecords(cwd);
      const prev = records.length ? records[records.length - 1]!.chainHash : "0".repeat(64);
      const rec = settlement.recordTx(prev, txIn as Partial<settlement.ContextTx>, records.length + 1);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "protocol-hop", subject: `settlement:${rec.tx.seq}`, payload: { chainHash: rec.chainHash, seq: rec.tx.seq }, includePayload: true }); } catch { /* */ }
      try { const p = join(cwd, LEDGER); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(rec) + "\n"); } catch (e) { out(`✗ append failed: ${(e as Error).message}`); process.exitCode = 1; return; }
      if (opts.json) { outJson({ record: rec, signed: receipt }); return; }
      out(`💳 tx#${rec.tx.seq} ${rec.tx.kind} recorded · chain ${rec.chainHash.slice(0, 12)}… · sent ~${rec.tx.tokensSent} tok, saved ~${rec.tx.tokensSaved} tok${receipt ? " · signed" : ""}`);
    });

  s.command("verify")
    .description("Recompute the chain offline + report tamper (returns the first broken seq). Exit 2 if broken.")
    .option("--json", "JSON output.")
    .action((opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const v = settlement.verifyChain(loadRecords(cwd));
      if (opts.json) { outJson(v); return; }
      out(v.ok ? `✓ chain intact — ${v.length} transaction(s) verify offline` : `🛑 chain BROKEN at seq ${v.firstBrokenSeq}: ${v.note}`);
      if (!v.ok) process.exitCode = 2;
    });

  s.command("statement")
    .description("A Visa-style settlement statement: tokens sent vs saved, % blinded, % locally-verified, chain integrity. --price-per-1k + --fee-pct (your numbers) add USD + the value-based fee.")
    .option("--price-per-1k <usd>", "your vendor's price per 1k tokens (USD).", (v) => parseFloat(v))
    .option("--fee-pct <f>", "value-based fee as a fraction of savings, e.g. 0.10 = 10%.", (v) => parseFloat(v))
    .option("--json", "JSON output.")
    .action((opts: { pricePer1k?: number; feePct?: number; json?: boolean }) => {
      const cwd = process.cwd();
      const st = settlement.settlementStatement(loadRecords(cwd), { pricePer1kUSD: opts.pricePer1k, feePct: opts.feePct });
      if (opts.json) { outJson(st); return; }
      out(`💳 SETTLEMENT STATEMENT — ${st.txCount} context transaction(s)`);
      out(`   tokens: ~${st.totalTokensSent.toLocaleString()} sent · ~${st.totalTokensSaved.toLocaleString()} saved`);
      if (typeof st.usdSaved === "number") out(`   value: $${st.usdSaved.toLocaleString()} saved${typeof st.feeUSD === "number" ? ` · fee @${(opts.feePct! * 100)}% = $${st.feeUSD.toLocaleString()}` : ""} (at your rate)`);
      out(`   security: ${st.pctBlinded}% blinded · ${st.pctLocallyVerified}% locally-verified`);
      out(`   integrity: ${st.integrity.ok ? "✓ chain intact" : "🛑 BROKEN @seq " + st.integrity.firstBrokenSeq}`);
    });
}
