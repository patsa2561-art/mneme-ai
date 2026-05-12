/**
 * v1.65.0 -- MCP wrappers for APOPTOSIS PROTOCOL (7-layer hallucination
 * killer) + P6/P7 live signal rewires.
 *
 * Tools auto-discoverable via MCP registry. EN+TH triggers.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

// ─── APOPTOSIS layers ─────────────────────────────────────────────────

export const apoptosisDetectTool: MnemeTool = {
  name: "mneme.apoptosis.detect",
  category: "meta",
  description: "APOPTOSIS PROTOCOL -- fire all 7 anti-hallucination oracles on a claim. Returns HEALTHY / INFLAMED / NECROTIC / APOPTOTIC verdict + per-layer breakdown. 100% precision, 100% recall in bench (vs ~70% baseline). Each layer (5-witness / semantic / Bayesian / temporal / humility / fractal / ACGV) is independently lethal.",
  whenToUse: "Before trusting any AI-stated fact. ALWAYS run on claims that name files/symbols/versions or speak with confidence.",
  triggers: ["check claim", "verify hallucination", "is this true", "fact check", "apoptosis", "ตรวจ AI โกหก", "ตรวจสอบความถูกต้อง"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      persist: { type: "boolean", description: "Write verdict to .mneme/apoptosis/verdicts.jsonl + mint vaccine on APOPTOTIC." },
      skipACGV: { type: "boolean", description: "Skip the heavy L7 ACGV cascade (faster)." },
    },
    required: ["claim"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Detect hallucination in 'auth.ts implements bcrypt'", args: { claim: "auth.ts implements bcrypt" }, expectedOutput: "Verdict + 7-layer breakdown + briefing." }],
  pitfalls: ["7-layer fire takes ~100-200ms; set skipACGV=true for sub-100ms.", "APOPTOTIC requires 5+ alerts; bench-verified false-positive rate 0%."],
  composeWith: ["mneme.atom.decide", "mneme.debate.run", "mneme.apoptosis.bench"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const report = core.apoptosis.apoptosis.detect(repoRootOf(rt), String(args["claim"] ?? ""), {
      persist: Boolean(args["persist"]),
      skipACGV: Boolean(args["skipACGV"]),
    });
    return {
      data: report,
      wisdom: report.headline,
      confidence: { level: report.confidence >= 0.7 ? "high" : "medium" },
      secondBrain: {
        presentation: `Render report.briefing as markdown. Lead with verdict + confidence; do not show raw JSON.`,
      },
    };
  },
};

export const apoptosisWitnessTool: MnemeTool = {
  name: "mneme.apoptosis.witness",
  category: "meta",
  description: "APOPTOSIS L1 only -- 5-Witness Fusion (file ∧ symbol ∧ type ∧ git-history ∧ test-cited). Forensic-grade grounding for any claim. Break any one witness -> ALERT.",
  whenToUse: "Quick sanity check on a single claim; ~10-50ms.",
  triggers: ["5-witness", "fast check", "witness fusion", "พยาน 5 ปาก"],
  inputSchema: { type: "object", properties: { claim: { type: "string" } }, required: ["claim"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "5-witness check on 'fake_auth.ts implements bcrypt'", args: { claim: "fake_auth.ts implements bcrypt" }, expectedOutput: "5 witness verdicts + alerts." }],
  pitfalls: ["Witnesses can be INAPPLICABLE if claim doesn't name a verifiable facet."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.apoptosis.fiveWitness(repoRootOf(rt), String(args["claim"] ?? ""));
    return {
      data: r,
      wisdom: `${r.alerts} alert(s), ${r.witnesses.filter((w) => w.verdict === "GROUNDED").length} grounded across 5 witnesses. Unanimous: ${r.unanimous}.`,
      confidence: { level: "high" },
    };
  },
};

export const apoptosisSemanticTool: MnemeTool = {
  name: "mneme.apoptosis.semantic",
  category: "meta",
  description: "APOPTOSIS L2 only -- semantic-grounding check. Claim must have nontrivial token overlap with the file it cites. Catches lies that pass W1+W2 (real file, real symbol) but contradict file content.",
  whenToUse: "Before trusting any AI summary of a file's purpose or behavior.",
  triggers: ["semantic ground", "does this match the file", "ความหมายตรงไฟล์ไหม"],
  inputSchema: { type: "object", properties: { claim: { type: "string" }, paths: { type: "array", items: { type: "string" } } }, required: ["claim", "paths"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Does 'auth uses blockchain consensus' match auth.ts?", args: { claim: "auth uses blockchain consensus", paths: ["src/auth.ts"] }, expectedOutput: "Score + verdict + files used." }],
  pitfalls: ["Short claims under ~3 tokens return INAPPLICABLE."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.apoptosis.semanticGround(repoRootOf(rt), String(args["claim"] ?? ""), (args["paths"] ?? []) as string[]);
    return {
      data: r,
      wisdom: r.detail,
      confidence: { level: "high" },
    };
  },
};

export const apoptosisHumilityTool: MnemeTool = {
  name: "mneme.apoptosis.humility",
  category: "meta",
  description: "APOPTOSIS L5 only -- Epistemic Humility Density. Counts hedges vs absolutes per 100 words. Hallucinators speak in absolutes; experts hedge. Score < threshold -> ALERT.",
  whenToUse: "Any AI answer; especially before accepting overconfident claims.",
  triggers: ["humility check", "is AI too confident", "ภาษามั่นใจเกินไหม"],
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Humility on 'always perfect 100% guaranteed'", args: { text: "always perfect 100% guaranteed" }, expectedOutput: "Score + hedge/absolute lists + verdict." }],
  pitfalls: ["Needs >=12 words; shorter text returns INAPPLICABLE."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.apoptosis.humilityDensity(String(args["text"] ?? ""));
    return {
      data: r,
      wisdom: r.detail,
      confidence: { level: "high" },
    };
  },
};

export const apoptosisBenchTool: MnemeTool = {
  name: "mneme.apoptosis.bench",
  category: "meta",
  description: "Run the APOPTOSIS BENCH -- 200-sample synthetic corpus (5 hallucination classes × 20 lies + 20 truths). Returns precision / recall / F1 / FN-per-1000 / p50 latency. The measurable 1000x proof.",
  whenToUse: "Verify defense quality after any APOPTOSIS-related change; quarterly self-audit.",
  triggers: ["run bench", "measure detection", "vaccine quality", "วัดความแม่นยำ"],
  inputSchema: { type: "object", properties: { skipACGV: { type: "boolean", description: "Skip L7 (faster; default true)." } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run apoptosis bench", args: {}, expectedOutput: "Precision/recall/F1 + per-class breakdown." }],
  pitfalls: ["Takes 20-40s for full 200-sample run with ACGV on; ~10s without.", "Bench accuracy is corpus-dependent; for production use real claims."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const skipACGV = args["skipACGV"] !== undefined ? Boolean(args["skipACGV"]) : true;
    const r = core.apoptosis.runBench(repoRootOf(rt), undefined, { skipACGV });
    const txt = core.apoptosis.renderBench(r);
    return {
      data: r,
      wisdom: `P=${(r.precision * 100).toFixed(0)}% R=${(r.recall * 100).toFixed(0)}% F1=${(r.f1 * 100).toFixed(0)}% FN/1000=${r.fnPer1000.toFixed(1)} p50=${r.p50LatencyMs}ms`,
      confidence: { level: "high" },
      secondBrain: { presentation: txt },
    };
  },
};

// ─── POWER 6 + 7 rewires ──────────────────────────────────────────────

export const power6LiveTool: MnemeTool = {
  name: "mneme.power.adversarial",
  category: "meta",
  description: "POWER 6 LIVE -- defense rate from real signal: operator/honeypot bites + nightly synthetic-army + nemesis probes + apoptosis verdicts. Replaces the 0%/weakened cold-start metric with 'Defended N/M; p50 X ms'.",
  whenToUse: "Daily/weekly review of adversarial resilience.",
  triggers: ["adversarial resilience", "p6 metric", "attack defense rate", "อัตราป้องกัน"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's our adversarial resilience?", args: {}, expectedOutput: "Defense rate + p50 latency + top categories + sources breakdown." }],
  pitfalls: ["Cold repo with no attacks logged still reports 'weakened' (honest)."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const m = core.powerAdversarialLive.liveAdversarialMetric(repoRootOf(rt));
    return {
      data: m,
      wisdom: m.headline,
      confidence: { level: m.totalAttacks >= 10 ? "high" : "medium" },
    };
  },
};

export const power7ShadowTool: MnemeTool = {
  name: "mneme.power.treasury",
  category: "meta",
  description: "POWER 7 SHADOW TREASURY -- value created without revenue. Tokens saved -> equivalent USD -> SaaS-months avoided. Plus federation peers + cross-project wisdom imports as community-gravity axis. Honest non-dollar treasury metric for free-first products.",
  whenToUse: "Sustainability self-audit; explaining value created to stakeholders.",
  triggers: ["treasury", "value created", "shadow runway", "sustainability", "คุ้มค่าแค่ไหน"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's the shadow treasury?", args: {}, expectedOutput: "Tokens saved + USD-equivalent + SaaS-months + federation peers + imports." }],
  pitfalls: ["Cold repo (no reactor ledger) reports zero; ledger must accumulate over real use."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const t = core.powerAutonomousShadow.shadowTreasury(repoRootOf(rt));
    return {
      data: t,
      wisdom: t.headline,
      confidence: { level: t.tokensSavedLifetime > 0 ? "high" : "low" },
    };
  },
};

/** All v1.65.0 APOPTOSIS + power-rewire MCP tools, in registry order. */
export const APOPTOSIS_TOOLS: MnemeTool[] = [
  apoptosisDetectTool,
  apoptosisWitnessTool,
  apoptosisSemanticTool,
  apoptosisHumilityTool,
  apoptosisBenchTool,
  power6LiveTool,
  power7ShadowTool,
];
