/**
 * v2.19.40 WIRING TRINITY — MCP tools (3 modules wiring all 13 primitives)
 *
 *   TOKEN GOVERNOR (3):
 *     mneme.governor.govern        — run the 5-stage cascade for one AI call
 *     mneme.governor.aggregate     — roll up decisions into savings dashboard
 *     mneme.governor.verify        — verify HMAC of a decision
 *
 *   PROMPT FOSSIL (4):
 *     mneme.fossil.mint            — append a prompt+response fossil to the store
 *     mneme.fossil.lookup          — embedding similarity lookup (reuse/diff/miss)
 *     mneme.fossil.diff_prompt     — render a diff-mode prompt for vendor
 *     mneme.fossil.stats           — store stats for dashboard
 *
 *   GANGLION (5):
 *     mneme.ganglion.classify      — classify intent of a prompt
 *     mneme.ganglion.auction       — run Vickrey-style auction across bids
 *     mneme.ganglion.record        — Hebbian record outcome → updates graph
 *     mneme.ganglion.preferred     — preferred neuron for an intent
 *     mneme.ganglion.stats         — graph stats + convergence metric
 */

import type { MnemeTool } from "./_types.js";

// ─── TOKEN GOVERNOR ───────────────────────────────────────────────────

export const governorGovernTool: MnemeTool = {
  name: "mneme.governor.govern",
  category: "meta",
  description: "🧠 GOVERNOR (v2.19.40) — run the 5-stage cascade for one AI call. Caller supplies callbacks for cache lookup, local answer, arbitrage, vendor calls. Returns deterministic GovernorDecision with HMAC signature.",
  whenToUse: "Wrap EVERY outbound AI vendor call through this; saves 30-80% tokens vs direct call by routing cache → local → cheap → expensive.",
  triggers: ["governor govern", "route ai call", "wire primitives"],
  inputSchema: {
    type: "object",
    properties: {
      req: { type: "object" },
      ctx: { type: "object", description: "Governor context (callbacks are no-ops over MCP boundary; caller wires real I/O)" },
    },
    required: ["req"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Route this AI call optimally", args: { req: { kind: "ask", prompt: "does X exist", estDirectTokens: 200 } }, expectedOutput: "{ stage: 1-5, action, answer, vendor, tokensUsedActual, estTokensSavedVsDirect, trail, signature }" }],
  pitfalls: ["The MCP wrapper takes a serialised request only; live callback wiring happens in the in-process caller. Use this tool to dry-run the governor or to mint a no-op decision skeleton."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const req = args["req"] as Parameters<typeof core.tokenGovernor.governCall>[0];
    const d = await core.tokenGovernor.governCall(req, {});
    return { data: d, wisdom: `🧠 governor → stage=${d.stage} action=${d.action}`, confidence: { level: "high" } };
  },
};

export const governorAggregateTool: MnemeTool = {
  name: "mneme.governor.aggregate",
  category: "meta",
  description: "🧠 GOVERNOR — roll up a list of decisions into the savings dashboard (totals by stage + cache/local hit rates).",
  whenToUse: "Display weekly savings to the user: 'you saved $47 vs direct vendor calls this week'.",
  triggers: ["governor aggregate", "savings dashboard", "tokens saved"],
  inputSchema: { type: "object", properties: { decisions: { type: "array" } }, required: ["decisions"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How many tokens did Mneme save me this week", args: { decisions: [] }, expectedOutput: "{ totalCallsGoverned, totalTokensSaved, byStage, cacheHitRate, localHitRate }" }],
  pitfalls: ["Decisions must be the exact GovernorDecision shape (HMAC-signed). Don't pass raw vendor logs."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const decisions = args["decisions"] as Parameters<typeof core.tokenGovernor.aggregateSavings>[0];
    const agg = core.tokenGovernor.aggregateSavings(decisions);
    return { data: agg, wisdom: `🧠 governed ${agg.totalCallsGoverned} calls · saved ${agg.totalTokensSaved} tokens · cache-hit ${(agg.cacheHitRate * 100).toFixed(0)}%`, confidence: { level: "high" } };
  },
};

export const governorVerifyTool: MnemeTool = {
  name: "mneme.governor.verify",
  category: "audit",
  description: "🧠 GOVERNOR — verify HMAC signature on a decision (tamper detection; composes with APOSTILLE).",
  whenToUse: "Before trusting a stored decision for billing / audit / dashboard.",
  triggers: ["governor verify", "verify decision"],
  inputSchema: { type: "object", properties: { decision: { type: "object" } }, required: ["decision"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this governor decision authentic?", args: { decision: {} }, expectedOutput: "{ ok: true } or { ok: false, reason }" }],
  pitfalls: ["Verification uses the same MNEME_GOVERNOR_SECRET env var the decision was minted with."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.tokenGovernor.verifyDecision(args["decision"] as Parameters<typeof core.tokenGovernor.verifyDecision>[0]);
    return { data: v, wisdom: v.ok ? "🧠 decision authentic" : `🧠 tampered: ${v.reason}`, confidence: { level: "high" } };
  },
};

// ─── PROMPT FOSSIL ────────────────────────────────────────────────────

export const fossilMintTool: MnemeTool = {
  name: "mneme.fossil.mint",
  category: "memory",
  description: "🦴 FOSSIL (v2.19.40) — append a prompt+response fossil to the store (HMAC-chained). Future similar prompts can REUSE or DIFF off this.",
  whenToUse: "After every successful AI response, mint a fossil so the next similar prompt is free or cheap.",
  triggers: ["fossil mint", "prompt git", "cache prompt"],
  inputSchema: {
    type: "object",
    properties: { store: { type: "object" }, input: { type: "object" } },
    required: ["store", "input"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Save this prompt+response as a fossil", args: { store: {}, input: { promptSkeleton: "list mcp tools", embedding: [], answer: "699", vendor: "haiku", model: "h", costTokens: 200 } }, expectedOutput: "{ id, mintedAtMs, sig, ... }" }],
  pitfalls: ["Embedding must come from the same embedder used for lookups (SNN / Chimera / Ollama); mixing embedders breaks similarity."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const store = args["store"] as Parameters<typeof core.promptFossil.mintFossil>[0];
    const input = args["input"] as Parameters<typeof core.promptFossil.mintFossil>[1];
    const fossil = core.promptFossil.mintFossil(store, input);
    return { data: { fossil, store }, wisdom: `🦴 minted fossil ${fossil.id.slice(0, 8)}`, confidence: { level: "high" } };
  },
};

export const fossilLookupTool: MnemeTool = {
  name: "mneme.fossil.lookup",
  category: "memory",
  description: "🦴 FOSSIL — embedding similarity lookup against the store. Returns action='reuse' (>=0.95 + fresh), 'diff' (>=0.85), or 'miss' (<0.85). REUSE = 0 tokens; DIFF saves 60-90%.",
  whenToUse: "BEFORE every outbound vendor call, look up the fossil store first. The 'prompt git' concept — first AI tool that diffs.",
  triggers: ["fossil lookup", "prompt similarity", "deja vu cache"],
  inputSchema: {
    type: "object",
    properties: {
      store: { type: "object" }, embedding: { type: "array" }, promptText: { type: "string" }, opts: { type: "object" },
    },
    required: ["store", "embedding", "promptText"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Has Mneme seen this prompt before?", args: { store: {}, embedding: [0.1, 0.2], promptText: "list mcp tools" }, expectedOutput: "{ action: 'reuse'|'diff'|'miss', similarity, fossil?, diffPrompt?, estTokensSaved }" }],
  pitfalls: ["Returns 'miss' when store is empty (cold start). Don't treat 'miss' as failure — that's the expected baseline."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const store = args["store"] as Parameters<typeof core.promptFossil.lookupFossil>[0];
    const r = core.promptFossil.lookupFossil(
      store,
      args["embedding"] as number[],
      args["promptText"] as string,
      args["opts"] as Parameters<typeof core.promptFossil.lookupFossil>[3] | undefined,
    );
    return { data: r, wisdom: `🦴 ${r.action} · similarity ${(r.similarity * 100).toFixed(1)}% · saved ${r.estTokensSaved} tokens`, confidence: { level: "high" } };
  },
};

export const fossilDiffPromptTool: MnemeTool = {
  name: "mneme.fossil.diff_prompt",
  category: "memory",
  description: "🦴 FOSSIL — render a diff-mode prompt: tells the AI vendor it previously answered X and to respond only to the delta. Caller sends this instead of the original prompt → vendor burns 60-90% fewer tokens.",
  whenToUse: "When fossil.lookup returned action='diff'. Send the diffPrompt instead of the user's literal prompt.",
  triggers: ["fossil diff prompt", "diff mode prompt"],
  inputSchema: { type: "object", properties: { newPrompt: { type: "string" }, fossil: { type: "object" } }, required: ["newPrompt", "fossil"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Render diff prompt", args: { newPrompt: "new prompt", fossil: {} }, expectedOutput: "{ diffPrompt: '# Mneme PROMPT FOSSIL diff-mode...' }" }],
  pitfalls: ["Composes with Anthropic/OpenAI prompt-cache because the diff-prompt prefix is stable — vendor cache hit + Mneme fossil hit = compound saving."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const out = core.promptFossil.renderDiffPrompt(
      args["newPrompt"] as string,
      args["fossil"] as Parameters<typeof core.promptFossil.renderDiffPrompt>[1],
    );
    return { data: { diffPrompt: out }, wisdom: `🦴 diff prompt ${out.length} bytes`, confidence: { level: "high" } };
  },
};

export const fossilStatsTool: MnemeTool = {
  name: "mneme.fossil.stats",
  category: "meta",
  description: "🦴 FOSSIL — store stats: count, age, total saved tokens, vendor breakdown.",
  whenToUse: "Dashboard / weekly review surface.",
  triggers: ["fossil stats"],
  inputSchema: { type: "object", properties: { store: { type: "object" } }, required: ["store"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How big is my fossil store?", args: { store: {} }, expectedOutput: "{ count, oldestAgeDays, totalCostTokens, vendorBreakdown }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.promptFossil.fossilStats(args["store"] as Parameters<typeof core.promptFossil.fossilStats>[0]);
    return { data: s, wisdom: `🦴 ${s.count} fossils · ${s.totalCostTokens} tokens captured`, confidence: { level: "high" } };
  },
};

// ─── GANGLION ─────────────────────────────────────────────────────────

export const ganglionClassifyTool: MnemeTool = {
  name: "mneme.ganglion.classify",
  category: "meta",
  description: "🕸 GANGLION (v2.19.40) — classify a prompt into one of 9 intent classes (ask_question / verify_claim / generate_code / refactor_code / explain_code / file_lookup / version_query / count_query / unknown). Pure deterministic.",
  whenToUse: "Before routing a request through the Governor, classify intent so the synapse graph picks the right preferred stage.",
  triggers: ["ganglion classify", "classify intent"],
  inputSchema: { type: "object", properties: { prompt: { type: "string" }, kind: { type: "string" } }, required: ["prompt"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What kind of request is this", args: { prompt: "does foo.ts exist" }, expectedOutput: "{ intent: 'file_lookup' }" }],
  pitfalls: ["Classifier uses keyword shapes — pass `kind` parameter when caller already knows for an unambiguous override."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const intent = core.ganglion.classifyIntent(args["prompt"] as string, args["kind"] as string | undefined);
    return { data: { intent }, wisdom: `🕸 intent=${intent}`, confidence: { level: "high" } };
  },
};

export const ganglionAuctionTool: MnemeTool = {
  name: "mneme.ganglion.auction",
  category: "meta",
  description: "🕸 GANGLION — run Vickrey-style auction across neuron bids. Score = (confidence * estTokensSaved) / (latencyMs + 1). Returns ranked list + winner.",
  whenToUse: "When you have a list of primitive bids and need to pick which one handles the request.",
  triggers: ["ganglion auction", "neuron bid"],
  inputSchema: { type: "object", properties: { bids: { type: "array" } }, required: ["bids"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Pick the best primitive for this", args: { bids: [{ neuron: "REFLEX", bid: { confidence: 0.9, estTokensSaved: 200, latencyMs: 5 } }] }, expectedOutput: "{ winner, winnerScore, ranked: [...] }" }],
  pitfalls: ["A bid with estTokensSaved=0 will lose to any positive bid — that's the desired ranking."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.ganglion.runAuction(args["bids"] as Parameters<typeof core.ganglion.runAuction>[0]);
    return { data: r, wisdom: `🕸 winner=${r.winner} score=${r.winnerScore.toFixed(2)}`, confidence: { level: "high" } };
  },
};

export const ganglionRecordTool: MnemeTool = {
  name: "mneme.ganglion.record",
  category: "meta",
  description: "🕸 GANGLION — Hebbian update: strengthen winner's synapse, decay losers. Append HMAC-chained update. Over time the graph self-rewires for the user's actual workflow.",
  whenToUse: "After EVERY governor call, record the outcome so the synapse graph learns which primitive worked best for this intent.",
  triggers: ["ganglion record", "hebbian update", "synapse strengthen"],
  inputSchema: {
    type: "object",
    properties: {
      graph: { type: "object" }, intent: { type: "string" }, winner: { type: "string" }, losers: { type: "array" }, outcome: { type: "object" },
    },
    required: ["graph", "intent", "winner", "outcome"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Strengthen REFLEX for verify_claim", args: { graph: {}, intent: "verify_claim", winner: "REFLEX", losers: ["OPUS"], outcome: { successful: true, actualTokensSaved: 200, actualLatencyMs: 5, quality: 1.0 } }, expectedOutput: "{ seq, intent, winner, reward, sig, ... }" }],
  pitfalls: ["Failing outcomes (successful=false) actively decay the winner's weight — only call this when the caller can decide success/failure honestly."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const update = core.ganglion.recordOutcome(
      args["graph"] as Parameters<typeof core.ganglion.recordOutcome>[0],
      args["intent"] as Parameters<typeof core.ganglion.recordOutcome>[1],
      args["winner"] as string,
      (args["losers"] as string[] | undefined) ?? [],
      args["outcome"] as Parameters<typeof core.ganglion.recordOutcome>[4],
    );
    return { data: { update, graph: args["graph"] }, wisdom: `🕸 recorded update seq=${update.seq} reward=${update.reward.toFixed(2)}`, confidence: { level: "high" } };
  },
};

export const ganglionPreferredTool: MnemeTool = {
  name: "mneme.ganglion.preferred",
  category: "meta",
  description: "🕸 GANGLION — preferred neuron for an intent class (the one with highest current weight). null on cold start.",
  whenToUse: "Before running the governor, ask GANGLION which primitive has historically performed best for this intent. Stage hint for the governor.",
  triggers: ["ganglion preferred", "best primitive for intent"],
  inputSchema: { type: "object", properties: { graph: { type: "object" }, intent: { type: "string" } }, required: ["graph", "intent"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's the best primitive for file_lookup", args: { graph: {}, intent: "file_lookup" }, expectedOutput: "{ neuron, weight } or null" }],
  pitfalls: ["null means cold start — caller should run the full cascade without a stage hint."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const out = core.ganglion.preferredNeuron(
      args["graph"] as Parameters<typeof core.ganglion.preferredNeuron>[0],
      args["intent"] as Parameters<typeof core.ganglion.preferredNeuron>[1],
    );
    return { data: out, wisdom: out ? `🕸 prefer ${out.neuron} (weight ${out.weight.toFixed(2)})` : "🕸 cold start — no preference yet", confidence: { level: "high" } };
  },
};

export const ganglionStatsTool: MnemeTool = {
  name: "mneme.ganglion.stats",
  category: "meta",
  description: "🕸 GANGLION — graph stats: total synapses, updates, per-intent breakdown, convergence metric (how dominant the top neuron is over runner-up averaged across intents). Convergence rises as the graph stabilises.",
  whenToUse: "Dashboard / debugging. Convergence > 0.3 means the graph has settled.",
  triggers: ["ganglion stats", "synapse graph stats"],
  inputSchema: { type: "object", properties: { graph: { type: "object" } }, required: ["graph"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How converged is my wiring graph", args: { graph: {} }, expectedOutput: "{ totalSynapses, totalUpdates, intentBreakdown, convergence }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.ganglion.graphStats(args["graph"] as Parameters<typeof core.ganglion.graphStats>[0]);
    return { data: s, wisdom: `🕸 ${s.totalSynapses} synapses · ${s.totalUpdates} updates · convergence ${s.convergence.toFixed(2)}`, confidence: { level: "high" } };
  },
};

export const V1940_WIRING_TRINITY_TOOLS: MnemeTool[] = [
  governorGovernTool, governorAggregateTool, governorVerifyTool,
  fossilMintTool, fossilLookupTool, fossilDiffPromptTool, fossilStatsTool,
  ganglionClassifyTool, ganglionAuctionTool, ganglionRecordTool, ganglionPreferredTool, ganglionStatsTool,
];
