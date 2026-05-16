/**
 * v2.19.12 LIVING CLI · Pillar 1: CLI EVOLUTION — 13 MCP tools.
 *
 *   MUSCLE MEMORY (3):
 *     mneme.muscle.benchmark   — synthetic cold-vs-warm dispatch speedup proof
 *     mneme.muscle.status      — current dispatcher latency/p95/speedup
 *     mneme.muscle.socket_path — platform-aware Unix socket / Windows pipe path
 *
 *   DIALECT (3):
 *     mneme.dialect.learn      — record (phrase, intent, accepted) into chain
 *     mneme.dialect.resolve    — verdict band for a phrase from one caller
 *     mneme.dialect.export     — per-caller ledger export
 *
 *   BRAIN BRANCHES (4):
 *     mneme.brain.branch       — fork the knowledge base into a named branch
 *     mneme.brain.diff         — set diff of axioms + claims across branches
 *     mneme.brain.merge        — apply a subset back into target branch
 *     mneme.brain.list         — enumerate branches with counts + snapshot hash
 *
 *   MODEL CHRYSALIS (3):
 *     mneme.chrysalis.probe        — match an arbitrary URL to a known vendor ABI
 *     mneme.chrysalis.translate    — request/response shape conversion
 *     mneme.chrysalis.list         — list registered fingerprints
 */

import type { MnemeTool } from "./_types.js";

// In-process singletons for state that needs to survive across calls within
// the same MCP server lifetime.
let muscleDispatcher: import("@mneme-ai/core").muscleMemory.MuscleDispatcher | null = null;
async function getMuscle(): Promise<import("@mneme-ai/core").muscleMemory.MuscleDispatcher> {
  if (!muscleDispatcher) {
    const core = await import("@mneme-ai/core");
    muscleDispatcher = new core.muscleMemory.MuscleDispatcher({
      handlers: { "ping": async () => ({ pong: true }) },
    });
  }
  return muscleDispatcher;
}

let dialectLedger: import("@mneme-ai/core").dialect.DialectLedger | null = null;
async function getDialect(): Promise<import("@mneme-ai/core").dialect.DialectLedger> {
  if (!dialectLedger) {
    const core = await import("@mneme-ai/core");
    dialectLedger = core.dialect.emptyLedger();
  }
  return dialectLedger;
}
async function setDialect(l: import("@mneme-ai/core").dialect.DialectLedger): Promise<void> {
  dialectLedger = l;
}

let brainRegistry: import("@mneme-ai/core").brainBranches.BrainRegistry | null = null;
async function getBrain(): Promise<import("@mneme-ai/core").brainBranches.BrainRegistry> {
  if (!brainRegistry) {
    const core = await import("@mneme-ai/core");
    brainRegistry = core.brainBranches.initMain({ registry: core.brainBranches.emptyRegistry() });
  }
  return brainRegistry;
}
async function setBrain(r: import("@mneme-ai/core").brainBranches.BrainRegistry): Promise<void> {
  brainRegistry = r;
}

let chrysalisRegistry: import("@mneme-ai/core").modelChrysalis.ChrysalisRegistry | null = null;
async function getChrysalis(): Promise<import("@mneme-ai/core").modelChrysalis.ChrysalisRegistry> {
  if (!chrysalisRegistry) {
    const core = await import("@mneme-ai/core");
    chrysalisRegistry = core.modelChrysalis.defaultChrysalis();
  }
  return chrysalisRegistry;
}

// ─── MUSCLE MEMORY ──────────────────────────────────────────────────────
export const muscleBenchmarkTool: MnemeTool = {
  name: "mneme.muscle.benchmark",
  category: "lab",
  description:
    "💪 MUSCLE — synthetic cold-vs-warm dispatch benchmark. Proves the speedup principle (real CLI saves Node-bootstrap overhead too, measured externally).",
  whenToUse: "Verify that the muscle-memory layer is functioning + measure the speedup ratio your hardware achieves.",
  triggers: ["muscle benchmark", "cold vs warm"],
  inputSchema: { type: "object", properties: { iterations: { type: "number" }, workMs: { type: "number" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Benchmark mneme muscle memory", expectedOutput: "{ iterations, coldMs, avgWarmMs, speedupFactor }" }],
  pitfalls: ["This benchmark is synthetic — real cold-start savings include Node binary bootstrap (~600-800ms saved per call) which is observed in the CLI shim, not here."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.muscleMemory.benchmarkMuscleSpeedup({
      iterations: args["iterations"] as number | undefined,
      workMs: args["workMs"] as number | undefined,
    });
    return { data: r, wisdom: `💪 BENCH · ${r.iterations} runs · speedup ${r.speedupFactor.toFixed(1)}x`, confidence: { level: "high" } };
  },
};

export const muscleStatusTool: MnemeTool = {
  name: "mneme.muscle.status",
  category: "lab",
  description:
    "💪 MUSCLE — current dispatcher status (total calls, warm avg latency, p95, speedup factor).",
  whenToUse: "Health check on the persistent dispatch layer.",
  triggers: ["muscle status"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show muscle status", expectedOutput: "{ totalCalls, avgWarmLatencyMs, p95LatencyMs, speedupFactor }" }],
  pitfalls: ["Status resets on MCP restart."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const d = await getMuscle();
    const s = d.status();
    return { data: s, wisdom: core.muscleMemory.formatMuscleStatusLine(s), confidence: { level: "high" } };
  },
};

export const muscleSocketPathTool: MnemeTool = {
  name: "mneme.muscle.socket_path",
  category: "lab",
  description:
    "💪 MUSCLE — suggested Unix domain socket / Windows named pipe path for the daemon, deterministic per repo.",
  whenToUse: "Setting up the persistent CLI dispatcher externally.",
  triggers: ["muscle socket path", "where is the daemon socket"],
  inputSchema: { type: "object", properties: { repoPath: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Where's the muscle socket?", expectedOutput: "{ path }" }],
  pitfalls: ["Each repo gets its own socket — by design, to avoid cross-repo cache pollution."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const path = core.muscleMemory.suggestedSocketPath({ repoPath: args["repoPath"] as string | undefined });
    return { data: { path }, wisdom: `💪 socket → ${path}`, confidence: { level: "high" } };
  },
};

// ─── DIALECT ────────────────────────────────────────────────────────────
export const dialectLearnTool: MnemeTool = {
  name: "mneme.dialect.learn",
  category: "lab",
  description:
    "🗣 DIALECT — record (phrase, intent, accepted) into the HMAC-chained ledger. Mneme learns to speak the dialect of one caller.",
  whenToUse: "After AI proposes an intent and the user accepts/rejects — train the per-user phrase resolver.",
  triggers: ["dialect learn", "remember this phrase"],
  inputSchema: {
    type: "object",
    properties: {
      callerKey: { type: "string" },
      phrase: { type: "string" },
      intent: { type: "string" },
      accepted: { type: "boolean" },
    },
    required: ["callerKey", "phrase", "intent", "accepted"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "User said 'ship it' and accepted mneme.ship", args: { callerKey: "ck-shin", phrase: "ship it", intent: "mneme.ship", accepted: true }, expectedOutput: "{ recordCount }" }],
  pitfalls: ["Always pass `accepted: false` on rejection — both signals matter."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ledger = await getDialect();
    const next = core.dialect.learnPhrase({
      ledger,
      callerKey: String(args["callerKey"]),
      phrase: String(args["phrase"]),
      intent: String(args["intent"]),
      accepted: Boolean(args["accepted"]),
    });
    await setDialect(next);
    return { data: { recordCount: next.records.length }, wisdom: `🗣 learned · total records=${next.records.length}`, confidence: { level: "high" } };
  },
};

export const dialectResolveTool: MnemeTool = {
  name: "mneme.dialect.resolve",
  category: "lab",
  description:
    "🗣 DIALECT — resolve a phrase from one caller. Verdict: speak_native (auto), ask_with_hint (show top guess + alternatives), ask_clarify (no signal).",
  whenToUse: "Before acting on a user's short phrase, check whether their personal dialect resolves it.",
  triggers: ["dialect resolve", "what does this phrase mean"],
  inputSchema: {
    type: "object",
    properties: { callerKey: { type: "string" }, phrase: { type: "string" } },
    required: ["callerKey", "phrase"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Resolve 'update mneme' for ck-shin", args: { callerKey: "ck-shin", phrase: "update mneme" }, expectedOutput: "{ verdict, topIntent, confidence, alternatives }" }],
  pitfalls: ["Verdicts are per-caller; never assume one user's dialect generalises."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ledger = await getDialect();
    const r = core.dialect.resolvePhrase({ ledger, callerKey: String(args["callerKey"]), phrase: String(args["phrase"]) });
    return { data: r, wisdom: core.dialect.formatResolveLine(r), confidence: { level: "high" } };
  },
};

export const dialectExportTool: MnemeTool = {
  name: "mneme.dialect.export",
  category: "lab",
  description:
    "🗣 DIALECT — export one caller's records for cross-machine sync or audit.",
  whenToUse: "Backing up your personal dialect; migrating to a new machine.",
  triggers: ["dialect export", "backup my dialect"],
  inputSchema: { type: "object", properties: { callerKey: { type: "string" } }, required: ["callerKey"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Export my dialect", args: { callerKey: "ck-shin" }, expectedOutput: "{ callerKey, recordCount, records, exportedAt }" }],
  pitfalls: ["Includes the HMAC sigs — if you change the secret, exported records become unverifiable."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ledger = await getDialect();
    const ex = core.dialect.exportDialect({ ledger, callerKey: String(args["callerKey"]) });
    return { data: ex, wisdom: `🗣 exported ${ex.recordCount} records for ${ex.callerKey}`, confidence: { level: "high" } };
  },
};

// ─── BRAIN BRANCHES ─────────────────────────────────────────────────────
export const brainBranchTool: MnemeTool = {
  name: "mneme.brain.branch",
  category: "lab",
  description:
    "🌳 BRAIN — fork the knowledge base into a named branch (counterfactual self). Default parent: main.",
  whenToUse: "Experimenting with a new belief or claim set without polluting main.",
  triggers: ["brain branch", "fork knowledge"],
  inputSchema: {
    type: "object",
    properties: { newName: { type: "string" }, fromName: { type: "string" } },
    required: ["newName"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Branch experimental-v3 from main", args: { newName: "experimental-v3" }, expectedOutput: "{ branchCount, newBranch }" }],
  pitfalls: ["Branch names must be unique; throws on collision."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const reg = await getBrain();
    const next = core.brainBranches.branchFrom({
      registry: reg,
      newName: String(args["newName"]),
      fromName: args["fromName"] as string | undefined,
    });
    await setBrain(next);
    const newBranch = next.branches.find((b) => b.name === args["newName"])!;
    return { data: { branchCount: next.branches.length, newBranch }, wisdom: `🌳 forked '${args["newName"]}' from '${args["fromName"] ?? "main"}'`, confidence: { level: "high" } };
  },
};

export const brainDiffTool: MnemeTool = {
  name: "mneme.brain.diff",
  category: "lab",
  description:
    "🌳 BRAIN — set-difference of axioms + claims between two branches. Flags conflicts (same id, different body).",
  whenToUse: "Reviewing what's actually different between two counterfactual brains before merging.",
  triggers: ["brain diff", "compare branches"],
  inputSchema: {
    type: "object",
    properties: { a: { type: "string" }, b: { type: "string" } },
    required: ["a", "b"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Diff experimental-v3 vs main", args: { a: "experimental-v3", b: "main" }, expectedOutput: "{ axiomsOnlyInA, axiomsOnlyInB, axiomsCommon, conflicts }" }],
  pitfalls: ["Conflicts are NOT auto-resolved — they're returned for caller decision."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const reg = await getBrain();
    const d = core.brainBranches.diffBranches({ registry: reg, a: String(args["a"]), b: String(args["b"]) });
    return {
      data: d,
      wisdom: `🌳 diff · onlyA=${d.axiomsOnlyInA.length + d.claimsOnlyInA.length} · onlyB=${d.axiomsOnlyInB.length + d.claimsOnlyInB.length} · conflicts=${d.conflicts.length}`,
      confidence: { level: "high" },
    };
  },
};

export const brainMergeTool: MnemeTool = {
  name: "mneme.brain.merge",
  category: "lab",
  description:
    "🌳 BRAIN — apply axioms + claims from a source branch into a target branch. Strategy 'all' merges every non-conflicting; 'selective' merges only explicit ids. Conflicts are reported.",
  whenToUse: "Promoting an experimental branch's winning ideas back to main.",
  triggers: ["brain merge", "promote branch"],
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string" },
      into: { type: "string" },
      strategy: { type: "string", enum: ["all", "selective"] },
      selectAxiomIds: { type: "array", items: { type: "string" } },
      selectClaimIds: { type: "array", items: { type: "string" } },
    },
    required: ["from", "into"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Merge experimental-v3 into main, only A3+A4", args: { from: "experimental-v3", into: "main", strategy: "selective", selectAxiomIds: ["A3", "A4"] }, expectedOutput: "{ appliedAxioms, appliedClaims, skippedConflicts }" }],
  pitfalls: ["strategy='all' still SKIPS conflicts — explicit caller decision required to overwrite."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const reg = await getBrain();
    const m = core.brainBranches.mergeBranch({
      registry: reg,
      from: String(args["from"]),
      into: String(args["into"]),
      strategy: (args["strategy"] as "all" | "selective" | undefined) ?? "all",
      selectAxiomIds: args["selectAxiomIds"] as string[] | undefined,
      selectClaimIds: args["selectClaimIds"] as string[] | undefined,
    });
    await setBrain(m.registry);
    return {
      data: { appliedAxioms: m.appliedAxioms, appliedClaims: m.appliedClaims, skippedConflicts: m.skippedConflicts },
      wisdom: `🌳 merged ${m.appliedAxioms} axioms + ${m.appliedClaims} claims (${m.skippedConflicts.length} conflicts skipped)`,
      confidence: { level: "high" },
    };
  },
};

export const brainListTool: MnemeTool = {
  name: "mneme.brain.list",
  category: "lab",
  description:
    "🌳 BRAIN — enumerate all branches with counts + snapshot hash.",
  whenToUse: "Auditing your counterfactual brains.",
  triggers: ["brain list", "show branches"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "List brain branches", expectedOutput: "{ branches: [{ name, id, axiomCount, claimCount, snapshotHash }] }" }],
  pitfalls: ["Snapshot hashes are deterministic — identical content = identical hash."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const reg = await getBrain();
    const ls = core.brainBranches.listBranches(reg);
    return { data: { branches: ls }, wisdom: `🌳 ${ls.length} branch(es): ${ls.map((b) => b.name).join(", ")}`, confidence: { level: "high" } };
  },
};

// ─── MODEL CHRYSALIS ────────────────────────────────────────────────────
export const chrysalisProbeTool: MnemeTool = {
  name: "mneme.chrysalis.probe",
  category: "lab",
  description:
    "🦋 CHRYSALIS — match an arbitrary base URL to a known vendor ABI by url-hint heuristic. Returns the matched fingerprint or a helpful hint to register one.",
  whenToUse: "AI agent wants to call a model endpoint but doesn't know its shape — probe first.",
  triggers: ["chrysalis probe", "what vendor is this url"],
  inputSchema: { type: "object", properties: { baseUrl: { type: "string" } }, required: ["baseUrl"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Probe https://api.anthropic.com", args: { baseUrl: "https://api.anthropic.com" }, expectedOutput: "{ matched: { provider, baseUrl, endpoint }, reason }" }],
  pitfalls: ["Heuristic, not a guarantee. If url-hint doesn't match, register a fingerprint manually."],
  handler: async (_rt, args) => {
    const reg = await getChrysalis();
    const r = reg.probe({ baseUrl: String(args["baseUrl"]) });
    return { data: r, wisdom: r.matched ? `🦋 matched ${r.matched.provider}` : `🦋 no match — ${r.reason}`, confidence: { level: "high" } };
  },
};

export const chrysalisTranslateTool: MnemeTool = {
  name: "mneme.chrysalis.translate",
  category: "lab",
  description:
    "🦋 CHRYSALIS — translate Mneme's canonical {model, messages} to a vendor's request body, OR translate a vendor's response back to canonical {content, model, usage}.",
  whenToUse: "Before calling an AI vendor: translate forward. After receiving: translate back. Mneme stays vendor-neutral.",
  triggers: ["chrysalis translate", "shape this for vendor"],
  inputSchema: {
    type: "object",
    properties: {
      provider: { type: "string" },
      direction: { type: "string", enum: ["request", "response"] },
      request: { type: "object" },
      raw: { type: "object" },
    },
    required: ["provider", "direction"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Translate for anthropic", args: { provider: "anthropic-messages", direction: "request", request: { model: "claude", messages: [] } }, expectedOutput: "{ body }" }],
  pitfalls: ["Does NOT actually call the vendor — caller does fetch with the returned body."],
  handler: async (_rt, args) => {
    const reg = await getChrysalis();
    const provider = String(args["provider"]);
    const direction = String(args["direction"]);
    if (direction === "request") {
      const out = reg.translateRequest({
        provider,
        request: args["request"] as import("@mneme-ai/core").modelChrysalis.CanonicalRequest,
      });
      return { data: { body: out }, wisdom: `🦋 translated → ${provider}`, confidence: { level: "high" } };
    }
    const out = reg.translateResponse({ provider, raw: args["raw"] });
    return { data: { canonical: out }, wisdom: `🦋 translated ← ${provider}`, confidence: { level: "high" } };
  },
};

export const chrysalisListTool: MnemeTool = {
  name: "mneme.chrysalis.list",
  category: "lab",
  description:
    "🦋 CHRYSALIS — list all registered vendor ABI fingerprints.",
  whenToUse: "Discovering which vendors Mneme can already speak to.",
  triggers: ["chrysalis list", "what vendors does mneme know"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "List chrysalis fingerprints", expectedOutput: "{ fingerprints: [...] }" }],
  pitfalls: ["Fingerprints reflect ABIs at release time — if a vendor changes shape, register a new fingerprint."],
  handler: async (_rt, _args) => {
    const reg = await getChrysalis();
    const fps = reg.list().map((f) => ({ provider: f.provider, baseUrl: f.baseUrl, endpoint: f.endpoint }));
    return { data: { fingerprints: fps }, wisdom: `🦋 ${fps.length} fingerprint(s): ${fps.map((f) => f.provider).join(", ")}`, confidence: { level: "high" } };
  },
};

export const V1912_LIVING_CLI_TOOLS: MnemeTool[] = [
  muscleBenchmarkTool, muscleStatusTool, muscleSocketPathTool,
  dialectLearnTool, dialectResolveTool, dialectExportTool,
  brainBranchTool, brainDiffTool, brainMergeTool, brainListTool,
  chrysalisProbeTool, chrysalisTranslateTool, chrysalisListTool,
];
