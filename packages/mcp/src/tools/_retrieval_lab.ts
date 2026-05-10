/**
 * Mneme Retrieval Lab -- MCP tools.
 *
 *   mneme.retrieval.lab.list_configs   -- arm pool + active config
 *   mneme.retrieval.lab.leaderboard    -- ranked by mean composite + UCB1
 *   mneme.retrieval.lab.tune           -- run one trial on demand
 *   mneme.retrieval.cross_encoder.rerank -- rerank candidates with bge-reranker-base
 *   mneme.retrieval.hyde.rewrite       -- expand query via HyDE
 */

import { retrievalLab } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

const ROOT = (rt: { meta: { rootPath: string } }) => rt.meta.rootPath;

export const labListConfigsTool: MnemeTool = {
  name: "mneme.retrieval.lab.list_configs",
  category: "meta",
  description:
    "List the candidate retrieval configs the auto-tuner picks among, " +
    "plus the currently-active config (the one every search() in Mneme " +
    "uses right now). Configs vary on embedder backend, RRF k, vector/BM25 " +
    "weight, reranker, HyDE on/off, and candidate-K.",
  whenToUse: "User asks 'what retrieval configs are running?' or 'why is search slow?'",
  triggers: ["retrieval configs", "retrieval lab", "what retrieval"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      configs: { type: "array" }, active: { type: "string" }, total: { type: "number" },
    },
  },
  examples: [{ userQuery: "What retrieval configs is Mneme trying?" }],
  pitfalls: [
    "Paid embedders (voyage-3, openai-3-*) only appear active if API keys are present in the env.",
  ],
  composeWith: ["mneme.retrieval.lab.leaderboard", "mneme.retrieval.lab.tune"],
  handler: async (rt) => {
    const lb = retrievalLab.readLeaderboard(ROOT(rt));
    const available = retrievalLab.availableEmbedders().map((e) => e.id);
    return {
      data: {
        configs: retrievalLab.CANDIDATE_CONFIGS.map((c) => ({
          ...c,
          available: available.includes(c.embedder),
        })),
        active: lb.active,
        total: retrievalLab.CANDIDATE_CONFIGS.length,
      },
      wisdom: `${retrievalLab.CANDIDATE_CONFIGS.length} candidate configs; active = "${lb.active}". ${available.length} embedder backends usable on this machine.`,
      confidence: { level: "high" },
    };
  },
};

export const labLeaderboardTool: MnemeTool = {
  name: "mneme.retrieval.lab.leaderboard",
  category: "meta",
  description:
    "Show the auto-tuner leaderboard: each config + trial count + mean " +
    "precision/recall/NDCG/latency + UCB1. The current active config is " +
    "the highest-mean entry with at least 2 trials. Pareto frontier (best " +
    "tradeoff between quality and latency) is included separately.",
  whenToUse: "Inspect the auto-tuner's progress; explain why config X is active.",
  triggers: ["retrieval leaderboard", "retrieval pareto", "retrieval tuning state"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: { entries: { type: "array" }, active: { type: "string" }, totalTrials: { type: "number" }, paretoIds: { type: "array" } },
  },
  examples: [{ userQuery: "Which retrieval config is winning right now?" }],
  pitfalls: [
    "Configs with trialCount=0 show ucb1=Infinity by design (untried arms get priority).",
  ],
  composeWith: ["mneme.retrieval.lab.tune", "mneme.retrieval.lab.list_configs"],
  handler: async (rt) => {
    const lb = retrievalLab.readLeaderboard(ROOT(rt));
    const pareto = retrievalLab.paretoFrontier(lb).map((e) => e.configId);
    const tried = lb.entries.filter((e) => e.trialCount > 0)
      .sort((a, b) => b.meanComposite - a.meanComposite);
    return {
      data: {
        entries: lb.entries, active: lb.active, totalTrials: lb.totalTrials,
        paretoIds: pareto,
      },
      wisdom: tried.length === 0
        ? `Leaderboard is empty -- start the daemon (\`mneme nucleus daemon --detach\`) and trials will run automatically every 15 min.`
        : `${tried.length} configs tried (${lb.totalTrials} trials). Active: "${lb.active}" (composite ${tried[0]?.meanComposite.toFixed(3)}, latency ${Math.round(tried[0]?.meanLatencyMs ?? 0)}ms).`,
      confidence: { level: "high" },
    };
  },
};

export const labTuneTool: MnemeTool = {
  name: "mneme.retrieval.lab.tune",
  category: "meta",
  description:
    "Run ONE retrieval-config trial on demand. Picks the next arm via " +
    "UCB1 (or accepts a specific configId), runs the eval suite, folds " +
    "the result into the leaderboard. Each trial is HMAC-SHA256 signed.",
  whenToUse: "Force a trial without waiting for the daemon's 15-min cycle.",
  triggers: ["tune retrieval", "retrieval trial", "rerun tuner"],
  inputSchema: {
    type: "object",
    properties: { configId: { type: "string", description: "Optional: trial this exact config. Default: UCB1 picks." } },
  },
  outputSchema: { type: "object", properties: { trial: { type: "object" }, newActive: { type: "string" } } },
  examples: [{ userQuery: "Run one retrieval-tuning trial." }],
  pitfalls: [],
  composeWith: ["mneme.retrieval.lab.leaderboard"],
  handler: async (rt, args) => {
    const root = ROOT(rt);
    const wantId = typeof args["configId"] === "string" ? args["configId"] as string : null;
    const config = wantId
      ? retrievalLab.getConfig(wantId)
      : retrievalLab.pickNextArm(retrievalLab.readLeaderboard(root)).config;
    const trial = retrievalLab.runTrial(root, config);
    const lb = retrievalLab.recordTrial(root, trial);
    return {
      data: { trial, newActive: lb.active },
      wisdom: `Trial of "${config.id}" complete: composite ${trial.compositeScore.toFixed(3)}, latency ${trial.meanLatencyMs}ms. Active config = "${lb.active}".`,
      confidence: { level: "high" },
    };
  },
};

export const crossEncoderRerankTool: MnemeTool = {
  name: "mneme.retrieval.cross_encoder.rerank",
  category: "meta",
  description:
    "Rerank a list of candidate texts using bge-reranker-base (a cross-" +
    "encoder transformer). Cross-encoders score (query, candidate) pairs " +
    "JOINTLY and consistently lift NDCG@10 by 5-15% on retrieval tasks " +
    "(at the cost of ~30-100ms per candidate on CPU). Use AFTER first-" +
    "stage retrieval to refine the top results.",
  whenToUse: "You have ~10-50 candidate chunks and want a higher-precision top-K.",
  triggers: ["cross-encoder rerank", "rerank with bge", "reranker"],
  inputSchema: {
    type: "object",
    required: ["query", "candidates"],
    properties: {
      query: { type: "string" },
      candidates: {
        type: "array",
        items: { type: "object", required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } },
      },
      topK: { type: "number" },
    },
  },
  outputSchema: { type: "object", properties: { ranked: { type: "array" }, totalMs: { type: "number" }, modelLoaded: { type: "boolean" } } },
  examples: [{ userQuery: "Rerank these 20 commit chunks against 'how does auth handle expired tokens?'" }],
  pitfalls: [
    "First call loads the bge-reranker-base WASM model (~50MB), can take 5-15s. Subsequent calls are fast (cached).",
    "Falls back to term-density scoring if @huggingface/transformers can't be loaded.",
  ],
  composeWith: ["mneme.retrieval.hyde.rewrite", "mneme.retrieval.lab.tune"],
  handler: async (_rt, args) => {
    const r = await retrievalLab.rerankCrossEncoder({
      query: String(args["query"] ?? ""),
      candidates: (args["candidates"] as Array<{ id: string; text: string }>) ?? [],
      topK: typeof args["topK"] === "number" ? (args["topK"] as number) : undefined,
    });
    return {
      data: r,
      wisdom: r.modelLoaded
        ? `Reranked ${r.ranked.length} candidates in ${r.totalMs}ms via bge-reranker-base.`
        : `Cross-encoder unavailable; fell back to term-density (${r.fallbackReason ?? "unknown"}).`,
      confidence: { level: r.modelLoaded ? "high" : "medium" },
    };
  },
};

export const hydeRewriteTool: MnemeTool = {
  name: "mneme.retrieval.hyde.rewrite",
  category: "meta",
  description:
    "Apply HyDE (Hypothetical Document Embeddings) query rewrite: returns " +
    "a system-prompt payload the AI agent uses to generate a hypothetical " +
    "ANSWER, OR -- if the agent already supplied one -- returns the " +
    "wrapped result ready for embedding. Lifts retrieval recall on most " +
    "corpora without any extra deps.",
  whenToUse: "Before embedding a query for retrieval, especially when the question is abstract or natural-language.",
  triggers: ["hyde rewrite", "expand query", "hypothetical embedding"],
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      agentSuppliedRewrite: { type: "string", description: "Optional: AI's hypothetical answer if already generated." },
      mode: { type: "string", enum: ["prompt", "apply"], description: "'prompt' returns the system-prompt payload; 'apply' returns the rewrite (using agentSuppliedRewrite or deterministic fallback)." },
    },
  },
  outputSchema: { type: "object", properties: { mode: { type: "string" }, payload: { type: "object" } } },
  examples: [{ userQuery: "HyDE-rewrite this query: 'how does auth handle expired tokens?'" }],
  pitfalls: [
    "Deterministic fallback (no agent rewrite) is less effective than a real LLM rewrite -- best to loop back: get prompt -> generate -> resubmit with agentSuppliedRewrite.",
  ],
  composeWith: ["mneme.retrieval.cross_encoder.rerank"],
  handler: async (_rt, args) => {
    const query = String(args["query"] ?? "");
    const mode = (args["mode"] === "apply" ? "apply" : "prompt") as "prompt" | "apply";
    if (mode === "prompt") {
      const payload = retrievalLab.buildHyDePrompt(query);
      return {
        data: { mode: "prompt", payload },
        wisdom: `HyDE prompt ready. Generate a hypothetical answer (${payload.maxChars} chars max), then call this tool again with mode='apply' + agentSuppliedRewrite.`,
        confidence: { level: "high" },
      };
    }
    const supplied = typeof args["agentSuppliedRewrite"] === "string" ? args["agentSuppliedRewrite"] as string : null;
    const result = retrievalLab.applyHyde(query, supplied);
    return {
      data: { mode: "apply", payload: result },
      wisdom: `HyDE rewrite (${result.source}): "${result.rewritten.slice(0, 80)}..."`,
      confidence: { level: result.source === "agent-supplied" ? "high" : "medium" },
    };
  },
};

export const retrievalLabTools: MnemeTool[] = [
  labListConfigsTool,
  labLeaderboardTool,
  labTuneTool,
  crossEncoderRerankTool,
  hydeRewriteTool,
];
