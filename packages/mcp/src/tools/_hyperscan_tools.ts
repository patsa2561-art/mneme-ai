/**
 * v1.69.0 -- MCP wrappers for HYPERSCAN PROTOCOL.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const hyperscanProseTool: MnemeTool = {
  name: "mneme.hyperscan.prose",
  category: "meta",
  description: "HYPERSCAN H1 -- prose-shadow scan. Extracts entity candidates (title-cased / package-shape / acronym / domain-suffixed) from prose claims and verifies each against package.json + imports + source. Catches fake-package mentions that the v1.65 antivirus misses.",
  whenToUse: "Any AI claim mentioning service / library / package names in prose, not syntax markers.",
  triggers: ["prose scan", "check fake package", "ตรวจชื่อปลอม"],
  inputSchema: { type: "object", properties: { claim: { type: "string" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Scan 'wraith-utils-2099 is used for caching'", args: { claim: "wraith-utils-2099 is used for caching" }, expectedOutput: "Suspect list + recognized known-real entities." }],
  pitfalls: ["Known-real services pass; only un-cited unknowns surface as suspects."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.hyperscan.proseScan(repoRootOf(rt), String(args["claim"] ?? ""));
    return {
      data: r,
      wisdom: `${r.suspects.length} suspect(s) flagged from ${r.entitiesExtracted} extracted entity/ies; ${r.recognized.length} recognized.`,
      confidence: { level: "high" },
    };
  },
};

export const hyperscanCitationTool: MnemeTool = {
  name: "mneme.hyperscan.citation",
  category: "meta",
  description: "HYPERSCAN H2 -- cross-citation ground. Parses (subject, verb, object) triples from claim and verifies each has codebase evidence. Reports citation gaps + ground score.",
  whenToUse: "Behavior-attribution claims like 'X handles Y' / 'we use Z for Q'.",
  triggers: ["cross citation", "ground claim", "ตรวจ citation"],
  inputSchema: { type: "object", properties: { claim: { type: "string" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Ground 'PhantomMonitor handles tracing'", args: { claim: "PhantomMonitor handles distributed tracing across services" }, expectedOutput: "Triples + per-triple citation density." }],
  pitfalls: ["Heuristic verb grammar; complex sentences may not parse cleanly."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.hyperscan.crossCitationGround(repoRootOf(rt), String(args["claim"] ?? ""));
    return {
      data: r,
      wisdom: `${r.gaps} citation gap(s) in ${r.triples.length} triple(s); ground score ${(r.groundScore * 100).toFixed(0)}%.`,
      confidence: { level: "high" },
    };
  },
};

export const hyperscanAskTool: MnemeTool = {
  name: "mneme.hyperscan.ask",
  category: "meta",
  description: "HYPERSCAN H3 -- cross-source Q&A fusion. Searches commits + README + CHANGELOG + source-file docstrings + package.json. Returns fused answer + trust label (HIGH/MEDIUM/LOW) + per-source scores.",
  whenToUse: "Any factual question about the codebase. Especially when commits alone gave LOW trust.",
  triggers: ["ask mneme", "hyperscan ask", "ถามแบบลึก"],
  inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What is HTC compression?", args: { question: "what is HTC compression and how does it work" }, expectedOutput: "fusedAnswer (multi-source) + trust + per-source max." }],
  pitfalls: ["Trust label LOW when no source overlaps the query keywords."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.hyperscan.crossSourceAsk(repoRootOf(rt), String(args["question"] ?? ""));
    return {
      data: r,
      wisdom: `Trust ${r.trustLabel} (${(r.trust * 100).toFixed(0)}%) across ${r.sourcesPresent.length} source(s).`,
      confidence: { level: r.trustLabel === "HIGH" ? "high" : r.trustLabel === "MEDIUM" ? "medium" : "low" },
      secondBrain: { presentation: r.fusedAnswer },
    };
  },
};

export const hyperscanDustTool: MnemeTool = {
  name: "mneme.hyperscan.dust",
  category: "meta",
  description: "HYPERSCAN H4 -- auto-populate HTC molecules from every commit subject + source-file docstring. Pushes HTC coverage from 0% to >=80% with no manual step. Idempotent.",
  whenToUse: "First-run setup; periodic refresh when new commits land.",
  triggers: ["populate htc", "auto dust", "htc coverage"],
  inputSchema: { type: "object", properties: { maxCommits: { type: "number" }, maxFiles: { type: "number" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Generate HTC dust", args: {}, expectedOutput: "Added count + coverage delta." }],
  pitfalls: ["Heuristic (no LLM); abstracts truncate to 140 chars."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const before = core.hyperscan.computeCoverage(root).coveragePct;
    const { added } = core.hyperscan.generateDust(root, {
      maxCommits: (args["maxCommits"] as number | undefined) ?? 500,
      maxFiles: (args["maxFiles"] as number | undefined) ?? 500,
    });
    const after = core.hyperscan.computeCoverage(root).coveragePct;
    return {
      data: { added, coverageBefore: before, coverageAfter: after },
      wisdom: `Added ${added} abstract(s); HTC coverage ${before.toFixed(0)}% -> ${after.toFixed(0)}%.`,
      confidence: { level: "high" },
    };
  },
};

export const hyperscanBenchTool: MnemeTool = {
  name: "mneme.hyperscan.bench",
  category: "meta",
  description: "Run the 4-axis HYPERSCAN bench (prose scan precision / citation gaps / cross-source trust / HTC coverage delta). Measurable proof of each axis.",
  whenToUse: "Verify after any HYPERSCAN-related change; quarterly precision audit.",
  triggers: ["hyperscan bench", "measure precision"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run hyperscan bench", args: {}, expectedOutput: "4-axis report with raw numbers." }],
  pitfalls: ["Bench mutates HTC dust + writes to .mneme/hyperscan/."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.hyperscan.runHyperscanBench(repoRootOf(rt));
    const txt = core.hyperscan.renderBench(r);
    return {
      data: r,
      wisdom: r.headline,
      confidence: { level: "high" },
      secondBrain: { presentation: txt },
    };
  },
};

export const HYPERSCAN_TOOLS: MnemeTool[] = [
  hyperscanProseTool,
  hyperscanCitationTool,
  hyperscanAskTool,
  hyperscanDustTool,
  hyperscanBenchTool,
];
