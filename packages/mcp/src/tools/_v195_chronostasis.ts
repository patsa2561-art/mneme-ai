/**
 * v2.19.5 CHRONOSTASIS · FLAGSHIP · MCP tools.
 *
 *   mneme.chronostasis.propose          — wrap claim as PENDING
 *   mneme.chronostasis.witness_prompt   — build the witness meta-prompt
 *   mneme.chronostasis.record_verdict   — vendor's refute/confirm verdict
 *   mneme.chronostasis.tick             — REWIND cascade + CRYSTALLIZE
 *   mneme.chronostasis.axioms_relevant  — truth gravity (jaccard)
 *   mneme.chronostasis.summarize        — counts + chain integrity
 */

import type { MnemeTool } from "./_types.js";

export const chronoProposeTool: MnemeTool = {
  name: "mneme.chronostasis.propose",
  category: "lab",
  description:
    "🪐 CHRONOSTASIS — wrap an AI claim as PENDING with deadline + dep-graph. HMAC-signed, chain-linked. Claim must survive the adversarial witness window to crystallize into an immutable AXIOM.",
  whenToUse: "EVERY AI claim worth time-testing (function locations, performance numbers, API behaviour, vendor accuracy). The flagship primitive — call it as soon as you assert something the user might depend on.",
  triggers: ["chronostasis propose", "time-test this claim", "lock claim", "ทดสอบ claim"],
  inputSchema: {
    type: "object",
    properties: {
      body: { type: "string" },
      context: { type: "object" },
      deadlineSec: { type: "number", description: "Default 600 (10 minutes)." },
      witnessPool: { type: "array", items: { type: "string" } },
      dependsOn: { type: "array", items: { type: "string" }, description: "Claim IDs this claim depends on; must NOT be deprecated." },
    },
    required: ["body"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Lock this AI claim for 10 minutes of witness", args: { body: "calculateTotal lives at src/foo.ts:42", deadlineSec: 600 }, expectedOutput: "{ claimId, deadlineAt, witnessPool, sig }" }],
  pitfalls: ["dependsOn must reference EXISTING claim or axiom IDs; deprecated deps throw."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.chronostasis.defaultChronostasis().proposeClaim(args as unknown as Parameters<typeof core.chronostasis.Chronostasis.prototype.proposeClaim>[0]);
    return { data: c, wisdom: core.chronostasis.formatClaimLine(c), confidence: { level: "high" } };
  },
};

export const chronoWitnessPromptTool: MnemeTool = {
  name: "mneme.chronostasis.witness_prompt",
  category: "lab",
  description:
    "🪐 CHRONOSTASIS — build the meta-prompt the caller sends to any witness vendor asking 'refute this claim or confirm it'. Vendor-agnostic; expects JSON reply { refuted, evidence, confidence }.",
  whenToUse: "Step 1 of the witness pipeline; daemon loops over pending claims and sends to vendors.",
  triggers: ["chronostasis witness", "build witness prompt"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "object", description: "PendingClaim object from propose." },
      vendor: { type: "string" },
    },
    required: ["claim", "vendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build a witness prompt for grok", args: { claim: {}, vendor: "grok" }, expectedOutput: "{ prompt: '...' }" }],
  pitfalls: ["You must wire the prompt into your AI vendor of choice — Mneme does not call vendors itself."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const prompt = core.chronostasis.defaultChronostasis().buildWitnessPrompt(
      args["claim"] as Parameters<typeof core.chronostasis.Chronostasis.prototype.buildWitnessPrompt>[0],
      String(args["vendor"]),
    );
    return { data: { prompt }, wisdom: `🪐 CHRONOSTASIS witness prompt for ${args["vendor"]}`, confidence: { level: "high" } };
  },
};

export const chronoRecordVerdictTool: MnemeTool = {
  name: "mneme.chronostasis.record_verdict",
  category: "lab",
  description:
    "🪐 CHRONOSTASIS — record a witness vendor's verdict (refuted? evidence? confidence 0..1). Multiple verdicts per claim accumulate; highest-confidence refute wins on next tick.",
  whenToUse: "After receiving a witness vendor reply.",
  triggers: ["chronostasis verdict", "record witness verdict"],
  inputSchema: {
    type: "object",
    properties: {
      claimId: { type: "string" },
      vendor: { type: "string" },
      refuted: { type: "boolean" },
      evidence: { type: "string" },
      confidence: { type: "number", description: "0..1" },
    },
    required: ["claimId", "vendor", "refuted", "evidence", "confidence"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record grok's refutation of claim pc-abc", args: { claimId: "pc-abc", vendor: "grok", refuted: true, evidence: "git log says symbol moved", confidence: 0.92 }, expectedOutput: "{ verdictId, sig }" }],
  pitfalls: ["Claim must still be pending. If it crystallized or got deprecated, verdict is rejected with an error."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.chronostasis.defaultChronostasis().recordVerdict(args as unknown as Parameters<typeof core.chronostasis.Chronostasis.prototype.recordVerdict>[0]);
    return { data: v, wisdom: `🪐 CHRONOSTASIS · ${args["vendor"]} ${args["refuted"] ? "REFUTED" : "confirmed"} · conf=${args["confidence"]}`, confidence: { level: "high" } };
  },
};

export const chronoTickTool: MnemeTool = {
  name: "mneme.chronostasis.tick",
  category: "lab",
  description:
    "🪐 CHRONOSTASIS — process all pending claims: high-confidence refute → REWIND cascade through dep graph; deadline-passed-with-no-refute + all deps axiom → CRYSTALLIZE. Returns { rewinds, crystallized, stillPending, deprecatedSoFar }.",
  whenToUse: "Daemon cycle (every N minutes); also after major batches of new verdicts.",
  triggers: ["chronostasis tick", "process pending claims", "advance time"],
  inputSchema: { type: "object", properties: { nowMs: { type: "number", description: "For testing; defaults to Date.now()." } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run a chronostasis tick now", args: {}, expectedOutput: "{ rewinds: [...], crystallized: [...], stillPending, deprecatedSoFar }" }],
  pitfalls: ["A single tick may CASCADE through many claims; REWIND can deprecate large dep trees."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chronostasis.defaultChronostasis().tick(args["nowMs"] !== undefined ? { nowMs: Number(args["nowMs"]) } : {});
    return { data: r, wisdom: `🪐 CHRONOSTASIS · ${r.crystallized.length} crystallized · ${r.rewinds.length} rewinds · ${r.stillPending} pending`, confidence: { level: "high" } };
  },
};

export const chronoAxiomsRelevantTool: MnemeTool = {
  name: "mneme.chronostasis.axioms_relevant",
  category: "lab",
  description:
    "🪐 CHRONOSTASIS — truth gravity. Given a query, return ranked axioms by jaccard similarity. These are time-tested facts you can cite without re-proving.",
  whenToUse: "When answering a new question; before re-deriving — check if an axiom already covers it.",
  triggers: ["chronostasis relevant", "find axioms", "truth gravity"],
  inputSchema: {
    type: "object",
    properties: {
      queryText: { type: "string" },
      k: { type: "number", description: "Default 5." },
      minSimilarity: { type: "number", description: "Default 0.1." },
    },
    required: ["queryText"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What axioms are relevant to this question?", args: { queryText: "where is calculateTotal" }, expectedOutput: "{ attractedAxioms: [{ axiomId, similarity, body }] }" }],
  pitfalls: ["Empty result means no axiom matches; either propose a new claim or admit uncertainty."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const g = core.chronostasis.defaultChronostasis().axiomsRelevantTo(args as unknown as Parameters<typeof core.chronostasis.Chronostasis.prototype.axiomsRelevantTo>[0]);
    return { data: g, wisdom: `🪐 CHRONOSTASIS · ${g.attractedAxioms.length} axiom(s) relevant`, confidence: { level: g.attractedAxioms.length > 0 ? "high" : "low" } };
  },
};

export const chronoSummarizeTool: MnemeTool = {
  name: "mneme.chronostasis.summarize",
  category: "lab",
  description:
    "🪐 CHRONOSTASIS — counts of pending/axiom/deprecated/rewinds/verdicts + chain integrity status. Parent-facing health report.",
  whenToUse: "User asks 'how much has Mneme proven?'; periodic audit.",
  triggers: ["chronostasis summary", "chronostasis status", "how much proven"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How many axioms have crystallized?", args: {}, expectedOutput: "{ pendingCount, axiomCount, deprecatedCount, rewindCount, verdictCount, chainOk }" }],
  pitfalls: ["chainOk=false means tampering — investigate immediately."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const s = core.chronostasis.defaultChronostasis().summary();
    return { data: s, wisdom: `🪐 CHRONOSTASIS · ${s.axiomCount} axioms · ${s.pendingCount} pending · ${s.rewindCount} rewinds · chain=${s.chainOk ? "OK" : "BROKEN"}`, confidence: { level: s.chainOk ? "high" : "low" } };
  },
};

export const V195_CHRONOSTASIS_TOOLS: MnemeTool[] = [
  chronoProposeTool,
  chronoWitnessPromptTool,
  chronoRecordVerdictTool,
  chronoTickTool,
  chronoAxiomsRelevantTool,
  chronoSummarizeTool,
];
