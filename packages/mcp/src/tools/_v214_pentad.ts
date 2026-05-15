/**
 * v2.14.0 KILLER PENTAD — MCP tools for the 5 new modules.
 *
 *   PROJECT SOUL    — mneme.soul.*
 *   MNEMOSYNE BOUNTY — mneme.bounty.*
 *   MNEME REPLICA   — mneme.replica.*
 *   KILL SWITCH     — mneme.compliance.*
 *   INFRA AS AI     — mneme.infra.*
 */

import type { MnemeTool } from "./_types.js";

// ====================================================================
// PROJECT SOUL
// ====================================================================

export const soulInitTool: MnemeTool = {
  name: "mneme.soul.init",
  category: "meta",
  description:
    "PROJECT SOUL — bootstrap a project's HMAC-signed values manifest at .mneme/project_soul.json. Loads (or creates) the soul, optionally seeds protective starter rules (no-fake-files / no-secret-leak / no-touch-mneme-config / utc-timestamps / honest-claims). Idempotent: re-running is safe.",
  whenToUse: "First time AI agent enters a Mneme-managed repo. Establishes the gate that future changes pass through.",
  triggers: ["init project soul", "soul init", "seed soul"],
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string", description: "Project name (defaults to repo basename)." },
      spirit: { type: "string", description: "One-line statement of project soul." },
      seed: { type: "boolean", description: "Seed default protective rules (recommended; default true)." },
      repoDir: { type: "string", description: "Project root. Defaults to cwd." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Initialize this project's soul", args: { project: "mneme", spirit: "memory layer that doesn't lie" }, expectedOutput: "{ project, ruleCount, spirit, soulSig }" }],
  pitfalls: [
    "Re-running with seed=true is safe — only adds missing default rules.",
    "Project name should match across machines for shared genomes.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const project = String(args["project"] ?? "mneme-project");
    const spirit = String(args["spirit"] ?? "(no spirit set)");
    const seed = args["seed"] !== false;
    const repoDir = args["repoDir"] ? String(args["repoDir"]) : undefined;
    let s = core.projectSoul.loadSoul({ ...(repoDir ? { repoDir } : {}) });
    if (!s) s = core.projectSoul.newSoul(project, spirit);
    if (seed) s = core.projectSoul.seedDefaultRules(s);
    const path = core.projectSoul.saveSoul(s, { ...(repoDir ? { repoDir } : {}) });
    return {
      data: { project: s.project, spirit: s.spirit, ruleCount: s.ruleCount, soulSig: s.soulSig, path },
      wisdom: core.projectSoul.formatSoulLine(s),
      followUp: ["mneme.soul.add_rule", "mneme.soul.check"],
      confidence: { level: "high" },
    };
  },
};

export const soulAddRuleTool: MnemeTool = {
  name: "mneme.soul.add_rule",
  category: "meta",
  description:
    "PROJECT SOUL — add an HMAC-signed rule. Categories: values | antiPatterns | conventions | scars | sacred. Severities: warn (note) | block (refuse). Sacred rules + antiPatterns + scars GATE; values + conventions are advisory.",
  whenToUse: "After an incident or a hard-won design decision — capture it so AI doesn't undo your wisdom.",
  triggers: ["add soul rule", "capture wisdom", "remember this"],
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["values", "antiPatterns", "conventions", "scars", "sacred"] },
      id: { type: "string", description: "Stable kebab-case ID." },
      text: { type: "string" },
      severity: { type: "string", enum: ["warn", "block"] },
      scarFrom: { type: "string", description: "Optional incident reference." },
      immutable: { type: "boolean", description: "If true, AI may not silently propose removal." },
      repoDir: { type: "string" },
    },
    required: ["category", "id", "text"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Remember: never use Redux", args: { category: "antiPatterns", id: "no-redux", text: "Never add Redux Toolkit", severity: "block" }, expectedOutput: "{ ruleCount, soulSig }" }],
  pitfalls: ["Duplicate IDs throw — pick a unique kebab-case slug per rule."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoDir = args["repoDir"] ? String(args["repoDir"]) : undefined;
    let s = core.projectSoul.loadSoul({ ...(repoDir ? { repoDir } : {}) });
    if (!s) return { data: { error: "no soul — run mneme.soul.init first" }, wisdom: "soul missing", confidence: { level: "low" } };
    s = core.projectSoul.addRule(s, {
      category: String(args["category"]) as Parameters<typeof core.projectSoul.addRule>[1]["category"],
      id: String(args["id"]),
      text: String(args["text"]),
      ...(args["severity"] ? { severity: String(args["severity"]) as "warn" | "block" } : {}),
      ...(args["scarFrom"] ? { scarFrom: String(args["scarFrom"]) } : {}),
      ...(args["immutable"] ? { immutable: true } : {}),
    });
    const path = core.projectSoul.saveSoul(s, { ...(repoDir ? { repoDir } : {}) });
    return {
      data: { ruleCount: s.ruleCount, soulSig: s.soulSig, path },
      wisdom: core.projectSoul.formatSoulLine(s),
      confidence: { level: "high" },
    };
  },
};

export const soulCheckTool: MnemeTool = {
  name: "mneme.soul.check",
  category: "meta",
  description:
    "PROJECT SOUL GATE — before applying an AI-proposed change, run this. Returns SHIP / WARN / BLOCK + per-rule findings + HMAC-signed verdict (paste in PR for tamper-evident review).",
  whenToUse: "BEFORE every non-trivial AI change. If verdict=BLOCK, refuse the change and ask AI to revise.",
  triggers: ["soul gate", "check change", "review against soul"],
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: "Free-form summary of the proposed change." },
      files: { type: "array", items: { type: "string" } },
      addsDeps: { type: "array", items: { type: "string" } },
      codeExcerpts: { type: "array", items: { type: "string" } },
      repoDir: { type: "string" },
    },
    required: ["description"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Check this change", args: { description: "Add Redux for global state", addsDeps: ["@reduxjs/toolkit"] }, expectedOutput: "{ verdict, findings, sig }" }],
  pitfalls: ["BLOCK verdict is binding — do not override silently. Ask the user before bypassing."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const repoDir = args["repoDir"] ? String(args["repoDir"]) : undefined;
    const s = core.projectSoul.loadSoul({ ...(repoDir ? { repoDir } : {}) });
    if (!s) return { data: { verdict: "PASS", reason: "no soul initialized" }, wisdom: "no soul gate", confidence: { level: "low" } };
    const v = core.projectSoul.checkAgainstSoul(s, {
      description: String(args["description"]),
      ...(args["files"] ? { files: (args["files"] as unknown[]).map(String) } : {}),
      ...(args["addsDeps"] ? { addsDeps: (args["addsDeps"] as unknown[]).map(String) } : {}),
      ...(args["codeExcerpts"] ? { codeExcerpts: (args["codeExcerpts"] as unknown[]).map(String) } : {}),
    });
    return {
      data: v,
      wisdom: `SOUL ${v.verdict} · ${v.findings.length} finding(s) · sig=${v.sig.slice(0, 8)}`,
      confidence: { level: v.verdict === "BLOCK" ? "high" : v.verdict === "WARN" ? "medium" : "high", notes: v.next },
    };
  },
};

// ====================================================================
// MNEMOSYNE BOUNTY
// ====================================================================

export const bountyClaimTool: MnemeTool = {
  name: "mneme.bounty.claim",
  category: "meta",
  description:
    "MNEMOSYNE BOUNTY — record a claim an AI just made (file exists, package version, command output, etc) into the HMAC-chained ledger. Pair with mneme.bounty.verdict once verified.",
  whenToUse: "Right after an AI states a checkable fact. Especially: file/symbol existence, version numbers, URLs, command outputs.",
  triggers: ["record claim", "log ai claim"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string", description: "AI vendor: chatgpt | claude | gemini | perplexity | cursor | copilot | codex | llama | mistral | qwen | deepseek | other" },
      text: { type: "string" },
      fact: { type: "object", description: "Optional structured fact: { type, subject, expected? }" },
      session: { type: "string" },
      repoDir: { type: "string" },
    },
    required: ["vendor", "text"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record claim: src/foo.ts exists", args: { vendor: "claude", text: "src/foo.ts exists", fact: { type: "file-exists", subject: "src/foo.ts" } }, expectedOutput: "{ id, chainSig }" }],
  pitfalls: ["text is capped at 1000 chars; use fact.expected for structured payloads."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.bounty.recordClaim({
      vendor: String(args["vendor"]) as Parameters<typeof core.bounty.recordClaim>[0]["vendor"],
      text: String(args["text"]),
      ...(args["fact"] ? { fact: args["fact"] as Parameters<typeof core.bounty.recordClaim>[0]["fact"] } : {}),
      ...(args["session"] ? { session: String(args["session"]) } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return {
      data: c,
      wisdom: `CLAIM · ${c.vendor} · ${c.id} · sig=${c.chainSig.slice(0, 8)}`,
      followUp: ["mneme.bounty.verdict"],
      confidence: { level: "high" },
    };
  },
};

export const bountyVerdictTool: MnemeTool = {
  name: "mneme.bounty.verdict",
  category: "meta",
  description:
    "MNEMOSYNE BOUNTY — record verdict on a previously-claimed fact. true | false | partial | inconclusive. Adds to vendor's trust scorecard.",
  whenToUse: "After verifying a claim independently (e.g., file actually exists / version actually matches).",
  triggers: ["bounty verdict", "verify claim"],
  inputSchema: {
    type: "object",
    properties: {
      claimId: { type: "string" },
      vendor: { type: "string" },
      verdict: { type: "string", enum: ["true", "false", "partial", "inconclusive"] },
      reason: { type: "string" },
      evidence: { type: "string", description: "Optional sha256 of evidence file or URL." },
      repoDir: { type: "string" },
    },
    required: ["claimId", "vendor", "verdict", "reason"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify claim — false", args: { claimId: "c-abc123", vendor: "claude", verdict: "false", reason: "file not found in repo" }, expectedOutput: "{ id, chainSig }" }],
  pitfalls: ["false verdicts contribute to vendor falseRate — be honest, not punitive."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.bounty.recordVerdict({
      claimId: String(args["claimId"]),
      vendor: String(args["vendor"]) as Parameters<typeof core.bounty.recordVerdict>[0]["vendor"],
      verdict: String(args["verdict"]) as Parameters<typeof core.bounty.recordVerdict>[0]["verdict"],
      reason: String(args["reason"]),
      ...(args["evidence"] ? { evidence: String(args["evidence"]) } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return {
      data: v,
      wisdom: `VERDICT · ${v.vendor} · ${v.verdict} · ${v.id}`,
      confidence: { level: "high" },
    };
  },
};

export const bountyLeaderboardTool: MnemeTool = {
  name: "mneme.bounty.leaderboard",
  category: "meta",
  description:
    "MNEMOSYNE BOUNTY — produce vendor trust leaderboard from the local ledger. Ranked by Wilson lower bound on falseRate (worst first). Each card is HMAC-signed; use mneme.bounty.publish to redact for sharing.",
  whenToUse: "Periodic AI-vendor selection: which vendor has lowest falseRate on the kinds of claims I make?",
  triggers: ["bounty leaderboard", "vendor trust ranking"],
  inputSchema: { type: "object", properties: { repoDir: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show vendor leaderboard", args: {}, expectedOutput: "[{ vendor, falseRate, falseRateLB, ... }]" }],
  pitfalls: ["Local-only — does not federate. To share, publish each card via mneme.bounty.publish."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const board = core.bounty.leaderboard({ ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}) });
    return {
      data: board,
      wisdom: core.bounty.formatBountyLine({ ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}) }),
      confidence: { level: "high" },
    };
  },
};

// ====================================================================
// MNEME REPLICA
// ====================================================================

export const replicaRecordTool: MnemeTool = {
  name: "mneme.replica.record",
  category: "meta",
  description:
    "MNEME REPLICA — record a decision (question + features + action) into the corpus. The replica gets smarter as the corpus grows.",
  whenToUse: "After making a non-trivial decision. Especially capture features as key=value tags so the replica can match similar future situations.",
  triggers: ["record decision", "log decision"],
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      action: { type: "string" },
      features: { type: "object", description: "key=value tags. e.g., { day: 'Friday', risk: 'high' }" },
      repoDir: { type: "string" },
    },
    required: ["question", "action"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "I decided to wait", args: { question: "Friday 5pm deploy?", action: "wait until Monday", features: { day: "Friday", risk: "high" } }, expectedOutput: "{ id, ts }" }],
  pitfalls: ["More features = better future matching. Use stable kebab-case keys."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.replica.recordDecision({
      question: String(args["question"]),
      action: String(args["action"]),
      ...(args["features"] ? { features: args["features"] as Record<string, string> } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return { data: d, wisdom: `REPLICA recorded · ${d.id}`, confidence: { level: "high" } };
  },
};

export const replicaConsultTool: MnemeTool = {
  name: "mneme.replica.consult",
  category: "meta",
  description:
    "MNEME REPLICA — ask the non-LLM oracle for a recommended action based on YOUR past decisions. Returns recommendation + confidence + neighbours + rationale. Zero LLM dependency: works offline, survives AI extinction events.",
  whenToUse: "When you want a second opinion grounded in your own past judgments. Especially valuable when AI vendors are unreachable or when you want continuity with your historical patterns.",
  triggers: ["consult replica", "ask my past self"],
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      features: { type: "object" },
      k: { type: "number", description: "Number of neighbours. Default 5." },
      halfLifeDays: { type: "number", description: "Recency decay. Default 90." },
      repoDir: { type: "string" },
    },
    required: ["question"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should I deploy now?", args: { question: "Friday 5pm deploy?", features: { day: "Friday", risk: "high" } }, expectedOutput: "{ recommendation, confidence, neighbours, rationale }" }],
  pitfalls: ["Confidence < 0.4 means the corpus is too thin or your situation is novel — treat as advisory, not prescriptive."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.replica.consultReplica({
      question: String(args["question"]),
      ...(args["features"] ? { features: args["features"] as Record<string, string> } : {}),
      ...(args["k"] ? { k: Number(args["k"]) } : {}),
      ...(args["halfLifeDays"] ? { halfLifeDays: Number(args["halfLifeDays"]) } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return {
      data: r,
      wisdom: r.recommendation
        ? `REPLICA · ${r.recommendation} (${(r.confidence * 100).toFixed(0)}% conf, ${r.corpusSize} corpus)`
        : `REPLICA · no match (corpus=${r.corpusSize})`,
      confidence: { level: r.confidence > 0.7 ? "high" : r.confidence > 0.4 ? "medium" : "low" },
    };
  },
};

// ====================================================================
// KILL SWITCH PROTOCOL
// ====================================================================

export const complianceKillSwitchTool: MnemeTool = {
  name: "mneme.compliance.killswitch",
  category: "meta",
  description:
    "KILL SWITCH PROTOCOL — issue an HMAC-signed kill directive. state=active stops all AI; state=scoped stops specific vendors/tags; state=off resumes. Mneme-aware AI clients must call mneme.compliance.should_respond before answering.",
  whenToUse: "Incident response: AI hallucinated a wrong answer that's spreading; vendor TOS violation; security event.",
  triggers: ["kill switch", "stop ai"],
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "string", enum: ["active", "scoped", "off"] },
      reason: { type: "string" },
      issuedBy: { type: "string", description: "e.g., ciso@company.com" },
      scopes: { type: "object", description: "{ vendors?: [...], tags?: [...] } when state=scoped" },
      expiresAt: { type: "string", description: "ISO 8601 auto-clear time." },
      repoDir: { type: "string" },
    },
    required: ["state", "reason", "issuedBy"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Stop all AI for incident response", args: { state: "active", reason: "incident #2026-05-15", issuedBy: "ciso@example.com" }, expectedOutput: "{ state, sig }" }],
  pitfalls: ["Always set expiresAt for incident response — avoid forgetting an active kill."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.killSwitch.issueKillSwitch({
      state: String(args["state"]) as Parameters<typeof core.killSwitch.issueKillSwitch>[0]["state"],
      reason: String(args["reason"]),
      issuedBy: String(args["issuedBy"]),
      ...(args["scopes"] ? { scopes: args["scopes"] as Parameters<typeof core.killSwitch.issueKillSwitch>[0]["scopes"] } : {}),
      ...(args["expiresAt"] ? { expiresAt: String(args["expiresAt"]) } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return { data: d, wisdom: `KILL ${d.state} · sig=${d.sig.slice(0, 8)}`, confidence: { level: "high" } };
  },
};

export const complianceShouldRespondTool: MnemeTool = {
  name: "mneme.compliance.should_respond",
  category: "meta",
  description:
    "KILL SWITCH runtime check — call before every AI response. Returns { allowed, reason, killDirective }. If allowed=false, the AI MUST refuse (and may quote the directive's reason).",
  whenToUse: "EVERY response, before answering. Cheap (~1ms; just reads .mneme/compliance/kill_switch.json).",
  triggers: ["should i respond", "check kill switch"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      repoDir: { type: "string" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Check before responding", args: { vendor: "claude" }, expectedOutput: "{ allowed: true | false, reason?, killDirective? }" }],
  pitfalls: ["Tampered directives are auto-ignored — verifier protects against forged kills."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.killSwitch.shouldRespond({
      ...(args["vendor"] ? { vendor: String(args["vendor"]) } : {}),
      ...(args["tags"] ? { tags: (args["tags"] as unknown[]).map(String) } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return {
      data: r,
      wisdom: r.allowed ? "OK · proceed" : `BLOCKED · ${r.reason}`,
      confidence: { level: "high" },
    };
  },
};

export const complianceDlpTool: MnemeTool = {
  name: "mneme.compliance.dlp",
  category: "meta",
  description:
    "KILL SWITCH DLP — scan a string for secrets / PII (AWS keys / GitHub PATs / OpenAI keys / private keys / JWTs / emails / cards / Thai national ID + custom rules in .mneme/compliance/dlp_rules.json). Block-severity hits create court-admissible audit entries.",
  whenToUse: "Before sending any AI output / commit message / log line that could contain sensitive data.",
  triggers: ["dlp scan", "check secrets"],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      actor: { type: "string", description: "Who is being scanned (for audit log)." },
      repoDir: { type: "string" },
    },
    required: ["text"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Scan this commit message", args: { text: "Updated config; new key=AKIA..." }, expectedOutput: "{ hits, worstSeverity, blocked, sig }" }],
  pitfalls: ["Heuristic AWS-secret pattern has high false-positive rate — review warn-severity hits before blocking flow."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.killSwitch.dlpScan(String(args["text"] ?? ""), {
      ...(args["actor"] ? { actor: String(args["actor"]) } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return {
      data: r,
      wisdom: r.blocked ? `DLP BLOCKED · ${r.hits.length} hit(s)` : r.hits.length > 0 ? `DLP warn · ${r.hits.length} hit(s)` : "DLP clean",
      confidence: { level: "high" },
    };
  },
};

export const complianceAuditExportTool: MnemeTool = {
  name: "mneme.compliance.audit",
  category: "meta",
  description:
    "KILL SWITCH AUDIT — export the HMAC-chained audit log for compliance reporting. Groups by kind + actor; verifies chain integrity. Court-admissible.",
  whenToUse: "Weekly CISO review; periodic compliance audits; post-incident forensics.",
  triggers: ["audit export", "compliance report"],
  inputSchema: {
    type: "object",
    properties: {
      since: { type: "string", description: "ISO 8601; only include entries on/after this time." },
      repoDir: { type: "string" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Last week's compliance report", args: { since: "2026-05-08T00:00:00Z" }, expectedOutput: "{ entries, byKind, byActor, chainOk }" }],
  pitfalls: ["chainOk=false means tampering — escalate immediately to security."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.killSwitch.exportAuditReport({
      ...(args["since"] ? { since: String(args["since"]) } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return {
      data: r,
      wisdom: `AUDIT · ${r.total} entries · chainOk=${r.chainOk}`,
      confidence: { level: r.chainOk ? "high" : "low", notes: r.chainOk ? undefined : "chain broken — investigate" },
    };
  },
};

// ====================================================================
// INFRA AS AI
// ====================================================================

export const infraObserveTool: MnemeTool = {
  name: "mneme.infra.observe",
  category: "meta",
  description:
    "INFRA AS AI — record an HMAC-signed infrastructure observation (latency outlier / error spike / deploy / cron misfire / anomaly / saturation / recovery / incident). Append-only; survives restarts.",
  whenToUse: "Hook into your monitoring: alerts, deploy events, anomaly detectors. Each event becomes a tamper-evident memory.",
  triggers: ["record observation", "log infra event"],
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["latency_outlier", "error_spike", "deploy", "config_change", "cron_misfire", "anomaly", "saturation", "recovery", "incident", "other"] },
      subject: { type: "string", description: "Service / component identifier (e.g., 'auth-service')." },
      detail: { type: "string" },
      metric: { type: "object", description: "Optional { name, value, unit }." },
      tags: { type: "array", items: { type: "string" } },
      host: { type: "string", description: "Host identity (defaults to OS hostname)." },
      repoDir: { type: "string" },
    },
    required: ["kind", "subject", "detail"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Log deploy event", args: { kind: "deploy", subject: "api", detail: "v2.13.1 → v2.14.0" }, expectedOutput: "{ id, sig, host }" }],
  pitfalls: ["Observation ids are unique; duplicates aren't deduplicated — caller is responsible."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const o = core.infraBrain.recordObservation({
      kind: String(args["kind"]) as Parameters<typeof core.infraBrain.recordObservation>[0]["kind"],
      subject: String(args["subject"]),
      detail: String(args["detail"]),
      ...(args["metric"] ? { metric: args["metric"] as Parameters<typeof core.infraBrain.recordObservation>[0]["metric"] } : {}),
      ...(args["tags"] ? { tags: (args["tags"] as unknown[]).map(String) } : {}),
      ...(args["host"] ? { host: String(args["host"]) } : {}),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return { data: o, wisdom: `OBS · ${o.kind}/${o.subject} · ${o.id}`, confidence: { level: "high" } };
  },
};

export const infraDiagnoseTool: MnemeTool = {
  name: "mneme.infra.diagnose",
  category: "meta",
  description:
    "INFRA AS AI diagnose — given a current symptom (subject + detail), search past observations for similar patterns. Returns top hypotheses + recurring-pattern flag + rationale.",
  whenToUse: "When a new alert fires: 'have we seen this before?' — answers in <50ms locally with no LLM.",
  triggers: ["diagnose infra", "have we seen this"],
  inputSchema: {
    type: "object",
    properties: {
      subject: { type: "string" },
      detail: { type: "string" },
      repoDir: { type: "string" },
    },
    required: ["subject", "detail"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Have we seen this auth lag?", args: { subject: "auth-service", detail: "p99 latency spike" }, expectedOutput: "{ hypotheses, recurring, rationale }" }],
  pitfalls: ["Empty corpus returns no hypotheses — the diagnoser is honest about novelty."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.infraBrain.diagnose({
      subject: String(args["subject"]),
      detail: String(args["detail"]),
      ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}),
    });
    return {
      data: r,
      wisdom: r.recurring
        ? `DIAGNOSE · recurring (${r.recurring.count}× ${r.recurring.window ?? "irregular"})`
        : `DIAGNOSE · ${r.hypotheses.length} hypothesis(es)`,
      confidence: { level: r.hypotheses.length > 0 || r.recurring ? "medium" : "low" },
    };
  },
};

export const infraDigestTool: MnemeTool = {
  name: "mneme.infra.digest",
  category: "meta",
  description:
    "INFRA AS AI gossip — export an HMAC-signed digest of this host's patterns, suitable for sharing with peer hosts. Use mneme.infra.ingest on the receiver to learn from the peer.",
  whenToUse: "Periodic gossip exchange between Mneme-managed hosts. Build a distributed infra memory without a central server.",
  triggers: ["export digest", "infra gossip"],
  inputSchema: { type: "object", properties: { repoDir: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Share my infra patterns", args: {}, expectedOutput: "{ host, patterns, sig }" }],
  pitfalls: ["Shared secret (env MNEME_INFRA_SECRET) must match across the peer set; otherwise sigs won't verify."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.infraBrain.exportDigest({ ...(args["repoDir"] ? { repoDir: String(args["repoDir"]) } : {}) });
    return { data: d, wisdom: `DIGEST · ${d.host} · ${d.observationCount} obs · ${d.patterns.length} patterns`, confidence: { level: "high" } };
  },
};

export const V214_PENTAD_TOOLS: MnemeTool[] = [
  // PROJECT SOUL (3)
  soulInitTool, soulAddRuleTool, soulCheckTool,
  // MNEMOSYNE BOUNTY (3)
  bountyClaimTool, bountyVerdictTool, bountyLeaderboardTool,
  // MNEME REPLICA (2)
  replicaRecordTool, replicaConsultTool,
  // KILL SWITCH PROTOCOL (4)
  complianceKillSwitchTool, complianceShouldRespondTool, complianceDlpTool, complianceAuditExportTool,
  // INFRA AS AI (3)
  infraObserveTool, infraDiagnoseTool, infraDigestTool,
];
