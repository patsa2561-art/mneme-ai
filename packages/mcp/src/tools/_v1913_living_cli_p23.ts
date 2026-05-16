/**
 * v2.19.13 LIVING CLI · Pillars 2 + 3 — 10 MCP tools.
 *
 *   PILLAR 2 — NEUROMORPHIC SPIKING EMBEDDER (5 tools):
 *     mneme.snn.embed         — text → 2048-dim sparse firing-rate vector
 *     mneme.snn.similarity    — cosine between two text embeddings
 *     mneme.snn.finetune      — adversarial threshold finetune on a triplet
 *     mneme.snn.stats         — population stats for one text's embedding
 *     mneme.snn.config        — current SNN config + dimensions
 *
 *   PILLAR 3 — NEGATIVE-EVIDENCE FIREWALL (5 tools):
 *     mneme.negev.gate                  — claim + refutations + search results → verdict
 *     mneme.negev.verify_certificate    — HMAC-verify an ACCEPTED certificate
 *     mneme.negev.tax_init              — grant monthly hallucination budget
 *     mneme.negev.tax_charge            — record a refuted-claim charge
 *     mneme.negev.tax_status            — vendor remaining budget + routing decision
 */

import type { MnemeTool } from "./_types.js";

// SNN: one shared embedder per MCP server lifetime (caller can override seed).
let snnEmbedder: import("@mneme-ai/core").neuromorphicEmbedder.SpikeEmbedder | null = null;
async function getSnn(): Promise<import("@mneme-ai/core").neuromorphicEmbedder.SpikeEmbedder> {
  if (!snnEmbedder) {
    const core = await import("@mneme-ai/core");
    snnEmbedder = core.neuromorphicEmbedder.createEmbedder({ seed: 1 });
  }
  return snnEmbedder;
}
async function setSnn(next: import("@mneme-ai/core").neuromorphicEmbedder.SpikeEmbedder): Promise<void> {
  snnEmbedder = next;
}

// Tax ledger: one persistent ledger per MCP server lifetime.
let taxLedger: import("@mneme-ai/core").negativeEvidence.TaxLedger | null = null;
async function getTax(): Promise<import("@mneme-ai/core").negativeEvidence.TaxLedger> {
  if (!taxLedger) {
    const core = await import("@mneme-ai/core");
    taxLedger = core.negativeEvidence.emptyTaxLedger();
  }
  return taxLedger;
}
async function setTax(next: import("@mneme-ai/core").negativeEvidence.TaxLedger): Promise<void> {
  taxLedger = next;
}

// ─── SNN ────────────────────────────────────────────────────────────────
export const snnEmbedTool: MnemeTool = {
  name: "mneme.snn.embed",
  category: "lab",
  description:
    "🧠 SNN — embed text into a 2048-dim SPARSE firing-rate vector via a 32-population × 64-neuron spiking neural net (50 timesteps). Tiny footprint, adversarially tunable.",
  whenToUse: "When you need a portable embedding without transformer dependencies — ideal for code-corpus + small footprint.",
  triggers: ["snn embed", "spike embed", "neuromorphic embedding"],
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Embed this sentence with the SNN", args: { text: "Mneme is a memory layer." }, expectedOutput: "{ vector, totalSpikes, dimension, sparsity }" }],
  pitfalls: ["SNN loses ~15-20% accuracy to transformers on MTEB English-general. Wins on code-corpus + tiny footprint + adversarial finetune."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const e = await getSnn();
    const r = core.neuromorphicEmbedder.embed(e, String(args["text"]));
    const sp = core.neuromorphicEmbedder.sparsity(r.vector);
    return {
      data: { vector: Array.from(r.vector), totalSpikes: r.totalSpikes, dimension: r.vector.length, sparsity: sp },
      wisdom: `🧠 SNN embed · dim=${r.vector.length} · spikes=${r.totalSpikes} · sparsity=${sp.toFixed(3)}`,
      confidence: { level: "high" },
    };
  },
};

export const snnSimilarityTool: MnemeTool = {
  name: "mneme.snn.similarity",
  category: "lab",
  description:
    "🧠 SNN — cosine similarity between two SNN-embedded texts. Returns value in [-1, 1].",
  whenToUse: "Fast pairwise similarity for retrieval-style ranking.",
  triggers: ["snn similarity", "spike similarity"],
  inputSchema: {
    type: "object",
    properties: { a: { type: "string" }, b: { type: "string" } },
    required: ["a", "b"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How similar are these two?", args: { a: "neural network", b: "spike train" }, expectedOutput: "{ cosine }" }],
  pitfalls: ["Both vectors are computed fresh — no caching at this layer."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const e = await getSnn();
    const a = core.neuromorphicEmbedder.embed(e, String(args["a"])).vector;
    const b = core.neuromorphicEmbedder.embed(e, String(args["b"])).vector;
    const c = core.neuromorphicEmbedder.cosine(a, b);
    return { data: { cosine: c }, wisdom: `🧠 SNN cos=${c.toFixed(3)}`, confidence: { level: "high" } };
  },
};

export const snnFinetuneTool: MnemeTool = {
  name: "mneme.snn.finetune",
  category: "lab",
  description:
    "🧠 SNN — adversarial threshold finetune on a triplet (anchor, positive, negative). Updates the singleton embedder in-place; reports before/after margins.",
  whenToUse: "Periodic (daemon-idle) to specialise the SNN to YOUR corpus. After enough triplets, the embedder is a per-repo phenotype.",
  triggers: ["snn finetune", "snn adversarial"],
  inputSchema: {
    type: "object",
    properties: {
      anchor: { type: "string" },
      positive: { type: "string" },
      negative: { type: "string" },
      learningRate: { type: "number" },
    },
    required: ["anchor", "positive", "negative"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Finetune SNN on this triplet", args: { anchor: "git commit", positive: "git push", negative: "weather rain" }, expectedOutput: "{ beforeMargin, afterMargin, marginImprovement, thresholdAdjustments }" }],
  pitfalls: ["Per-triplet improvement isn't guaranteed (SNN is gradient-free). Run batches for measurable trends."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const e = await getSnn();
    const r = core.neuromorphicEmbedder.adversarialFinetune({
      embedder: e,
      triplet: {
        anchor: String(args["anchor"]),
        positive: String(args["positive"]),
        negative: String(args["negative"]),
      },
      learningRate: args["learningRate"] as number | undefined,
    });
    await setSnn(r.embedder);
    return {
      data: {
        beforeCosPos: r.beforeCosPos, beforeCosNeg: r.beforeCosNeg,
        afterCosPos: r.afterCosPos, afterCosNeg: r.afterCosNeg,
        beforeMargin: r.beforeMargin, afterMargin: r.afterMargin,
        marginImprovement: r.marginImprovement,
        thresholdAdjustments: r.thresholdAdjustments,
      },
      wisdom: `🧠 SNN finetune · margin Δ=${r.marginImprovement.toFixed(4)} · adj=${r.thresholdAdjustments}`,
      confidence: { level: "high" },
    };
  },
};

export const snnStatsTool: MnemeTool = {
  name: "mneme.snn.stats",
  category: "lab",
  description:
    "🧠 SNN — population stats for one text: active/silent neurons, populations touched, average + max firing rate, sparsity.",
  whenToUse: "Diagnosing SNN behaviour on a specific text — is it firing too dense or too sparse?",
  triggers: ["snn stats", "snn population stats"],
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "SNN stats for 'hello world'", args: { text: "hello world" }, expectedOutput: "{ totalNeurons, activeNeurons, populationsTouched, averageFiringRate, sparsity }" }],
  pitfalls: ["High average firing rate = too dense (consider raising thresholds). Zero firing = input under-driving (consider increasing input strength)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const e = await getSnn();
    const r = core.neuromorphicEmbedder.embed(e, String(args["text"]));
    const s = core.neuromorphicEmbedder.populationStats(e, r.vector);
    return { data: s, wisdom: `🧠 SNN · active=${s.activeNeurons}/${s.totalNeurons} · pops=${s.populationsTouched} · sparsity=${s.sparsity.toFixed(3)}`, confidence: { level: "high" } };
  },
};

export const snnConfigTool: MnemeTool = {
  name: "mneme.snn.config",
  category: "lab",
  description:
    "🧠 SNN — current embedder configuration (populations × neuronsPerPop × steps × featureDim × seed).",
  whenToUse: "Audit which SNN you're running against.",
  triggers: ["snn config"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show SNN config", expectedOutput: "{ populations, neuronsPerPop, steps, featureDim, seed, dimension }" }],
  pitfalls: ["Singleton resets on MCP restart unless externally persisted."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const e = await getSnn();
    const dim = e.config.populations * e.config.neuronsPerPop;
    return {
      data: { ...e.config, dimension: dim },
      wisdom: core.neuromorphicEmbedder.formatEmbedderLine(e),
      confidence: { level: "high" },
    };
  },
};

// ─── NEGEV ──────────────────────────────────────────────────────────────
export const negevGateTool: MnemeTool = {
  name: "mneme.negev.gate",
  category: "audit",
  description:
    "❌ NEGEV — gate a claim through negative-evidence firewall. Caller supplies refutation candidates + search outcomes (git/file/test/web); returns ACCEPTED + HMAC certificate, REJECTED + defeating evidence, or UNKNOWN + pending searches.",
  whenToUse: "Before trusting any AI-stated factual claim that names files, functions, versions, or behaviours. The strongest hallucination defence we ship.",
  triggers: ["negev gate", "negative evidence", "kill hallucination"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      refutations: { type: "array", items: { type: "string" } },
      searchResults: { type: "array", items: { type: "object" } },
    },
    required: ["claim", "refutations", "searchResults"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Gate this claim", args: { claim: "X is true", refutations: ["X false in case A"], searchResults: [{ refutation: "X false in case A", source: "git", verdict: "not_found" }] }, expectedOutput: "{ verdict, certificate? | rejectedBy? | pendingSearches? }" }],
  pitfalls: ["Empty refutations → UNKNOWN (never auto-accepts). Pair with mneme.inverse.prompt to generate refutations + a real search step."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.negativeEvidence.gateClaim({
      claim: String(args["claim"]),
      refutations: (args["refutations"] as string[]) ?? [],
      searchResults: (args["searchResults"] as Parameters<typeof core.negativeEvidence.gateClaim>[0]["searchResults"]) ?? [],
    });
    return { data: r, wisdom: core.negativeEvidence.formatGateLine(r), confidence: { level: "high" } };
  },
};

export const negevVerifyCertTool: MnemeTool = {
  name: "mneme.negev.verify_certificate",
  category: "audit",
  description:
    "❌ NEGEV — HMAC-verify an ACCEPTED certificate. Catches forged certificates that didn't actually pass the gate.",
  whenToUse: "Before trusting a certificate received from another Mneme instance or vendor.",
  triggers: ["negev verify", "verify certificate"],
  inputSchema: { type: "object", properties: { certificate: { type: "object" } }, required: ["certificate"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this certificate real?", args: { certificate: {} }, expectedOutput: "{ ok, reason? }" }],
  pitfalls: ["Verifies signature only — doesn't re-check the original searches."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.negativeEvidence.verifyCertificate(
      args["certificate"] as Parameters<typeof core.negativeEvidence.verifyCertificate>[0],
    );
    return { data: r, wisdom: r.ok ? "✅ cert VALID" : `❌ ${r.reason}`, confidence: { level: "high" } };
  },
};

export const negevTaxInitTool: MnemeTool = {
  name: "mneme.negev.tax_init",
  category: "audit",
  description:
    "💰 TAX — grant the monthly hallucination budget for a vendor (default 1000 credits). Idempotent within the same month.",
  whenToUse: "Beginning of each month, or at first call from a new vendor.",
  triggers: ["negev tax init", "vendor budget grant"],
  inputSchema: {
    type: "object",
    properties: { vendor: { type: "string" }, amount: { type: "number" } },
    required: ["vendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Grant June budget to claude", args: { vendor: "v-anthropic" }, expectedOutput: "{ entryCount }" }],
  pitfalls: ["Calling twice in the same month does nothing (idempotent by design)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ledger = await getTax();
    const next = core.negativeEvidence.initMonthlyBudget({
      ledger,
      vendor: String(args["vendor"]),
      amount: args["amount"] as number | undefined,
    });
    await setTax(next);
    return { data: { entryCount: next.entries.length }, wisdom: `💰 tax init for ${args["vendor"]}`, confidence: { level: "high" } };
  },
};

export const negevTaxChargeTool: MnemeTool = {
  name: "mneme.negev.tax_charge",
  category: "audit",
  description:
    "💰 TAX — charge a vendor for a refuted claim (default 10 credits). HMAC-chained ledger; positive amounts only.",
  whenToUse: "Every time mneme.negev.gate returns REJECTED — charge the vendor whose answer it was.",
  triggers: ["negev tax charge", "refuted claim charge"],
  inputSchema: {
    type: "object",
    properties: { vendor: { type: "string" }, amount: { type: "number" }, reason: { type: "string" } },
    required: ["vendor", "reason"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Charge openai 10 for refuted claim X", args: { vendor: "v-openai", amount: 10, reason: "refuted: file X doesn't exist" }, expectedOutput: "{ entryCount, remaining }" }],
  pitfalls: ["Negative amounts throw — explicit positive only."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ledger = await getTax();
    const next = core.negativeEvidence.chargeTax({
      ledger,
      vendor: String(args["vendor"]),
      amount: args["amount"] as number | undefined,
      reason: String(args["reason"]),
    });
    await setTax(next);
    const s = core.negativeEvidence.vendorStatus({ ledger: next, vendor: String(args["vendor"]) });
    return {
      data: { entryCount: next.entries.length, remaining: s.remaining, exhausted: s.exhausted },
      wisdom: `💰 charged ${args["vendor"]} · remaining=${s.remaining}${s.exhausted ? " (EXHAUSTED)" : ""}`,
      confidence: { level: "high" },
    };
  },
};

export const negevTaxStatusTool: MnemeTool = {
  name: "mneme.negev.tax_status",
  category: "audit",
  description:
    "💰 TAX — vendor monthly status (budget/charged/remaining/exhausted/rejectedClaimCount) + a routing decision against a fallback vendor.",
  whenToUse: "Before delegating a high-stakes claim — check whether the primary vendor still has budget.",
  triggers: ["negev tax status", "vendor routing"],
  inputSchema: {
    type: "object",
    properties: {
      primaryVendor: { type: "string" },
      fallbackVendor: { type: "string" },
    },
    required: ["primaryVendor", "fallbackVendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should I route to claude or llama?", args: { primaryVendor: "v-anthropic", fallbackVendor: "v-llama" }, expectedOutput: "{ status, decision }" }],
  pitfalls: ["Routing decision is advisory — MCP client decides whether to honour it."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ledger = await getTax();
    const status = core.negativeEvidence.vendorStatus({ ledger, vendor: String(args["primaryVendor"]) });
    const decision = core.negativeEvidence.routingDecision({
      ledger,
      primaryVendor: String(args["primaryVendor"]),
      fallbackVendor: String(args["fallbackVendor"]),
    });
    return {
      data: { status, decision },
      wisdom: `💰 ${status.vendor} · ${status.remaining}/${status.budget} · route=${decision.route}`,
      confidence: { level: "high" },
    };
  },
};

export const V1913_LIVING_CLI_P23_TOOLS: MnemeTool[] = [
  snnEmbedTool, snnSimilarityTool, snnFinetuneTool, snnStatsTool, snnConfigTool,
  negevGateTool, negevVerifyCertTool, negevTaxInitTool, negevTaxChargeTool, negevTaxStatusTool,
];
