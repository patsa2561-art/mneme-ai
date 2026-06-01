#!/usr/bin/env node
/**
 * scripts/outline-bench.mjs — regenerate the honest OUTLINE benchmark table.
 *
 * Measures, across real repo files of varying size, the realistic agent
 * workflow: a raw full-read vs reading the OUTLINE skeleton vs (skeleton + ONE
 * region fetch). Token figures are a LABELLED ≈chars/4 estimate (NOT a vendor
 * tokenizer); the char reduction is exact. No cherry-picking — files are listed
 * explicitly below. Run: `node scripts/outline-bench.mjs`
 *
 * What it does NOT prove: it does not claim a specific vendor's tokenizer count,
 * and it only measures the INPUT cost of reading code — not the model's
 * reasoning. It also only helps when an agent CHOOSES to outline instead of a
 * raw read.
 */
import { readFileSync } from "node:fs";
import { extractOutline, renderOutline, extractRegion, measureReduction } from "../packages/core/dist/outline/index.js";

const FILES = [
  "packages/core/src/outline/index.ts",
  "packages/cli/src/commands/demo.ts",
  "packages/core/src/squadron/acgv.ts",
  "packages/core/src/bequest/index.ts",
  "packages/mcp/src/tools/_registry.ts",
];

const est = (chars) => Math.ceil(chars / 4);
const rows = [];
for (const f of FILES) {
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  const o = extractOutline(src, { path: f });
  const skeleton = renderOutline(o, { path: f });
  // realistic edit: skeleton + the single largest symbol's region
  const biggest = [...o.symbols].filter((s) => s.kind !== "import").sort((a, b) => b.bodyLines - a.bodyLines)[0];
  const region = biggest ? extractRegion(src, biggest.name, { path: f }) : { text: "" };
  const rawTok = est(src.length);
  const skTok = est(skeleton.length);
  const editTok = est(skeleton.length + (region.text ? region.text.length : 0));
  rows.push({ f, lines: o.totalLines, syms: o.symbolCount, rawTok, skTok, editTok, skPct: measureReduction(src.length, skeleton.length).reductionPct });
}

const pad = (s, n) => String(s).padEnd(n);
console.log("| File | Lines | Raw read (~tok) | Skeleton (~tok) | Skeleton+1 region (~tok) | Skeleton reduction |");
console.log("|---|--:|--:|--:|--:|--:|");
let rawSum = 0, skSum = 0, editSum = 0;
for (const r of rows) {
  rawSum += r.rawTok; skSum += r.skTok; editSum += r.editTok;
  console.log(`| \`${r.f.replace("packages/", "")}\` | ${r.lines} | ${r.rawTok.toLocaleString()} | ${r.skTok.toLocaleString()} (−${r.skPct}%) | ${r.editTok.toLocaleString()} | −${r.skPct}% |`);
}
const totPct = Math.round((1 - skSum / rawSum) * 1000) / 10;
const editPct = Math.round((1 - editSum / rawSum) * 1000) / 10;
console.log(`| **total** | | **${rawSum.toLocaleString()}** | **${skSum.toLocaleString()} (−${totPct}%)** | **${editSum.toLocaleString()} (−${editPct}%)** | |`);
console.log(`\n(≈chars/4 INPUT-token estimate, labelled; char reduction is exact. "Skeleton+1 region" = orient on the skeleton then fetch the single largest symbol's byte-exact body — a realistic single-edit. Regenerate: \`node scripts/outline-bench.mjs\`.)`);
