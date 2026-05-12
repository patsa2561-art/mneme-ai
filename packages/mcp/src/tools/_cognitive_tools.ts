/**
 * v1.64.0 -- MCP wrappers for COGNITIVE 7 layers.
 *
 * Each wrapper is a thin shim over @mneme-ai/core/cognitive. AI agents
 * auto-discover via MCP registry and can invoke them with natural
 * triggers in English + Thai.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

// ─── Layer 1: Theory of Mind ─────────────────────────────────────────

export const theoryOfMindProfileTool: MnemeTool = {
  name: "mneme.tom.profile",
  category: "meta",
  description: "Theory of Mind -- build a 9-axis behavioral profile for an AI vendor (verbosity / overconfidence / domain bias / refusal rate / hallucination class / risk appetite / drift / stability / chain depth). Mneme predicts vendor behavior BEFORE the prompt runs.",
  whenToUse: "Picking which AI vendor to delegate a task to; reviewing why a vendor mis-fired.",
  triggers: ["vendor profile", "which AI should handle this", "AI behavior pattern", "โปรไฟล์ AI", "vendor มีนิสัยยังไง"],
  inputSchema: { type: "object", properties: { vendor: { type: "string" }, persist: { type: "boolean" } }, required: ["vendor"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Profile claude", args: { vendor: "claude" }, expectedOutput: "9-axis profile with hallucination class + domain bias." }],
  pitfalls: ["Profile is meaningful only after >=10 sessions for that vendor."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const profile = core.cognitive.theoryOfMind.buildProfile(root, String(args["vendor"] ?? ""));
    let persistedPath: string | undefined;
    if (args["persist"]) persistedPath = core.cognitive.theoryOfMind.persistProfile(root, profile);
    return {
      data: { profile, persistedPath },
      wisdom: `${profile.vendor}: ${profile.observationCount} sessions, hallucination=${profile.axes.hallucinationClass}, overconfidence=${profile.axes.overconfidence.toFixed(2)}.`,
      confidence: { level: profile.observationCount >= 10 ? "high" : "medium", notes: profile.observationCount < 10 ? "Profile improves with more sessions." : undefined },
    };
  },
};

export const theoryOfMindRecommendTool: MnemeTool = {
  name: "mneme.tom.recommend",
  category: "meta",
  description: "Theory of Mind -- given a task profile (domain / needsTerse / needsStable), pick the best vendor from a candidate list using their 9-axis behavioral profiles.",
  whenToUse: "Multiple vendors available; need to route ONE prompt to the strongest fit.",
  triggers: ["best vendor for", "route this prompt", "which AI is best for", "AI ไหนเก่ง"],
  inputSchema: {
    type: "object",
    properties: {
      vendors: { type: "array", items: { type: "string" } },
      domain: { type: "string" },
      needsTerse: { type: "boolean" },
      needsStable: { type: "boolean" },
    },
    required: ["vendors"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Best AI for auth refactor (terse)", args: { vendors: ["claude", "cursor"], domain: "auth", needsTerse: true }, expectedOutput: "Recommended vendor + reasoning." }],
  pitfalls: ["Returns null if vendors list is empty."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const root = repoRootOf(rt);
    const vendors = (args["vendors"] ?? []) as string[];
    const profiles = vendors.map((v) => core.cognitive.theoryOfMind.buildProfile(root, v));
    const rec = core.cognitive.theoryOfMind.recommendVendor(profiles, {
      domain: args["domain"] as string | undefined,
      needsTerse: Boolean(args["needsTerse"]),
      needsStable: Boolean(args["needsStable"]),
    });
    return {
      data: { recommended: rec, profilesConsidered: profiles.length },
      wisdom: rec ? `Recommended: ${rec.vendor} (observations=${rec.observationCount}).` : `No vendor recommended (empty list).`,
      confidence: { level: rec ? "high" : "low" },
    };
  },
};

// ─── Layer 2: Tree of Thought ────────────────────────────────────────

export const treeOfThoughtTool: MnemeTool = {
  name: "mneme.tot.search",
  category: "meta",
  description: "Tree of Thought -- 3-level decision tree with Expected Value scoring (regression risk x fairness / token cost). Returns best path + all ranked alternatives + audit trail.",
  whenToUse: "Before any high-stakes decision: refactor / build / fix. You want to compare 3+ strategies systematically.",
  triggers: ["search strategies", "decision tree", "best approach", "options to consider", "ตัดสินใจ", "หาทางออก"],
  inputSchema: { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Search strategies for 'refactor auth'", args: { intent: "refactor auth" }, expectedOutput: "Best path + EV + top alternative + reasoning." }],
  pitfalls: ["EV is deterministic from intent string -- same intent always picks same path."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const result = core.cognitive.treeOfThought.search(repoRootOf(rt), String(args["intent"] ?? ""));
    return {
      data: result,
      wisdom: `Best: ${result.bestPath.join(" -> ")} (EV ${result.bestEv.toFixed(3)}). ${result.rankedLeaves.length - 1} alternatives ranked.`,
      confidence: { level: "high" },
    };
  },
};

// ─── Layer 3: Curiosity ──────────────────────────────────────────────

export const curiosityScanTool: MnemeTool = {
  name: "mneme.curiosity.scan",
  category: "meta",
  description: "Curiosity Engine -- daemon-idle gap scanner. Finds places where Mneme has DATA but no DEFENSE (or vice versa) + suggests probes that close the gap.",
  whenToUse: "Daemon idle cycles; user wants to know what Mneme should investigate next.",
  triggers: ["what should I probe", "knowledge gaps", "curiosity scan", "ช่องโหว่ความรู้"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Scan my repo for gaps", args: {}, expectedOutput: "List of gaps with priority + suggested probes." }],
  pitfalls: ["Needs commit history + vaccine bank to produce signal; cold repos return empty."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const scan = core.cognitive.curiosity.scanGaps(repoRootOf(rt));
    const top = scan.gaps[0];
    return {
      data: scan,
      wisdom: `${scan.totalGaps} gaps detected; ${scan.highPriority} high-priority.${top ? ` Top: "${top.description}"` : ""}`,
      confidence: { level: scan.totalGaps > 0 ? "high" : "low" },
    };
  },
};

// ─── Layer 4: Consolidation ──────────────────────────────────────────

export const consolidationTool: MnemeTool = {
  name: "mneme.consolidate.run",
  category: "meta",
  description: "Memory Consolidation -- sleep-cycle compression. Merge near-duplicate vaccines (Hamming distance <=radius), prune unused milestones (>=90 days no recall), promote frequently-recalled lessons to core tier.",
  whenToUse: "Nightly maintenance; after a big batch of new lessons; before publishing a wisdom export.",
  triggers: ["consolidate memory", "compress wisdom", "memory cleanup", "บีบอัดความทรงจำ"],
  inputSchema: {
    type: "object",
    properties: {
      dryRun: { type: "boolean", description: "If true, compute deltas without writing to disk (default true)." },
      radius: { type: "number", description: "Hamming-distance threshold for vaccine merge (default 4)." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Consolidate memory (dry run)", args: { dryRun: true }, expectedOutput: "Report of merges + prunes + promotions." }],
  pitfalls: ["Default is dry run; pass dryRun=false to actually mutate disk."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const report = core.cognitive.consolidation.runConsolidation(repoRootOf(rt), {
      dryRun: args["dryRun"] !== undefined ? Boolean(args["dryRun"]) : true,
      radius: args["radius"] !== undefined ? Number(args["radius"]) : 4,
    });
    return {
      data: report,
      wisdom: `Vaccines: ${report.vaccines.before} -> ${report.vaccines.after} (${report.vaccines.merged} merged). Lessons: ${report.lessons.before} -> ${report.lessons.after} (${report.lessons.pruned} pruned, ${report.lessons.promoted} promoted). ${report.dryRun ? "(dry run)" : "(persisted)"}`,
      confidence: { level: "high" },
    };
  },
};

// ─── Layer 5: Counterfactual ─────────────────────────────────────────

export const counterfactualSimulateTool: MnemeTool = {
  name: "mneme.cf.simulate",
  category: "meta",
  description: "Counterfactual Engine -- simulate alternative timelines for a decision (not-done / done-sooner / done-different). Computes relief/regret deltas vs. the actual outcome.",
  whenToUse: "Post-mortem of a decision; learning loop after shipping a release.",
  triggers: ["what if we hadn't", "alternative timeline", "regret analysis", "counterfactual", "ถ้าไม่ทำจะเป็นยังไง"],
  inputSchema: {
    type: "object",
    properties: {
      decision: { type: "string" },
      actualRegressionP: { type: "number" },
      actualStakeholderFair: { type: "number" },
      actualTokenCost: { type: "number" },
      persistDelta: { type: "boolean" },
    },
    required: ["decision", "actualRegressionP", "actualStakeholderFair", "actualTokenCost"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What if we hadn't shipped v1.50?", args: { decision: "ship v1.50", actualRegressionP: 0.15, actualStakeholderFair: 0.8, actualTokenCost: 2000 }, expectedOutput: "4 branches + relief/regret deltas + summary." }],
  pitfalls: ["Branches are deterministic perturbations of the actual values; for true randomness use multiple decision labels."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const result = core.cognitive.counterfactual.simulate(repoRootOf(rt), {
      decision: String(args["decision"] ?? ""),
      actualRegressionP: Number(args["actualRegressionP"] ?? 0.2),
      actualStakeholderFair: Number(args["actualStakeholderFair"] ?? 0.7),
      actualTokenCost: Number(args["actualTokenCost"] ?? 1000),
    }, { persistDelta: Boolean(args["persistDelta"]) });
    return {
      data: result,
      wisdom: result.summary,
      confidence: { level: "medium", notes: "Counterfactuals are heuristic; treat as decision aid, not ground truth." },
    };
  },
};

export const counterfactualBiasTool: MnemeTool = {
  name: "mneme.cf.bias",
  category: "meta",
  description: "Counterfactual Engine -- detect systematic bias from history (act-sooner / act-different / act-less / balanced). Helps Mneme calibrate future decisions.",
  whenToUse: "Quarterly self-review; after a string of regrets.",
  triggers: ["am I biased", "decision bias", "systematic regret", "อคติ"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Detect my decision bias", args: {}, expectedOutput: "Bias direction + mean relief/regret." }],
  pitfalls: ["Needs >=10 persisted counterfactual entries for stable verdict."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const bias = core.cognitive.counterfactual.detectBias(repoRootOf(rt));
    return {
      data: bias,
      wisdom: `${bias.totalEntries} entries; systematic bias = ${bias.systematicBias}. Mean relief ${bias.meanRelief.toFixed(3)}, regret ${bias.meanRegret.toFixed(3)}.`,
      confidence: { level: bias.totalEntries >= 10 ? "high" : "low" },
    };
  },
};

// ─── Layer 6: Debate ─────────────────────────────────────────────────

export const debateTool: MnemeTool = {
  name: "mneme.debate.run",
  category: "meta",
  description: "Internal Debate -- 3-voice dialectic (skeptic / optimist / realist) anchored on vaccine bank + lessons + recent commits. Realist arbitrates with a confidence score.",
  whenToUse: "Before committing to a verdict; want a structured devil's-advocate run.",
  triggers: ["debate this claim", "second opinion", "argue both sides", "ถกเถียงทั้งสองด้าน"],
  inputSchema: { type: "object", properties: { claim: { type: "string" }, persist: { type: "boolean" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Debate: 'our test coverage is 100%'", args: { claim: "our test coverage is 100%" }, expectedOutput: "3 turns + realist verdict (AGREE/DISAGREE/INCONCLUSIVE) + arbiter confidence." }],
  pitfalls: ["No LLM; deterministic over repo signals. Stronger when nucleus + vaccines are populated."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const result = core.cognitive.debate.debate(repoRootOf(rt), String(args["claim"] ?? ""), { persist: Boolean(args["persist"]) });
    return {
      data: result,
      wisdom: `Verdict: ${result.verdict} @ ${result.arbiterConfidence.toFixed(2)}. ${result.turns[2]?.argument ?? ""}`,
      confidence: { level: result.arbiterConfidence >= 0.5 ? "high" : "medium" },
    };
  },
};

// ─── Layer 7: Decision Atom ──────────────────────────────────────────

export const decisionAtomTool: MnemeTool = {
  name: "mneme.atom.decide",
  category: "meta",
  description: "Decision Atom -- the CAPSTONE. Fuses all 6 cognitive layers (Theory of Mind + Tree of Thought + Curiosity + Consolidation + Counterfactual + Debate) into a single verdict: PROCEED / PROCEED-WITH-CARE / PAUSE-INVESTIGATE / ABORT-FOR-NOW.",
  whenToUse: "Before any non-trivial decision. ALL OTHER COGNITIVE TOOLS feed into this one. Returns a single-screen briefing + recommended action.",
  triggers: ["should I do this", "decide for me", "decision atom", "verdict", "ตัดสินใจให้ที", "ควรทำดีไหม"],
  inputSchema: {
    type: "object",
    properties: {
      intent: { type: "string" },
      vendors: { type: "array", items: { type: "string" } },
      domain: { type: "string" },
      needsTerse: { type: "boolean" },
      needsStable: { type: "boolean" },
      counterfactualBaseline: {
        type: "object",
        properties: {
          actualRegressionP: { type: "number" },
          actualStakeholderFair: { type: "number" },
          actualTokenCost: { type: "number" },
        },
      },
    },
    required: ["intent"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Should I refactor billing?",
    args: { intent: "refactor billing module", vendors: ["claude"], domain: "billing", counterfactualBaseline: { actualRegressionP: 0.18, actualStakeholderFair: 0.75, actualTokenCost: 1500 } },
    expectedOutput: "Verdict + confidence + per-layer breakdown + recommended action.",
  }],
  pitfalls: ["ABORT verdict requires both strong skeptic AND low EV; PAUSE fires more often. Trust the briefing, not the verdict alone."],
  composeWith: ["mneme.tot.search", "mneme.debate.run", "mneme.cf.simulate", "mneme.curiosity.scan"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const baseline = args["counterfactualBaseline"] as { actualRegressionP?: number; actualStakeholderFair?: number; actualTokenCost?: number } | undefined;
    const atom = core.cognitive.decisionAtom.build(repoRootOf(rt), {
      intent: String(args["intent"] ?? ""),
      vendors: (args["vendors"] ?? []) as string[],
      taskProfile: {
        domain: args["domain"] as string | undefined,
        needsTerse: Boolean(args["needsTerse"]),
        needsStable: Boolean(args["needsStable"]),
      },
      counterfactualBaseline: baseline && baseline.actualRegressionP !== undefined && baseline.actualStakeholderFair !== undefined && baseline.actualTokenCost !== undefined
        ? {
            actualRegressionP: Number(baseline.actualRegressionP),
            actualStakeholderFair: Number(baseline.actualStakeholderFair),
            actualTokenCost: Number(baseline.actualTokenCost),
          }
        : undefined,
    });
    return {
      data: atom,
      wisdom: `${atom.verdict} (confidence ${atom.confidence.toFixed(2)}). ${atom.recommendedAction}`,
      confidence: { level: atom.confidence >= 0.6 ? "high" : "medium" },
      secondBrain: {
        presentation: `Render the atom.briefing markdown as-is. Lead with the verdict + confidence on the first line. Do NOT show raw JSON.`,
      },
    };
  },
};

export const decisionAtomHistoryTool: MnemeTool = {
  name: "mneme.atom.history",
  category: "meta",
  description: "Decision Atom history -- summarize past atoms: counts per verdict (PROCEED / PROCEED-WITH-CARE / PAUSE-INVESTIGATE / ABORT-FOR-NOW), mean confidence, last atom.",
  whenToUse: "Reviewing recent decisions; want a calibration check.",
  triggers: ["recent decisions", "atom history", "decision log", "ประวัติการตัดสินใจ"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show decision history", args: {}, expectedOutput: "Verdict counts + mean confidence + last atom intent." }],
  pitfalls: ["Empty for cold repos with no prior mneme.atom.decide calls."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const sum = core.cognitive.decisionAtom.summarizeHistory(repoRootOf(rt));
    return {
      data: sum,
      wisdom: `${sum.totalAtoms} atom(s); mean confidence ${sum.meanConfidence.toFixed(2)}. Verdicts: PROCEED=${sum.verdictCounts.PROCEED}, CARE=${sum.verdictCounts["PROCEED-WITH-CARE"]}, PAUSE=${sum.verdictCounts["PAUSE-INVESTIGATE"]}, ABORT=${sum.verdictCounts["ABORT-FOR-NOW"]}.`,
      confidence: { level: sum.totalAtoms >= 5 ? "high" : "low" },
    };
  },
};

/** All v1.64.0 COGNITIVE tools in registry order. */
export const COGNITIVE_TOOLS: MnemeTool[] = [
  theoryOfMindProfileTool,
  theoryOfMindRecommendTool,
  treeOfThoughtTool,
  curiosityScanTool,
  consolidationTool,
  counterfactualSimulateTool,
  counterfactualBiasTool,
  debateTool,
  decisionAtomTool,
  decisionAtomHistoryTool,
];
