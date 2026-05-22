/**
 * v2.25.0 — MCP wrappers for LIVING SOUL CODEGRAPH.
 *
 * 6 tools cover the surface:
 *   mneme.codegraph.build     — build + persist the graph
 *   mneme.codegraph.query     — filter nodes / edges
 *   mneme.codegraph.drift     — detect broken edges since last build
 *   mneme.codegraph.root      — Merkle root for cross-machine sync
 *   mneme.codegraph.verify    — verify HMAC chain integrity
 *   mneme.codegraph.warn      — mark an edge as hallucination-vaccine
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const codegraphBuildTool: MnemeTool = {
  name: "mneme.codegraph.build",
  category: "meta",
  description:
    "LIVING SOUL CODEGRAPH — build the code graph (file deps + symbol references) for the current repo. Returns " +
    "stats + Merkle root + HMAC chain head. Unlike static codegraph tools, every edge is cryptographically attested + " +
    "tracks vendor attribution + can be re-verified offline. Self-builds in ~400ms for a 2000-file TS repo.",
  whenToUse: "First time per repo, OR after a major refactor, OR weekly to refresh stale edges.",
  triggers: ["build code graph", "mneme codegraph", "ดูแผนที่โค้ด", "scan codebase"],
  inputSchema: {
    type: "object",
    properties: {
      exclude: { type: "array", items: { type: "string" }, description: "Extra dir names to skip beyond defaults (node_modules / dist / .git / .mneme)." },
      maxBytes: { type: "number", description: "Skip files larger than this. Default 500_000." },
      touchedBy: { type: "string", description: "Override vendor attribution. Defaults to 'mneme-daemon'." },
    },
  },
  outputSchema: { type: "object" },
  pitfalls: [
    "Regex parser misses dynamic imports / computed names. AST-grade parser ships in v2.25.x.",
    "Persists to .mneme/codegraph/. First run is full rebuild; subsequent runs overwrite.",
  ],
  composeWith: ["mneme.codegraph.query", "mneme.codegraph.drift", "mneme.codegraph.root"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const g = core.codegraph.buildGraph(repoRoot, {
      exclude: Array.isArray(args["exclude"]) ? (args["exclude"] as string[]) : undefined,
      maxBytes: typeof args["maxBytes"] === "number" ? (args["maxBytes"] as number) : undefined,
      touchedBy: typeof args["touchedBy"] === "string" ? (args["touchedBy"] as string) : undefined,
    });
    core.codegraph.writeSnapshot(repoRoot, g);
    return {
      data: {
        commit: g.commit,
        builtAt: g.builtAt,
        merkleRoot: g.merkleRoot,
        signature: core.codegraph.graphSignature(g),
        stats: g.stats,
      },
      wisdom: `Built LIVING SOUL graph for commit ${g.commit.slice(0, 8)} — ${g.stats.nodes} nodes, ${g.stats.edges} edges. Merkle root pinned for cross-machine sync.`,
      followUp: ["mneme.codegraph.query", "mneme.codegraph.drift"],
      confidence: { level: "high" as const },
    };
  },
};

export const codegraphQueryTool: MnemeTool = {
  name: "mneme.codegraph.query",
  category: "meta",
  description:
    "LIVING SOUL CODEGRAPH — query nodes and edges. Filter by kind, path-contains, symbol substring, edge kind, or " +
    "warningsOnly (vaccine-marked edges). Returns a slice of the graph for the AI agent to reason over.",
  whenToUse: "AI agent needs to know who calls foo / which files depend on bar / which edges have hallucination warnings.",
  triggers: ["query code graph", "find function", "graph lookup", "find imports of"],
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", description: "Filter nodes by kind: file / function / class / interface / type / module / constant / external." },
      pathContains: { type: "string", description: "Filter nodes whose path contains this substring." },
      symbol: { type: "string", description: "Filter nodes whose symbol contains this substring (case-insensitive)." },
      srcIds: { type: "array", items: { type: "string" } },
      dstIds: { type: "array", items: { type: "string" } },
      edgeKinds: { type: "array", items: { type: "string" } },
      warningsOnly: { type: "boolean", description: "Only return edges that have a hallucination-vaccine warning." },
      limit: { type: "number", description: "Cap returned nodes + edges. Defaults to 200." },
    },
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.codegraph.build", "mneme.codegraph.drift"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const g = core.codegraph.readSnapshot(repoRoot);
    if (!g) {
      return {
        data: { error: "no graph; call mneme.codegraph.build first" },
        wisdom: "No graph on disk. Run `mneme.codegraph.build` first.",
        followUp: ["mneme.codegraph.build"],
        confidence: { level: "low" as const },
      };
    }
    const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 200;
    const opts: Parameters<typeof core.codegraph.query>[1] = {};
    if (typeof args["kind"] === "string") opts.kind = args["kind"] as never;
    if (typeof args["pathContains"] === "string") opts.pathContains = args["pathContains"] as string;
    if (typeof args["symbol"] === "string") opts.symbol = args["symbol"] as string;
    if (Array.isArray(args["srcIds"])) opts.srcIds = args["srcIds"] as string[];
    if (Array.isArray(args["dstIds"])) opts.dstIds = args["dstIds"] as string[];
    if (Array.isArray(args["edgeKinds"])) opts.edgeKinds = args["edgeKinds"] as never;
    if (args["warningsOnly"] === true) opts.warningsOnly = true;
    const r = core.codegraph.query(g, opts);
    return {
      data: {
        nodes: r.nodes.slice(0, limit),
        edges: r.edges.slice(0, limit),
        nodeCount: r.nodes.length,
        edgeCount: r.edges.length,
        truncated: r.nodes.length > limit || r.edges.length > limit,
      },
      wisdom: `${r.nodes.length} node(s), ${r.edges.length} edge(s) matched. ${opts.warningsOnly ? "Filter: vaccine warnings only." : ""}`,
      followUp: r.nodes.length === 0 ? ["mneme.codegraph.build"] : [],
      confidence: { level: "high" as const },
    };
  },
};

export const codegraphDriftTool: MnemeTool = {
  name: "mneme.codegraph.drift",
  category: "meta",
  description:
    "LIVING SOUL CODEGRAPH — detect broken or stale edges since the graph was built. Returns per-edge DriftEvent " +
    "with severity. The daemon ticks this organ; AI agents can call it before every code edit to know which edges " +
    "would break.",
  whenToUse: "Before applying any AI-suggested edit; CI gate; daemon-tick scheduling.",
  triggers: ["graph drift", "broken imports", "stale code graph"],
  inputSchema: {
    type: "object",
    properties: {
      record: { type: "boolean", description: "Append events to .mneme/codegraph/drift.jsonl. Default false." },
    },
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.codegraph.build"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const g = core.codegraph.readSnapshot(repoRoot);
    if (!g) {
      return {
        data: { error: "no graph; call mneme.codegraph.build first" },
        wisdom: "No graph on disk.",
        followUp: ["mneme.codegraph.build"],
        confidence: { level: "low" as const },
      };
    }
    const record = args["record"] === true;
    const d = core.codegraph.detectDrift(g, { record });
    return {
      data: { brokenEdges: d.brokenEdges, staleEdges: d.staleEdges, missingFiles: d.missingFiles, events: d.events.slice(0, 50) },
      wisdom: d.events.length === 0
        ? "✅ no drift — every edge in the graph points at a file that still exists."
        : `⚠ ${d.events.length} drift event(s) — ${d.brokenEdges} broken / ${d.staleEdges} stale / ${d.missingFiles} missing file(s).`,
      followUp: d.events.length > 0 ? ["mneme.codegraph.build"] : [],
      confidence: { level: "high" as const },
    };
  },
};

export const codegraphRootTool: MnemeTool = {
  name: "mneme.codegraph.root",
  category: "meta",
  description:
    "LIVING SOUL CODEGRAPH — return Merkle root + HMAC signature for cross-machine integrity check. Two installs " +
    "with the same root have identical graphs WITHOUT transmitting the full graph. Cross-machine sync cost ≈ O(log N).",
  whenToUse: "Cross-machine consistency check; federated trust graph; pre-push CI gate.",
  triggers: ["graph root", "merkle root", "graph signature"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  composeWith: ["mneme.codegraph.build", "mneme.codegraph.verify"],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const g = core.codegraph.readSnapshot(repoRoot);
    if (!g) {
      return {
        data: { error: "no graph; call mneme.codegraph.build first" },
        wisdom: "No graph on disk.",
        followUp: ["mneme.codegraph.build"],
        confidence: { level: "low" as const },
      };
    }
    return {
      data: {
        commit: g.commit,
        builtAt: g.builtAt,
        merkleRoot: g.merkleRoot,
        signature: core.codegraph.graphSignature(g),
        stats: g.stats,
      },
      wisdom: `Merkle root = ${g.merkleRoot.slice(0, 16)}…  signature = ${core.codegraph.graphSignature(g).slice(0, 16)}…`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const codegraphVerifyTool: MnemeTool = {
  name: "mneme.codegraph.verify",
  category: "meta",
  description:
    "LIVING SOUL CODEGRAPH — verify the HMAC chain integrity of the persisted edge list. Detects tampering at any " +
    "position. Returns ok=true OR the index + edge id of the first chain break.",
  whenToUse: "After cross-machine transport; periodic integrity audit; before trusting graph in a high-stakes decision.",
  triggers: ["verify code graph", "graph chain", "graph integrity"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  composeWith: ["mneme.codegraph.root"],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const g = core.codegraph.readSnapshot(repoRoot);
    if (!g) {
      return {
        data: { ok: false, reason: "no graph" },
        wisdom: "No graph on disk.",
        followUp: ["mneme.codegraph.build"],
        confidence: { level: "low" as const },
      };
    }
    const edges = [...g.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    const v = core.codegraph.verifyChain(edges);
    return {
      data: v.ok ? { ok: true, edges: edges.length } : v,
      wisdom: v.ok ? `✅ HMAC chain valid across ${edges.length} edges.` : `❌ HMAC chain FAIL at index ${(v as { firstBadIdx: number }).firstBadIdx}.`,
      followUp: v.ok ? [] : ["mneme.codegraph.build"],
      confidence: { level: "high" as const },
    };
  },
};

export const codegraphWarnTool: MnemeTool = {
  name: "mneme.codegraph.warn",
  category: "meta",
  description:
    "LIVING SOUL CODEGRAPH — mark an edge as a hallucination-vaccine warning. Future AI agents see the warning + " +
    "should NOT propose this edge again. Persists to the graph snapshot. CodeGraph (the competitor) has no such " +
    "anti-hallucination memory.",
  whenToUse: "When an AI hallucinated a function call / import that doesn't really exist and was caught; flag the edge.",
  triggers: ["mark hallucination", "graph warning", "anti hallucinate"],
  inputSchema: {
    type: "object",
    properties: {
      edgeId: { type: "string", description: "Edge id to mark." },
      reason: { type: "string", description: "Short explanation of why this edge is hallucinated." },
    },
    required: ["edgeId", "reason"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.codegraph.query"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoRoot = repoRootOf(rt);
    const g = core.codegraph.readSnapshot(repoRoot);
    if (!g) {
      return {
        data: { ok: false, reason: "no graph" },
        wisdom: "No graph on disk.",
        followUp: ["mneme.codegraph.build"],
        confidence: { level: "low" as const },
      };
    }
    const edgeId = String(args["edgeId"] ?? "");
    const reason = String(args["reason"] ?? "hallucinated");
    const ok = core.codegraph.markVaccineWarning(g, edgeId, reason);
    if (ok) core.codegraph.writeSnapshot(repoRoot, g);
    return {
      data: { ok, edgeId, reason },
      wisdom: ok ? `🦠 Vaccine warning attached to edge ${edgeId}. Future AI proposals to recreate this edge will see the warning.` : `Edge ${edgeId} not found.`,
      followUp: ok ? ["mneme.codegraph.query"] : [],
      confidence: { level: "high" as const },
    };
  },
};

export const CODEGRAPH_TOOLS: MnemeTool[] = [
  codegraphBuildTool,
  codegraphQueryTool,
  codegraphDriftTool,
  codegraphRootTool,
  codegraphVerifyTool,
  codegraphWarnTool,
];
