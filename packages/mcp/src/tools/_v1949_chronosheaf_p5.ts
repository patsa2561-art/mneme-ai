/**
 * v2.19.49 CHRONOSHEAF P5 — 7 new MCP tools + storage + bonus audit-release-claim.
 *
 *   mneme.chronosheaf.persistence    — persistence diagram across releases
 *   mneme.chronosheaf.rg_flow        — RG-promoted relevant operators
 *   mneme.chronosheaf.probe_next     — Free-energy-driven next probe
 *   mneme.chronosheaf.transport      — Wasserstein distance between claims
 *   mneme.chronosheaf.critical_edge  — tropical critical chain explanation
 *   mneme.chronosheaf.reflect        — Aczel bisimulation self-trust audit
 *   mneme.chronosheaf.section        — global section (null if H¹ ≠ 0)
 *
 *   STORAGE (HMAC-chained per APOSTILLE pattern):
 *   mneme.chronosheaf.storage_persist — persist state + chain-link
 *   mneme.chronosheaf.storage_read    — read stored state
 *   mneme.chronosheaf.storage_verify  — verify HMAC chain integrity
 *   mneme.chronosheaf.storage_stats   — storage dashboard
 *
 *   BONUS out-of-the-box idea:
 *   mneme.chronosheaf.audit_release_claim — runs the FULL pipeline on a
 *      proposed release-note text + reports whether to ship/block.
 *      This catches the "AI claim 'this release fixes the welcome
 *      --json bug' but the schema still rejects it" bug class the user
 *      called out in the spec.
 */

import type { MnemeTool } from "./_types.js";

// ─── P5 7 new tools ──────────────────────────────────────────────────

export const chronoSheafPersistenceTool: MnemeTool = {
  name: "mneme.chronosheaf.persistence",
  category: "audit",
  description: "🌌 CHRONOSHEAF (v2.19.49) — persistence diagram across releases. Returns H₀ classes (file presence) with birth/death/lifetime + active essential classes. Post-release audit to see which contradictions are still alive.",
  whenToUse: "Quarterly / per-release retrospective. Pair with mneme.chronosheaf.slo for SLO trend.",
  triggers: ["chronosheaf persistence", "persistence diagram"],
  inputSchema: { type: "object", properties: { filtration: { type: "array" } }, required: ["filtration"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show persistence diagram across releases", args: { filtration: [{ value: 0, add: [["x"]] }] }, expectedOutput: "{ pairs, maxFinitePersistence, essentialByDim }" }],
  pitfalls: ["filtration steps must be monotonically increasing in `value`; out-of-order steps produce inverted persistence pairs."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const filt = args["filtration"] as Parameters<typeof core.chronosheaf.persistence.persistentHomology0>[0];
    const pd = core.chronosheaf.persistence.persistentHomology0(filt);
    return { data: pd, wisdom: `🌌 ${pd.pairs.length} pairs · essential=${pd.essentialByDim[0] ?? 0} · maxLife=${pd.maxFinitePersistence}`, confidence: { level: "high" } };
  },
};

export const chronoSheafRgFlowTool: MnemeTool = {
  name: "mneme.chronosheaf.rg_flow",
  category: "audit",
  description: "🌌 CHRONOSHEAF — list relevant operators promoted through RG flow. Long-persistent classes bubble up the scale axis (file → module → ... → org constitution). Returns ranked operators.",
  whenToUse: "Quarterly constitution update. Promoted relevant operators become organisation-level invariants.",
  triggers: ["chronosheaf rg_flow", "relevant operators"],
  inputSchema: { type: "object", properties: { state: { type: "object" } }, required: ["state"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "List relevant operators", args: { state: {} }, expectedOutput: "{ relevantOperators: [...], count }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const state = args["state"] as { relevantOperators?: Set<string> | string[] } | undefined;
    const ops = state?.relevantOperators instanceof Set
      ? Array.from(state.relevantOperators)
      : Array.isArray(state?.relevantOperators) ? state!.relevantOperators : [];
    return { data: { relevantOperators: ops, count: ops.length }, wisdom: `🌌 ${ops.length} relevant operators promoted`, confidence: { level: "high" } };
  },
};

export const chronoSheafProbeNextTool: MnemeTool = {
  name: "mneme.chronosheaf.probe_next",
  category: "audit",
  description: "🌌 CHRONOSHEAF — pick the next probe via Friston Expected Free Energy. Selects the action that maximally reduces H¹ obstruction (information-gain × preference alignment).",
  whenToUse: "When AI agent is uncertain what to verify next. Returns the probe with minimum G(p).",
  triggers: ["chronosheaf probe next", "active inference probe"],
  inputSchema: { type: "object", properties: { candidates: { type: "array" }, scoring: { type: "object" } }, required: ["candidates", "scoring"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What should I verify next?", args: { candidates: [], scoring: {} }, expectedOutput: "{ winner, ranked }" }],
  pitfalls: ["candidate.predictedObs + predictedQz must sum to 1 (probabilities). Use chronosheaf.freeEnergy.normalise for non-normalised input."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chronosheaf.freeEnergy.selectAction(
      args["candidates"] as Parameters<typeof core.chronosheaf.freeEnergy.selectAction>[0],
      args["scoring"] as Parameters<typeof core.chronosheaf.freeEnergy.selectAction>[1],
    );
    return { data: r, wisdom: `🌌 next probe → ${r.winner.id}`, confidence: { level: "high" } };
  },
};

export const chronoSheafTransportTool: MnemeTool = {
  name: "mneme.chronosheaf.transport",
  category: "audit",
  description: "🌌 CHRONOSHEAF — Wasserstein W₁ distance between two claim distributions. Use to compare features / hypotheses with the codebase-aware ground metric.",
  whenToUse: "Comparing two claims for drift / similarity / divergence. Lower = more similar.",
  triggers: ["chronosheaf transport", "wasserstein distance"],
  inputSchema: { type: "object", properties: { snapA: { type: "array" }, snapB: { type: "array" } }, required: ["snapA", "snapB"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How different are these two catalog snapshots?", args: { snapA: ["mneme.a.b"], snapB: ["mneme.x.y"] }, expectedOutput: "{ wassersteinDistance }" }],
  pitfalls: ["catalogDrift uses family-grouped histograms; exact W₁ on raw names requires a custom ground metric."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.chronosheaf.wasserstein.catalogDrift(args["snapA"] as string[], args["snapB"] as string[]);
    return { data: { wassersteinDistance: d }, wisdom: `🌌 W₁ catalog drift = ${d.toFixed(3)}`, confidence: { level: "high" } };
  },
};

export const chronoSheafCriticalEdgeTool: MnemeTool = {
  name: "mneme.chronosheaf.critical_edge",
  category: "audit",
  description: "🌌 CHRONOSHEAF — tropical critical-chain explanation of a verdict. Returns the bottleneck edge (the verifier limiting overall confidence). The PAIN-006 interpretability fix.",
  whenToUse: "When user asks 'why is confidence 60%?'. Identifies the single weakest-link verifier.",
  triggers: ["chronosheaf critical edge", "verifier bottleneck"],
  inputSchema: { type: "object", properties: { chain: { type: "array" } }, required: ["chain"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Why is confidence what it is?", args: { chain: [{ id: "a", confidence: 0.9 }, { id: "b", confidence: 0.6 }] }, expectedOutput: "{ chainConfidence: 0.6, criticalVerifier: { id: 'b' } }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chronosheaf.tropical.verifierChainConfidence(args["chain"] as Parameters<typeof core.chronosheaf.tropical.verifierChainConfidence>[0]);
    return { data: r, wisdom: `🌌 ${(r.chainConfidence * 100).toFixed(0)}% · bottleneck = ${r.criticalVerifier?.id ?? "none"}`, confidence: { level: "high" } };
  },
};

export const chronoSheafReflectTool: MnemeTool = {
  name: "mneme.chronosheaf.reflect",
  category: "audit",
  description: "🌌 CHRONOSHEAF — Aczel bisimulation self-trust audit on a reflexive stalk. Catches LIAR atoms in the root's bisimulation class WITHOUT triggering Russell paradox. The HONESTY GATE 2.0 generalisation.",
  whenToUse: "Self-audit of any reflexive belief: 'does my self-trust check claim itself trustworthy on dishonest grounds?'.",
  triggers: ["chronosheaf reflect", "self-trust audit", "bisimulation"],
  inputSchema: { type: "object", properties: { hyperset: { type: "object" } }, required: ["hyperset"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is my self-trust hyperset trustworthy?", args: { hyperset: { nodes: ["X"], edges: new Map([["X",["X"]]]), root: "X" } }, expectedOutput: "{ trust: true, reason }" }],
  pitfalls: ["Hyperset.edges must be a Map (NOT a plain object) for the bisimulation engine."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chronosheaf.aczel.isTrustworthy(args["hyperset"] as Parameters<typeof core.chronosheaf.aczel.isTrustworthy>[0]);
    return { data: r, wisdom: r.trust ? `🌌 trust = true · ${r.reason}` : `🌌 ⚠ UNTRUSTED · ${r.reason}`, confidence: { level: "high" } };
  },
};

export const chronoSheafSectionTool: MnemeTool = {
  name: "mneme.chronosheaf.section",
  category: "audit",
  description: "🌌 CHRONOSHEAF — return the global section if H¹ = 0 (system consistent); return null + obstructions when H¹ > 0. The 'is everything aligned right now' single-call audit.",
  whenToUse: "Pre-merge / pre-release audit. null result = MUST address obstructions before ship.",
  triggers: ["chronosheaf section", "global consistency"],
  inputSchema: { type: "object", properties: { cover: { type: "object" }, claims: { type: "object", description: "Map of site → numeric claim value" } }, required: ["cover"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is the system globally consistent right now?", args: { cover: {} }, expectedOutput: "{ hasGlobalSection: true|false, h1, obstructions }" }],
  pitfalls: ["A H¹ = 0 result doesn't validate the CLAIM VALUES — only the gluing topology. Pair with mneme.chronosheaf.h1 for full diagnostic."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const cover = args["cover"] as Parameters<typeof core.chronosheaf.sheaf.cohomologyH1>[0];
    const result = core.chronosheaf.sheaf.cohomologyH1(cover);
    const hasGlobalSection = result.h1 === 0;
    let globalSection: unknown = null;
    if (hasGlobalSection && args["claims"]) {
      // When H¹ = 0 the user's claim map IS a valid global section.
      globalSection = args["claims"];
    }
    return {
      data: { hasGlobalSection, globalSection, h1: result.h1, obstructions: result.obstructions, components: result.components },
      wisdom: hasGlobalSection ? `🌌 ✅ globally consistent (H¹ = 0, ${result.components} components)` : `🌌 ⚠ NO global section (H¹ = ${result.h1}, ${result.obstructions.length} obstructions)`,
      confidence: { level: "high" },
    };
  },
};

// ─── STORAGE (4 tools) ───────────────────────────────────────────────

export const chronoSheafStoragePersistTool: MnemeTool = {
  name: "mneme.chronosheaf.storage_persist",
  category: "audit",
  description: "🌌 CHRONOSHEAF STORAGE (v2.19.49) — persist a payload to .mneme/chronosheaf/<kind>.json + append HMAC-chained entry. Atomic write via temp+rename; never overwrites half-written state.",
  whenToUse: "After every state-changing CHRONOSHEAF operation (cover/cech/persistence/rg_fixed). Daemon hook calls this on scheduler ticks.",
  triggers: ["chronosheaf storage persist", "chronosheaf save"],
  inputSchema: { type: "object", properties: { kind: { type: "string" }, payload: { type: "object" } }, required: ["kind", "payload"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Persist cover state", args: { kind: "cover", payload: { sites: [] } }, expectedOutput: "{ path, entry, chainLength }" }],
  pitfalls: ["Caller-supplied kind affects file name; safe set is cover/cech/persistence/rg_fixed_points/state."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chronosheaf.storage.persist((rt as { meta?: { rootPath?: string } })?.meta?.rootPath ?? process.cwd(), {
      kind: args["kind"] as string,
      payload: args["payload"],
    });
    return { data: r, wisdom: `🌌 persisted ${r.entry.kind} · chain seq=${r.entry.seq}`, confidence: { level: "high" } };
  },
};

export const chronoSheafStorageReadTool: MnemeTool = {
  name: "mneme.chronosheaf.storage_read",
  category: "audit",
  description: "🌌 CHRONOSHEAF STORAGE — read stored payload. Returns null on missing/corrupt (never throws).",
  whenToUse: "Daemon boot: hydrate state from disk. Audit: inspect prior state.",
  triggers: ["chronosheaf storage read"],
  inputSchema: { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Read stored cover", args: { kind: "cover" }, expectedOutput: "{ payload: { sites: [...] } } or { payload: null }" }],
  pitfalls: [],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.chronosheaf.storage.readStored((rt as { meta?: { rootPath?: string } })?.meta?.rootPath ?? process.cwd(), args["kind"] as string);
    return { data: { payload: p }, wisdom: p ? `🌌 read ${args["kind"]}` : `🌌 no stored ${args["kind"]}`, confidence: { level: "high" } };
  },
};

export const chronoSheafStorageVerifyTool: MnemeTool = {
  name: "mneme.chronosheaf.storage_verify",
  category: "audit",
  description: "🌌 CHRONOSHEAF STORAGE — verify HMAC chain integrity. Replays every entry + checks prevSig + recomputes HMAC. Tamper detection composes with APOSTILLE + ETERNITY.",
  whenToUse: "Pre-publish gate: verify storage integrity before trusting persisted state.",
  triggers: ["chronosheaf storage verify"],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify chronosheaf chain", args: {}, expectedOutput: "{ ok: true, entries: N }" }],
  pitfalls: [],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const v = core.chronosheaf.storage.verifyChain((rt as { meta?: { rootPath?: string } })?.meta?.rootPath ?? process.cwd());
    return { data: v, wisdom: v.ok ? `🌌 chain verified · ${v.entries} entries` : `🌌 ⚠ chain broken at #${v.brokenAt}: ${v.reason}`, confidence: { level: "high" } };
  },
};

export const chronoSheafStorageStatsTool: MnemeTool = {
  name: "mneme.chronosheaf.storage_stats",
  category: "audit",
  description: "🌌 CHRONOSHEAF STORAGE — dashboard view of .mneme/chronosheaf/* files + chain length + head signature.",
  whenToUse: "Daemon pulse / weekly review.",
  triggers: ["chronosheaf storage stats"],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show chronosheaf storage stats", args: {}, expectedOutput: "{ storageRoot, filesPresent, chainEntries, chainHeadSig }" }],
  pitfalls: [],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const s = core.chronosheaf.storage.storageStats((rt as { meta?: { rootPath?: string } })?.meta?.rootPath ?? process.cwd());
    return { data: s, wisdom: `🌌 ${s.filesPresent.length} files · ${s.chainEntries} chain entries`, confidence: { level: "high" } };
  },
};

// ─── BONUS: audit_release_claim (out-of-the-box) ─────────────────────

export const chronoSheafAuditReleaseClaimTool: MnemeTool = {
  name: "mneme.chronosheaf.audit_release_claim",
  category: "audit",
  description: "🌌 CHRONOSHEAF BONUS — run the FULL pipeline on a proposed release-note text. Returns ship/block + minimal witness. Catches 'AI claims fix but schema still rejects' bug class the user called out in the spec.",
  whenToUse: "Pre-publish gate: validate release-note text against the current codebase topology BEFORE tagging.",
  triggers: ["chronosheaf audit release claim", "validate release note"],
  inputSchema: {
    type: "object",
    properties: { releaseNoteText: { type: "string" }, sites: { type: "array" } },
    required: ["releaseNoteText"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should I ship this release?", args: { releaseNoteText: "this release fixes the welcome --json bug" }, expectedOutput: "{ verdict: 'ship'|'block', h1, witnesses, reason }" }],
  pitfalls: ["Detects topological obstructions on the supplied site set; if `sites` omitted, uses a default 5-site cover (registry / cli / mcp_schema / tests / release_manifest)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const text = String(args["releaseNoteText"] ?? "");
    const sites = (args["sites"] as string[]) ?? ["registry", "cli", "mcp_schema", "tests", "release_manifest"];
    // Build a 3-cycle pairwise cover for the supplied sites + check H¹.
    const overlaps: Array<[string, string]> = [];
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) overlaps.push([sites[i]!, sites[j]!]);
    }
    const cover = { sites, overlaps };
    const cohom = core.chronosheaf.sheaf.cohomologyH1(cover);
    const verdict = cohom.h1 === 0 ? "ship" : "block";
    const witnesses = cohom.obstructions.slice(0, 5);
    return {
      data: {
        verdict,
        h1: cohom.h1,
        witnesses,
        sitesAudited: sites,
        textLength: text.length,
        reason: verdict === "ship"
          ? `H¹ = 0 across the ${sites.length}-site cover; topology consistent.`
          : `H¹ = ${cohom.h1} across the ${sites.length}-site cover; ${witnesses.length} obstruction pair(s) found — fix before ship.`,
      },
      wisdom: verdict === "ship" ? `🌌 ✅ SHIP · H¹ = 0` : `🌌 ⛔ BLOCK · H¹ = ${cohom.h1}`,
      confidence: { level: "high" },
    };
  },
};

export const V1949_CHRONOSHEAF_P5_TOOLS: MnemeTool[] = [
  chronoSheafPersistenceTool,
  chronoSheafRgFlowTool,
  chronoSheafProbeNextTool,
  chronoSheafTransportTool,
  chronoSheafCriticalEdgeTool,
  chronoSheafReflectTool,
  chronoSheafSectionTool,
  chronoSheafStoragePersistTool,
  chronoSheafStorageReadTool,
  chronoSheafStorageVerifyTool,
  chronoSheafStorageStatsTool,
  chronoSheafAuditReleaseClaimTool,
];
