/**
 * v2.19.4 INTENT ROUTER + SOUL-IN-DNA — MCP tools.
 *
 *   INTENT ROUTER — 3 tools:
 *     mneme.intent.execute           — short phrase → signed multi-step plan
 *     mneme.intent.list_phrases      — show all registered phrases
 *     mneme.intent.register_phrase   — extend the catalogue at runtime
 *
 *   SOUL-IN-DNA — 5 tools:
 *     mneme.dna.encode               — payload → ATCG (with Hamming/triple ECC)
 *     mneme.dna.decode               — ATCG → payload (ECC-corrected)
 *     mneme.dna.cost                 — per-provider USD cost estimate
 *     mneme.dna.order                — ordering URL + 6-step user instructions
 *     mneme.dna.verify               — post-synthesis sequence diff vs original
 */

import type { MnemeTool } from "./_types.js";

// ─── INTENT ROUTER ──────────────────────────────────────────────────────
export const intentExecuteTool: MnemeTool = {
  name: "mneme.intent.execute",
  category: "lab",
  description:
    "🎯 INTENT — user says a SHORT human phrase ('update mneme' / 'ลูกเป็นไง' / 'audit this'); router returns a verified multi-step PLAN with HMAC-signed steps. AI walks the plan; user never memorises long phrases.",
  whenToUse: "EVERY natural-language user request that touches a Mneme primitive. Turn 'update mneme' into upgrade→drift→promote→restart→record automatically.",
  triggers: ["intent execute", "what does this mean", "plan for me"],
  inputSchema: {
    type: "object",
    properties: {
      userPhrase: { type: "string" },
      matchThreshold: { type: "number", description: "Default 0.30." },
    },
    required: ["userPhrase"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "User says: update mneme", args: { userPhrase: "update mneme" }, expectedOutput: "{ matchedPhrase, matchScore, steps, walkthrough, sig }" }],
  pitfalls: ["The router returns a PLAN; you (the AI agent) must execute each step in order. Show the walkthrough to the user so they know what's happening."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.intentRouter.execute({
      userPhrase: String(args["userPhrase"]),
      ...(args["matchThreshold"] !== undefined ? { matchThreshold: Number(args["matchThreshold"]) } : {}),
    });
    return { data: p, wisdom: core.intentRouter.formatIntentLine(p), confidence: { level: p.matchScore > 0.5 ? "high" : p.matchScore > 0.3 ? "medium" : "low" } };
  },
};

export const intentListPhrasesTool: MnemeTool = {
  name: "mneme.intent.list_phrases",
  category: "lab",
  description:
    "🎯 INTENT — list all registered phrases (built-in + user-registered). Discoverability for the AI agent + user.",
  whenToUse: "User asks 'what can I tell you?'; AI is unfamiliar with current Mneme catalogue.",
  triggers: ["intent list", "what phrases", "list commands"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show me all the short commands", args: {}, expectedOutput: "{ phrases: [{ canonical, aliases, intent, plan }] }" }],
  pitfalls: ["The catalogue is process-local — phrases registered in one MCP session don't carry over to the next unless caller persists them."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const phrases = core.intentRouter.listPhrases();
    return { data: { phrases }, wisdom: `🎯 INTENT · ${phrases.length} phrase(s) registered`, confidence: { level: "high" } };
  },
};

export const intentRegisterPhraseTool: MnemeTool = {
  name: "mneme.intent.register_phrase",
  category: "lab",
  description:
    "🎯 INTENT — extend the catalogue at runtime with a new (canonical, aliases, intent, plan) entry.",
  whenToUse: "User or AI vendor adds project-specific commands.",
  triggers: ["intent register", "add phrase", "teach mneme"],
  inputSchema: {
    type: "object",
    properties: {
      canonical: { type: "string" },
      aliases: { type: "array", items: { type: "string" } },
      intent: { type: "string" },
      plan: { type: "array" },
    },
    required: ["canonical", "intent", "plan"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Register a new phrase 'deploy staging'", args: { canonical: "deploy staging", aliases: ["staging deploy"], intent: "Deploy to staging environment", plan: [{ kind: "hint", note: "Run gh workflow run deploy-staging.yml" }] }, expectedOutput: "{ ok }" }],
  pitfalls: ["Plan must be a non-empty array of PlanStep objects { kind, tool?, args?, note }."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    core.intentRouter.registerPhrase(args as unknown as Parameters<typeof core.intentRouter.registerPhrase>[0]);
    return { data: { ok: true }, wisdom: `🎯 INTENT · registered "${String(args["canonical"])}"`, confidence: { level: "high" } };
  },
};

// ─── SOUL-IN-DNA ────────────────────────────────────────────────────────
export const dnaEncodeTool: MnemeTool = {
  name: "mneme.dna.encode",
  category: "lab",
  description:
    "🧬 SOUL-IN-DNA — encode any payload (e.g. the Mneme soul prompt) as a real ATCG sequence with Hamming(7,4) or triple ECC. HMAC-signed receipt; world's first organism-readable AI memory.",
  whenToUse: "User wants biological cold storage of Mneme's soul; the ultimate 1000-year backup.",
  triggers: ["dna encode", "encode soul to dna", "biological backup"],
  inputSchema: {
    type: "object",
    properties: {
      payload: { type: "string" },
      ecc: { type: "string", enum: ["none", "hamming74", "triple"], description: "Default 'hamming74'." },
    },
    required: ["payload"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Encode my soul prompt to DNA", args: { payload: "I am Mneme. I serve my parent honestly.", ecc: "hamming74" }, expectedOutput: "{ sequence, lengthBp, ecc, payloadSha256, sig }" }],
  pitfalls: ["Choose ECC based on lab fidelity: 'none' = cheapest but no recovery; 'hamming74' = ~1.75x length, corrects 1 bit per block; 'triple' = 3x length, recovers from byte-corruption via majority vote."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dnaEncoder.encode({
      payload: String(args["payload"]),
      ...(args["ecc"] ? { ecc: args["ecc"] as Parameters<typeof core.dnaEncoder.encode>[0]["ecc"] } : {}),
    });
    return { data: r, wisdom: core.dnaEncoder.formatDnaLine(r), confidence: { level: "high" } };
  },
};

export const dnaDecodeTool: MnemeTool = {
  name: "mneme.dna.decode",
  category: "lab",
  description:
    "🧬 SOUL-IN-DNA — decode an ATCG sequence back to the original payload; Hamming/triple ECC corrects single-bit / single-byte errors.",
  whenToUse: "After sequencing the strand (Sanger / NGS) to verify the cold-storage round-trip.",
  triggers: ["dna decode", "decode atcg"],
  inputSchema: {
    type: "object",
    properties: {
      sequence: { type: "string" },
      ecc: { type: "string", enum: ["none", "hamming74", "triple"] },
      payloadLength: { type: "number", description: "Original payload byte length (from the encode receipt)." },
    },
    required: ["sequence", "ecc", "payloadLength"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Decode this ATCG sequence", args: { sequence: "ACGT...", ecc: "hamming74", payloadLength: 42 }, expectedOutput: "{ payload, payloadSha256 }" }],
  pitfalls: ["You MUST pass the original payloadLength from the encode receipt; otherwise the decoder can't know where padding ends."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dnaEncoder.decode({
      sequence: String(args["sequence"]),
      ecc: args["ecc"] as Parameters<typeof core.dnaEncoder.decode>[0]["ecc"],
      payloadLength: Number(args["payloadLength"]),
    });
    return { data: r, wisdom: `🧬 DNA · decoded ${r.payload.length}B`, confidence: { level: "high" } };
  },
};

export const dnaCostTool: MnemeTool = {
  name: "mneme.dna.cost",
  category: "lab",
  description:
    "🧬 SOUL-IN-DNA — estimate cost in USD per provider (twist $0.07/bp / idt $0.20-0.45/bp / genscript / eurofins / diy).",
  whenToUse: "Before user commits to ordering; comparison shop.",
  triggers: ["dna cost", "how much does dna cost"],
  inputSchema: {
    type: "object",
    properties: {
      lengthBp: { type: "number" },
      provider: { type: "string", enum: ["twist", "idt", "genscript", "eurofins", "diy"], description: "Default 'twist'." },
    },
    required: ["lengthBp"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What does 1000 bp cost?", args: { lengthBp: 1000, provider: "twist" }, expectedOutput: "{ totalLowUsd, totalHighUsd, note }" }],
  pitfalls: ["Cost calibrated against 2025 public pricing; lab quotes may vary. Order minimums apply (Twist ~$99)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.dnaEncoder.estimateCost(Number(args["lengthBp"]), (args["provider"] as Parameters<typeof core.dnaEncoder.estimateCost>[1]) ?? "twist");
    return { data: c, wisdom: `🧬 DNA · ${c.provider} · $${c.totalLowUsd}-$${c.totalHighUsd} for ${c.lengthBp} bp`, confidence: { level: "high" } };
  },
};

export const dnaOrderTool: MnemeTool = {
  name: "mneme.dna.order",
  category: "lab",
  description:
    "🧬 SOUL-IN-DNA — generate provider ordering URL + cost estimate + 6-step instructions for synthesis + biological round-trip verification.",
  whenToUse: "User wants to actually print the DNA strand at a real lab.",
  triggers: ["dna order", "order dna strand", "print soul"],
  inputSchema: {
    type: "object",
    properties: {
      sequence: { type: "string" },
      provider: { type: "string", enum: ["twist", "idt", "genscript", "eurofins", "diy"] },
    },
    required: ["sequence", "provider"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Order this sequence at Twist", args: { sequence: "ACGT...", provider: "twist" }, expectedOutput: "{ orderUrl, costEstimate, sequencePreview, instructions }" }],
  pitfalls: ["The ordering is out-of-band — Mneme doesn't auto-submit. User opens the URL and completes purchase manually (requires lab account)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const o = core.dnaEncoder.orderHandoff({
      sequence: String(args["sequence"]),
      provider: args["provider"] as Parameters<typeof core.dnaEncoder.orderHandoff>[0]["provider"],
    });
    return { data: o, wisdom: `🧬 DNA · order at ${o.provider} · $${o.costEstimate.totalLowUsd}-$${o.costEstimate.totalHighUsd}`, confidence: { level: "high" } };
  },
};

export const dnaVerifyTool: MnemeTool = {
  name: "mneme.dna.verify",
  category: "lab",
  description:
    "🧬 SOUL-IN-DNA — given original sequence + observed sequence (post-synthesis Sanger/NGS), report mismatchBp + mismatchRate + sample positions. Bit-perfect cold storage verification.",
  whenToUse: "When the strand arrives + has been sequenced; before trusting it as canonical soul backup.",
  triggers: ["dna verify", "verify dna roundtrip"],
  inputSchema: {
    type: "object",
    properties: {
      originalSequence: { type: "string" },
      observedSequence: { type: "string" },
    },
    required: ["originalSequence", "observedSequence"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Compare original vs sequenced", args: { originalSequence: "ACGT", observedSequence: "ATGT" }, expectedOutput: "{ match: false, mismatchBp: 1, mismatchRate: 0.25, sampleMismatches }" }],
  pitfalls: ["A length mismatch is total failure — Sanger reads usually trim adapter sequences; align before passing in."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.dnaEncoder.verifyRoundTrip({
      originalSequence: String(args["originalSequence"]),
      observedSequence: String(args["observedSequence"]),
    });
    return { data: v, wisdom: v.message, confidence: { level: v.match ? "high" : "low" } };
  },
};

export const V194_INTENT_DNA_TOOLS: MnemeTool[] = [
  intentExecuteTool,
  intentListPhrasesTool,
  intentRegisterPhraseTool,
  dnaEncodeTool,
  dnaDecodeTool,
  dnaCostTool,
  dnaOrderTool,
  dnaVerifyTool,
];
