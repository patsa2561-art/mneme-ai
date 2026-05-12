/**
 * v1.65.0 -- MCP wrappers for METAMORPHOSIS + TRIBUNAL + INNER LIFE +
 * AI TEACHER. AI agents auto-discover these via MCP just like the
 * v1.60 tier tools.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

// ─── METAMORPHOSIS ────────────────────────────────────────────────────

export const mirrorTool: MnemeTool = {
  name: "mneme.mirror.report",
  category: "meta",
  description: "Transparency Mirror -- daily/weekly self-knowledge report of YOUR own AI usage patterns. Surfaces top savings methods, top themes, biggest waste.",
  whenToUse: "User asks 'how am I doing with Mneme' / 'my usage' / 'weekly review'.",
  triggers: ["mneme report", "my usage", "weekly review", "self knowledge"],
  inputSchema: { type: "object", properties: { windowDays: { type: "number", description: "Lookback window (default 7)." } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show me my Mneme usage report", args: {}, expectedOutput: "Tokens saved + top methods + themes + biggest waste." }],
  pitfalls: ["Empty ledger -> zero savings shown; not a bug."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const report = core.metamorphosis.buildMirrorReport(repoRootOf(rt), args["windowDays"] ? Number(args["windowDays"]) : 7);
    return { data: report, wisdom: report.plain.split("\n")[0]!, confidence: { level: "high" } };
  },
};

export const interviewTool: MnemeTool = {
  name: "mneme.interview.next",
  category: "meta",
  description: "Interview Protocol -- Socratic dialogue. Pick 3 questions the user hasn't answered this week so Mneme distills tacit wisdom.",
  whenToUse: "Weekly check-in; user has minutes to spare for self-reflection.",
  triggers: ["interview me", "weekly questions", "socratic check"],
  inputSchema: { type: "object", properties: { n: { type: "number", description: "Question count (default 3)." } } },
  outputSchema: { type: "object", properties: { questions: { type: "array" } } },
  examples: [{ userQuery: "Interview me", args: {}, expectedOutput: "3 questions across diverse topics." }],
  pitfalls: ["Only 8 questions in bank; rotate over weeks."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const qs = core.metamorphosis.pickQuestions(repoRootOf(rt), args["n"] ? Number(args["n"]) : 3);
    return { data: { questions: qs }, wisdom: `Picked ${qs.length} question(s)`, confidence: { level: "high" } };
  },
};

export const audienceTool: MnemeTool = {
  name: "mneme.audience.tune",
  category: "meta",
  description: "Audience Layer -- profile the reader (engineer / PM / exec / customer) from a message sample + return AI tone instructions.",
  whenToUse: "First message of a new thread; whenever audience may have changed.",
  triggers: ["who am I talking to", "tone tune", "audience profile"],
  inputSchema: { type: "object", properties: { sample: { type: "string" } }, required: ["sample"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Profile this user", args: { sample: "what's our customer retention this quarter" }, expectedOutput: "Role + verbosity + tone instructions." }],
  pitfalls: ["Unknown role -> balanced prose default."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const profile = core.metamorphosis.inferAudience(String(args["sample"] ?? ""));
    const tuning = core.metamorphosis.tuneFor(profile);
    return { data: { profile, tuning }, wisdom: `Detected ${profile.role} -- ${tuning.toneInstructions[0] ?? ""}`, confidence: { level: "high" } };
  },
};

export const alienTool: MnemeTool = {
  name: "mneme.alien.template",
  category: "meta",
  description: "Alien Protocol -- genetic recombination of wisdom cards for first-time prompts. Returns a SCAFFOLD the AI fills in.",
  whenToUse: "Cache miss + recipe miss; first-time prompts.",
  triggers: ["template", "scaffold", "first-time prompt"],
  inputSchema: { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build a scaffold for 'refactor the auth layer'", args: { intent: "refactor the auth layer" }, expectedOutput: "Template with matched wisdom cards." }],
  pitfalls: ["6 cards in registry; coverage grows over time."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const t = core.metamorphosis.buildAlienTemplate(String(args["intent"] ?? ""));
    return { data: t, wisdom: `Matched ${t.matchedCards.length} card(s)`, confidence: { level: "medium" } };
  },
};

export const carbonTool: MnemeTool = {
  name: "mneme.carbon.report",
  category: "meta",
  description: "Carbon Budget -- compute CO2 footprint from token spend + savings. ESG metric for enterprise.",
  whenToUse: "User asks for environmental impact / ESG reporting.",
  triggers: ["carbon impact", "co2 savings", "esg metric"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's my CO2 saved this month?", args: {}, expectedOutput: "Grams CO2 + km-driven + smartphone-charges equivalents." }],
  pitfalls: ["Estimate uses public model disclosures; ~20% margin."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const c = core.metamorphosis.buildCarbonReport(repoRootOf(rt));
    return { data: c, wisdom: `${c.co2GramsSaved.toFixed(2)}g CO2 saved (=${c.equivalents.kmDriven.toFixed(4)}km drive)`, confidence: { level: "medium" } };
  },
};

// ─── TRIBUNAL ─────────────────────────────────────────────────────────

export const courtTool: MnemeTool = {
  name: "mneme.court.rule",
  category: "meta",
  description: "Court of Last Appeal -- N-vendor tournament when ACGV vs primary AI disagree. Builds trust ranking over time.",
  whenToUse: "Disputed claim; want independent multi-vendor view.",
  triggers: ["which AI is right", "tournament verdict", "vendor disagree"],
  inputSchema: { type: "object", properties: { claim: { type: "string" }, acgvVerdict: { type: "string", enum: ["true", "false", "unknown"] }, votes: { type: "array" } }, required: ["claim", "acgvVerdict", "votes"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Court rule on claim X", args: { claim: "v1.42 broke auth", acgvVerdict: "false", votes: [] }, expectedOutput: "Ruling + trust ranking." }],
  pitfalls: ["Trust ranking meaningful only after >= 5 rulings/vendor."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.tribunal.rule(
      repoRootOf(rt),
      String(args["claim"] ?? ""),
      args["acgvVerdict"] as "true" | "false" | "unknown",
      (args["votes"] ?? []) as import("@mneme-ai/core").tribunal.VendorVote[],
    );
    return { data: r, wisdom: `Final verdict: ${r.finalVerdict} (${r.votes.length} votes)`, confidence: { level: "high" } };
  },
};

export const consensusTool: MnemeTool = {
  name: "mneme.consensus.check",
  category: "meta",
  description: "Consensus Network -- N Mneme instances vote on a claim. Returns consensus verdict + caveats (LOW_VOTER_COUNT / CLOSE_VOTE).",
  whenToUse: "Federated truth check across multiple instances.",
  triggers: ["federation vote", "consensus check", "multi-instance verify"],
  inputSchema: { type: "object", properties: { claim: { type: "string" }, voters: { type: "array" } }, required: ["claim", "voters"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Consensus across 5 mnemes", args: { claim: "x", voters: [] }, expectedOutput: "Verdict + weighted confidence + caveats." }],
  pitfalls: ["LOW_VOTER_COUNT under 3 voters; surface to user."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.tribunal.reachConsensus(String(args["claim"] ?? ""), { voters: (args["voters"] ?? []) as Array<{ instanceId: string; verdict: "true" | "false" | "unknown"; confidence: number }> });
    return { data: r, wisdom: `Consensus: ${r.consensusVerdict} (${(r.weightedConfidence * 100).toFixed(0)}%)`, confidence: { level: "high" } };
  },
};

export const oracleTool: MnemeTool = {
  name: "mneme.deps.oracle",
  category: "meta",
  description: "Dependency Oracle -- predict npm package futures (deprecate / vuln / fork / die). Heuristic risk score per dep.",
  whenToUse: "Before adding a new dep; quarterly audit of supply chain.",
  triggers: ["dependency risk", "package futures", "deps audit"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run dependency oracle", args: {}, expectedOutput: "Risks ranked by riskScore; flagged elevated/high." }],
  pitfalls: ["Heuristic; no live vuln-db lookup yet."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.tribunal.dependencyOracle(repoRootOf(rt));
    return { data: r, wisdom: `${r.totalDeps} deps · ${r.highRiskCount} elevated/high risk`, confidence: { level: "medium" } };
  },
};

// ─── INNER LIFE ───────────────────────────────────────────────────────

export const reasoningTool: MnemeTool = {
  name: "mneme.reasoning.capture",
  category: "meta",
  description: "Reasoning Genome -- capture AI's chain-of-thought as a 5th strand. HMAC-signed; stats roll up per vendor.",
  whenToUse: "After significant AI decisions; routine logging for accountability.",
  triggers: ["save reasoning", "log thinking", "capture chain-of-thought"],
  inputSchema: { type: "object", properties: { vendor: { type: "string" }, prompt: { type: "string" }, steps: { type: "array" }, finalAnswer: { type: "string" }, acgvVerdict: { type: "string" } }, required: ["vendor", "prompt", "steps", "finalAnswer", "acgvVerdict"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Save my reasoning", args: { vendor: "claude-opus-4-7", prompt: "x", steps: [], finalAnswer: "y", acgvVerdict: "FUSION" }, expectedOutput: "Signed trace + id." }],
  pitfalls: ["Caller tags step kind correctly (observe / hypothesize / verify / decide / doubt)."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const t = core.innerlife.captureReasoning(repoRootOf(rt), {
      vendor: String(args["vendor"] ?? ""),
      prompt: String(args["prompt"] ?? ""),
      steps: (args["steps"] ?? []) as Array<{ kind: "observe" | "hypothesize" | "verify" | "decide" | "doubt"; text: string; tokens: number }>,
      finalAnswer: String(args["finalAnswer"] ?? ""),
      acgvVerdict: (args["acgvVerdict"] ?? "unknown") as "FUSION" | "BLACK_HOLE" | "LIMBO" | "IMPOSSIBLE_REFUTE" | "PASSTHROUGH" | "AUTO_REFUTE" | "unknown",
    });
    return { data: t, wisdom: `Trace ${t.id} captured`, confidence: { level: "high" } };
  },
};

export const nashTool: MnemeTool = {
  name: "mneme.game.nash",
  category: "meta",
  description: "Game Theory Engine -- Nash equilibrium + Borda + Shapley values for multi-stakeholder decisions.",
  whenToUse: "Multi-party decisions (refactor / migration / hire).",
  triggers: ["fair decision", "stakeholder analysis", "nash equilibrium"],
  inputSchema: { type: "object", properties: { stakeholders: { type: "array" }, outcomes: { type: "array" } }, required: ["stakeholders", "outcomes"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run Nash analysis", args: { stakeholders: [], outcomes: [] }, expectedOutput: "Borda winner + Nash candidate + Shapley shares." }],
  pitfalls: ["Pure-preference Nash; doesn't model side payments."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const stakeholders = (args["stakeholders"] ?? []) as import("@mneme-ai/core").innerlife.Stakeholder[];
    const outcomes = (args["outcomes"] ?? []) as string[];
    const result = core.innerlife.findNash(stakeholders, outcomes);
    const shapley = core.innerlife.shapleyValues(stakeholders, outcomes);
    return { data: { ...result, shapley }, wisdom: `Borda winner: ${result.bordaWinner}; Nash: ${result.nashEquilibrium ?? "(unstable)"}`, confidence: { level: "high" } };
  },
};

// ─── AI TEACHER ───────────────────────────────────────────────────────

export const syllabusTool: MnemeTool = {
  name: "mneme.teacher.syllabus",
  category: "meta",
  description: "AI Teacher -- expose the syllabus of all Mneme capabilities so a fresh AI agent can self-onboard.",
  whenToUse: "First time an AI agent connects to a Mneme; want to learn what's available.",
  triggers: ["mneme syllabus", "what can mneme do", "list capabilities"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show me the syllabus", args: {}, expectedOutput: "25+ capability entries with framing + triggers + invocation." }],
  pitfalls: ["Read once + cache; don't re-fetch every prompt."],
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const s = core.aiTeacher.getSyllabus();
    return { data: { syllabus: s }, wisdom: `${s.length} capabilities documented`, confidence: { level: "high" } };
  },
};

export const examTool: MnemeTool = {
  name: "mneme.teacher.exam",
  category: "meta",
  description: "AI Teacher -- adversarial exam to verify the AI understands the syllabus. Returns probes; caller submits answers + we grade.",
  whenToUse: "After AI reads syllabus; before issuing training cert.",
  triggers: ["mneme exam", "test my knowledge"],
  inputSchema: { type: "object", properties: { vendor: { type: "string" }, answers: { type: "array" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get exam", args: {}, expectedOutput: "Question list or grading result." }],
  pitfalls: ["Pass threshold 75%; cert only issued on pass."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    if (args["vendor"] && Array.isArray(args["answers"])) {
      const result = core.aiTeacher.gradeExam(
        String(args["vendor"]),
        (args["answers"] ?? []) as Array<{ id: string; capability: string }>,
      );
      const cert = core.aiTeacher.issueTrainingCert(repoRootOf(rt), result);
      return { data: { result, cert }, wisdom: `Score ${result.scorePercent}% -- ${result.passed ? "PASSED" : "FAILED"}`, confidence: { level: "high" } };
    }
    return { data: { questions: core.aiTeacher.getExam() }, wisdom: "Exam questions returned", confidence: { level: "high" } };
  },
};

/** All v1.63-v1.65 path tools, in registry order. */
export const PATH_TOOLS: MnemeTool[] = [
  mirrorTool, interviewTool, audienceTool, alienTool, carbonTool,
  courtTool, consensusTool, oracleTool,
  reasoningTool, nashTool,
  syllabusTool, examTool,
];
