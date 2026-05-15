/**
 * v2.18.0 REVENUE-PRIMITIVE PENTAD — MCP tools.
 *
 *   ARENA            — mneme.arena.*
 *   VERIFIED BADGE   — mneme.badge.*
 *   ORACLE LIABILITY — mneme.oracle.*
 *   NEXUS PROACTIVE  — mneme.nexus.*  (Reverse MCP push notifier)
 */

import type { MnemeTool } from "./_types.js";

// ─── ARENA ─────────────────────────────────────────────────────────────
export const arenaJudgeTool: MnemeTool = {
  name: "mneme.arena.judge",
  category: "lab",
  description:
    "ARENA 🏆 — judge N AI-vendor responses against expectedFacts. Returns ranked composite + winner + HMAC-signed match verdict. Brevity-aware, cost-tiebreaker, regex-checked. The public AI showdown.",
  whenToUse: "You polled multiple vendors for the same prompt; want a tamper-evident verdict on which won.",
  triggers: ["arena judge", "vendor showdown", "compare vendors"],
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      taskClass: { type: "string" },
      expectedFacts: { type: "array" },
      responses: { type: "array" },
      ts: { type: "string" },
    },
    required: ["prompt", "taskClass", "expectedFacts", "responses"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Run an ARENA match on this fact-check prompt",
    args: { prompt: "what is 2+2", taskClass: "fact_check", expectedFacts: [], responses: [] },
    expectedOutput: "{ matchId, scored, winner, margin, headline, sig }",
  }],
  pitfalls: ["expectedFacts must be VERIFIABLE; vague descriptions produce vague verdicts."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.arena.judgeMatch({
      prompt: String(args["prompt"]),
      taskClass: args["taskClass"] as Parameters<typeof core.arena.judgeMatch>[0]["taskClass"],
      expectedFacts: args["expectedFacts"] as Parameters<typeof core.arena.judgeMatch>[0]["expectedFacts"],
      responses: args["responses"] as Parameters<typeof core.arena.judgeMatch>[0]["responses"],
      ...(args["ts"] ? { ts: String(args["ts"]) } : {}),
    });
    return { data: v, wisdom: core.arena.formatArenaLine(v), confidence: { level: "high" } };
  },
};

export const arenaLeaderboardTool: MnemeTool = {
  name: "mneme.arena.leaderboard",
  category: "lab",
  description:
    "ARENA 🏆 — aggregate signed match verdicts into a per-day vendor leaderboard. Win rate + mean composite + total margin per vendor.",
  whenToUse: "Daily public scoreboard render or weekly digest.",
  triggers: ["arena leaderboard", "daily scoreboard"],
  inputSchema: { type: "object", properties: { verdicts: { type: "array" }, day: { type: "string" } }, required: ["verdicts"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build today's vendor leaderboard", args: { verdicts: [] }, expectedOutput: "{ day, rows: [{ vendor, wins, winRate, ... }] }" }],
  pitfalls: ["Filter your verdict pool first; leaderboard only counts the day passed in."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.arena.dailyLeaderboard({
      verdicts: args["verdicts"] as Parameters<typeof core.arena.dailyLeaderboard>[0]["verdicts"],
      ...(args["day"] ? { day: String(args["day"]) } : {}),
    });
    return { data: r, wisdom: `ARENA leaderboard ${r.day}: ${r.rows.length} vendors`, confidence: { level: "high" } };
  },
};

// ─── VERIFIED BADGE ────────────────────────────────────────────────────
export const badgeIssueTool: MnemeTool = {
  name: "mneme.badge.issue",
  category: "lab",
  description:
    "BADGE 🛡 — issue a 90-day MNEME VERIFIED tier (PLATINUM/GOLD/SILVER/BRONZE/FAIL) from a measured falseRateLB + sample size. HMAC-signed cert + tier-locked.",
  whenToUse: "Vendor passed the BOUNTY/OBELISK gate and wants to display the badge.",
  triggers: ["badge issue", "verified badge", "tier certificate"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      displayName: { type: "string" },
      falseRateLB: { type: "number" },
      totalVerdicts: { type: "number" },
      issuedAt: { type: "string" },
      validityDays: { type: "number" },
    },
    required: ["vendor", "displayName", "falseRateLB", "totalVerdicts"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Issue Anthropic Claude a Verified Badge", args: { vendor: "claude", displayName: "Anthropic Claude", falseRateLB: 0.04, totalVerdicts: 1500 }, expectedOutput: "{ tier: 'gold', certId, sig, ... }" }],
  pitfalls: ["Caller cannot pick the tier — it's derived from the inputs. FAIL tier is rejected by verify."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const b = core.verifiedBadge.issueBadge({
      vendor: String(args["vendor"]),
      displayName: String(args["displayName"]),
      falseRateLB: Number(args["falseRateLB"]),
      totalVerdicts: Number(args["totalVerdicts"]),
      ...(args["issuedAt"] ? { issuedAt: String(args["issuedAt"]) } : {}),
      ...(args["validityDays"] ? { validityDays: Number(args["validityDays"]) } : {}),
    });
    return { data: b, wisdom: core.verifiedBadge.formatBadgeLine(b), confidence: { level: "high" } };
  },
};

export const badgeVerifyTool: MnemeTool = {
  name: "mneme.badge.verify",
  category: "lab",
  description:
    "BADGE 🛡 — verify any MNEME VERIFIED badge: sig + expiry + tier ≠ fail. Anyone can verify; the secret is only needed to issue.",
  whenToUse: "Marketing page renders a competitor's badge — confirm before trusting.",
  triggers: ["badge verify", "validate badge"],
  inputSchema: { type: "object", properties: { badge: { type: "object" } }, required: ["badge"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this badge bundle", args: { badge: {} }, expectedOutput: "{ ok, expired, reason? }" }],
  pitfalls: ["A 'sig mismatch' result means tampered OR wrong key — both are reasons not to trust."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.verifiedBadge.verifyBadge(args["badge"] as Parameters<typeof core.verifiedBadge.verifyBadge>[0]);
    return { data: r, wisdom: r.ok ? "BADGE 🛡 verified" : `BADGE rejected: ${r.reason}`, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const badgeSvgTool: MnemeTool = {
  name: "mneme.badge.svg",
  category: "lab",
  description:
    "BADGE 🛡 — render a 240×60 embed-safe SVG of a verified badge (escaped vendor name, tier color, certId visible).",
  whenToUse: "Vendor wants to drop the badge on a landing page or README.",
  triggers: ["badge svg", "render badge"],
  inputSchema: { type: "object", properties: { badge: { type: "object" } }, required: ["badge"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Give me the SVG for this badge", args: { badge: {} }, expectedOutput: "{ svg: '<svg ...' }" }],
  pitfalls: ["Vendor name is escaped — your raw HTML cannot inject through the SVG."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const svg = core.verifiedBadge.badgeSvg(args["badge"] as Parameters<typeof core.verifiedBadge.badgeSvg>[0]);
    return { data: { svg }, wisdom: "BADGE 🛡 SVG rendered (240×60)", confidence: { level: "high" } };
  },
};

// ─── ORACLE LIABILITY ──────────────────────────────────────────────────
export const oracleAssessRiskTool: MnemeTool = {
  name: "mneme.oracle.assess_risk",
  category: "lab",
  description:
    "ORACLE 🔬 — fuse BUG PROPHET + SOUL + AURELIAN + BOUNTY + category multiplier into 0..1 liability risk + insurable verdict.",
  whenToUse: "Before committing a high-stakes change; before issuing an ORACLE certificate.",
  triggers: ["oracle assess", "risk score", "insurability"],
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string" },
      aurelianComposite: { type: "number" },
      soulVerdict: { type: "string", enum: ["PASS", "WARN", "BLOCK"] },
      bugProphetRisk: { type: "number" },
      vendorFalseRateLB: { type: "number" },
      category: { type: "string" },
    },
    required: ["description"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's the risk on this migration?", args: { description: "drop nullable on user_email", soulVerdict: "WARN", bugProphetRisk: 0.4 }, expectedOutput: "{ riskScore, band, insurable, reasons }" }],
  pitfalls: ["BLOCK SOUL forces uninsurable; don't try to bypass."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.oracleLiability.assessRisk(args as unknown as Parameters<typeof core.oracleLiability.assessRisk>[0]);
    return { data: r, wisdom: `ORACLE risk=${r.riskScore} (${r.band}) — insurable=${r.insurable}`, confidence: { level: r.insurable ? "high" : "low" } };
  },
};

export const oracleIssueCertificateTool: MnemeTool = {
  name: "mneme.oracle.issue_certificate",
  category: "lab",
  description:
    "ORACLE 🔬 — issue HMAC-signed liability certificate (per-incident cap + annual aggregate cap + voiding conditions). Refuses if risk ≥ 0.5 or SOUL=BLOCK.",
  whenToUse: "Subscriber on a paid Mneme tier ships a change and wants underwriting cover.",
  triggers: ["oracle issue", "liability cert"],
  inputSchema: {
    type: "object",
    properties: {
      subscriber: { type: "string" },
      tier: { type: "string", enum: ["starter", "team", "business", "enterprise", "sovereign"] },
      change: { type: "object" },
      issuedAt: { type: "string" },
      validityDays: { type: "number" },
    },
    required: ["subscriber", "tier", "change"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Issue Acme a team-tier cert for this change", args: { subscriber: "acme", tier: "team", change: {} }, expectedOutput: "{ issued: { certId, sig, perIncidentCapUsd, ... } } | { issued: null, reason }" }],
  pitfalls: ["A null `issued` is not a bug — it means the change failed underwriting."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.oracleLiability.issueCertificate(args as unknown as Parameters<typeof core.oracleLiability.issueCertificate>[0]);
    return {
      data: r,
      wisdom: r.issued ? core.oracleLiability.formatOracleLine(r.issued) : `ORACLE refused: ${r.reason}`,
      confidence: { level: r.issued ? "high" : "low" },
    };
  },
};

export const oracleDecideClaimTool: MnemeTool = {
  name: "mneme.oracle.decide_claim",
  category: "lab",
  description:
    "ORACLE 🔬 — decide approved/partial/denied + payout USD given an incident loss + cert + aggregate paid YTD. Verifies cert sig first.",
  whenToUse: "Incident occurred; subscriber filing under an active cert.",
  triggers: ["oracle claim", "decide claim"],
  inputSchema: {
    type: "object",
    properties: {
      cert: { type: "object" },
      estimatedLossUsd: { type: "number" },
      incidentDescription: { type: "string" },
      conditionsBreached: { type: "array" },
      aggregatePaidYtdUsd: { type: "number" },
    },
    required: ["cert", "estimatedLossUsd", "incidentDescription"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Decide a $5k claim under this cert", args: { cert: {}, estimatedLossUsd: 5000, incidentDescription: "x" }, expectedOutput: "{ decision, payoutUsd, reasons, sig }" }],
  pitfalls: ["A breached condition denies the entire claim — be honest."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.oracleLiability.decideClaim(args as unknown as Parameters<typeof core.oracleLiability.decideClaim>[0]);
    return { data: d, wisdom: `ORACLE claim · ${d.decision} · $${d.payoutUsd.toLocaleString()}`, confidence: { level: "high" } };
  },
};

// ─── NEXUS PROACTIVE ───────────────────────────────────────────────────
export const nexusSubscribeTool: MnemeTool = {
  name: "mneme.nexus.subscribe",
  category: "lab",
  description:
    "NEXUS 📡 — Reverse MCP. AI agent subscribes to a fact (file_content / symbol_location / soul_rule / vendor_score / stat_threshold). Mneme will queue a stale_claim notification when the fact changes.",
  whenToUse: "AI just stated a fact about the repo — subscribe so it gets corrected when the fact moves.",
  triggers: ["nexus subscribe", "watch fact", "reverse mcp"],
  inputSchema: {
    type: "object",
    properties: {
      subscriber: { type: "string" },
      kind: { type: "string", enum: ["file_content", "symbol_location", "stat_threshold", "vendor_score", "soul_rule"] },
      factKey: { type: "string" },
      knownValue: { type: "string" },
      ttlSeconds: { type: "number" },
    },
    required: ["subscriber", "kind", "factKey", "knownValue"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Watch src/foo.ts:42 for the function I cited", args: { subscriber: "claude", kind: "symbol_location", factKey: "calculateTotal", knownValue: "src/foo.ts:42" }, expectedOutput: "{ subId, sig, ... }" }],
  pitfalls: ["Subscriptions auto-expire (default 24h); re-subscribe between sessions."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.nexusProactive.defaultNexus().registerSubscription({
      subscriber: String(args["subscriber"]),
      kind: args["kind"] as Parameters<typeof core.nexusProactive.NexusProactive.prototype.registerSubscription>[0]["kind"],
      factKey: String(args["factKey"]),
      knownValue: String(args["knownValue"]),
      ...(args["ttlSeconds"] ? { ttlSeconds: Number(args["ttlSeconds"]) } : {}),
    });
    return { data: s, wisdom: `NEXUS 📡 subscribed: ${s.subscriber} → ${s.kind}/${s.factKey}`, confidence: { level: "high" } };
  },
};

export const nexusPublishObservationTool: MnemeTool = {
  name: "mneme.nexus.publish_observation",
  category: "lab",
  description:
    "NEXUS 📡 — daemon / IDE plugin / AI itself publishes a fact value. Mneme diffs against subscriptions and queues stale_claim notifications.",
  whenToUse: "File-watch / git-pre-commit hook / on every meaningful repo event.",
  triggers: ["nexus publish", "report observation"],
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["file_content", "symbol_location", "stat_threshold", "vendor_score", "soul_rule"] },
      factKey: { type: "string" },
      value: { type: "string" },
      observedAt: { type: "string" },
    },
    required: ["kind", "factKey", "value"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Report that src/foo.ts changed sha", args: { kind: "file_content", factKey: "src/foo.ts", value: "abc123" }, expectedOutput: "{ emitted: [{ notifId, severity, oldValue, newValue, sig }] }" }],
  pitfalls: ["This is the WRITE side of NEXUS; do not call it from the AI being notified — call from the daemon or hook."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const emitted = core.nexusProactive.defaultNexus().publishObservation({
      kind: args["kind"] as Parameters<typeof core.nexusProactive.NexusProactive.prototype.publishObservation>[0]["kind"],
      factKey: String(args["factKey"]),
      value: String(args["value"]),
      ...(args["observedAt"] ? { observedAt: String(args["observedAt"]) } : {}),
    });
    return { data: { emitted }, wisdom: `NEXUS 📡 emitted ${emitted.length} stale_claim notif(s)`, confidence: { level: "high" } };
  },
};

export const nexusDrainTool: MnemeTool = {
  name: "mneme.nexus.drain",
  category: "lab",
  description:
    "NEXUS 📡 — AI agent drains queued notifications for its subscriber-id. Each is HMAC-signed + monotonic. Severity ≥4 means MUST ACK before continuing.",
  whenToUse: "Top of every prompt cycle — flush before answering, treat as authoritative override.",
  triggers: ["nexus drain", "check notifications", "any updates"],
  inputSchema: { type: "object", properties: { subscriber: { type: "string" } }, required: ["subscriber"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Any updates for me?", args: { subscriber: "claude" }, expectedOutput: "{ notifications: [{ notifId, kind, oldValue, newValue, severity, message, sig }] }" }],
  pitfalls: ["Drain is destructive — once read, the notif leaves the queue. Persist or ack it."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const notifications = core.nexusProactive.defaultNexus().drainNotifications(String(args["subscriber"]));
    return { data: { notifications }, wisdom: `NEXUS 📡 drained ${notifications.length} notif(s)`, confidence: { level: "high" } };
  },
};

export const nexusAckTool: MnemeTool = {
  name: "mneme.nexus.ack",
  category: "lab",
  description:
    "NEXUS 📡 — AI acks a notification with optional restated understanding. Un-acked sev-≥4 surface louder over time.",
  whenToUse: "AI updated its mental model after a stale_claim; closes the loop.",
  triggers: ["nexus ack", "acknowledge"],
  inputSchema: {
    type: "object",
    properties: {
      notifId: { type: "string" },
      subscriber: { type: "string" },
      restatement: { type: "string" },
    },
    required: ["notifId", "subscriber"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Ack notification n-abc123", args: { notifId: "n-abc123", subscriber: "claude", restatement: "got it, foo is now at line 80" }, expectedOutput: "{ notifId, ackedAt, sig }" }],
  pitfalls: ["An ack without a restatement still records, but is weaker evidence the AI really updated."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const a = core.nexusProactive.defaultNexus().acknowledge({
      notifId: String(args["notifId"]),
      subscriber: String(args["subscriber"]),
      ...(args["restatement"] ? { restatement: String(args["restatement"]) } : {}),
    });
    return { data: a, wisdom: `NEXUS 📡 ack recorded for ${a.notifId}`, confidence: { level: "high" } };
  },
};

export const V218_REVOLUTIONARY_TOOLS: MnemeTool[] = [
  arenaJudgeTool, arenaLeaderboardTool,
  badgeIssueTool, badgeVerifyTool, badgeSvgTool,
  oracleAssessRiskTool, oracleIssueCertificateTool, oracleDecideClaimTool,
  nexusSubscribeTool, nexusPublishObservationTool, nexusDrainTool, nexusAckTool,
];
