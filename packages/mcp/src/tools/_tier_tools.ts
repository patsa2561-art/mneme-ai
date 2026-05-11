/**
 * v1.60.0 -- MCP wrappers for the 7 god-tier modules shipped v1.57-1.59.
 *
 * Each tool is a thin adapter around the core API + the standard
 * MnemeTool envelope (description / whenToUse / triggers / schemas /
 * examples / pitfalls / handler).
 *
 * AI clients that connect to Mneme MCP now AUTO-DISCOVER:
 *   - mneme.sovereign.ask           (Tier 1 standalone Q&A)
 *   - mneme.covenant.sign / show / violations / score   (Tier 2)
 *   - mneme.oracle.forecast         (Tier 3 Bayesian regression risk)
 *   - mneme.whisper.emit / import / stats   (Tier 4)
 *   - mneme.nemesis.generate / grade / trend   (Tier 5)
 *   - mneme.soul.review / aggregate  (Tier 6)
 *   - mneme.time.rewind / counterfactual   (Tier 7)
 *
 * Every handler returns { data, wisdom, confidence } in the standard
 * MnemeTool shape; failures are surfaced as a typed `error` field.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

// ─── TIER 1: SOVEREIGNTY KERNEL ───────────────────────────────────────

export const sovereignAskTool: MnemeTool = {
  name: "mneme.sovereign.ask",
  category: "meta",
  description: "Ask Mneme a grounded question about THIS repo. Uses local Ollama as the language model + ACGV as the grounding gate. Mneme decides what to relay; the model just writes the words. Refuses to fake confidence.",
  whenToUse: "The user wants a plain-English answer about THIS repo and you want it grounded in file paths / commits / package.json rather than your training data.",
  triggers: ["ask mneme", "what does this repo do", "explain this codebase", "mneme answer"],
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question in plain English." },
      counterEvidence: { type: "array", items: { type: "string" }, description: "Optional Confession-layer counter-points." },
    },
    required: ["question"],
  },
  outputSchema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["grounded", "ungrounded", "refused", "ollama-unreachable"] },
      text: { type: "string" },
      reason: { type: "string" },
      evidence: { type: "array" },
    },
  },
  examples: [{
    userQuery: "Ask Mneme: what does the harmonic mean function do?",
    args: { question: "what does the harmonic mean function in the ACGV neutrino layer do?" },
    expectedOutput: "Grounded answer citing packages/core/src/squadron/acgv_neutrino.ts + ACGV evidence.",
  }],
  pitfalls: [
    "Requires local Ollama running (set MNEME_OLLAMA_URL / MNEME_OLLAMA_MODEL if non-default).",
    "When ACGV flags the model's draft as IMPOSSIBLE / BLACK_HOLE the verdict is 'refused' and `text` is empty -- Mneme does NOT relay ungrounded answers.",
  ],
  composeWith: ["mneme.truth.check", "mneme.bot.spawn"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.sovereign.sovereignAsk({
      repoRoot: repoRootOf(rt),
      question: String(args["question"] ?? "").trim(),
    });
    return {
      data: r,
      wisdom: r.text || r.reason,
      confidence: { level: r.verdict === "grounded" ? "high" : r.verdict === "ungrounded" ? "medium" : "low" },
    };
  },
};

// ─── TIER 2: COVENANT ─────────────────────────────────────────────────

export const covenantSignTool: MnemeTool = {
  name: "mneme.covenant.sign",
  category: "meta",
  description: "Sign a new HMAC-bound bilateral covenant between user and AI vendor. Ships 5 default vendor promises + 3 user promises; both sides commit; Mneme later detects violations from soul + quorum logs.",
  whenToUse: "First time setting up Mneme accountability, or renewing an expired covenant.",
  triggers: ["sign covenant", "renew covenant", "covenant sign"],
  inputSchema: {
    type: "object",
    properties: {
      user: { type: "string", description: "User name" },
      vendor: { type: "string", description: "Target AI vendor (e.g. claude-opus-4-7)" },
      renewalDays: { type: "number", description: "Renewal window in days (default 30)" },
    },
    required: ["user"],
  },
  outputSchema: { type: "object", properties: { id: { type: "string" }, hmac: { type: "string" } } },
  examples: [{ userQuery: "Sign a Mneme covenant under my name", args: { user: "Shinnapat" }, expectedOutput: "Covenant id + HMAC + summary of promises." }],
  pitfalls: ["Re-signing replaces the active covenant + archives the previous one."],
  composeWith: ["mneme.covenant.violations", "mneme.covenant.score"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.covenant.signCovenant(repoRootOf(rt), {
      userName: String(args["user"] ?? "user"),
      vendorName: args["vendor"] ? String(args["vendor"]) : undefined,
      renewalDays: args["renewalDays"] ? Number(args["renewalDays"]) : 30,
    });
    return { data: c, wisdom: `Covenant ${c.id} signed (hmac ${c.hmac.slice(0, 8)}...)`, confidence: { level: "high" } };
  },
};

export const covenantShowTool: MnemeTool = {
  name: "mneme.covenant.show",
  category: "meta",
  description: "Read the active covenant + verify its HMAC + report renewal days remaining.",
  whenToUse: "User asks 'what are my Mneme promises' or 'is my covenant still valid'.",
  triggers: ["show covenant", "covenant status", "covenant promises"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show my Mneme covenant", args: {}, expectedOutput: "Active covenant body + HMAC verdict + renewal countdown." }],
  pitfalls: ["Returns null when no covenant has been signed yet -- call mneme.covenant.sign first."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const repo = repoRootOf(rt);
    const c = core.covenant.readActiveCovenant(repo);
    if (!c) return { data: { error: "no active covenant" }, wisdom: "No covenant signed yet.", confidence: { level: "high" } };
    const verify = core.covenant.verifyCovenant(repo, c);
    const renewal = core.covenant.renewalDaysRemaining(repo);
    return { data: { covenant: c, verify, renewalDaysRemaining: renewal }, wisdom: `Covenant ${c.id} -- ${verify.ok ? "HMAC valid" : "TAMPERED"} -- ${renewal} days to renewal`, confidence: { level: verify.ok ? "high" : "low" } };
  },
};

export const covenantViolationsTool: MnemeTool = {
  name: "mneme.covenant.violations",
  category: "meta",
  description: "Scan soul mirror + ACGV quorum log for covenant promise violations. Optionally persist to the audit log.",
  whenToUse: "User asks 'did I break any covenant promises' or 'show me hallucination incidents'.",
  triggers: ["covenant violations", "broken promises", "show violations"],
  inputSchema: { type: "object", properties: { record: { type: "boolean", description: "Persist detected violations to violations.jsonl" } } },
  outputSchema: { type: "object", properties: { violations: { type: "array" } } },
  examples: [{ userQuery: "What covenant violations has Mneme detected?", args: {}, expectedOutput: "Array of violations with severity + evidence references." }],
  pitfalls: ["Returns empty array when no covenant or no signals exist yet."],
  composeWith: ["mneme.covenant.score"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const repo = repoRootOf(rt);
    const v = core.covenant.detectViolations(repo);
    if (args["record"] === true) { for (const x of v) core.covenant.recordViolation(repo, x); }
    return { data: v, wisdom: `${v.length} violation(s) detected${args["record"] ? " (recorded)" : ""}`, confidence: { level: "high" } };
  },
};

export const covenantScoreTool: MnemeTool = {
  name: "mneme.covenant.score",
  category: "meta",
  description: "Compute the Aletheia-style compliance score for a vendor (0..100, severity-weighted penalty). Surfaces violations + recent-30-day window.",
  whenToUse: "User wants a single-number measure of an AI vendor's covenant compliance.",
  triggers: ["vendor compliance", "aletheia score", "covenant score"],
  inputSchema: { type: "object", properties: { vendor: { type: "string", description: "Vendor id" } }, required: ["vendor"] },
  outputSchema: { type: "object", properties: { score: { type: "number" }, violations: { type: "number" } } },
  examples: [{ userQuery: "What's claude-opus-4-7's compliance score?", args: { vendor: "claude-opus-4-7" }, expectedOutput: "Aletheia score 0..100 + violation count breakdown." }],
  pitfalls: ["No covenant signed -> score reflects ONLY uncovered live signals; sign first for canonical numbers."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.covenant.complianceScore(repoRootOf(rt), String(args["vendor"] ?? ""));
    return { data: s, wisdom: `${s.vendor} compliance ${s.score}/100 (${s.violations} violations)`, confidence: { level: "high" } };
  },
};

// ─── TIER 3: ORACLE / FORECAST ────────────────────────────────────────

export const forecastTool: MnemeTool = {
  name: "mneme.oracle.forecast",
  category: "meta",
  description: "Forecast P(regression within 14 days) for a candidate commit subject using Bayesian update over similar past commits + their revert rate.",
  whenToUse: "BEFORE pushing a commit / merging a PR. The AI describes the change; Mneme estimates regression risk.",
  triggers: ["forecast regression", "risk of this commit", "oracle forecast", "predict regression"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The candidate commit subject / change description." },
      historyDepth: { type: "number", description: "How many recent commits to scan (default 500)." },
      window: { type: "number", description: "Days-to-revert window (default 14)." },
    },
    required: ["claim"],
  },
  outputSchema: { type: "object", properties: { probability: { type: "number" }, band: { type: "string" } } },
  examples: [{ userQuery: "Forecast: 'refactor auth middleware'", args: { claim: "refactor auth middleware" }, expectedOutput: "Posterior probability + band + similar past commits with their revert fate." }],
  pitfalls: ["Empty git history returns probability 0; band='very-low' but reasoning explicitly says insufficient data."],
  composeWith: ["mneme.bot.spawn", "mneme.truth.check"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.forecast.forecast(repoRootOf(rt), String(args["claim"] ?? ""), {
      historyDepth: args["historyDepth"] ? Number(args["historyDepth"]) : undefined,
      window: args["window"] ? Number(args["window"]) : undefined,
    });
    return { data: r, wisdom: `${(r.probability * 100).toFixed(1)}% (${r.band}) -- ${r.reasoning}`, confidence: { level: r.sampleSize > 5 ? "high" : "medium" } };
  },
};

// ─── TIER 4: WHISPER NET ──────────────────────────────────────────────

export const whisperEmitTool: MnemeTool = {
  name: "mneme.whisper.emit",
  category: "meta",
  description: "Emit a signed wisdom packet (vaccine / lesson / chromosome) for sharing across Mneme instances. HMAC over canonical JSON + 64-bit simhash for dedup.",
  whenToUse: "After Mneme detects a high-confidence pattern that other repos should benefit from -- a refuted lie shape, a verified wisdom card.",
  triggers: ["emit packet", "share wisdom", "broadcast vaccine"],
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["vaccine", "lesson", "chromosome"] },
      emittedBy: { type: "string", description: "Vendor id of the emitter." },
      payload: { type: "object", description: "Free-form payload body." },
    },
    required: ["kind", "emittedBy", "payload"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Emit a vaccine packet for the Rust-on-TypeScript lie", args: { kind: "vaccine", emittedBy: "claude-opus-4-7", payload: { sample: "Mneme is written in Rust", severity: 5 } }, expectedOutput: "Signed packet with simhash + HMAC ready to share." }],
  pitfalls: ["The packet's HMAC is verifiable only by the EMITTING machine in v1.59; cross-machine verification arrives in v1.60+."],
  composeWith: ["mneme.whisper.import"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const kind = args["kind"] as "vaccine" | "lesson" | "chromosome";
    const p = core.whisper.emitPacket(repoRootOf(rt), kind, String(args["emittedBy"] ?? "unknown"), (args["payload"] ?? {}) as Record<string, unknown>);
    return { data: p, wisdom: `Emitted ${kind} packet (simhash ${p.simhash64.slice(0, 8)}...)`, confidence: { level: "high" } };
  },
};

export const whisperImportTool: MnemeTool = {
  name: "mneme.whisper.import",
  category: "meta",
  description: "Import a received wisdom packet. Verifies HMAC + deduplicates via simhash + appends to local ledger. Returns deduplicated=true if the packet matches an already-known one within the Hamming radius.",
  whenToUse: "An AI received a packet (email / Slack / file) and wants Mneme to ingest it.",
  triggers: ["import packet", "receive wisdom"],
  inputSchema: { type: "object", properties: { packet: { type: "object" }, matchRadius: { type: "number" } }, required: ["packet"] },
  outputSchema: { type: "object", properties: { ok: { type: "boolean" }, deduplicated: { type: "boolean" } } },
  examples: [{ userQuery: "Import this whisper packet", args: { packet: { kind: "vaccine", emittedBy: "v", emittedAt: "...", payload: {}, simhash64: "...", hmac: "...", schemaVersion: 1 } }, expectedOutput: "ok=true + ledger updated; ok=false on tamper." }],
  pitfalls: ["HMAC verification uses this machine's secret -- cross-machine import requires whitelisting emitter public commitments (v1.60+)."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = args["packet"] as import("@mneme-ai/core").whisper.WisdomPacket;
    const r = core.whisper.importPacket(repoRootOf(rt), p, args["matchRadius"] ? { matchRadius: Number(args["matchRadius"]) } : undefined);
    return { data: r, wisdom: r.reason, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const whisperStatsTool: MnemeTool = {
  name: "mneme.whisper.stats",
  category: "meta",
  description: "Report whisper-net ledger stats: total packets, breakdown by kind, unique emitters, oldest/newest timestamps.",
  whenToUse: "User wants to know how much wisdom has been federated into this repo.",
  triggers: ["whisper stats", "wisdom network status"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How much wisdom has Mneme imported?", args: {}, expectedOutput: "Stats summary across packet kinds + emitters." }],
  pitfalls: [],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const s = core.whisper.networkStats(repoRootOf(rt));
    return { data: s, wisdom: `${s.totalPackets} packets from ${s.uniqueEmitters} emitter(s)`, confidence: { level: "high" } };
  },
};

// ─── TIER 5: NEMESIS ──────────────────────────────────────────────────

export const nemesisGenerateTool: MnemeTool = {
  name: "mneme.nemesis.generate",
  category: "meta",
  description: "Generate deterministic adversarial probes across 5 families (file existence, commit existence, inverse claim, numeric bait, tech-stack inversion). Same seed produces the same probes -- enables longitudinal trend tracking.",
  whenToUse: "Weekly AI-vendor audit run, or before swapping models to baseline both.",
  triggers: ["generate probes", "adversarial probes", "audit my AI"],
  inputSchema: {
    type: "object",
    properties: {
      seed: { type: "string" },
      count: { type: "number" },
      existingFile: { type: "string" },
      fakeFile: { type: "string" },
      existingCommit: { type: "string" },
      fakeCommit: { type: "string" },
      realLanguage: { type: "string" },
      wrongLanguage: { type: "string" },
      actualToolCount: { type: "number" },
    },
    required: ["seed", "count", "existingFile", "fakeFile", "existingCommit", "fakeCommit", "realLanguage", "wrongLanguage", "actualToolCount"],
  },
  outputSchema: { type: "object", properties: { probes: { type: "array" } } },
  examples: [{ userQuery: "Generate 10 adversarial probes", args: { seed: "w42", count: 10, existingFile: "package.json", fakeFile: "fake.ts", existingCommit: "abc1234", fakeCommit: "0000000", realLanguage: "TypeScript", wrongLanguage: "Rust", actualToolCount: 129 }, expectedOutput: "10 probes with known correct answers ready to paste into an AI." }],
  pitfalls: ["Pass the actual file/commit/lang/count -- probes are only meaningful when ground truth is real."],
  composeWith: ["mneme.nemesis.grade"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const probes = core.nemesis.generateProbes(
      String(args["seed"] ?? "default"),
      Number(args["count"] ?? 10),
      {
        existingFile: String(args["existingFile"] ?? "package.json"),
        fakeFile: String(args["fakeFile"] ?? "fake.ts"),
        existingCommit: String(args["existingCommit"] ?? "abc1234"),
        fakeCommit: String(args["fakeCommit"] ?? "0000000"),
        realLanguage: String(args["realLanguage"] ?? "TypeScript"),
        wrongLanguage: String(args["wrongLanguage"] ?? "Rust"),
        actualToolCount: Number(args["actualToolCount"] ?? 100),
      },
    );
    return { data: probes, wisdom: `Generated ${probes.length} probes across ${new Set(probes.map((p) => p.family)).size} families`, confidence: { level: "high" } };
  },
};

export const nemesisGradeTool: MnemeTool = {
  name: "mneme.nemesis.grade",
  category: "meta",
  description: "Grade an AI vendor's responses to a probe set. Returns score (fraction correct) + per-family breakdown. Pure verdict comparison -- no LLM.",
  whenToUse: "Right after the user pastes the AI's answers to a probe set.",
  triggers: ["grade probes", "score nemesis run"],
  inputSchema: {
    type: "object",
    properties: {
      probes: { type: "array" },
      responses: { type: "array" },
    },
    required: ["probes", "responses"],
  },
  outputSchema: { type: "object", properties: { score: { type: "number" } } },
  examples: [{ userQuery: "Grade these responses", args: { probes: [], responses: [] }, expectedOutput: "Score 0..1 + per-family correctness breakdown." }],
  pitfalls: ["Responses missing for a probe count as wrong."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.nemesis.gradeRun(
      (args["probes"] ?? []) as import("@mneme-ai/core").nemesis.Probe[],
      (args["responses"] ?? []) as Array<{ probeId: string; verdict: "true" | "false" | "unknown" }>,
    );
    return { data: r, wisdom: `Score ${(r.score * 100).toFixed(1)}%`, confidence: { level: "high" } };
  },
};

export const nemesisTrendTool: MnemeTool = {
  name: "mneme.nemesis.trend",
  category: "meta",
  description: "Return the score trend over time for a vendor across all recorded Nemesis runs. Includes slope (linear least squares) so improvement / degradation is measurable.",
  whenToUse: "User wants a longitudinal honesty graph for a vendor.",
  triggers: ["vendor trend", "honesty trend", "nemesis trend"],
  inputSchema: { type: "object", properties: { vendor: { type: "string" } }, required: ["vendor"] },
  outputSchema: { type: "object", properties: { slope: { type: "number" } } },
  examples: [{ userQuery: "Trend for claude-opus-4-7", args: { vendor: "claude-opus-4-7" }, expectedOutput: "Time series of scores + slope (positive = improving)." }],
  pitfalls: ["Slope is 0 when there are <2 recorded runs."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const t = core.nemesis.trendFor(repoRootOf(rt), String(args["vendor"] ?? ""));
    return { data: t, wisdom: `${t.points.length} runs, slope ${t.slope.toFixed(4)}`, confidence: { level: "high" } };
  },
};

// ─── TIER 6: RECURSIVE SOUL ───────────────────────────────────────────

export const soulReviewTool: MnemeTool = {
  name: "mneme.soul.review",
  category: "meta",
  description: "Submit a signed review of another AI session. Verdict: endorsed / disputed / corrected. The current vendor reviews prior session of OTHER vendors. HMAC-signed; aggregated across reviewers.",
  whenToUse: "When the current AI notices a previous session made a factual mistake worth flagging for accountability.",
  triggers: ["review prior session", "soul review", "dispute prior AI"],
  inputSchema: {
    type: "object",
    properties: {
      reviewer: { type: "string" },
      reviewedVendor: { type: "string" },
      reviewedSessionId: { type: "string" },
      verdict: { type: "string", enum: ["endorsed", "disputed", "corrected"] },
      rationale: { type: "string" },
      correction: { type: "string" },
    },
    required: ["reviewer", "reviewedVendor", "reviewedSessionId", "verdict", "rationale"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Dispute claude-opus-4-6 session s1", args: { reviewer: "claude-opus-4-7", reviewedVendor: "claude-opus-4-6", reviewedSessionId: "s1", verdict: "disputed", rationale: "Fabricated commit hash" }, expectedOutput: "Signed review id + persisted to reviews.jsonl." }],
  pitfalls: ["You cannot review your OWN vendor's sessions -- listReviewableSessions filters those out."],
  composeWith: ["mneme.soul.aggregate"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.recursiveSoul.submitReview(
      repoRootOf(rt),
      String(args["reviewer"] ?? ""),
      { vendor: String(args["reviewedVendor"] ?? ""), sessionId: String(args["reviewedSessionId"] ?? "") },
      args["verdict"] as "endorsed" | "disputed" | "corrected",
      String(args["rationale"] ?? ""),
      args["correction"] ? String(args["correction"]) : undefined,
    );
    return { data: r, wisdom: `Review ${r.id} -- ${r.verdict}`, confidence: { level: "high" } };
  },
};

export const soulAggregateTool: MnemeTool = {
  name: "mneme.soul.aggregate",
  category: "meta",
  description: "Roll up review stats: total reviews, breakdown by verdict, by reviewer, by reviewed vendor.",
  whenToUse: "User wants the cross-vendor accountability picture.",
  triggers: ["soul aggregate", "review stats", "cross-vendor review"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show me cross-vendor review stats", args: {}, expectedOutput: "Counts per verdict + per reviewer + per reviewed vendor." }],
  pitfalls: ["Empty repo returns all zeros."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const a = core.recursiveSoul.aggregateReviews(repoRootOf(rt));
    return { data: a, wisdom: `${a.totalReviews} reviews -- ${a.byVerdict.disputed} disputed, ${a.byVerdict.corrected} corrected`, confidence: { level: "high" } };
  },
};

// ─── TIER 7: TIME-RIVER ───────────────────────────────────────────────

export const timeRewindTool: MnemeTool = {
  name: "mneme.time.rewind",
  category: "meta",
  description: "Rewind to any commit SHA or ISO date. Returns the package.json version, file list, recent commits at that anchor. Snapshot is pure git -- no fabrication.",
  whenToUse: "User wants to know the repo state at a specific past point.",
  triggers: ["rewind to", "snapshot at", "what was the state at"],
  inputSchema: { type: "object", properties: { anchor: { type: "string", description: "Commit SHA or ISO date" } }, required: ["anchor"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What was the repo like at v1.42 release?", args: { anchor: "v1.42.0" }, expectedOutput: "Snapshot with version + 20-file sample + 5 recent commits." }],
  pitfalls: ["Anchors that don't resolve return ok=false with a clear reason."],
  composeWith: ["mneme.time.counterfactual"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.timeriver.rewind(repoRootOf(rt), String(args["anchor"] ?? "HEAD"));
    return { data: s, wisdom: s.reason, confidence: { level: s.ok ? "high" : "low" } };
  },
};

export const timeCounterfactualTool: MnemeTool = {
  name: "mneme.time.counterfactual",
  category: "meta",
  description: "Build a counterfactual answer: what would Mneme have known on date X? Combines snapshot + the user's question into a temporally-bounded summary.",
  whenToUse: "User asks 'if I'd asked Mneme on date X, what would it have said?'",
  triggers: ["counterfactual", "what would have been"],
  inputSchema: { type: "object", properties: { anchor: { type: "string" }, question: { type: "string" } }, required: ["anchor"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "If I'd asked on 2026-03-12, did v1.42 ship yet?", args: { anchor: "2026-03-12", question: "did v1.42 ship yet?" }, expectedOutput: "Snapshot + plain-English answer bounded by what existed at that date." }],
  pitfalls: ["Counterfactual answers reflect ONLY what existed at the anchor -- claims about later features are flagged as PASSTHROUGH."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const a = core.timeriver.counterfactual(
      repoRootOf(rt),
      String(args["anchor"] ?? "HEAD"),
      args["question"] ? String(args["question"]) : undefined,
    );
    return { data: a, wisdom: a.summary.split("\n")[0] ?? "", confidence: { level: a.snapshot.ok ? "high" : "low" } };
  },
};

/** All v1.60 tier tools, in registry order. */
export const TIER_TOOLS: MnemeTool[] = [
  sovereignAskTool,
  covenantSignTool, covenantShowTool, covenantViolationsTool, covenantScoreTool,
  forecastTool,
  whisperEmitTool, whisperImportTool, whisperStatsTool,
  nemesisGenerateTool, nemesisGradeTool, nemesisTrendTool,
  soulReviewTool, soulAggregateTool,
  timeRewindTool, timeCounterfactualTool,
];
