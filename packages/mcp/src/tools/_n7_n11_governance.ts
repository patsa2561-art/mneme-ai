/**
 * v2.26.0 — N7 + N11 deep-finding closures.
 *
 * N7: honeypot status — the audit found that stateful honeypot probes
 *     (3 seed calls) hid the `decoysActive` count. Now surfaced via
 *     mneme.security.honeypot_status.
 *
 * N11: catalog inflation — audit watched the catalog grow 795 → 799
 *     tools in 1 day. Now there's mneme.governance.catalog_growth that
 *     tracks tool counts per release + warns on >5% growth without doc.
 */

import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";
import { buildAllTools, groupByCategory } from "./_registry.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

// ── N7: honeypot status ──────────────────────────────────────────────

export const honeypotStatusTool: MnemeTool = {
  name: "mneme.security.honeypot_status",
  category: "meta",
  description:
    "N7 fix — return the live honeypot status: which honeypot tools are advertised, how many decoys are seeded, " +
    "recent bite counts. Surfaces the `decoysActive` state the v2.24.0 audit found hidden.",
  whenToUse: "Audit pre-pitch; periodic security check; investigating suspicious probes.",
  triggers: ["honeypot status", "decoys active", "honeypot count"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    const repoRoot = repoRootOf(rt);
    // Honeypot-flagged tools in the catalog
    const all = buildAllTools();
    const honeypotPatterns = [/\.honeypot(\.|$)/i, /\.system\.exec(\.|$)/i, /\[honeypot/i];
    const honeypotTools = all.filter((t) => honeypotPatterns.some((re) => re.test(t.name) || (t.description && re.test(t.description))));
    // Try to read .mneme/aegis/honeypot.json — best-effort
    let decoysActive = 0;
    let recentBites = 0;
    let allowList: string[] = [];
    try {
      const aegisFile = join(repoRoot, ".mneme", "aegis", "honeypot.json");
      if (existsSync(aegisFile)) {
        const j = JSON.parse(readFileSync(aegisFile, "utf8")) as { decoysActive?: number; recentBites?: number };
        if (typeof j.decoysActive === "number") decoysActive = j.decoysActive;
        if (typeof j.recentBites === "number") recentBites = j.recentBites;
      }
    } catch { /* best-effort */ }
    try {
      const allowFile = join(repoRoot, ".mneme", "honeypot-allow.jsonl");
      if (existsSync(allowFile)) {
        allowList = readFileSync(allowFile, "utf8")
          .split("\n").filter(Boolean)
          .map((l) => { try { return (JSON.parse(l) as { tool?: string }).tool ?? ""; } catch { return ""; } })
          .filter(Boolean);
      }
    } catch { /* best-effort */ }
    return {
      data: {
        decoysActive,
        recentBites,
        advertisedHoneypotTools: honeypotTools.map((t) => ({ name: t.name, gated: !allowList.includes(t.name) })),
        allowList,
        gatePolicy: "MCP refuses to call any advertised honeypot unless explicitly allow-listed.",
      },
      wisdom: `${honeypotTools.length} honeypot tool(s) advertised · ${decoysActive} decoys active · ${recentBites} recent bites · ${allowList.length} allow-list entries.`,
      followUp: ["mneme.aegis.status"],
      confidence: { level: "high" as const },
    };
  },
};

// ── N11: catalog inflation governor ───────────────────────────────────

interface CatalogSnapshot {
  at: string;
  version: string;
  totalTools: number;
  byCategory: Record<string, number>;
  byFamily: Record<string, number>;
}

function snapshotDir(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "governance");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function readSnapshotLedger(repoRoot: string): CatalogSnapshot[] {
  const p = join(snapshotDir(repoRoot), "catalog_growth.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as CatalogSnapshot; } catch { return null; } })
    .filter((x): x is CatalogSnapshot => x !== null);
}

function takeSnapshot(version: string): CatalogSnapshot {
  const all = buildAllTools();
  const byCat: Record<string, number> = {};
  const byFam: Record<string, number> = {};
  for (const t of all) {
    byCat[t.category] = (byCat[t.category] ?? 0) + 1;
    const parts = t.name.split(".");
    const fam = parts.length >= 3 ? parts[1]! : "_root";
    byFam[fam] = (byFam[fam] ?? 0) + 1;
  }
  return { at: new Date().toISOString(), version, totalTools: all.length, byCategory: byCat, byFamily: byFam };
}

function resolveVersion(): string {
  try {
    const { fileURLToPath } = require("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch { return "0.0.0"; }
}

export const catalogGrowthTool: MnemeTool = {
  name: "mneme.governance.catalog_growth",
  category: "meta",
  description:
    "N11 fix — track tool count growth per release. Records a snapshot to .mneme/governance/catalog_growth.jsonl. " +
    "Returns the latest snapshot + delta vs prior. Warns when growth > 5% in one release without documentation.",
  whenToUse: "Per release; weekly governance audit; before publishing a new tool family.",
  triggers: ["catalog growth", "tool inflation", "how many tools"],
  inputSchema: {
    type: "object",
    properties: {
      record: { type: "boolean", description: "Append a new snapshot to the ledger. Defaults to false (peek only)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    const repoRoot = repoRootOf(rt);
    const current = takeSnapshot(resolveVersion());
    const ledger = readSnapshotLedger(repoRoot);
    const prior = ledger.length > 0 ? ledger[ledger.length - 1] : null;
    if (args["record"] === true) {
      try {
        appendFileSync(join(snapshotDir(repoRoot), "catalog_growth.jsonl"), JSON.stringify(current) + "\n");
      } catch { /* best-effort */ }
    }
    const delta = prior ? current.totalTools - prior.totalTools : 0;
    const growthPct = prior && prior.totalTools > 0 ? (delta / prior.totalTools) * 100 : 0;
    const warn = Math.abs(growthPct) > 5;
    return {
      data: {
        current,
        prior,
        delta,
        growthPct: Number(growthPct.toFixed(2)),
        warn,
        ledgerCount: ledger.length,
      },
      wisdom: warn
        ? `⚠ catalog grew ${growthPct.toFixed(1)}% (${prior?.totalTools ?? 0} → ${current.totalTools}). Document new families before next release.`
        : `Catalog at ${current.totalTools} tools (${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(1)}% vs ${prior?.version ?? "first snapshot"}).`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

// ── Family count summary (used by tune.run) ──────────────────────────

export const familyCountTool: MnemeTool = {
  name: "mneme.governance.family_count",
  category: "meta",
  description:
    "Return the number of unique tool families (mneme.X.*) and tools per family. Cross-reference with the deep-" +
    "findings audit's N12 datapoint.",
  whenToUse: "Audit prep; governance overview.",
  triggers: ["family count", "how many families"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    const all = buildAllTools();
    const byFam: Record<string, number> = {};
    for (const t of all) {
      const parts = t.name.split(".");
      const fam = parts.length >= 3 ? parts[1]! : "_root";
      byFam[fam] = (byFam[fam] ?? 0) + 1;
    }
    const families = Object.keys(byFam).length;
    return {
      data: {
        totalTools: all.length,
        families,
        avgPerFamily: families > 0 ? Number((all.length / families).toFixed(2)) : 0,
        topFamilies: Object.entries(byFam).sort(([, a], [, b]) => b - a).slice(0, 10).map(([f, n]) => ({ family: f, count: n })),
      },
      wisdom: `${families} families × ${all.length} tools (avg ${families > 0 ? (all.length / families).toFixed(1) : 0} per family).`,
      followUp: ["mneme.governance.catalog_growth"],
      confidence: { level: "high" as const },
    };
  },
};

// also expose category counts for the syllabus
void groupByCategory;

export const N7_N11_GOVERNANCE_TOOLS: MnemeTool[] = [
  honeypotStatusTool,
  catalogGrowthTool,
  familyCountTool,
];
