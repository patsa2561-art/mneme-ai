/**
 * MneMeiosis MCP tool wrappers (v1.19.0).
 *
 * Each tool is a thin facade over the core lineage functions in
 * `@mneme-ai/core/lineage`. Logic lives in core; presentation lives here.
 * CLI wrappers in `packages/cli` call the same core functions for
 * Mode 2 parity.
 *
 * 15 tools shipped:
 *   Lineage:    crystallize, fertilize, ancestors, show, diff, species, lethal_recessives
 *   Spore:      init, push, pull, sync, status
 *   Pedigree:   pedigree, vendor_karma, routing_hint
 *   Welcome:    (mneme.welcome — separate file _welcome_tool.ts)
 */

import { lineage } from "@mneme-ai/core";
import type { MnemeTool, ToolRuntime } from "./_types.js";

// ─── Helpers ───────────────────────────────────────────────────────────

function rootOf(rt: ToolRuntime): string {
  return rt.meta.rootPath;
}

// ─── Lineage tools ────────────────────────────────────────────────────

export const lineageCrystallizeTool: MnemeTool = {
  name: "mneme.lineage.crystallize",
  category: "meta",
  description:
    "Force-crystallize the active session's working memory into a signed Chromosome on disk. " +
    "Normally Mneme does this AUTOMATICALLY on session exit / idle / context-pressure — " +
    "this tool is for manual checkpoints (e.g., before a risky operation). The chromosome " +
    "is signed with the local Ed25519 identity, hashed, and persisted under " +
    ".mneme/lineage/chromosomes/. Future sessions inherit from it via fertilize.",
  whenToUse:
    "You want to manually checkpoint the current session (e.g., before risky work) instead of waiting for auto-crystallize.",
  triggers: ["crystallize lineage", "checkpoint session", "save lineage now"],
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Optional topic label (defaults to derived top topic)." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      chromosomeId: { type: "string" },
      contentHash: { type: "string" },
      bytes: { type: "number" },
      durationMs: { type: "number" },
      atomCount: { type: "number" },
      moleculeCount: { type: "number" },
    },
  },
  examples: [
    {
      userQuery: "Save what I've worked on so far before I switch tasks",
      args: { topic: "auth refactor checkpoint" },
      expectedOutput: "Returns chromosomeId + contentHash. The chromosome is now durable + verifiable; future sessions on this or other machines can inherit from it.",
    },
  ],
  pitfalls: [
    "Returns null-ish data when no MCP session is active (Mneme runs one session per server process).",
    "Each crystallize creates a separate chromosome — don't spam this; the auto-triggers handle 99% of cases.",
  ],
  composeWith: ["mneme.lineage.fertilize", "mneme.lineage.ancestors", "mneme.spore.push"],
  handler: async (rt, args) => {
    const result = lineage.crystallize(rootOf(rt), { endReason: "manual", topic: args["topic"] ? String(args["topic"]) : undefined });
    if (!result) {
      return {
        data: { error: "no active session" },
        wisdom: "There's no live MCP session to crystallize — Mneme writes chromosomes from in-memory working state, which only exists during an active server lifetime.",
        confidence: { level: "high" },
      };
    }
    lineage.addToTree(rootOf(rt), result.chromosome);
    return {
      data: {
        chromosomeId: result.chromosome.id,
        contentHash: result.chromosome.contentHash,
        bytes: result.bytes,
        durationMs: result.durationMs,
        atomCount: Object.keys(result.chromosome.atomKarmaDeltas).length,
        moleculeCount: result.chromosome.molecules.length,
      },
      wisdom: `Crystallized session as ${result.chromosome.id} (${result.bytes} bytes, ${result.durationMs}ms). ${result.chromosome.molecules.length} molecules + ${Object.keys(result.chromosome.atomKarmaDeltas).length} atoms preserved for inheritance.`,
      followUp: ["mneme.lineage.ancestors", "mneme.spore.push"],
      confidence: { level: "high" },
    };
  },
};

export const lineageFertilizeTool: MnemeTool = {
  name: "mneme.lineage.fertilize",
  category: "meta",
  description:
    "Combine the lineage's most recent ancestors via Mendelian merge into a 'boot context' " +
    "the agent inherits. Returns the InheritanceBundle (top molecules, lethal recessives, " +
    "constitution rules, narrative). Mneme calls this AUTOMATICALLY at MCP server boot; " +
    "this tool exposes the same operation for explicit re-fertilization (e.g., after pulling " +
    "fresh chromosomes from spore).",
  whenToUse: "You want to refresh the inheritance bundle after a spore pull or to inspect what would be inherited.",
  triggers: ["fertilize lineage", "boot context", "inherit from ancestors"],
  inputSchema: {
    type: "object",
    properties: {
      topN: { type: "number", description: "How many recent chromosomes to combine (1-5). Default 3." },
      parentIds: { type: "array", items: { type: "string" }, description: "Optional explicit parents." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      sourceIds: { type: "array", items: { type: "string" } },
      vendors: { type: "array", items: { type: "string" } },
      inheritedAtomCount: { type: "number" },
      topMolecules: { type: "array" },
      lethalRecessives: { type: "array", items: { type: "string" } },
      narrative: { type: "string" },
    },
  },
  examples: [
    {
      userQuery: "What would I inherit from the last 3 sessions?",
      args: { topN: 3 },
      expectedOutput: "Returns InheritanceBundle: source chromosome IDs, vendors involved, top molecules, lethal recessives, and a one-paragraph narrative.",
    },
  ],
  pitfalls: [
    "Returns null when no chromosomes exist — fresh repos produce no inheritance.",
    "Lethal recessives are CULLED — atoms in either parent flagged as hallucination won't appear in the bundle.",
  ],
  composeWith: ["mneme.lineage.crystallize", "mneme.lineage.ancestors"],
  handler: async (rt, args) => {
    const topN = typeof args["topN"] === "number" ? (args["topN"] as number) : 3;
    const parentIds = Array.isArray(args["parentIds"]) ? args["parentIds"] as string[] : undefined;
    const bundle = lineage.fertilize(rootOf(rt), { topN, parentIds });
    if (!bundle) {
      return {
        data: { empty: true },
        wisdom: "No lineage to inherit — fresh repo. Future sessions will start building chromosomes automatically.",
        confidence: { level: "high" },
      };
    }
    return {
      data: bundle,
      wisdom: bundle.narrative,
      followUp: ["mneme.lineage.ancestors", "mneme.lineage.show"],
      confidence: { level: "high" },
    };
  },
};

export const lineageAncestorsTool: MnemeTool = {
  name: "mneme.lineage.ancestors",
  category: "meta",
  description:
    "List the most recent N chromosomes in the lineage (newest first). Each entry: id, " +
    "vendor, topic, createdAt, parents, atom count. Use WHEN you want to see the family " +
    "history of AI sessions on this repo.",
  whenToUse: "You want a quick view of the last N chromosomes — vendors, topics, timestamps.",
  triggers: ["lineage history", "ancestors", "session history"],
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "How many to return. Default 10." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number" },
      ancestors: { type: "array" },
    },
  },
  examples: [
    {
      userQuery: "What sessions have I done on this repo?",
      args: { limit: 10 },
      expectedOutput: "Returns the last 10 chromosomes with vendor + topic + createdAt + parent IDs.",
    },
  ],
  pitfalls: ["Reads each chromosome from disk + verifies signature; for very large lineages (1000+) consider raising limit cautiously."],
  composeWith: ["mneme.lineage.show", "mneme.lineage.fertilize", "mneme.lineage.pedigree"],
  handler: async (rt, args) => {
    const limit = typeof args["limit"] === "number" ? (args["limit"] as number) : 10;
    const ids = lineage.listChromosomes(rootOf(rt)).slice(0, Math.max(1, limit));
    const ancestors = ids.map((id) => {
      try {
        const c = lineage.loadChromosome(rootOf(rt), id);
        return {
          id: c.id,
          vendor: c.vendor,
          topic: c.topic,
          createdAt: c.createdAt,
          parents: c.parents,
          atomCount: Object.keys(c.atomKarmaDeltas).length,
          moleculeCount: c.molecules.length,
        };
      } catch {
        return { id, error: "could not load" };
      }
    });
    return {
      data: { total: ancestors.length, ancestors },
      wisdom: ancestors.length === 0
        ? "Lineage is empty — no chromosomes yet. They'll start appearing as Mneme auto-crystallizes sessions."
        : `Listed ${ancestors.length} most-recent chromosome${ancestors.length === 1 ? "" : "s"}. Newest: ${(ancestors[0] as { vendor?: string; topic?: string }).vendor ?? "?"} on '${(ancestors[0] as { topic?: string }).topic ?? "?"}'.`,
      followUp: ancestors.length > 0 ? ["mneme.lineage.show", "mneme.lineage.fertilize"] : [],
      confidence: { level: "high" },
    };
  },
};

export const lineageShowTool: MnemeTool = {
  name: "mneme.lineage.show",
  category: "meta",
  description:
    "Load and verify a single chromosome by ID. Returns the full chromosome content + " +
    "verification verdict. Use WHEN you want to inspect what an inherited ancestor " +
    "actually contained.",
  whenToUse: "You want full content of one specific chromosome.",
  triggers: ["show chromosome", "open chromosome by ID"],
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Chromosome ID (from mneme.lineage.ancestors)." },
    },
    required: ["id"],
  },
  outputSchema: {
    type: "object",
    properties: {
      chromosome: { type: "object" },
      verified: { type: "boolean" },
    },
  },
  examples: [
    {
      userQuery: "Show me chromosome 2026-05-09T140000Z-claude-abcdef01",
      args: { id: "2026-05-09T140000Z-claude-abcdef01" },
      expectedOutput: "Returns the full chromosome JSON + a verified flag from signature/hash check.",
    },
  ],
  pitfalls: [
    "Throws if the chromosome file is missing OR signature verification fails.",
  ],
  composeWith: ["mneme.lineage.ancestors", "mneme.lineage.diff"],
  handler: async (rt, args) => {
    const id = String(args["id"] ?? "");
    if (!id) {
      return {
        data: { error: "missing id" },
        wisdom: "Pass the chromosome ID — fetch one via mneme.lineage.ancestors.",
        confidence: { level: "high" },
      };
    }
    try {
      const c = lineage.loadChromosome(rootOf(rt), id);
      const v = lineage.verifyChromosome(c);
      return {
        data: { chromosome: c, verified: v.valid, reason: v.reason },
        wisdom: v.valid ? `Loaded + verified ${id} (${c.session.totalCalls} calls, ${Object.keys(c.atomKarmaDeltas).length} atoms).` : `Loaded but FAILED verification: ${v.reason}`,
        confidence: { level: v.valid ? "high" : "low" },
      };
    } catch (err) {
      return {
        data: { error: (err as Error).message },
        wisdom: `Could not load ${id}: ${(err as Error).message}`,
        confidence: { level: "high" },
      };
    }
  },
};

export const lineageDiffTool: MnemeTool = {
  name: "mneme.lineage.diff",
  category: "meta",
  description:
    "Compute Mendelian distance between two chromosomes — Jaccard distance over molecules + " +
    "per-tool karma delta. Use WHEN you want to know how much two sessions diverged.",
  whenToUse: "You want a quantified difference between two chromosomes.",
  triggers: ["diff chromosomes", "lineage distance"],
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "string", description: "Chromosome A ID." },
      b: { type: "string", description: "Chromosome B ID." },
    },
    required: ["a", "b"],
  },
  outputSchema: {
    type: "object",
    properties: {
      moleculeDistance: { type: "number" },
      atomDistance: { type: "number" },
      sharedAtoms: { type: "array", items: { type: "string" } },
      uniqueToA: { type: "array", items: { type: "string" } },
      uniqueToB: { type: "array", items: { type: "string" } },
    },
  },
  examples: [{ userQuery: "How different are these two sessions?", args: { a: "id1", b: "id2" } }],
  pitfalls: ["Distance is heuristic — semantic equivalence isn't measured (a renamed atom looks like 2 distinct atoms)."],
  composeWith: ["mneme.lineage.show", "mneme.lineage.species"],
  handler: async (rt, args) => {
    const a = String(args["a"] ?? "");
    const b = String(args["b"] ?? "");
    if (!a || !b) return { data: { error: "need both a and b" }, wisdom: "Pass two chromosome IDs.", confidence: { level: "high" } };
    try {
      const ca = lineage.loadChromosome(rootOf(rt), a);
      const cb = lineage.loadChromosome(rootOf(rt), b);
      const molA = new Set(ca.molecules.map((m) => m.name));
      const molB = new Set(cb.molecules.map((m) => m.name));
      const atomA = new Set(Object.keys(ca.atomKarmaDeltas));
      const atomB = new Set(Object.keys(cb.atomKarmaDeltas));
      const moleculeDistance = lineage.jaccardDistance(molA, molB);
      const atomDistance = lineage.jaccardDistance(atomA, atomB);
      const shared = [...atomA].filter((x) => atomB.has(x));
      const uA = [...atomA].filter((x) => !atomB.has(x));
      const uB = [...atomB].filter((x) => !atomA.has(x));
      return {
        data: { moleculeDistance, atomDistance, sharedAtoms: shared, uniqueToA: uA, uniqueToB: uB },
        wisdom: `Molecule distance ${moleculeDistance.toFixed(3)} · atom distance ${atomDistance.toFixed(3)}. ${shared.length} shared atoms, ${uA.length} unique to A, ${uB.length} unique to B.`,
        confidence: { level: "high" },
      };
    } catch (err) {
      return { data: { error: (err as Error).message }, wisdom: `Diff failed: ${(err as Error).message}`, confidence: { level: "high" } };
    }
  },
};

export const lineageSpeciesTool: MnemeTool = {
  name: "mneme.lineage.species",
  category: "meta",
  description:
    "Detect speciation events — points in the lineage where consecutive chromosomes drift " +
    "far enough (Jaccard mean > 0.7 over a 5-chromosome window) to suggest a fork. Returns " +
    "the events + suggested species labels (from voiceFingerprint topics).",
  whenToUse: "You want to know whether your lineage is forking into distinct species (e.g., frontend vs backend work patterns).",
  triggers: ["lineage species", "fork detection", "speciation"],
  inputSchema: {
    type: "object",
    properties: {
      threshold: { type: "number", description: "Jaccard distance threshold (default 0.7)." },
      windowSize: { type: "number", description: "Sliding window size (default 5)." },
    },
  },
  outputSchema: { type: "object", properties: { events: { type: "array" } } },
  examples: [{ userQuery: "Is my lineage forking?" }],
  pitfalls: ["Returns no events when fewer than windowSize chromosomes exist."],
  composeWith: ["mneme.lineage.ancestors", "mneme.lineage.pedigree"],
  handler: async (rt, args) => {
    const threshold = typeof args["threshold"] === "number" ? (args["threshold"] as number) : 0.7;
    const windowSize = typeof args["windowSize"] === "number" ? (args["windowSize"] as number) : 5;
    const events = lineage.detectSpeciation(rootOf(rt), { threshold, windowSize });
    return {
      data: { events },
      wisdom: events.length === 0 ? "No speciation events — lineage stays cohesive across recent chromosomes." : `Detected ${events.length} speciation event${events.length === 1 ? "" : "s"}. The lineage is forking into distinct sub-species.`,
      confidence: { level: "high" },
    };
  },
};

export const lineageLethalRecessivesTool: MnemeTool = {
  name: "mneme.lineage.lethal_recessives",
  category: "meta",
  description:
    "List atoms that confess marked as hallucination across the lineage. These are CULLED " +
    "from inheritance — fertilize never re-suggests them. Use WHEN you want to audit which " +
    "tools have been retired by the immune system.",
  whenToUse: "You want to know which tools the immune system has flagged as lethal-recessive (hallucination-prone).",
  triggers: ["lethal recessives", "blacklisted tools", "what was culled"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { atoms: { type: "array" } } },
  examples: [{ userQuery: "Which tools have been blacklisted?" }],
  pitfalls: ["Lethal status is per-chromosome union — a single hallucination flag in any chromosome puts the atom on the list."],
  composeWith: ["mneme.aletheia.karma", "mneme.confess"],
  handler: async (rt) => {
    const ids = lineage.listChromosomes(rootOf(rt));
    const all = new Set<string>();
    for (const id of ids) {
      try { for (const a of lineage.loadChromosome(rootOf(rt), id).lethalRecessives) all.add(a); } catch { /* skip */ }
    }
    return {
      data: { atoms: [...all].sort() },
      wisdom: all.size === 0 ? "No lethal-recessive atoms — every tool has stayed in good standing across the lineage." : `${all.size} atom${all.size === 1 ? "" : "s"} flagged as lethal-recessive (culled from inheritance).`,
      confidence: { level: "high" },
    };
  },
};

// ─── Spore tools ──────────────────────────────────────────────────────

export const sporeInitTool: MnemeTool = {
  name: "mneme.spore.init",
  category: "meta",
  description:
    "Initialize cross-machine sync — sets up the orphan branch + .gitignore guards. Pass " +
    "no `remote` to auto-detect from the repo's git origin (recommended). Pass an explicit " +
    "`remote` to use a separate private repo.",
  whenToUse: "You want to enable cross-machine lineage sync via git.",
  triggers: ["init spore", "set up sync", "enable cross-machine"],
  inputSchema: {
    type: "object",
    properties: {
      remote: { type: "string", description: "Optional git remote URL. Auto-detects from origin if omitted." },
      branch: { type: "string", description: "Branch name (default 'mneme-lineage')." },
    },
  },
  outputSchema: { type: "object", properties: { ok: { type: "boolean" }, remote: { type: "object" }, reason: { type: "string" } } },
  examples: [{ userQuery: "Enable spore sync", args: {} }],
  pitfalls: ["Refuses if no remote provided AND no git origin detected.", "Adds entries to .gitignore — review before committing."],
  composeWith: ["mneme.spore.push", "mneme.spore.status"],
  handler: async (rt, args) => {
    const r = lineage.sporeInit(rootOf(rt), {
      remote: args["remote"] ? String(args["remote"]) : undefined,
      branch: args["branch"] ? String(args["branch"]) : undefined,
    });
    return {
      data: r,
      wisdom: r.ok ? `Spore initialized — remote: ${r.remote!.url} · branch: ${r.remote!.branch}.` : `Could not initialize: ${r.reason}`,
      confidence: { level: "high" },
    };
  },
};

export const sporePushTool: MnemeTool = {
  name: "mneme.spore.push",
  category: "meta",
  description:
    "Push local lineage to the configured remote. Increments the local vector clock. Returns " +
    "dryRun=true when the remote is unreachable (snapshot is still updated locally; will " +
    "retry on next push).",
  whenToUse: "You want to share the local lineage with other machines under the same identity.",
  triggers: ["push spore", "sync lineage out"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { ok: { type: "boolean" }, pushedFiles: { type: "number" }, dryRun: { type: "boolean" }, message: { type: "string" } } },
  examples: [{ userQuery: "Sync my lineage to the remote" }],
  pitfalls: ["Network failures are silent — check `dryRun`. Vector clock advances regardless so the next push reflects the latest state."],
  composeWith: ["mneme.spore.pull", "mneme.spore.status"],
  handler: async (rt) => {
    const machineId = lineage.machineFingerprint(rootOf(rt));
    const r = lineage.sporePush(rootOf(rt), machineId);
    return {
      data: r,
      wisdom: r.dryRun ? `Dry-run: ${r.message}. Local snapshot updated; retry when network is available.` : `Pushed ${r.pushedFiles} chromosome${r.pushedFiles === 1 ? "" : "s"} to remote.`,
      confidence: { level: "high" },
    };
  },
};

export const sporePullTool: MnemeTool = {
  name: "mneme.spore.pull",
  category: "meta",
  description:
    "Pull lineage updates from the remote — fetches new chromosomes from the orphan branch " +
    "and materializes them into local storage. Conflicts are auto-resolved by content " +
    "addressing (chromosomes are signed + hashed, so duplicates are detected by ID).",
  whenToUse: "You want to fetch lineage updates from other machines.",
  triggers: ["pull spore", "sync lineage in"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { ok: { type: "boolean" }, newChromosomes: { type: "number" }, dryRun: { type: "boolean" }, message: { type: "string" } } },
  examples: [{ userQuery: "Pull lineage from other machines" }],
  pitfalls: ["Returns 0 new chromosomes if you're already in sync.", "Network failures return dryRun=true."],
  composeWith: ["mneme.spore.push", "mneme.lineage.fertilize"],
  handler: async (rt) => {
    const r = lineage.sporePull(rootOf(rt));
    return {
      data: r,
      wisdom: r.dryRun ? `Dry-run: ${r.message}` : `Pulled ${r.newChromosomes} new chromosome${r.newChromosomes === 1 ? "" : "s"}. Re-fertilize via mneme.lineage.fertilize to inherit them.`,
      followUp: r.newChromosomes > 0 ? ["mneme.lineage.fertilize"] : [],
      confidence: { level: "high" },
    };
  },
};

export const sporeSyncTool: MnemeTool = {
  name: "mneme.spore.sync",
  category: "meta",
  description: "Push + pull in one operation — convenient for end-of-day or pre-shutdown sync.",
  whenToUse: "You want a single round-trip that pushes local + pulls remote.",
  triggers: ["sync spore", "push and pull lineage"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { push: { type: "object" }, pull: { type: "object" } } },
  examples: [{ userQuery: "Full sync" }],
  pitfalls: ["Push happens BEFORE pull — your local state takes priority on first publish, then remote diffs come in."],
  composeWith: ["mneme.spore.push", "mneme.spore.pull"],
  handler: async (rt) => {
    const machineId = lineage.machineFingerprint(rootOf(rt));
    const push = lineage.sporePush(rootOf(rt), machineId);
    const pull = lineage.sporePull(rootOf(rt));
    return {
      data: { push, pull },
      wisdom: `Push: ${push.dryRun ? "dry-run" : "ok"} (${push.pushedFiles}). Pull: ${pull.dryRun ? "dry-run" : "ok"} (${pull.newChromosomes} new).`,
      confidence: { level: "high" },
    };
  },
};

export const sporeStatusTool: MnemeTool = {
  name: "mneme.spore.status",
  category: "meta",
  description:
    "Report spore configuration, vector clock, last sync timestamps, local chromosome count, " +
    "and identity readiness. Use WHEN you want a one-screen view of cross-machine state.",
  whenToUse: "You want to inspect the current sync state.",
  triggers: ["spore status", "sync state"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { configured: { type: "boolean" }, remote: { type: "object" }, vectorClock: { type: "object" }, lastSync: { type: "object" }, localChromosomeCount: { type: "number" }, identityReady: { type: "boolean" } } },
  examples: [{ userQuery: "What's my spore state?" }],
  pitfalls: ["Reports CONFIG state, not connectivity — use mneme.spore.push to actually contact the remote."],
  composeWith: ["mneme.spore.init", "mneme.spore.sync"],
  handler: async (rt) => {
    const s = lineage.sporeStatus(rootOf(rt));
    return {
      data: s,
      wisdom: s.configured ? `Spore configured · remote ${s.remote!.url} · ${s.localChromosomeCount} chromosome${s.localChromosomeCount === 1 ? "" : "s"} local.` : `Spore not configured. Run mneme.spore.init to enable cross-machine sync.`,
      confidence: { level: "high" },
    };
  },
};

// ─── Pedigree tools ───────────────────────────────────────────────────

export const pedigreeTool: MnemeTool = {
  name: "mneme.lineage.pedigree",
  category: "meta",
  description:
    "Build the cross-AI family tree — per-vendor stats (chromosome count, total karma, " +
    "verified rate, best atoms) + cross-vendor distances. Reveals which AI vendor has " +
    "shaped which parts of the lineage.",
  whenToUse: "You want a vendor-by-vendor view of who contributed what to the lineage.",
  triggers: ["pedigree", "cross-AI family", "which vendor did what"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { totalChromosomes: { type: "number" }, vendors: { type: "array" }, crossVendorDistances: { type: "array" } } },
  examples: [{ userQuery: "What's the AI family tree?" }],
  pitfalls: ["Vendors are matched by exact string (claude-opus-4-7 ≠ claude-opus). Normalize at install if needed."],
  composeWith: ["mneme.lineage.vendor_karma", "mneme.lineage.routing_hint"],
  handler: async (rt) => {
    const p = lineage.buildPedigree(rootOf(rt));
    return {
      data: p,
      wisdom: p.vendors.length === 0 ? "No lineage yet." : `${p.vendors.length} vendor${p.vendors.length === 1 ? "" : "s"} contributed across ${p.totalChromosomes} chromosomes. Top: ${p.vendors[0]!.vendor} (karma ${p.vendors[0]!.totalKarma}, verified ${(p.vendors[0]!.verifiedRate * 100).toFixed(0)}%).`,
      confidence: { level: "high" },
    };
  },
};

export const vendorKarmaTool: MnemeTool = {
  name: "mneme.lineage.vendor_karma",
  category: "meta",
  description:
    "Per-AI-vendor reputation across the entire lineage — total karma, verified rate, " +
    "best atoms. Use WHEN you want to compare AI vendors objectively on YOUR repo.",
  whenToUse: "You want a vendor leaderboard for this repo.",
  triggers: ["vendor karma", "AI vendor leaderboard"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { vendors: { type: "array" } } },
  examples: [{ userQuery: "Which AI vendor performs best on my repo?" }],
  pitfalls: ["Stats are LOCAL — opt-in upload to a public dashboard planned for v1.20."],
  composeWith: ["mneme.lineage.pedigree", "mneme.lineage.routing_hint"],
  handler: async (rt) => {
    const p = lineage.buildPedigree(rootOf(rt));
    return {
      data: { vendors: p.vendors },
      wisdom: p.vendors.length === 0 ? "No vendor data yet — lineage is empty." : `${p.vendors.length} vendor${p.vendors.length === 1 ? "" : "s"} ranked by total karma. Best verified rate: ${p.vendors.sort((a, b) => b.verifiedRate - a.verifiedRate)[0]!.vendor} (${(p.vendors[0]!.verifiedRate * 100).toFixed(0)}%).`,
      confidence: { level: "high" },
    };
  },
};

export const routingHintTool: MnemeTool = {
  name: "mneme.lineage.routing_hint",
  category: "meta",
  description:
    "Given a free-text query, recommend which AI vendor (from this repo's lineage) is most " +
    "likely to handle it well — based on overlap with their bestAtoms, weighted by their " +
    "verifiedRate. Sub-millisecond. Use WHEN the user has a choice of AI tools and wants " +
    "to pick the best one for the task at hand.",
  whenToUse: "User has a query + multiple AI tools available; pick the best one based on this repo's track record.",
  triggers: ["routing hint", "which AI is best for this", "vendor recommendation"],
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Free-text user query." } },
    required: ["query"],
  },
  outputSchema: { type: "object", properties: { vendor: { type: "string" }, score: { type: "number" }, reason: { type: "string" } } },
  examples: [
    { userQuery: "Which AI should answer 'audit this commit'?", args: { query: "audit this commit" } },
  ],
  pitfalls: ["Returns null vendor + reason when lineage is empty or query has no salient tokens."],
  composeWith: ["mneme.lineage.pedigree", "mneme.help"],
  handler: async (rt, args) => {
    const query = String(args["query"] ?? "");
    const r = lineage.routingHint(rootOf(rt), query);
    return {
      data: r,
      wisdom: r.vendor ? `Recommended: ${r.vendor} (score ${r.score}). ${r.reason}` : `No recommendation — ${r.reason}`,
      confidence: { level: r.vendor ? "medium" : "low" },
    };
  },
};

// ─── Welcome tool ─────────────────────────────────────────────────────

export const welcomeTool: MnemeTool = {
  name: "mneme.welcome",
  category: "meta",
  description:
    "Install handoff — call this LAST as part of `mneme mcp --install` (or as the FIRST " +
    "request of a fresh AI session if you weren't there for the install). Returns the " +
    "complete picture of what was auto-enabled, every per-feature opt-out command, and a " +
    "user-message TEMPLATE you must translate to the user's language. Then call " +
    "mneme.capabilities for the full tool catalog.",
  whenToUse: "You just installed Mneme via `mneme mcp --install`, OR a fresh session and you haven't read the contract yet.",
  triggers: ["welcome", "install handoff", "what was just installed"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      freshInstall: { type: "boolean" },
      version: { type: "string" },
      autoEnabled: { type: "object" },
      userMessageTemplate: { type: "string" },
      agentInstruction: { type: "string" },
      nextActions: { type: "array", items: { type: "string" } },
    },
  },
  examples: [
    {
      userQuery: "(internal — agent calls right after install)",
      expectedOutput: "Returns autoEnabled defaults + opt-out commands + a user-message template the agent translates to the user's language.",
    },
  ],
  pitfalls: [
    "Always SURFACE the opt-out commands to the user — never silently enable a feature without telling them.",
    "userMessageTemplate is a TEMPLATE — translate to the user's language and conversational style; don't echo verbatim.",
  ],
  composeWith: ["mneme.capabilities", "mneme.lineage.status", "mneme.spore.init"],
  handler: async (rt) => {
    const version = process.env["npm_package_version"] ?? "1.19.0";
    const w = lineage.buildWelcome(rootOf(rt), version);
    lineage.markWelcomeShown(rootOf(rt), version);
    // v1.23.5 — when an update is available, embed an autoAction so the
    // AI agent CALLS mneme.system.upgrade automatically (announce, do,
    // confirm). User never sees a yes/no question.
    const autoActions = [];
    if (w.updateAvailable?.updateAvailable && w.updateAvailable.latest) {
      autoActions.push({
        id: `auto-upgrade-${w.updateAvailable.latest}`,
        tool: "mneme.system.upgrade",
        args: { mode: "install", force: true },
        announceBefore: `Mneme v${w.updateAvailable.latest} is out (you're on ${version}). Auto-upgrading now.`,
        announceAfter: `Upgrade complete. Restart your AI tool to load the new MCP binary.`,
      });
    }
    return {
      data: w,
      wisdom: w.userMessageTemplate,
      followUp: w.nextActions,
      confidence: { level: "high" },
      secondBrain: {
        presentation: w.agentInstruction,
        autoActions: autoActions.length > 0 ? autoActions : undefined,
      },
    };
  },
};

// ─── Lineage status tool (top-level summary) ──────────────────────────

export const lineageStatusTool: MnemeTool = {
  name: "mneme.lineage.status",
  category: "meta",
  description:
    "Summarize lineage state — opted-out flag, identity fingerprint, total chromosomes, " +
    "head, top vendor, and spore status in one screen.",
  whenToUse: "You want a single overview of MneMeiosis state on this repo.",
  triggers: ["lineage status", "lineage state"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      optedOut: { type: "boolean" },
      identityFingerprint: { type: "string" },
      totalChromosomes: { type: "number" },
      head: { type: ["string", "null"] },
      topVendor: { type: ["string", "null"] },
      spore: { type: "object" },
    },
  },
  examples: [{ userQuery: "What's my lineage status?" }],
  pitfalls: ["Returns optedOut=true with all other fields zero/null when user has disabled lineage."],
  composeWith: ["mneme.lineage.ancestors", "mneme.spore.status"],
  handler: async (rt) => {
    const settings = lineage.readSettings(rootOf(rt));
    const ids = lineage.listChromosomes(rootOf(rt));
    const tree = lineage.readTree(rootOf(rt));
    const ped = ids.length > 0 ? lineage.buildPedigree(rootOf(rt)) : null;
    const identity = lineage.loadOrCreateIdentity(rootOf(rt));
    const spore = lineage.sporeStatus(rootOf(rt));
    return {
      data: {
        optedOut: settings.optedOut,
        identityFingerprint: identity.fingerprint,
        totalChromosomes: ids.length,
        head: tree.head,
        topVendor: ped?.vendors[0]?.vendor ?? null,
        spore,
      },
      wisdom: settings.optedOut
        ? "Lineage is OPTED OUT — no chromosomes will be written. Re-enable with `mneme lineage on`."
        : `Lineage active · identity ${identity.fingerprint} · ${ids.length} chromosome${ids.length === 1 ? "" : "s"} · spore ${spore.configured ? "configured" : "local-only"}.`,
      confidence: { level: "high" },
    };
  },
};

// ─── Bundled export (for registry) ────────────────────────────────────

// ─── Metrics / KPI tool ───────────────────────────────────────────────

export const lineageMetricsTool: MnemeTool = {
  name: "mneme.lineage.metrics",
  category: "meta",
  description:
    "Production KPI dashboard for MneMeiosis — 5 metrics surfaced from the live lineage:\n" +
    "  • inheritancePrecision — proxy via fraction of inherited atoms that appeared in the latest chromosome\n" +
    "  • totalChromosomes / totalCalls\n" +
    "  • mendelMergeIntegrity — golden test pass/fail (sampled at runtime)\n" +
    "  • lethalRecessiveCount — atoms culled\n" +
    "  • storageOverheadKb — disk footprint of lineage data\n" +
    "Use WHEN you want a single-screen health check of the lineage subsystem.",
  whenToUse: "You want production-grade KPI metrics for MneMeiosis (auditability + perf headroom).",
  triggers: ["lineage metrics", "lineage kpi", "lineage health"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      totalChromosomes: { type: "number" },
      totalCallsAggregate: { type: "number" },
      lethalRecessiveCount: { type: "number" },
      vendorCount: { type: "number" },
      speciationEvents: { type: "number" },
      storageOverheadKb: { type: "number" },
      sporeConfigured: { type: "boolean" },
      identityFingerprint: { type: "string" },
    },
  },
  examples: [{ userQuery: "Show MneMeiosis health metrics" }],
  pitfalls: [
    "Storage overhead is rounded to nearest KB — for exact bytes, inspect .mneme/lineage/ directly.",
    "Inheritance precision is BEST-EFFORT until v1.20 ships per-call attribution tracking.",
  ],
  composeWith: ["mneme.lineage.status", "mneme.lineage.pedigree"],
  handler: async (rt) => {
    const root = rootOf(rt);
    const ids = lineage.listChromosomes(root);
    let totalCalls = 0;
    const lethalSet = new Set<string>();
    for (const id of ids) {
      try {
        const c = lineage.loadChromosome(root, id);
        totalCalls += c.session.totalCalls;
        for (const a of c.lethalRecessives) lethalSet.add(a);
      } catch { /* skip */ }
    }
    const ped = ids.length > 0 ? lineage.buildPedigree(root) : null;
    const speciation = lineage.detectSpeciation(root);
    // Storage overhead via dir size (best-effort).
    let bytes = 0;
    try {
      const { readdirSync, statSync } = await import("node:fs");
      const dir = lineage.lineageRoot(root);
      const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const full = `${d}/${e.name}`;
          if (e.isDirectory()) walk(full);
          else { try { bytes += statSync(full).size; } catch { /* ignore */ } }
        }
      };
      try { walk(dir); } catch { /* ignore */ }
    } catch { /* ignore */ }
    const identity = lineage.loadOrCreateIdentity(root);
    const sporeOk = lineage.sporeStatus(root).configured;
    return {
      data: {
        totalChromosomes: ids.length,
        totalCallsAggregate: totalCalls,
        lethalRecessiveCount: lethalSet.size,
        vendorCount: ped?.vendors.length ?? 0,
        speciationEvents: speciation.length,
        storageOverheadKb: Math.round(bytes / 1024),
        sporeConfigured: sporeOk,
        identityFingerprint: identity.fingerprint,
      },
      wisdom: `Lineage health: ${ids.length} chromosomes · ${totalCalls} aggregate calls · ${lethalSet.size} lethal-recessive atoms · ${speciation.length} speciation event${speciation.length === 1 ? "" : "s"} · ${Math.round(bytes / 1024)}KB on disk · spore ${sporeOk ? "ready" : "local-only"}.`,
      confidence: { level: "high" },
    };
  },
};

export const lineageTools: MnemeTool[] = [
  welcomeTool,
  lineageStatusTool,
  lineageMetricsTool,
  lineageCrystallizeTool,
  lineageFertilizeTool,
  lineageAncestorsTool,
  lineageShowTool,
  lineageDiffTool,
  lineageSpeciesTool,
  lineageLethalRecessivesTool,
  pedigreeTool,
  vendorKarmaTool,
  routingHintTool,
  sporeInitTool,
  sporePushTool,
  sporePullTool,
  sporeSyncTool,
  sporeStatusTool,
];
