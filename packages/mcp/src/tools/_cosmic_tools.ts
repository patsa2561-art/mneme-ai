/**
 * v2.11.0 -- COSMIC LINK MCP wrappers.
 *
 *   mneme.cosmic.mint     — generate a fresh session token + secret
 *   mneme.cosmic.publish  — push current state to user's COSMIC server
 *   mneme.cosmic.read     — read state from a COSMIC URL (any AI can use)
 *   mneme.cosmic.revoke   — kill a session (HMAC-auth)
 */

import type { MnemeTool } from "./_types.js";

export const cosmicMintTool: MnemeTool = {
  name: "mneme.cosmic.mint",
  category: "meta",
  description:
    "COSMIC LINK -- mint a fresh ephemeral session for the user's COSMIC server. Returns { token, secret, publicUrl, jsonUrl, sseUrl }. Save the secret — needed for subsequent publish/revoke. The publicUrl is what you embed in the NEXUS-LOCK soul prompt's stargateUrl field.",
  whenToUse: "First-time setup of a cross-vendor handoff session. Mint once per session; reuse the token for subsequent publishes.",
  triggers: ["mint cosmic", "new cosmic session"],
  inputSchema: {
    type: "object",
    properties: {
      serverUrl: { type: "string", description: "Base URL of the user's COSMIC server (e.g., https://cosmic.example.com)" },
    },
    required: ["serverUrl"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mint COSMIC session", args: { serverUrl: "https://cosmic.example.com" }, expectedOutput: "{ token, secret, publicUrl, jsonUrl, sseUrl }" }],
  pitfalls: [
    "secret is sensitive — needed to publish/revoke. Treat like a password.",
    "If you mint without publishing, the session doesn't exist server-side until first publish.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const session = core.cosmic.mintSession({ serverUrl: String(args["serverUrl"] ?? "") });
    return {
      data: session,
      wisdom: `COSMIC mint · token=${session.token.slice(0, 8)} · ${session.publicUrl}`,
      followUp: ["mneme.cosmic.publish"],
      confidence: { level: "high", notes: "Save the secret — required for publish + revoke. Embed publicUrl in soul prompts." },
    };
  },
};

export const cosmicPublishTool: MnemeTool = {
  name: "mneme.cosmic.publish",
  category: "meta",
  description:
    "COSMIC LINK -- publish current Mneme state to the user's COSMIC server. State should be version + commit metadata only (NOT source code, NOT secrets). Returns chain signatures so receivers can verify integrity. After 30 min of no publish, COSMIC marks the session STALE in its served HTML — receivers see a red banner.",
  whenToUse: "After every Mneme upgrade; on a daemon timer (every 5 min) for live sync; before generating a NEXUS-LOCK soul prompt that references the COSMIC URL.",
  triggers: ["publish cosmic", "push state to cosmic"],
  inputSchema: {
    type: "object",
    properties: {
      session: { type: "object", description: "{ token, secret, adminSecretHash, serverUrl } from mneme.cosmic.mint" },
      state: { type: "object", description: "Arbitrary state JSON — version, commits, daemon state, timestamps" },
    },
    required: ["session", "state"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Publish v2.11.0 state", args: { session: {}, state: { mnemeVersion: "2.11.0" } }, expectedOutput: "{ ok, count, prevSig, newSig }" }],
  pitfalls: [
    "First publish on a token sets the adminSecretHash; subsequent publishes auth via HMAC.",
    "If COSMIC server is offline, returns {ok:false, error}. Caller should fall back to LAN BEACON or PIGEON POST.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const session = args["session"] as Parameters<typeof core.cosmic.publishToCosmic>[0]["session"];
    const state = args["state"] as Record<string, unknown>;
    const r = await core.cosmic.publishToCosmic({ session, state });
    return {
      data: r,
      wisdom: r.ok ? `COSMIC publish · count=${r.count} sig=${r.newSig?.slice(0, 8)}` : `COSMIC publish FAILED · ${r.error}`,
      confidence: { level: r.ok ? "high" : "low", notes: r.ok ? undefined : "COSMIC server unreachable; use LAN BEACON or PIGEON POST instead." },
    };
  },
};

export const cosmicReadTool: MnemeTool = {
  name: "mneme.cosmic.read",
  category: "meta",
  description:
    "COSMIC LINK -- read current state from a COSMIC URL. NO AUTH REQUIRED — the read endpoint is open by design (state is version metadata only). Returns { state, stale, publishCount, lastPublishTs }. If stale=true → parent has been offline > 30 min.",
  whenToUse: "Receiving AI (or daemon) wants to verify the most recent state without doing a full handoff. Useful for sanity-checks before answering 'current version?' questions.",
  triggers: ["read cosmic", "fetch cosmic state"],
  inputSchema: {
    type: "object",
    properties: {
      jsonUrl: { type: "string", description: "Full URL like https://cosmic.example.com/api/v1/sessions/<token>.json" },
    },
    required: ["jsonUrl"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Read live state from this COSMIC URL", args: { jsonUrl: "https://cosmic.example.com/api/v1/sessions/abc123.json" }, expectedOutput: "{ ok, state, stale, publishCount }" }],
  pitfalls: ["404 = session expired or never existed. Caller should ask user to re-mint."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.cosmic.readCosmic(String(args["jsonUrl"] ?? ""));
    return {
      data: r,
      wisdom: r.ok
        ? `COSMIC read · publishes=${r.publishCount} stale=${r.stale} ts=${r.lastPublishTs}`
        : `COSMIC read FAILED · ${r.error}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const cosmicRevokeTool: MnemeTool = {
  name: "mneme.cosmic.revoke",
  category: "meta",
  description:
    "COSMIC LINK -- revoke a session immediately. Server forgets the token; subsequent reads return 404. Useful when ending a sensitive collaboration / when you want to kill the URL from public access.",
  whenToUse: "End-of-session cleanup; user explicitly asks to 'kill the COSMIC link'.",
  triggers: ["revoke cosmic", "kill cosmic session"],
  inputSchema: {
    type: "object",
    properties: {
      session: { type: "object", description: "{ token, secret, adminSecretHash, serverUrl } — the secret is required for HMAC auth." },
    },
    required: ["session"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Kill that COSMIC URL", args: { session: {} }, expectedOutput: "{ ok, error? }" }],
  pitfalls: ["Server-side state is gone immediately — no recovery. To reuse, mint a fresh session."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const session = args["session"] as Parameters<typeof core.cosmic.revokeCosmic>[0];
    const r = await core.cosmic.revokeCosmic(session);
    return {
      data: r,
      wisdom: r.ok ? `COSMIC revoke · ok` : `COSMIC revoke FAILED · ${r.error}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

// ====================================================================
// v2.12.0 NOBEL-tier tools — proof-of-liveness, reverse-delivery, presence.
// ====================================================================

export const cosmicHeartbeatTool: MnemeTool = {
  name: "mneme.cosmic.heartbeat",
  category: "meta",
  description:
    "COSMIC v2.12 -- send a proof-of-liveness ping (HMAC-auth) so receivers know the parent is alive. If the server has not seen a heartbeat OR a publish within ~3 minutes, the session is marked ZOMBIE in JSON read + the HTML banner shows 🧟 ZOMBIE MODE. Receiving AIs are instructed to refuse claims based on zombie state.",
  whenToUse: "On a daemon timer (every 60-120s) for any session you want to keep LIVE without spamming publishes. Cheaper than publish (no body, no chain update).",
  triggers: ["heartbeat cosmic", "keep cosmic alive"],
  inputSchema: {
    type: "object",
    properties: {
      session: { type: "object", description: "{ token, secret, adminSecretHash, serverUrl } from mneme.cosmic.mint" },
    },
    required: ["session"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Keep this cosmic session live", args: { session: {} }, expectedOutput: "{ ok, ts, zombie }" }],
  pitfalls: [
    "Heartbeat alone does NOT update state — receivers still see the last-published snapshot.",
    "Skip heartbeating if you publish frequently (< 3 min apart); publishes refresh the liveness clock too.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const session = args["session"] as Parameters<typeof core.cosmic.heartbeatCosmic>[0];
    const r = await core.cosmic.heartbeatCosmic(session);
    return {
      data: r,
      wisdom: r.ok ? `COSMIC heartbeat · ts=${r.ts}` : `COSMIC heartbeat FAILED · ${r.error}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const cosmicInboxPushTool: MnemeTool = {
  name: "mneme.cosmic.inbox.push",
  category: "meta",
  description:
    "COSMIC v2.12 -- receiving AI POSTs a HOMUNCULUS RETURN block back to the parent's inbox. OPEN endpoint (no auth) so any vendor (ChatGPT / Gemini / Codex / Cursor) can participate. Server caps at 16KB per entry, 256 entries per session, vendor-tagged via User-Agent sniff.",
  whenToUse: "When you (the receiving AI) have read state from a COSMIC URL and want to ack / report back / push your own findings to the parent without the user having to copy-paste.",
  triggers: ["push to cosmic inbox", "homunculus return"],
  inputSchema: {
    type: "object",
    properties: {
      jsonUrl: { type: "string", description: "The cosmic JSON URL (parent gave you this in the soul prompt)" },
      body: { type: "string", description: "Free-form text — typically '# HOMUNCULUS RETURN\\nvendor: <you>\\necho: <ack>'" },
    },
    required: ["jsonUrl", "body"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Tell parent I got the soul prompt", args: { jsonUrl: "https://x/sessions/abc.json", body: "# HOMUNCULUS RETURN\nvendor: chatgpt\necho: ack" }, expectedOutput: "{ ok, count }" }],
  pitfalls: ["Open endpoint — anyone with the token can push. Parent should sanity-check vendor + content before trusting."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.cosmic.pushHomunculusReturn(String(args["jsonUrl"] ?? ""), String(args["body"] ?? ""));
    return {
      data: r,
      wisdom: r.ok ? `COSMIC inbox push · count=${r.count}` : `COSMIC inbox push FAILED · ${r.error}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const cosmicInboxReadTool: MnemeTool = {
  name: "mneme.cosmic.inbox.read",
  category: "meta",
  description:
    "COSMIC v2.12 -- parent reads + optionally drains its inbox (HMAC-auth). Returns vendor-tagged entries that receivers pushed back. Use drain=true after processing so the inbox stays bounded.",
  whenToUse: "Parent daemon polls every minute to learn which vendors actually opened / acked the soul prompt + what they reported.",
  triggers: ["read cosmic inbox", "drain cosmic inbox"],
  inputSchema: {
    type: "object",
    properties: {
      session: { type: "object", description: "{ token, secret, adminSecretHash, serverUrl }" },
      drain: { type: "boolean", description: "If true, server clears the inbox after this read." },
    },
    required: ["session"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What did the receivers say?", args: { session: {}, drain: true }, expectedOutput: "{ ok, items, count, drained }" }],
  pitfalls: ["If drain=false the inbox grows up to 256 entries before it starts evicting oldest. Drain after processing."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const session = args["session"] as Parameters<typeof core.cosmic.readInbox>[0];
    const drain = !!args["drain"];
    const r = await core.cosmic.readInbox(session, { drain });
    return {
      data: r,
      wisdom: r.ok ? `COSMIC inbox · items=${r.count} drained=${r.drained}` : `COSMIC inbox read FAILED · ${r.error}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const cosmicPresenceTool: MnemeTool = {
  name: "mneme.cosmic.presence",
  category: "meta",
  description:
    "COSMIC v2.12 -- Google-Docs-style watcher list. Open endpoint — anyone with the token can see who else is reading + what vendor they appear to be (sniffed from User-Agent). Includes zombie flag so the parent knows if its own publishes have lapsed.",
  whenToUse: "Parent verifies the receiving AI actually opened the URL; receivers see they're not alone. UI gold for cross-vendor handoff dashboards.",
  triggers: ["who's reading cosmic", "cosmic presence", "cosmic watchers"],
  inputSchema: {
    type: "object",
    properties: {
      jsonUrl: { type: "string", description: "Cosmic JSON URL — presence URL is derived from it." },
    },
    required: ["jsonUrl"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Who opened my COSMIC URL?", args: { jsonUrl: "https://x/sessions/abc.json" }, expectedOutput: "{ ok, watchers, zombie, publishCount }" }],
  pitfalls: ["Watchers are anonymous fingerprints (sha256 of ip+ua, 12 chars) — not user identity. Only AI-vendor sniff is best-effort."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = await core.cosmic.getCosmicPresence(String(args["jsonUrl"] ?? ""));
    return {
      data: r,
      wisdom: r.ok ? `COSMIC presence · watchers=${r.watchers?.length ?? 0} zombie=${r.zombie}` : `COSMIC presence FAILED · ${r.error}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const COSMIC_TOOLS: MnemeTool[] = [
  cosmicMintTool,
  cosmicPublishTool,
  cosmicReadTool,
  cosmicRevokeTool,
  cosmicHeartbeatTool,
  cosmicInboxPushTool,
  cosmicInboxReadTool,
  cosmicPresenceTool,
];
