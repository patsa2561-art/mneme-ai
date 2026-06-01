/**
 * `mneme regret` (v2.140.0) — the REGRET ORACLE (💎3). A signed, cross-vendor
 * calibration of how often an edit carrying a given signal was ACTUALLY
 * regretted later (reverted / test failed). Backward-looking, not fortune-telling.
 *
 *   mneme regret record --features "primitive:network,area:auth,vendor:grok" --regretted
 *   git diff | mneme regret record --diff - --vendor grok --regretted   # auto-derive signals
 *   git diff | mneme regret score --diff - --vendor grok
 *   mneme regret vendors
 *
 * `score` exit 2 on band HIGH (CI-gate). Honest: a historical base rate with a
 * Wilson interval + UNKNOWN when support is thin — never a prediction.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { regret, pce, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
const LEDGER = ".mneme/regret/outcomes.jsonl";

function splitList(v?: string): string[] { return typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : []; }
function readDiff(file?: string): string { try { if (file && file !== "-" && existsSync(file)) return readFileSync(file, "utf8"); if (file === "-") return readFileSync(0, "utf8"); } catch { /* */ } return ""; }

/** Derive observable signals from a diff (via PCE's static analysis) + a vendor. */
function deriveFeatures(diff: string, vendor?: string): string[] {
  const f: string[] = [];
  try {
    const props = pce.analyzeDiff(diff);
    for (const [k, v] of Object.entries(props.introducedPrimitives)) if (v) f.push(`primitive:${k.toLowerCase()}`);
    if (props.massDeletion) f.push("mass-deletion");
    if (props.touchedPaths.some((p) => /delete/.test(p))) { /* noop */ }
    // top-level dir as "area:*"
    for (const p of props.touchedPaths) { const top = p.split("/")[0]; if (top) f.push(`area:${top.toLowerCase()}`); }
    f.push(props.touchedPaths.length > 5 ? "breadth:wide" : "breadth:narrow");
  } catch { /* */ }
  if (vendor) f.push(`vendor:${vendor.toLowerCase()}`);
  return Array.from(new Set(f));
}

function loadModel(cwd: string): regret.RegretModel {
  const p = join(cwd, LEDGER);
  const events: regret.RegretEvent[] = [];
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (Array.isArray(j.features)) events.push({ features: j.features, regretted: j.regretted === true }); } catch { /* */ }
    }
  }
  return regret.buildRegretModel(events);
}

/**
 * Attach the REGRET ORACLE calibration as subcommands of the EXISTING `regret`
 * command (which lists reverted commits — the raw outcome source). So:
 *   mneme regret            → the git revert/hotfix lister (unchanged)
 *   mneme regret score      → calibrated regret base rate for an edit's signals
 *   mneme regret record     → record an outcome into the calibration ledger
 *   mneme regret vendors    → cross-vendor regret comparison
 */
export function attachRegretOracle(regretCmd: Command): void {
  regretCmd
    .command("score")
    .description("💎 REGRET ORACLE — calibrated regret base rate for an edit's signals (Wilson 95% LOWER bound of the riskiest signal, UNKNOWN when support is thin). Pass --diff - to derive signals via PCE. Exit 2 on HIGH. HONEST: a backward-looking historical base rate, not a prediction.")
    .option("--features <list>", "comma-separated signals (e.g. \"primitive:network,area:auth,vendor:grok\")")
    .option("--diff <file>", "derive signals from a unified diff (PCE static analysis); '-' = stdin")
    .option("--vendor <name>", "tag the vendor (adds vendor:<name>)")
    .option("--min-support <n>", "min samples before a signal counts (default 5)", (v) => parseInt(v, 10))
    .option("--json", "JSON output")
    .action((opts: { features?: string; diff?: string; vendor?: string; minSupport?: number; json?: boolean }) => {
      const cwd = process.cwd();
      const features = opts.diff !== undefined ? deriveFeatures(readDiff(opts.diff), opts.vendor) : (() => { const f = splitList(opts.features); if (opts.vendor) f.push(`vendor:${opts.vendor.toLowerCase()}`); return f; })();
      const model = loadModel(cwd);
      const s = regret.scoreRegret(model, features, opts.minSupport !== undefined ? { minSupport: opts.minSupport } : undefined);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `regret:${s.band}`, payload: { band: s.band, lb: s.regretRateLowerBound, support: s.support }, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ ...s, signed: receipt }, null, 2)); process.exitCode = s.band === "HIGH" ? 2 : 0; return; }
      const icon = s.band === "HIGH" ? "🛑" : s.band === "ELEVATED" ? "🟡" : s.band === "LOW" ? "🟢" : "❔";
      out(`${icon} REGRET ${s.band}${s.band !== "UNKNOWN" ? ` — ≥${(s.regretRateLowerBound * 100).toFixed(1)}% of similar edits were regretted (Wilson LB · ${(s.observedRate * 100).toFixed(0)}% observed · n=${s.support})` : " — not enough recorded outcomes for these signals"}`);
      for (const d of s.drivers) out(`   • ${d.feature}: ${(d.wilsonLow * 100).toFixed(1)}% LB (n=${d.n})`);
      out(`   ${s.note}`);
      if (receipt) out(`   ✓ signed (verify offline with the NOTARY public key)`);
      process.exitCode = s.band === "HIGH" ? 2 : 0;
    });

  regretCmd
    .command("record")
    .description("💎 REGRET ORACLE — record one real outcome (signals + --regretted) into the signed calibration ledger.")
    .option("--features <list>", "comma-separated signals")
    .option("--diff <file>", "derive signals from a unified diff; '-' = stdin")
    .option("--vendor <name>", "tag the vendor")
    .option("--regretted", "this outcome WAS regretted (reverted / test failed)")
    .action((opts: { features?: string; diff?: string; vendor?: string; regretted?: boolean }) => {
      const cwd = process.cwd();
      const features = opts.diff !== undefined ? deriveFeatures(readDiff(opts.diff), opts.vendor) : (() => { const f = splitList(opts.features); if (opts.vendor) f.push(`vendor:${opts.vendor.toLowerCase()}`); return f; })();
      if (!features.length) { out("✗ no signals — pass --features or --diff"); process.exitCode = 2; return; }
      try { const p = join(cwd, LEDGER); if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify({ features, regretted: opts.regretted === true, at: Date.now() }) + "\n"); } catch { /* */ }
      out(`✓ recorded outcome (${opts.regretted ? "REGRETTED" : "stable"}): ${features.join(", ")}`);
    });

  regretCmd
    .command("vendors")
    .description("💎 REGRET ORACLE — cross-vendor regret comparison (Wilson LB, riskiest first).")
    .option("--json", "JSON output")
    .action((opts: { json?: boolean }) => {
      const vr = regret.vendorRegret(loadModel(process.cwd()));
      if (opts.json) { out(JSON.stringify(vr, null, 2)); return; }
      if (!vr.length) { out("💎 Regret Oracle — no vendor-tagged outcomes recorded yet."); return; }
      out("💎 Regret Oracle — cross-vendor regret (riskiest first, Wilson 95% LB):");
      for (const v of vr) out(`   ${v.feature.replace("vendor:", "").padEnd(10)} ${(v.wilsonLow * 100).toFixed(1)}% LB · ${(v.rate * 100).toFixed(0)}% observed · n=${v.n}`);
      out("   (historical base rate from your own revert/test outcomes — not a prediction.)");
    });
}
