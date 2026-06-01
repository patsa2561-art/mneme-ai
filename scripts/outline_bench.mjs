/**
 * OUTLINE honesty benchmark — regenerate the README table.
 *
 *   node scripts/outline_bench.mjs           # print the markdown table
 *   node scripts/outline_bench.mjs --json    # machine-readable rows
 *
 * WHAT IT MEASURES (per real repo file, no cherry-picking — the file list is
 * HARDCODED below and deliberately includes a degenerate case + a worst case):
 *
 *   raw          = whole file loaded into context        (≈ chars/4 tokens)
 *   skeleton     = renderOutline(extractOutline(file))   (≈ chars/4 tokens)
 *   skeleton+1   = skeleton + ONE byte-exact region fetch (the realistic
 *                  "orient cheap, then edit one symbol exact" agent workflow)
 *
 * The region is chosen by a FIXED RULE, not by hand: the MEDIAN-body top-level
 * symbol (deterministic; not the smallest, not the largest — a typical edit
 * target). The exact symbol + line range is recorded in the row so the number
 * is reproducible and auditable. This deliberately refuses to flatter the
 * result by hand-picking a tiny region.
 *
 * HONESTY (DIAKRISIS):
 *   - Char counts are EXACT. The token column is a LABELLED ≈chars/4 estimate of
 *     INPUT context, NOT a vendor tokenizer — same convention as DISTILL/TREASURY.
 *   - This is deterministic + offline. Re-running on an unchanged tree yields the
 *     identical table (it is part of what makes the claim falsifiable).
 *   - It does NOT prove faster task completion, fewer agent turns, better edits,
 *     lower $ cost, or that chars/4 equals any specific model's tokenizer. It
 *     proves ONE thing: the structural skeleton (and skeleton + one exact region)
 *     is smaller, by this estimate, than loading the whole file — and shows the
 *     cases where it is NOT a win.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractOutline, renderOutline, extractRegion } from "../packages/core/dist/outline/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Hardcoded + diverse on purpose: tiny → huge, plus a barrel (degenerate) and a
// god-function file (worst case). NO globbing → reproducible. The region is the
// MEDIAN-body top-level symbol (chosen by rule, below) — not hand-picked.
const CASES = [
  "scripts/ship-readiness.mjs",          // small script
  "packages/core/src/hydra/index.ts",    // small module
  "packages/core/src/outline/index.ts",  // self: medium
  "packages/core/src/cortex/index.ts",   // medium-large module
  "packages/core/src/index.ts",          // DEGENERATE: pure re-export barrel
  "packages/cli/src/index.ts",           // WORST CASE: 6.9k-line god file
];

const estTok = (chars) => Math.ceil(chars / 4);

/** Deterministic region rule: the median-body top-level symbol. Falls back to
 *  the first 1/3 of the file as a line range when the file has no symbols (a
 *  barrel) so the "edit one region" column is still defined + honest. */
function pickRegionSelector(o, totalLines) {
  const d0 = o.symbols.filter((s) => s.depth === 0 && s.kind !== "import");
  if (d0.length === 0) {
    const b = Math.max(1, Math.floor(totalLines / 3));
    return `L1-L${b}`;
  }
  const sorted = [...d0].sort((a, b) => a.bodyLines - b.bodyLines || a.startLine - b.startLine);
  return sorted[Math.floor(sorted.length / 2)].name;
}

function row(rel) {
  const src = readFileSync(resolve(ROOT, rel), "utf8");
  const o = extractOutline(src);
  const skeleton = renderOutline(o, { path: rel });
  const selector = pickRegionSelector(o, src.split("\n").length);
  const reg = extractRegion(src, selector);
  const regionChars = reg.ok ? reg.text.length : 0;

  const rawT = estTok(src.length);
  const skT = estTok(skeleton.length);
  const skrT = estTok(skeleton.length + regionChars);

  return {
    file: rel,
    lines: src.split("\n").length,
    symbols: o.symbolCount,
    region: reg.ok ? `${selector} (L${reg.startLine}-${reg.endLine})` : `${selector} (NO MATCH)`,
    rawTokens: rawT,
    skeletonTokens: skT,
    skeletonPlusRegionTokens: skrT,
    skeletonPct: rawT > 0 ? Math.round((1 - skT / rawT) * 1000) / 10 : 0,
    skeletonPlusRegionPct: rawT > 0 ? Math.round((1 - skrT / rawT) * 1000) / 10 : 0,
  };
}

const rows = CASES.map((f) => row(f));

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify({ unit: "≈chars/4 tokens (estimate, not a vendor tokenizer)", rows }, null, 2) + "\n");
} else {
  const out = [];
  out.push("| file | lines | sym | raw ≈tok | skeleton ≈tok (Δ) | skeleton + 1 region ≈tok (Δ) | region |");
  out.push("|---|--:|--:|--:|--:|--:|---|");
  for (const r of rows) {
    out.push(`| \`${r.file}\` | ${r.lines} | ${r.symbols} | ${r.rawTokens} | ${r.skeletonTokens} (−${r.skeletonPct}%) | ${r.skeletonPlusRegionTokens} (−${r.skeletonPlusRegionPct}%) | ${r.region} |`);
  }
  out.push("");
  out.push("> `≈tok` = **labelled ≈chars/4 estimate** of input context, not a vendor tokenizer. Char counts are exact. Regenerate: `node scripts/outline_bench.mjs`.");
  out.push("> The barrel file (`core/src/index.ts`) and the 6.9k-line god-file (`cli/src/index.ts`) are included **on purpose** to show where outline is *not* a clear win.");
  process.stdout.write(out.join("\n") + "\n");
}
