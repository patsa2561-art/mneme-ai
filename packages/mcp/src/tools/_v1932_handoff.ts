/**
 * v2.19.32 BEACON HANDOFF — MCP tools (Parent → QR → Child device brain transfer)
 *
 *   HANDOFF SNAPSHOT (4):
 *     mneme.handoff.snapshot       — compose fresh-context envelope
 *     mneme.handoff.verify         — receiver HMAC verify
 *     mneme.handoff.freshness      — receiver TTL gate
 *     mneme.handoff.render         — markdown body for child vendor paste
 *
 *   PAIR CODE (5):
 *     mneme.handoff.pair_generate  — fresh 6-char human-friendly code
 *     mneme.handoff.pair_bind      — bind code to envelope HMAC
 *     mneme.handoff.pair_lookup    — receiver lookup (with TTL + one-shot gates)
 *     mneme.handoff.pair_mark_used — one-shot enforcement
 *     mneme.handoff.sas_emoji      — 4-emoji visual MITM verifier
 *
 *   HANDOFF PWA (1):
 *     mneme.handoff.pwa_html       — device-adaptive HTML page generator
 *
 *   CONSCIOUSNESS FORK (4):
 *     mneme.fork.record            — record parent→child fork event
 *     mneme.fork.reconcile         — mark fork merged back via SYNAPSE SYNC
 *     mneme.fork.find_descendants  — list active descendants of a parent
 *     mneme.fork.verify_ledger     — HMAC-chain integrity check
 */

import type { MnemeTool } from "./_types.js";

// ─── HANDOFF SNAPSHOT ──────────────────────────────────────────────────

export const handoffSnapshotTool: MnemeTool = {
  name: "mneme.handoff.snapshot",
  category: "lab",
  description: "🧬 HANDOFF — compose a fresh HMAC-signed envelope of the parent's live state (conversation tail / git state / activity / capabilities). Each handoff is FRESH — never a pre-baked file. Child gets the same context the parent had at snapshot time.",
  whenToUse: "Before running `mneme handoff` on parent device. Daemon may call this automatically when user invokes BEACON.",
  triggers: ["handoff snapshot", "soul snapshot", "brain capture", "handoff envelope"],
  inputSchema: {
    type: "object",
    properties: {
      conversation: { type: "array" },
      activeIntent: { type: "string" },
      gitState: { type: "object" },
      recentActivity: { type: "array" },
      capabilities: { type: "object" },
      voiceDirective: { type: "string" },
      mnemeDictionary: { type: "object" },
      parentDeviceId: { type: "string" },
      nowMs: { type: "number" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Capture handoff snapshot for laptop→phone", args: { parentDeviceId: "macbook" }, expectedOutput: "{ envelopeId, sig, conversation, gitState, ... }" }],
  pitfalls: ["Caller must supply LIVE conversation + git state. The composer doesn't read I/O — it never goes stale."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const env = core.handoffSnapshot.captureSnapshot(args as Parameters<typeof core.handoffSnapshot.captureSnapshot>[0]);
    const stats = core.handoffSnapshot.computeSnapshotStats(env);
    return { data: env, wisdom: core.handoffSnapshot.formatSnapshotLine(stats), confidence: { level: "high" } };
  },
};

export const handoffVerifyTool: MnemeTool = {
  name: "mneme.handoff.verify",
  category: "audit",
  description: "🧬 HANDOFF — receiver-side HMAC verification of an incoming envelope. Returns false on tamper / wrong secret / wrong shape. NEVER ingest before this returns true.",
  whenToUse: "On child device after fetching envelope; gate before mneme.handoff.freshness + ingest.",
  triggers: ["handoff verify", "envelope verify"],
  inputSchema: { type: "object", properties: { envelope: { type: "object" } }, required: ["envelope"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this handoff envelope authentic?", args: { envelope: {} }, expectedOutput: "{ valid: true | false }" }],
  pitfalls: ["MNEME_HANDOFF_SECRET env var must match parent's secret OR be the bundled default."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const valid = core.handoffSnapshot.verifyEnvelope(args["envelope"] as Parameters<typeof core.handoffSnapshot.verifyEnvelope>[0]);
    return { data: { valid }, wisdom: valid ? "🧬 envelope verified" : "🧬 envelope REJECTED", confidence: { level: valid ? "high" : "low" } };
  },
};

export const handoffFreshnessTool: MnemeTool = {
  name: "mneme.handoff.freshness",
  category: "audit",
  description: "🧬 HANDOFF — receiver-side TTL gate. Reasons: fresh / stale (>80% TTL) / expired / future_clock_skew. Stale envelope = ingest with caveat; expired = REFUSE.",
  whenToUse: "After mneme.handoff.verify; before injecting envelope into child vendor session.",
  triggers: ["handoff freshness", "envelope age", "envelope expired"],
  inputSchema: { type: "object", properties: { envelope: { type: "object" }, nowMs: { type: "number" } }, required: ["envelope"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this envelope fresh enough?", args: { envelope: {} }, expectedOutput: "{ ageMs, isFresh, isExpired, reason }" }],
  pitfalls: ["Default TTL 5min — caller may have set custom. Receiver should also reject 'future_clock_skew' (parent clock ahead = suspicious)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.handoffSnapshot.freshnessCheck(args["envelope"] as Parameters<typeof core.handoffSnapshot.freshnessCheck>[0], args["nowMs"] as number | undefined);
    return { data: r, wisdom: `🧬 ${r.reason} (age ${Math.floor(r.ageMs / 1000)}s)`, confidence: { level: r.isFresh ? "high" : "low" } };
  },
};

export const handoffRenderTool: MnemeTool = {
  name: "mneme.handoff.render",
  category: "lab",
  description: "🧬 HANDOFF — render envelope as ingestible markdown for the child vendor (Gemini / GPT / Claude / etc). Vendor-neutral, deterministic, safe to display.",
  whenToUse: "After verify + freshness pass; produces the text the child AI agent will read as its onboarding prompt.",
  triggers: ["handoff render", "envelope render", "child ingest text"],
  inputSchema: { type: "object", properties: { envelope: { type: "object" } }, required: ["envelope"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show me the handoff text Gemini will paste", args: { envelope: {} }, expectedOutput: "{ markdown }" }],
  pitfalls: ["Output may exceed 8KB — caller should chunk if pasting into a token-budgeted UI."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const md = core.handoffSnapshot.renderForChildVendor(args["envelope"] as Parameters<typeof core.handoffSnapshot.renderForChildVendor>[0]);
    return { data: { markdown: md }, wisdom: `🧬 rendered ${md.length} chars`, confidence: { level: "high" } };
  },
};

// ─── PAIR CODE ─────────────────────────────────────────────────────────

export const pairGenerateTool: MnemeTool = {
  name: "mneme.handoff.pair_generate",
  category: "lab",
  description: "🔑 PAIR — generate a fresh 6-char human-friendly pair code (format XXX-XXX, confusable-free alphabet — no 0/O/Q/1/I/L/5/S/8/B). User reads it aloud with zero ambiguity.",
  whenToUse: "When spawning a BEACON HANDOFF server — generate code then bind to envelope.",
  triggers: ["pair generate", "pair code"],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get a fresh pair code", args: {}, expectedOutput: "{ code: 'CAT-DAD' }" }],
  pitfalls: ["Codes are random — caller must persist + bind to envelope to make them useful."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const code = core.pairCode.generatePairCode();
    return { data: { code }, wisdom: `🔑 pair code ${code}`, confidence: { level: "high" } };
  },
};

export const pairBindTool: MnemeTool = {
  name: "mneme.handoff.pair_bind",
  category: "lab",
  description: "🔑 PAIR — bind a pair code to an envelope HMAC (default 30s TTL); produces a stored PairRecord with its own sig.",
  whenToUse: "After snapshot + pair_generate; before serving the BEACON HTTP route.",
  triggers: ["pair bind", "pair record"],
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string" },
      envelopeSig: { type: "string" },
      envelopeId: { type: "string" },
      ttlMs: { type: "number" },
      nowMs: { type: "number" },
    },
    required: ["envelopeSig", "envelopeId"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Bind code to envelope for 30s", args: { envelopeSig: "abc", envelopeId: "1" }, expectedOutput: "{ code, envelopeSig, expiresAtMs, sig }" }],
  pitfalls: ["TTL > 60s discouraged — pair codes are short-lived by design (replay defense)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.pairCode.bindEnvelope(args as Parameters<typeof core.pairCode.bindEnvelope>[0]);
    return { data: r, wisdom: `🔑 bound code ${r.code} (expires ${new Date(r.expiresAtMs).toISOString()})`, confidence: { level: "high" } };
  },
};

export const pairLookupTool: MnemeTool = {
  name: "mneme.handoff.pair_lookup",
  category: "audit",
  description: "🔑 PAIR — receiver-side lookup by typed code. Handles lowercase/no-dash/extra-spaces. Verdicts: found / not_found / expired / already_used / tampered.",
  whenToUse: "On child device when user types or scans the pair code.",
  triggers: ["pair lookup", "pair receive"],
  inputSchema: {
    type: "object",
    properties: {
      records: { type: "array" },
      code: { type: "string" },
      nowMs: { type: "number" },
    },
    required: ["records", "code"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Look up code 'cat-dad'", args: { records: [], code: "cat-dad" }, expectedOutput: "{ verdict, record }" }],
  pitfalls: ["Caller MUST check verdict==='found' before invoking ingest — other verdicts mean refuse."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.pairCode.lookupByCode(args as Parameters<typeof core.pairCode.lookupByCode>[0]);
    return { data: r, wisdom: `🔑 verdict: ${r.verdict}`, confidence: { level: r.verdict === "found" ? "high" : "low" } };
  },
};

export const pairMarkUsedTool: MnemeTool = {
  name: "mneme.handoff.pair_mark_used",
  category: "lab",
  description: "🔑 PAIR — one-shot enforcement: mark record used by child device. Re-signs the record. Subsequent lookups return 'already_used'.",
  whenToUse: "Immediately after successful ingest on child device — prevents replay.",
  triggers: ["pair mark used", "pair burn"],
  inputSchema: {
    type: "object",
    properties: {
      record: { type: "object" },
      usedByDeviceId: { type: "string" },
      nowMs: { type: "number" },
    },
    required: ["record", "usedByDeviceId"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mark code consumed by my phone", args: { record: {}, usedByDeviceId: "phone" }, expectedOutput: "{ ...record, usedAtMs, usedByDeviceId }" }],
  pitfalls: ["Caller must persist the updated record back to the BEACON server's store, otherwise replay still possible."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.pairCode.markUsed(args as Parameters<typeof core.pairCode.markUsed>[0]);
    return { data: r, wisdom: `🔑 burned by ${r.usedByDeviceId}`, confidence: { level: "high" } };
  },
};

export const pairSasEmojiTool: MnemeTool = {
  name: "mneme.handoff.sas_emoji",
  category: "audit",
  description: "🐱 SAS EMOJI — deterministic 4-emoji visual MITM verifier derived from envelope HMAC. User compares parent screen + child screen — same emoji = no MITM. ~16M combinations (64-emoji alphabet ^ 4 slots).",
  whenToUse: "Display on both parent + child UIs; user visually verifies they match before accepting handoff.",
  triggers: ["sas emoji", "mitm verify", "visual auth"],
  inputSchema: { type: "object", properties: { envelopeSig: { type: "string" } }, required: ["envelopeSig"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show 4 emoji to verify parent/child", args: { envelopeSig: "abc..." }, expectedOutput: "{ emoji: ['🐱', '🌟', '🌊', '🔥'] }" }],
  pitfalls: ["Emoji rendering varies by OS — 🐱 on Mac may look slightly different from 🐱 on Android, but the SHAPE is identical, so user can still verify."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const emoji = core.pairCode.sasEmoji(String(args["envelopeSig"] ?? ""));
    return { data: { emoji }, wisdom: `🐱 ${emoji.join(" ")}`, confidence: { level: "high" } };
  },
};

// ─── HANDOFF PWA ───────────────────────────────────────────────────────

export const handoffPwaHtmlTool: MnemeTool = {
  name: "mneme.handoff.pwa_html",
  category: "lab",
  description: "📱 PWA — generate self-contained HTML page the BEACON server serves at /pair/<code>. Device-adaptive: Android → Web Share API to Gemini/ChatGPT/Claude; Desktop → cursor:// vscode:// claude-code:// mneme:// deep links; iOS → clipboard + Shortcut. Zero external CDN.",
  whenToUse: "When BEACON HANDOFF server needs to serve the scanner's landing page.",
  triggers: ["pwa html", "handoff pwa", "scanner page"],
  inputSchema: {
    type: "object",
    properties: {
      body: { type: "string" },
      pairCode: { type: "string" },
      sasEmoji: { type: "array" },
      expiresInMs: { type: "number" },
      title: { type: "string" },
      parentDeviceId: { type: "string" },
      shareTargets: { type: "array" },
    },
    required: ["body", "pairCode", "sasEmoji", "expiresInMs"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build the scanner landing page", args: { body: "...", pairCode: "CAT-DAD", sasEmoji: ["🐱", "🌟", "🌊", "🔥"], expiresInMs: 25000 }, expectedOutput: "{ html: '<!DOCTYPE html>...' }" }],
  pitfalls: ["Page is offline-safe — no external CDN. Works on LAN even without internet."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const html = core.handoffPwa.generateHandoffPwaHtml(args as unknown as Parameters<typeof core.handoffPwa.generateHandoffPwaHtml>[0]);
    return { data: { html, bytes: html.length }, wisdom: `📱 PWA generated (${html.length} bytes)`, confidence: { level: "high" } };
  },
};

// ─── CONSCIOUSNESS FORK ────────────────────────────────────────────────

export const forkRecordTool: MnemeTool = {
  name: "mneme.fork.record",
  category: "lab",
  description: "🧬 FORK — record a parent→child fork event in the HMAC-chained lineage ledger. Composable with v2.19.31 SYNAPSE SYNC for future reconciliation.",
  whenToUse: "On parent device when handoff successfully receives confirmation from child.",
  triggers: ["fork record", "lineage record", "consciousness fork"],
  inputSchema: {
    type: "object",
    properties: {
      ledger: { type: "array" },
      parentDeviceId: { type: "string" },
      childDeviceId: { type: "string" },
      envelopeId: { type: "string" },
      forkedAtMs: { type: "number" },
      note: { type: "string" },
    },
    required: ["ledger", "parentDeviceId", "childDeviceId", "envelopeId"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record laptop forked to phone", args: { ledger: [], parentDeviceId: "mac", childDeviceId: "phone", envelopeId: "env1" }, expectedOutput: "{ ledger, record }" }],
  pitfalls: ["Parent must equal != child (self-fork rejected). Empty deviceIds rejected."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.consciousnessFork.recordFork(args as Parameters<typeof core.consciousnessFork.recordFork>[0]);
    return { data: r, wisdom: r.record ? `🧬 fork ${r.record.forkId} recorded` : `🧬 fork rejected: ${r.reason}`, confidence: { level: r.record ? "high" : "low" } };
  },
};

export const forkReconcileTool: MnemeTool = {
  name: "mneme.fork.reconcile",
  category: "lab",
  description: "🧬 FORK — mark a fork reconciled (child merged back into parent via v2.19.31 SYNAPSE SYNC). Closes the lineage loop.",
  whenToUse: "After mneme.synapse.sync_merge successfully unifies the child's brain back into parent.",
  triggers: ["fork reconcile", "lineage reconcile"],
  inputSchema: {
    type: "object",
    properties: {
      ledger: { type: "array" },
      forkId: { type: "string" },
      reconciledAtMs: { type: "number" },
    },
    required: ["ledger", "forkId"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mark fork ABC merged", args: { ledger: [], forkId: "abc" }, expectedOutput: "{ ledger, updated }" }],
  pitfalls: ["Idempotent — calling on already-reconciled fork is a no-op."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.consciousnessFork.markReconciled(args as Parameters<typeof core.consciousnessFork.markReconciled>[0]);
    return { data: r, wisdom: r.updated ? `🧬 ${r.updated.forkId} reconciled` : `🧬 fork not found`, confidence: { level: r.updated ? "high" : "low" } };
  },
};

export const forkFindDescendantsTool: MnemeTool = {
  name: "mneme.fork.find_descendants",
  category: "audit",
  description: "🧬 FORK — discover active descendants of a parent device. Used by SYNAPSE SYNC to know which other devices have my brain forked to (merge candidates).",
  whenToUse: "Periodic SYNAPSE SYNC cycle on parent: 'who do I need to merge with?'",
  triggers: ["fork descendants", "find children", "lineage descendants"],
  inputSchema: {
    type: "object",
    properties: {
      ledger: { type: "array" },
      parentDeviceId: { type: "string" },
      sinceMs: { type: "number" },
    },
    required: ["ledger", "parentDeviceId"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "List active forks from my mac", args: { ledger: [], parentDeviceId: "mac" }, expectedOutput: "{ descendants: [{ childDeviceId, ... }] }" }],
  pitfalls: ["Excludes reconciled + abandoned — only ACTIVE forks returned."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const descendants = core.consciousnessFork.findActiveDescendants(args as Parameters<typeof core.consciousnessFork.findActiveDescendants>[0]);
    return { data: { descendants, count: descendants.length }, wisdom: `🧬 ${descendants.length} active descendant(s)`, confidence: { level: "high" } };
  },
};

export const forkVerifyLedgerTool: MnemeTool = {
  name: "mneme.fork.verify_ledger",
  category: "audit",
  description: "🧬 FORK — verify HMAC-chain integrity of the whole fork lineage. Tamper anywhere in chain → false. Use before trusting descendant data.",
  whenToUse: "Periodic audit; before reading ledger to make decisions.",
  triggers: ["fork verify", "lineage verify"],
  inputSchema: { type: "object", properties: { ledger: { type: "array" } }, required: ["ledger"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is the fork ledger intact?", args: { ledger: [] }, expectedOutput: "{ valid: true | false }" }],
  pitfalls: ["After mneme.fork.reconcile updates a record, the HMAC chain BREAKS at that record (by design — re-signed). Caller may treat this as a new fork lineage branch."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const valid = core.consciousnessFork.verifyLedger(args["ledger"] as Parameters<typeof core.consciousnessFork.verifyLedger>[0]);
    return { data: { valid }, wisdom: valid ? "🧬 ledger intact" : "🧬 ledger TAMPERED", confidence: { level: valid ? "high" : "low" } };
  },
};

export const V1932_HANDOFF_TOOLS: MnemeTool[] = [
  handoffSnapshotTool,
  handoffVerifyTool,
  handoffFreshnessTool,
  handoffRenderTool,
  pairGenerateTool,
  pairBindTool,
  pairLookupTool,
  pairMarkUsedTool,
  pairSasEmojiTool,
  handoffPwaHtmlTool,
  forkRecordTool,
  forkReconcileTool,
  forkFindDescendantsTool,
  forkVerifyLedgerTool,
];
