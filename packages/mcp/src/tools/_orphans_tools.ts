/**
 * v2.5.0 -- MCP wrappers for the 12 v2.0 / v2.1 wild-idea modules that
 * had no MCP surface (audit flagged them as "orphans"). Each tool here
 * exposes the module's headline function to AI agents. The modules
 * themselves are unchanged — only their visibility changes.
 *
 * Modules wrapped: mutiny / prophet / prophecy / dream / wisdom_shards /
 * necromancy / interstellar / adversarial_twins / living_will /
 * timeriver / recursive_soul / holy.
 *
 * Design notes:
 *   - Each tool is read-only or pure-functional; nothing here writes
 *     ambient filesystem state unless the underlying module already did.
 *   - Each handler does dynamic `import("@mneme-ai/core")` so the MCP
 *     server stays modular.
 *   - Confidence level reflects the maturity of the underlying module:
 *     wild ideas with limited bench coverage → "medium" or "low".
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

function hexToBuffer(s: unknown): Buffer {
  const str = typeof s === "string" ? s : "";
  // Accept hex or raw utf8; never throws.
  if (/^[0-9a-f]+$/i.test(str) && str.length % 2 === 0) return Buffer.from(str, "hex");
  return Buffer.from(str, "utf8");
}

export const mutinyCheckTool: MnemeTool = {
  name: "mneme.mutiny.check",
  category: "audit",
  description:
    "MUTINY -- evaluate whether a request matches a documented historical regret pattern. AI with a spine: refuses with rationale instead of complying when severity is high.",
  whenToUse: "Before executing any non-trivial action (refactor / delete / dep bump) — surface regret matches.",
  triggers: ["check mutiny", "did we regret this", "block dangerous"],
  inputSchema: {
    type: "object",
    properties: {
      request: { type: "string" },
      regretHistory: { type: "array" },
      acknowledgement: { type: "string" },
    },
    required: ["request"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should we add Redis again?", args: { request: "switch sessions to Redis", regretHistory: [] }, expectedOutput: "{ verdict: 'APPROVE'|'WARN'|'BLOCK', rationale }" }],
  pitfalls: ["Empty regret history → always APPROVE. Wire a real regret source for the real signal."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.mutiny.evaluateRequest({
      request: String(args["request"] ?? ""),
      regretHistory: (args["regretHistory"] as Parameters<typeof core.mutiny.evaluateRequest>[0]["regretHistory"]) ?? [],
      acknowledgement: args["acknowledgement"] ? String(args["acknowledgement"]) : undefined,
    });
    return { data: r, wisdom: core.mutiny.formatMutinyPulseLine(r), confidence: { level: "medium" } };
  },
};

export const prophetPredictTool: MnemeTool = {
  name: "mneme.prophet.predict",
  category: "insights",
  description:
    "PROPHET -- predict the user's next K queries given the current query and last AI reply, then pre-warm hydration tasks for each prediction.",
  whenToUse: "Right after the AI ships an answer — pre-fetch retrieval / pre-compile prompts for the likely follow-up before the user even types.",
  triggers: ["predict next query", "prophet", "what will user ask"],
  inputSchema: {
    type: "object",
    properties: {
      currentQuery: { type: "string" },
      lastAiReply: { type: "string" },
      topK: { type: "integer" },
      timeBudgetMs: { type: "integer" },
    },
    required: ["currentQuery", "lastAiReply"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Pre-warm next 3 queries", args: { currentQuery: "why X?", lastAiReply: "because Y", topK: 3 }, expectedOutput: "{ prediction, prewarmed, pulseLine }" }],
  pitfalls: ["Top-K is best-effort. Treat predictions as priors, not certainty."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.prophet.prophesyAndPrewarm({
      currentQuery: String(args["currentQuery"] ?? ""),
      lastAiReply: String(args["lastAiReply"] ?? ""),
      topK: (args["topK"] as number | undefined) ?? 3,
      timeBudgetMs: (args["timeBudgetMs"] as number | undefined) ?? 5000,
    });
    return { data: r, wisdom: core.prophet.formatProphetPulseLine(r), confidence: { level: "medium" } };
  },
};

export const prophecyReadTool: MnemeTool = {
  name: "mneme.prophecy.read",
  category: "insights",
  description:
    "PROPHECY LETTERS -- HMAC-signed time-locked cross-version messages. Read a sealed prophecy from a previous Mneme version once its unlock time arrives.",
  whenToUse: "Periodically, to see if any predecessor sealed a forecast for the current version window.",
  triggers: ["read prophecy", "unseal prophecy", "predecessor message"],
  inputSchema: { type: "object", properties: { prophecy: { type: "object" }, secret: { type: "string" }, currentVersion: { type: "string" } }, required: ["prophecy", "secret", "currentVersion"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Read prophecy", args: { prophecy: {}, secret: "...", currentVersion: "2.5.0" }, expectedOutput: "{ verdict, body }" }],
  pitfalls: ["INVALID_HMAC means the secret is wrong or the body was tampered with. PREMATURE means the unlock window hasn't opened yet."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.prophecy.unsealProphecy({
      prophecy: args["prophecy"] as Parameters<typeof core.prophecy.unsealProphecy>[0]["prophecy"],
      secret: hexToBuffer(args["secret"]),
      currentVersion: String(args["currentVersion"] ?? ""),
    });
    return { data: r, wisdom: `prophecy verdict=${r.verdict}`, confidence: { level: "high" } };
  },
};

export const dreamRunTool: MnemeTool = {
  name: "mneme.dream.vaccine_cycle",
  category: "audit",
  description:
    "DREAM CYCLE (vaccine variant) -- REM-sleep adversarial vaccine simulation. Survivors gain fitness; missed hallucinations spawn variants. Returns updated vaccine candidates. (Distinct from mneme.dream.run which is v2.19.7 DREAM CONSOLIDATION over axioms.)",
  whenToUse: "Nightly via the daemon, or manually when you want to refresh the vaccine population.",
  triggers: ["run dream cycle", "rem sleep", "vaccine refresh"],
  inputSchema: { type: "object", properties: { vaccines: { type: "array" }, samples: { type: "array" }, seed: { type: "integer" } }, required: ["vaccines", "samples"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run dream cycle", args: { vaccines: [], samples: [] }, expectedOutput: "{ survivors, variants, score }" }],
  pitfalls: ["Empty inputs produce a neutral score; only meaningful with real vaccine + hallucination corpora."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dream.dreamPhase({
      vaccines: (args["vaccines"] as Parameters<typeof core.dream.dreamPhase>[0]["vaccines"]) ?? [],
      samples: (args["samples"] as Parameters<typeof core.dream.dreamPhase>[0]["samples"]) ?? [],
      seed: args["seed"] as number | undefined,
    });
    return { data: r, wisdom: core.dream.formatDreamPulseLine(r), confidence: { level: "medium" } };
  },
};

export const wisdomShardsAppendTool: MnemeTool = {
  name: "mneme.wisdom_shards.append",
  category: "audit",
  description:
    "WISDOM SHARDS -- append a proof-of-truth entry to the HMAC-chained ledger. Each shard is tamper-evident: a single edit breaks the chain at that point.",
  whenToUse: "When you want a cryptographically-auditable trail of accounting actions (mint = increase balance; burn = decrease).",
  triggers: ["append wisdom", "log shard", "proof of truth"],
  inputSchema: {
    type: "object",
    properties: {
      ledger: { type: "array" },
      secret: { type: "string", description: "hex-encoded HMAC key" },
      kind: { type: "string", enum: ["mint", "burn"] },
      value: { type: "integer" },
      reason: { type: "string" },
      citation: { type: "string" },
    },
    required: ["secret", "kind", "value", "reason"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mint 5 shards for a verified claim", args: { secret: "hex", kind: "mint", value: 5, reason: "verified X" }, expectedOutput: "{ ledger, entry }" }],
  pitfalls: ["Secret must persist across calls or the ledger becomes unverifiable. Re-use the same HMAC key for every append + verify."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const secretBuf = hexToBuffer(args["secret"]);
    const ledger = (args["ledger"] as Parameters<typeof core.wisdomShards.balanceOf>[0]) ?? core.wisdomShards.createLedger(secretBuf);
    const r = core.wisdomShards.appendShard({
      ledger,
      secret: secretBuf,
      kind: (args["kind"] as "mint" | "burn") ?? "mint",
      value: Number(args["value"] ?? 1) | 0,
      reason: String(args["reason"] ?? "unspecified"),
      citation: args["citation"] ? String(args["citation"]) : undefined,
    });
    return { data: r, wisdom: `appended shard chainHash=${r.entry.chainHash.slice(0, 12)}`, confidence: { level: "high" } };
  },
};

export const necromancyFingerprintTool: MnemeTool = {
  name: "mneme.necromancy.fingerprint",
  category: "people",
  description:
    "NECROMANCY -- extract a stylometric fingerprint from a sample of an author's writing (commit messages, AI chats). Compare with another fingerprint to estimate author similarity.",
  whenToUse: "Cross-vendor identity check; or anomaly detection when an AI's style suddenly shifts.",
  triggers: ["extract style", "fingerprint author", "necromancy"],
  inputSchema: { type: "object", properties: { vendorLabel: { type: "string" }, samples: { type: "array", items: { type: "string" } } }, required: ["vendorLabel", "samples"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Fingerprint Claude's style", args: { vendorLabel: "claude", samples: ["..."] }, expectedOutput: "{ fingerprint, prefix }" }],
  pitfalls: ["MVP module — reliable only with ≥20 samples per author. Treat as a heuristic, not biometric ID."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const fp = core.necromancy.extractStyleFingerprint(String(args["vendorLabel"] ?? "unknown"), (args["samples"] as string[]) ?? []);
    return { data: { fingerprint: fp, promptPrefix: core.necromancy.styleAsPromptPrefix(fp) }, wisdom: `style fingerprint for ${fp.vendorLabel}`, confidence: { level: "low", notes: "MVP — needs ≥20 samples per author for stable signal." } };
  },
};

export const interstellarCompressTool: MnemeTool = {
  name: "mneme.interstellar.compress",
  category: "memory",
  description:
    "INTERSTELLAR -- compress a year of wisdom events into a 4 KB packet suitable for high-latency channels (LoRa / sat / brain transfer).",
  whenToUse: "Cross-machine wisdom transfer over a constrained link; cold-storage of a year's lessons.",
  triggers: ["compress wisdom", "4kb packet", "interstellar"],
  inputSchema: { type: "object", properties: { events: { type: "array" }, secret: { type: "string" } }, required: ["events", "secret"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Compress this year", args: { events: [], secret: "hex" }, expectedOutput: "{ packet, integrity, pulseLine }" }],
  pitfalls: ["Lossy — the goal is 4 KB, not lossless. Use the FULL store for the source of truth."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const packet = core.interstellar.compressYearOfWisdom({
      events: (args["events"] as Parameters<typeof core.interstellar.compressYearOfWisdom>[0]["events"]) ?? [],
      secret: hexToBuffer(args["secret"]),
    });
    return { data: packet, wisdom: core.interstellar.formatInterstellarPulseLine(packet), confidence: { level: "medium" } };
  },
};

export const adversarialTwinsTool: MnemeTool = {
  name: "mneme.adversarial_twins.debate",
  category: "audit",
  description:
    "ADVERSARIAL TWINS -- two Mneme instances debate a claim from opposing priors and surface the disagreement. Higher disagreement = more uncertainty.",
  whenToUse: "Before high-stakes verdicts where a single instance might be over-confident.",
  triggers: ["twin debate", "adversarial check", "two minds"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      positionA: { type: "string" },
      positionB: { type: "string" },
      evidence: { type: "array" },
      priorA: { type: "number" },
      priorB: { type: "number" },
    },
    required: ["claim", "positionA", "positionB"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Twin-debate this claim", args: { claim: "X is true", positionA: "supports X", positionB: "refutes X", evidence: [] }, expectedOutput: "{ verdict, disagreement, pulseLine }" }],
  pitfalls: ["No-evidence inputs default to maximum uncertainty. Wire real evidence from both sides for the real signal."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.adversarialTwins.twinDebate({
      claim: String(args["claim"] ?? ""),
      positionA: String(args["positionA"] ?? "supports"),
      positionB: String(args["positionB"] ?? "refutes"),
      evidence: (args["evidence"] as Parameters<typeof core.adversarialTwins.twinDebate>[0]["evidence"]) ?? [],
      priorA: args["priorA"] as number | undefined,
      priorB: args["priorB"] as number | undefined,
    });
    return { data: r, wisdom: core.adversarialTwins.formatTwinDebatePulseLine(r), confidence: { level: "medium" } };
  },
};

export const livingWillCreateTool: MnemeTool = {
  name: "mneme.living_will.create",
  category: "meta",
  description:
    "LIVING WILL -- create a cryptographic dead-man envelope. After N days of inactivity the will auto-releases its payload to its named beneficiaries.",
  whenToUse: "Continuity planning — succession of credentials, knowledge handoff, or scheduled release.",
  triggers: ["living will", "dead man switch", "continuity envelope"],
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string" },
      encryptedPayload: { type: "string", description: "hex-encoded ciphertext" },
      inactivityDays: { type: "integer" },
      secret: { type: "string", description: "hex-encoded HMAC key" },
    },
    required: ["description", "encryptedPayload", "secret"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Create living will", args: { description: "team continuity", encryptedPayload: "abcd...", inactivityDays: 30, secret: "hex" }, expectedOutput: "{ will: { id, releaseAfter } }" }],
  pitfalls: ["Secret governs release; lose it and the will is unrevocable + unreadable. Store the secret offline."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.livingWill.createLivingWill({
      description: String(args["description"] ?? ""),
      encryptedPayload: hexToBuffer(args["encryptedPayload"]),
      inactivityDays: (args["inactivityDays"] as number | undefined) ?? 30,
      secret: hexToBuffer(args["secret"]),
    });
    return { data: r, wisdom: `living will created id=${r.id}`, confidence: { level: "high" } };
  },
};

export const timeriverCounterfactualTool: MnemeTool = {
  name: "mneme.timeriver.counterfactual",
  category: "insights",
  description:
    "TIMERIVER -- rewind the repo to a historical anchor and answer a counterfactual question (\"what if we hadn't shipped X?\").",
  whenToUse: "Post-mortem; pre-rollback decision; learning loop after a release.",
  triggers: ["counterfactual", "what if", "rewind history"],
  inputSchema: { type: "object", properties: { anchor: { type: "string" }, question: { type: "string" } }, required: ["anchor"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What if we hadn't shipped v1.5?", args: { anchor: "v1.5.0", question: "regression?" }, expectedOutput: "{ answer, evidence }" }],
  pitfalls: ["Heuristic — uses git log, not a true causal model. Treat as a thinking aid, not a forecast."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.timeriver.counterfactual(repoRootOf(rt), String(args["anchor"] ?? "HEAD"), args["question"] ? String(args["question"]) : undefined);
    return { data: r, wisdom: `counterfactual @ ${args["anchor"]}`, confidence: { level: "low", notes: "Heuristic over git log; not a causal model." } };
  },
};

export const recursiveSoulListTool: MnemeTool = {
  name: "mneme.recursive_soul.list_reviews",
  category: "audit",
  description:
    "RECURSIVE SOUL -- list AI sessions that are eligible for cross-session review (one AI auditing another's earlier work).",
  whenToUse: "Before a multi-vendor consensus pass; choose which session another AI should review.",
  triggers: ["recursive soul", "cross-vendor review", "list reviewable"],
  inputSchema: { type: "object", properties: { currentVendor: { type: "string" } }, required: ["currentVendor"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What can I review?", args: { currentVendor: "claude" }, expectedOutput: "{ reviewable: [{ vendor, sessionId, ts }] }" }],
  pitfalls: ["Only surfaces sessions actually persisted to disk. Empty store ⇒ empty list."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.recursiveSoul.listReviewableSessions(repoRootOf(rt), String(args["currentVendor"] ?? "unknown"));
    return { data: { reviewable: r }, wisdom: `${r.length} reviewable session(s)`, confidence: { level: "high" } };
  },
};

export const holyHeartbeatTool: MnemeTool = {
  name: "mneme.holy.heartbeat",
  category: "quality",
  description:
    "HOLY HEARTBEAT -- compute a multi-axis pulse snapshot from the current repo MRI; used as a baseline for circadian deviation detection.",
  whenToUse: "Once per day from the daemon; or on demand when you want a snapshot of repo health.",
  triggers: ["holy heartbeat", "pulse baseline", "circadian"],
  inputSchema: { type: "object", properties: { mri: { type: "object" } }, required: ["mri"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Heartbeat now", args: { mri: {} }, expectedOutput: "{ snapshot }" }],
  pitfalls: ["A single snapshot is not a baseline — call computeBaseline over ≥7 days for the real signal."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const snap = core.holy.snapshotFromMri((args["mri"] as Parameters<typeof core.holy.snapshotFromMri>[0]) ?? ({} as never));
    return { data: { snapshot: snap }, wisdom: `holy heartbeat snapshot recorded`, confidence: { level: "medium" } };
  },
};

export const ORPHANS_TOOLS: MnemeTool[] = [
  mutinyCheckTool,
  prophetPredictTool,
  prophecyReadTool,
  dreamRunTool,
  wisdomShardsAppendTool,
  necromancyFingerprintTool,
  interstellarCompressTool,
  adversarialTwinsTool,
  livingWillCreateTool,
  timeriverCounterfactualTool,
  recursiveSoulListTool,
  holyHeartbeatTool,
];
