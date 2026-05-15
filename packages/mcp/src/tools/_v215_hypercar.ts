/**
 * v2.15.0 HYPERCAR PENTAD — MCP tools.
 *
 *   GENESIS    — mneme.genesis.*
 *   HIVE       — mneme.hive.*
 *   VIBE       — mneme.vibe.*
 *   ARBITRAGE  — mneme.arbitrage.*
 */

import type { MnemeTool } from "./_types.js";

// ====================================================================
// GENESIS
// ====================================================================

export const genesisFingerprintTool: MnemeTool = {
  name: "mneme.genesis.fingerprint",
  category: "meta",
  description:
    "GENESIS — fingerprint a repo: detect stack (typescript/python/rust/...), frameworks (react/django/...), CI presence, package managers, age. Pure I/O; no network. Used to drive auto-bootstrap.",
  whenToUse: "First-time entry into a repo, or when re-tuning Mneme to a freshly-pivoted stack.",
  triggers: ["fingerprint repo", "what stack"],
  inputSchema: { type: "object", properties: { repoDir: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What is this repo?", args: {}, expectedOutput: "{ stack, frameworks, hasCI, packageManagers, ... }" }],
  pitfalls: ["Polyglot repos return stack=polyglot — frameworks list still distinguishes them."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const fp = core.genesis.fingerprintRepo(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {});
    return { data: fp, wisdom: `FINGERPRINT · ${fp.stack}${fp.frameworks.length ? " + " + fp.frameworks.join(",") : ""} · ${fp.fileCount} files`, confidence: { level: "high" } };
  },
};

export const genesisPlanTool: MnemeTool = {
  name: "mneme.genesis.plan",
  category: "meta",
  description:
    "GENESIS — produce an HMAC-signed bootstrap plan for the repo. Lists every action (soul rules to seed, BOUNTY/REPLICA/INFRA/COMPLIANCE init) with rationale + benefit + ETA. Show this to the user; apply via mneme.genesis.apply.",
  whenToUse: "Cold-start a new Mneme-managed repo. The plan is the user's preview.",
  triggers: ["genesis plan", "bootstrap plan"],
  inputSchema: { type: "object", properties: { repoDir: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Plan Mneme bootstrap", args: {}, expectedOutput: "{ summary, actions, etaSeconds, sig }" }],
  pitfalls: ["Plan is read-only. Run mneme.genesis.apply to actually write to .mneme/."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const plan = core.genesis.genesisPlan(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {});
    return { data: plan, wisdom: core.genesis.formatGenesisLine(plan), followUp: ["mneme.genesis.apply"], confidence: { level: "high" } };
  },
};

export const genesisApplyTool: MnemeTool = {
  name: "mneme.genesis.apply",
  category: "meta",
  description:
    "GENESIS — execute the plan against the repo. Idempotent: re-running is safe. Initialises project soul + bounty + replica + infra + compliance per the plan.",
  whenToUse: "After user confirms the plan from mneme.genesis.plan.",
  triggers: ["apply genesis", "bootstrap mneme"],
  inputSchema: { type: "object", properties: { plan: { type: "object" } }, required: ["plan"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Apply the genesis plan", args: { plan: {} }, expectedOutput: "{ applied, errors, durationMs }" }],
  pitfalls: ["Verifies the plan's HMAC sig before applying. Tampered plans are rejected silently."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.genesis.applyPlan(args["plan"] as Parameters<typeof core.genesis.applyPlan>[0]);
    return { data: r, wisdom: `GENESIS applied · ${r.applied.length} modules · ${r.durationMs}ms`, confidence: { level: r.errors.length === 0 ? "high" : "low" } };
  },
};

// ====================================================================
// HIVE
// ====================================================================

export const hiveHashTool: MnemeTool = {
  name: "mneme.hive.hash",
  category: "meta",
  description:
    "HIVE — hash a problem into a stable fingerprint (sha256 over canonical AST-ish shape). Identifiers/strings/numbers are masked → privacy. Same problem across users hashes identically.",
  whenToUse: "When recording a pattern or looking it up.",
  triggers: ["hash problem", "pattern hash"],
  inputSchema: {
    type: "object",
    properties: {
      problemText: { type: "string" },
      kind: { type: "string", enum: ["bug", "refactor", "perf", "security", "test_failure", "build_failure", "dependency_update", "type_error", "lint_error", "deploy_failure", "other"] },
      stack: { type: "string" },
      framework: { type: "string" },
    },
    required: ["problemText", "kind"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Hash this bug", args: { problemText: "TypeError: x is not a function", kind: "type_error" }, expectedOutput: "{ hash, contextHash, kind }" }],
  pitfalls: ["Hash is one-way. Original problem text is NOT recoverable."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const h = core.hive.hashPattern({
      problemText: String(args["problemText"]),
      kind: String(args["kind"]) as Parameters<typeof core.hive.hashPattern>[0]["kind"],
      ...(args["stack"] ? { stack: String(args["stack"]) } : {}),
      ...(args["framework"] ? { framework: String(args["framework"]) } : {}),
    });
    return { data: h, wisdom: `HASH · ${h.hash.slice(0, 12)} · ${h.kind}`, confidence: { level: "high" } };
  },
};

export const hiveRecordTool: MnemeTool = {
  name: "mneme.hive.record",
  category: "meta",
  description:
    "HIVE — record an observation (a pattern + the solution applied + the outcome) into your local hive. HMAC-signed; tamper-evident. Builds your personal library + (opt-in) feeds the public hive.",
  whenToUse: "After resolving a bug / hitting a build failure / etc — record what worked.",
  triggers: ["record pattern", "hive observe"],
  inputSchema: {
    type: "object",
    properties: {
      hash: { type: "object" },
      solution: { type: "object" },
      outcome: { type: "string", enum: ["good", "bad", "regression", "unknown"] },
      repoDir: { type: "string" },
    },
    required: ["hash", "solution", "outcome"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record fix worked", args: { hash: {}, solution: { kind: "edit", filesAffected: 1, linesChanged: 3 }, outcome: "good" }, expectedOutput: "{ id, sig }" }],
  pitfalls: ["Solution does NOT include source code — only kind + size + 1-line label."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const obs = core.hive.recordObservation({
      hash: args["hash"] as Parameters<typeof core.hive.recordObservation>[0]["hash"],
      solution: args["solution"] as Parameters<typeof core.hive.recordObservation>[0]["solution"],
      outcome: String(args["outcome"]) as Parameters<typeof core.hive.recordObservation>[0]["outcome"],
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return { data: obs, wisdom: `HIVE recorded · ${obs.id} · ${obs.outcome}`, confidence: { level: "high" } };
  },
};

export const hiveLookupTool: MnemeTool = {
  name: "mneme.hive.lookup",
  category: "meta",
  description:
    "HIVE — look up a pattern hash in local + public hive. Returns best-known solution + confidence + sample size. Falls back to local if public endpoint unreachable.",
  whenToUse: "Before asking AI to fix a bug — check if the hive already knows the answer.",
  triggers: ["hive lookup", "find pattern"],
  inputSchema: {
    type: "object",
    properties: { hash: { type: "object" }, useRemote: { type: "boolean" }, repoDir: { type: "string" } },
    required: ["hash"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What do others do for this?", args: { hash: {}, useRemote: true }, expectedOutput: "{ totalObservations, bestSolution, byOutcome }" }],
  pitfalls: ["Public hive is opt-in. Local-only is always available."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const remote = args["useRemote"] !== false;
    const m = remote
      ? await core.hive.lookupPublic(args["hash"] as Parameters<typeof core.hive.lookupPublic>[0], { ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}) })
      : core.hive.lookupLocal(args["hash"] as Parameters<typeof core.hive.lookupLocal>[0], { ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}) });
    return { data: m, wisdom: m.bestSolution ? `HIVE · best=${m.bestSolution.kind}/${m.bestSolution.label ?? "(no label)"} · ${m.bestSolution.samplesGood}/${m.bestSolution.samplesTotal} good` : `HIVE · no match (${m.totalObservations} obs total)`, confidence: { level: m.bestSolution?.samplesTotal && m.bestSolution.samplesTotal >= 5 ? "high" : "medium" } };
  },
};

// ====================================================================
// VIBE
// ====================================================================

export const vibeCheckTool: MnemeTool = {
  name: "mneme.vibe.check",
  category: "meta",
  description:
    "VIBE — beginner-friendly safety wrapper. Runs DLP + SOUL + complexity-creep gates over an AI-proposed change. Returns plain-English status (ship_it / ship_with_note / wait_review / stop_unsafe) + 0-10 confidence + actionable findings. Translates technical findings to vibe-coder English.",
  whenToUse: "After EVERY AI change in a vibe-coder context (Bolt / Lovable / Replit / v0). Before shipping to user.",
  triggers: ["vibe check", "is this safe", "should i ship"],
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string" },
      content: { type: "string", description: "The new/changed text content to scan." },
      files: { type: "array", items: { type: "string" } },
      addsDeps: { type: "array", items: { type: "string" } },
      repoDir: { type: "string" },
    },
    required: ["description"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is my new component safe?", args: { description: "Add login form", content: "..." }, expectedOutput: "{ status, confidence, quote, findings }" }],
  pitfalls: ["status=stop_unsafe means a critical issue (e.g., leaked secret) — DO NOT ship."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.vibe.vibeCheck({
      description: String(args["description"]),
      ...(args["content"] ? { content: String(args["content"]) } : {}),
      ...(args["files"] ? { files: (args["files"] as unknown[]).map(String) } : {}),
      ...(args["addsDeps"] ? { addsDeps: (args["addsDeps"] as unknown[]).map(String) } : {}),
    }, args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {});
    return { data: r, wisdom: r.quote, confidence: { level: r.status === "ship_it" ? "high" : r.status === "ship_with_note" ? "medium" : "low", notes: r.coach } };
  },
};

export const vibeExplainTool: MnemeTool = {
  name: "mneme.vibe.explain",
  category: "meta",
  description:
    "VIBE — translate technical Mneme output into vibe-coder English. 'HMAC signature mismatch' → 'someone changed a file Mneme had marked trusted'. Use whenever surfacing a technical finding to a non-programmer user.",
  whenToUse: "Before showing any Mneme finding to a non-programmer user.",
  triggers: ["explain like im five", "translate"],
  inputSchema: {
    type: "object",
    properties: { topic: { type: "string" }, technical: { type: "string" } },
    required: ["topic", "technical"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Explain this", args: { topic: "Soul check", technical: "HMAC signature mismatch" }, expectedOutput: "{ plainEnglish }" }],
  pitfalls: ["Best for short technical strings. Long ones are passed through with truncation."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const out = core.vibe.explainLikeImFive({ topic: String(args["topic"]), technical: String(args["technical"]) });
    return { data: { plainEnglish: out }, wisdom: out, confidence: { level: "high" } };
  },
};

// ====================================================================
// ARBITRAGE
// ====================================================================

export const arbitrageChooseTool: MnemeTool = {
  name: "mneme.arbitrage.choose",
  category: "meta",
  description:
    "ARBITRAGE — recommend the best AI vendor for a task type + quality budget. Combines default per-task strength tables + measured BOUNTY data (your repo's actual vendor falseRate). Returns ranked candidates with quality/$ scores + signed decision.",
  whenToUse: "Before sending a prompt to an AI. Especially valuable in agentic workflows where you have control over routing.",
  triggers: ["choose vendor", "which ai"],
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", enum: ["code_generation", "code_review", "debugging", "refactoring", "test_writing", "documentation", "explanation", "summarization", "translation", "creative_writing", "data_analysis", "research", "structured_output", "function_calling", "agentic_workflow", "other"] },
      budget: { type: "string", enum: ["ultra", "high", "balanced", "cheap", "free_only"] },
      estTokens: { type: "object" },
      candidates: { type: "array", items: { type: "string" } },
      repoDir: { type: "string", description: "If supplied, BOUNTY measured data is read in for personalised routing." },
    },
    required: ["task"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Cheapest vendor for code review?", args: { task: "code_review", budget: "cheap" }, expectedOutput: "{ decision, considered, sig }" }],
  pitfalls: ["With <5 measured samples per vendor, defaults dominate. Use mneme.bounty.* to build the signal."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const measured = args["repoDir"] ? await core.arbitrage.snapshotMeasured({ repoDir: String(args["repoDir"]) }) : undefined;
    const r = core.arbitrage.chooseVendor({
      task: String(args["task"]) as Parameters<typeof core.arbitrage.chooseVendor>[0]["task"],
      ...(args["budget"] ? { budget: String(args["budget"]) as Parameters<typeof core.arbitrage.chooseVendor>[0]["budget"] } : {}),
      ...(args["estTokens"] ? { estTokens: args["estTokens"] as Parameters<typeof core.arbitrage.chooseVendor>[0]["estTokens"] } : {}),
      ...(args["candidates"] ? { candidates: (args["candidates"] as unknown[]).map(String) as Parameters<typeof core.arbitrage.chooseVendor>[0]["candidates"] } : {}),
      ...(measured ? { measured } : {}),
    });
    return { data: r, wisdom: core.arbitrage.formatArbitrageLine(r), confidence: { level: r.decision ? "high" : "low", notes: r.reason } };
  },
};

export const arbitrageRecordTool: MnemeTool = {
  name: "mneme.arbitrage.record_outcome",
  category: "meta",
  description:
    "ARBITRAGE — after a routed request, feed the outcome back into BOUNTY so future routing learns from this trial. correct/wrong/partial.",
  whenToUse: "After every AI response in an arbitrage-routed flow. Even one feedback per routing tightens the signal.",
  triggers: ["arbitrage outcome", "record routing result"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      task: { type: "string" },
      outcome: { type: "string", enum: ["correct", "wrong", "partial"] },
      detail: { type: "string" },
      repoDir: { type: "string" },
    },
    required: ["vendor", "task", "outcome", "detail"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record the AI got it right", args: { vendor: "claude", task: "code_review", outcome: "correct", detail: "found real bug" }, expectedOutput: "{ ok }" }],
  pitfalls: ["Outcomes are HMAC-chained in BOUNTY — tampering breaks the chain at that index."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    await core.arbitrage.recordRoutingOutcome({
      vendor: String(args["vendor"]) as Parameters<typeof core.arbitrage.recordRoutingOutcome>[0]["vendor"],
      task: String(args["task"]) as Parameters<typeof core.arbitrage.recordRoutingOutcome>[0]["task"],
      outcome: String(args["outcome"]) as Parameters<typeof core.arbitrage.recordRoutingOutcome>[0]["outcome"],
      detail: String(args["detail"]),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return { data: { ok: true }, wisdom: `ARBITRAGE outcome recorded · ${args["vendor"]}/${args["task"]} · ${args["outcome"]}`, confidence: { level: "high" } };
  },
};

// ====================================================================
// BUG PROPHET — pre-bug detection
// ====================================================================

export const bugProphetProphesyTool: MnemeTool = {
  name: "mneme.bug_prophet.prophesy",
  category: "meta",
  description:
    "BUG PROPHET — predict regression risk for a proposed change BEFORE shipping. Pure inference (no LLM). Fuses SOUL scars + REPLICA bad outcomes + HIVE pattern history + BOUNTY vendor trust + complexity heuristic into a 0-1 risk score with HMAC-signed evidence.",
  whenToUse: "BEFORE applying any non-trivial AI-proposed change. Especially valuable for changes that touch multiple files / add deps / refactor.",
  triggers: ["bug prophet", "predict regression", "is this risky"],
  inputSchema: {
    type: "object",
    properties: {
      change: {
        type: "object",
        description: "{ description, files?, addsDeps?, content?, proposedBy?, taskClass? }",
      },
      repoDir: { type: "string" },
    },
    required: ["change"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this safe to ship?", args: { change: { description: "deploy on Friday", proposedBy: "claude" } }, expectedOutput: "{ regressionRisk, verdict, evidence, mitigations, sig }" }],
  pitfalls: [
    "very_high_risk verdict (>=0.7) means DO NOT ship without review.",
    "Confidence below 0.5 means corpora are thin — treat as advisory, not prescriptive.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.bugProphet.prophesy({
      change: args["change"] as Parameters<typeof core.bugProphet.prophesy>[0]["change"],
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return {
      data: r,
      wisdom: r.headline,
      confidence: { level: r.verdict === "low_risk" ? "high" : r.verdict === "medium_risk" ? "medium" : "low", notes: r.mitigations.join(" · ") },
    };
  },
};

export const V215_HYPERCAR_TOOLS: MnemeTool[] = [
  // GENESIS (3)
  genesisFingerprintTool, genesisPlanTool, genesisApplyTool,
  // HIVE (3)
  hiveHashTool, hiveRecordTool, hiveLookupTool,
  // VIBE (2)
  vibeCheckTool, vibeExplainTool,
  // ARBITRAGE (2)
  arbitrageChooseTool, arbitrageRecordTool,
  // BUG PROPHET (1) — pre-bug detection (v2.15.1)
  bugProphetProphesyTool,
];
