/**
 * v2.24.0 — MCP wrappers for the MCP fuzzer.
 *
 * 4 tools:
 *   mneme.fuzz.vectors   — list the 108 vectors (id + title + category + severity)
 *   mneme.fuzz.run       — fire vectors against an MCP target + return signed report
 *   mneme.fuzz.report    — read the most recent HMAC-signed report card
 *   mneme.fuzz.verify    — verify a pasted card against a known chain head
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const fuzzVectorsTool: MnemeTool = {
  name: "mneme.fuzz.vectors",
  category: "meta",
  description:
    "MCP FUZZER — list the 108 attack vectors used to harden Mneme's MCP surface against the audit findings " +
    "(initialize timeout · unknown-tool isError · honeypot exposure · git-repo crash · stderr-blind · deep nesting · " +
    "proto-pollution · path traversal · transport garbage · concurrency races). Returns id + title + category + " +
    "severity + spec citation + CVE references when applicable.",
  whenToUse: "Audit prep; CI gate design; documenting which classes Mneme MCP is hardened against.",
  triggers: ["fuzz vectors", "list mcp attack vectors", "mcp fuzzer catalog"],
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", description: "Filter to one category (handshake / schema / method / tool / resource / prompt / policy / concurrency / transport)." },
    },
  },
  outputSchema: { type: "object" },
  pitfalls: ["The catalog is closed for v2.24 — community extensions land in v2.24.x."],
  composeWith: ["mneme.fuzz.run", "mneme.fuzz.report"],
  handler: async (_rt, args) => {
    const { VECTORS_108 } = await import("@mneme-ai/core").then((m) => m.mcpFuzzer);
    const cat = typeof args["category"] === "string" ? args["category"] : null;
    const filtered = cat ? VECTORS_108.filter((v) => v.category === cat) : VECTORS_108;
    const summary = filtered.map((v) => ({
      id: v.id,
      title: v.title,
      category: v.category,
      severity: v.severity,
      spec: v.spec,
      cve: v.cve ?? [],
    }));
    return {
      data: { count: summary.length, vectors: summary },
      wisdom: `${summary.length} attack vectors loaded. Critical/high cover the audit-finding classes (handshake timeout / honeypot exposure / proto-pollution / path traversal). Run \`mneme.fuzz.run\` to fire them at the live MCP server.`,
      followUp: ["mneme.fuzz.run", "mneme.fuzz.report"],
      confidence: { level: "high" as const },
    };
  },
};

export const fuzzRunTool: MnemeTool = {
  name: "mneme.fuzz.run",
  category: "meta",
  description:
    "MCP FUZZER — fire 108 attack vectors (or a filtered subset) at an MCP server and return an HMAC-signed report card. " +
    "Default target is the local `mneme mcp` bin (self-fuzz). 24/7 daemon-tick organ records each run in an append-only " +
    "HMAC-chained ledger so regressions surface as soon as the next tick runs. Wisdom layer correlates failures with " +
    "known CVEs (CVE-2025-54136 MCPoison etc) + proposes mutations for the next run.",
  whenToUse: "Pre-release gate; periodic self-audit; after upgrading MCP SDK or any MCP-tool surface.",
  triggers: ["mcp fuzz", "fuzz mcp server", "mcp pentest", "ยิง mcp", "ทดสอบ mcp"],
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "array", items: { type: "string" }, description: "Vector ids or category names. Empty = all 108." },
      failFast: { type: "boolean", description: "Stop after first critical/high failure." },
      timeoutMs: { type: "number", description: "Per-vector timeout override (ms)." },
    },
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Run full fuzz", args: {}, expectedOutput: "108 vectors fired; HMAC-signed report card with pass/fail per category + CVE posture." },
    { userQuery: "Fuzz handshake only", args: { filter: ["handshake"] }, expectedOutput: "12 vectors fired." },
    { userQuery: "Smoke test critical only", args: { failFast: true }, expectedOutput: "Stops at first critical/high failure; fast CI gate." },
  ],
  pitfalls: [
    "Spawns a child MCP process. Slow on cold start (the daemon-tick organ runs once after the OS quiets down).",
    "Report card includes responses; can be 100KB+ for the full run. Use `filter` to scope.",
  ],
  composeWith: ["mneme.fuzz.vectors", "mneme.fuzz.report", "mneme.fuzz.verify"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const filter = Array.isArray(args["filter"]) ? (args["filter"] as string[]) : undefined;
    const failFast = args["failFast"] === true;
    const timeoutMs = typeof args["timeoutMs"] === "number" ? (args["timeoutMs"] as number) : undefined;
    const { reportCard } = await core.mcpFuzzer.runFuzz(
      { kind: "local", cwd: repoRoot },
      { filter, failFast, timeoutMs },
    );
    try { core.mcpFuzzer.storeReport(repoRoot, reportCard); } catch { /* best-effort */ }
    const s = reportCard.summary;
    return {
      data: {
        headline: reportCard.wisdom.headline,
        trafficLight: reportCard.wisdom.trafficLight,
        spec: reportCard.spec,
        target: reportCard.target,
        startedAt: reportCard.startedAt,
        finishedAt: reportCard.finishedAt,
        totalMs: reportCard.totalMs,
        summary: s,
        wisdom: reportCard.wisdom,
        hmac: reportCard.hmac,
        seq: reportCard.seq,
        bodyDigest: reportCard.bodyDigest,
      },
      wisdom: reportCard.wisdom.headline,
      followUp: ["mneme.fuzz.report", "mneme.fuzz.verify"],
      confidence: { level: s.fail === 0 ? "high" as const : s.fail > 5 ? "low" as const : "medium" as const },
    };
  },
};

export const fuzzReportTool: MnemeTool = {
  name: "mneme.fuzz.report",
  category: "meta",
  description:
    "MCP FUZZER — read the most recent HMAC-signed report card from .mneme/mcp_fuzzer/. Returns the full card (with " +
    "per-vector verdicts + CVE posture + recommended mutations) for replay or comparison.",
  whenToUse: "After fuzz.run; periodic check; build a regression timeline by listing multiple cards.",
  triggers: ["mcp fuzz report", "latest fuzz", "show fuzz card"],
  inputSchema: { type: "object", properties: { limit: { type: "number", description: "If set, list the last N ledger entries instead of returning the full latest card." } } },
  outputSchema: { type: "object" },
  composeWith: ["mneme.fuzz.run", "mneme.fuzz.verify"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    if (typeof args["limit"] === "number") {
      const ledger = core.mcpFuzzer.listReports(repoRoot, args["limit"] as number);
      return {
        data: { count: ledger.length, ledger },
        wisdom: `${ledger.length} report(s) recorded.`,
        followUp: ["mneme.fuzz.run"],
        confidence: { level: "high" as const },
      };
    }
    const latest = core.mcpFuzzer.readLatestReport(repoRoot);
    return {
      data: latest ? { card: latest } : { card: null, note: "No fuzz report yet — run mneme.fuzz.run first." },
      wisdom: latest ? latest.wisdom.headline : "No fuzz report on disk yet.",
      followUp: latest ? ["mneme.fuzz.verify"] : ["mneme.fuzz.run"],
      confidence: { level: latest ? "high" as const : "low" as const },
    };
  },
};

export const fuzzVerifyTool: MnemeTool = {
  name: "mneme.fuzz.verify",
  category: "meta",
  description:
    "MCP FUZZER — verify a report card's HMAC chain. Pass the card body + the expected previous chain link; returns " +
    "ok/false + reason. Lets receivers prove a card was produced by THIS install without re-running the corpus.",
  whenToUse: "Cross-machine attestation; CI artifact verification; tamper audit.",
  triggers: ["verify fuzz report", "check fuzz hmac", "mcp fuzz verify"],
  inputSchema: {
    type: "object",
    properties: {
      card: { type: "object", description: "The full ReportCard JSON to verify." },
      prevChainLink: { type: "string", description: "Previous chain head (sha256 hex, 64 chars). Defaults to all-zero (first card)." },
    },
    required: ["card"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.fuzz.report"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const card = args["card"] as Parameters<typeof core.mcpFuzzer.verifyReport>[0];
    const prev = typeof args["prevChainLink"] === "string" ? (args["prevChainLink"] as string) : "0".repeat(64);
    if (!card || typeof card !== "object") {
      return {
        data: { ok: false, reason: "card argument missing or not an object" },
        wisdom: "Pass `card` (full ReportCard).",
        followUp: ["mneme.fuzz.report"],
        confidence: { level: "high" as const },
      };
    }
    const v = core.mcpFuzzer.verifyReport(card, prev);
    return {
      data: v,
      wisdom: v.ok ? "Report card HMAC verified." : `Report card HMAC FAIL: ${v.reason}`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const MCP_FUZZER_TOOLS: MnemeTool[] = [
  fuzzVectorsTool,
  fuzzRunTool,
  fuzzReportTool,
  fuzzVerifyTool,
];
