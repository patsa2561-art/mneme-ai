#!/usr/bin/env tsx
/**
 * gen-tools-md — Generates MCP_TOOLS.md from the live tool registry.
 *
 * The registry IS the source of truth — this script reads it, groups by
 * category, and writes a fresh markdown catalog to repo root. Run before
 * publishing to keep the catalog in sync; CI flags drift via diff.
 *
 *   $ npx tsx packages/mcp/scripts/gen-tools-md.ts
 *
 * Output: <repo-root>/MCP_TOOLS.md (overwritten)
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllTools, groupByCategory } from "../dist/tools/_registry.js";
import { computeCatalogHash } from "../dist/tools/_tool_meta.js";
import type { MnemeTool, ToolCategory } from "../dist/tools/_types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const OUT = resolve(REPO_ROOT, "MCP_TOOLS.md");

const CATEGORY_BLURB: Record<ToolCategory, string> = {
  memory: "Q&A, semantic search, citations — answers grounded in the repo's commit history.",
  people: "Contributors, knowledge atrophy, telepathic teammates, cultural alphas, semantic ownership.",
  audit: "AI Session Audit — trust certificate for AI commits. Vendor-neutral.",
  forensics: "Security: vuln-hunt, anomaly detection, authorship attribution, ENFSI-style verdicts.",
  insights: "Storytelling, regret-mining, prediction (oracle / premortem / time-machine).",
  quality: "Code/repo health, palimpsest causal chains, cognitive twin, voice fingerprints.",
  quant: "Engineering analysis borrowed from Wall Street — drawdown, alpha, Greeks, moneyball.",
  lab: "Periodic Table + Second Brain + Wisdom Mutant — compose recipes, save plans, recalibrate.",
  meta: "Discovery, contracts, lint, intent matching, doctor, manifesto.",
};

function escape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderTool(t: MnemeTool): string {
  const out: string[] = [];
  out.push(`### \`${t.name}\``);
  out.push("");
  out.push(t.description);
  if (t.whenToUse) {
    out.push("");
    out.push(`**When to use:** ${t.whenToUse}`);
  }
  out.push("");
  out.push("<details><summary>Contract</summary>");
  out.push("");
  out.push("**Input schema:**");
  out.push("```json");
  out.push(JSON.stringify(t.inputSchema, null, 2));
  out.push("```");
  if (t.outputSchema) {
    out.push("");
    out.push("**Output schema:**");
    out.push("```json");
    out.push(JSON.stringify(t.outputSchema, null, 2));
    out.push("```");
  }
  if (t.examples && t.examples.length > 0) {
    out.push("");
    out.push("**Examples:**");
    for (const ex of t.examples) {
      out.push(`- *"${ex.userQuery}"*`);
      if (ex.args) out.push(`  - args: \`${JSON.stringify(ex.args)}\``);
      if (ex.expectedOutput) out.push(`  - returns: ${ex.expectedOutput}`);
    }
  }
  if (t.pitfalls && t.pitfalls.length > 0) {
    out.push("");
    out.push("**Pitfalls:**");
    for (const p of t.pitfalls) out.push(`- ${p}`);
  }
  if (t.composeWith && t.composeWith.length > 0) {
    out.push("");
    out.push(`**Compose with:** ${t.composeWith.map((n) => `\`${n}\``).join(" · ")}`);
  }
  if (t.jargon && Object.keys(t.jargon).length > 0) {
    out.push("");
    out.push("**Jargon:**");
    for (const [term, defn] of Object.entries(t.jargon)) {
      out.push(`- **${term}** — ${defn}`);
    }
  }
  out.push("");
  out.push("</details>");
  out.push("");
  return out.join("\n");
}

function main(): void {
  const all = buildAllTools();
  const grouped = groupByCategory();
  const hash = computeCatalogHash();
  const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";

  const lines: string[] = [];
  lines.push("# Mneme MCP Tools — Full Catalog");
  lines.push("");
  lines.push(
    "_Auto-generated from the live tool registry. Do not edit by hand — run_ " +
      "`npx tsx packages/mcp/scripts/gen-tools-md.ts` _to refresh._",
  );
  lines.push("");
  lines.push(
    `**${all.length} tools** across **${grouped.size} categories** · ` +
      `catalog hash \`${hash}\` · generated ${generatedAt}`,
  );
  lines.push("");
  lines.push("## What is this");
  lines.push("");
  lines.push(
    "Mneme exposes its full tool catalog through the [Model Context Protocol](https://modelcontextprotocol.io). " +
      "Every tool below is callable by AI clients (Claude Code, Cursor, Continue, Codex, Cline, Zed, Aider, " +
      "or any MCP-aware client) once `mneme mcp --install` has been run.",
  );
  lines.push("");
  lines.push(
    "**For AI agents:** call `mneme.capabilities` first for the syllabus, then `mneme.help(query)` " +
      "to find a tool by free-text intent, or `mneme.tool.contract(name)` for the full 6-field contract " +
      "of a single tool. Catalog drift detection: pass your last-seen hash to `mneme.whats_new`.",
  );
  lines.push("");
  lines.push("## Categories");
  lines.push("");
  for (const [cat, tools] of grouped) {
    lines.push(`- [**${cat}**](#${cat}) (${tools.length} tool${tools.length === 1 ? "" : "s"}) — ${CATEGORY_BLURB[cat]}`);
  }
  lines.push("");
  lines.push("## Quick reference");
  lines.push("");
  lines.push("| Tool | Category | Purpose (1-line) |");
  lines.push("|---|---|---|");
  for (const t of all) {
    const oneLiner = escape(t.whenToUse ?? t.description.split(/\.\s/)[0] ?? t.description);
    lines.push(`| \`${t.name}\` | ${t.category} | ${oneLiner.slice(0, 200)} |`);
  }
  lines.push("");
  for (const [cat, tools] of grouped) {
    lines.push(`## ${cat}`);
    lines.push("");
    lines.push(`*${CATEGORY_BLURB[cat]}*`);
    lines.push("");
    for (const t of tools) {
      lines.push(renderTool(t));
    }
  }

  writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`✓ wrote ${OUT} — ${all.length} tools, hash ${hash}`);
}

main();
