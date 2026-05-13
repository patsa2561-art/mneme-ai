/**
 * v2.8.0 -- MCP wrappers for HANDOFF UNIVERSAL + SHADOW CONSENSUS + BIRTHRIGHT.
 *
 * Surface:
 *   mneme.handoff.universal       — 1-call returns ALL handoff paths
 *   mneme.consensus.open_ballot   — open an N-vendor ballot
 *   mneme.consensus.record_reply  — record one vendor's reply
 *   mneme.consensus.close         — fuse + emit verdict
 *   mneme.birthright.mint         — mint / load the repo's birthright
 *   mneme.birthright.verify       — verify a presented birthright
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime | undefined): string {
  return resolve(rt?.meta?.rootPath ?? process.cwd());
}

export const handoffUniversalTool: MnemeTool = {
  name: "mneme.handoff.universal",
  category: "meta",
  description:
    "HANDOFF UNIVERSAL -- one call returns EVERY viable cross-device path (clipboard + AURA-DROP self-contained QR + NEXUS short code + raw markdown). User picks the easiest. Receiver needs ZERO install — the QR is a `data:text/html` URI containing a complete page with the soul prompt pre-loaded; the phone browser opens it offline with no fetch.",
  whenToUse: "When the user says 'send my brain to my phone' / 'ส่งสมองไปมือถือ' / 'sync this to my iPad' — paint every path; user picks the easiest.",
  triggers: ["send brain", "handoff", "ส่งสมอง", "sync to phone", "cross device", "QR my brain"],
  inputSchema: {
    type: "object",
    properties: {
      payload: { type: "string", description: "The soul prompt / capsule body to ship." },
      label: { type: "string", description: "Short label shown on the AURA-DROP page." },
      targetVendor: { type: "string", description: "Vendor the user will paste into (claude / chatgpt / gemini / cursor / etc)." },
    },
    required: ["payload"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Send this brain to my phone",
    args: { payload: "## SOUL PROMPT\n...", targetVendor: "claude" },
    expectedOutput: "{ paths: [{id:'clipboard'}, {id:'qr-embed', content:'data:text/html...'}, {id:'nexus', content:'A2K7P9'}, {id:'markdown'}], digest, instructions }",
  }],
  pitfalls: [
    "AURA-DROP QR encodes the FULL soul prompt — for very large payloads (>8 KB after base64) the path is omitted; markdown fallback always present.",
    "The receiver's BROWSER renders the data: URI — no server is involved. If the browser blocks `data:` URIs in QR readers, fall back to markdown.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const b = core.handoff.handoffUniversal({
      payload: String(args["payload"] ?? ""),
      label: args["label"] ? String(args["label"]) : undefined,
      targetVendor: args["targetVendor"] ? String(args["targetVendor"]) : undefined,
    });
    return {
      data: b,
      wisdom: core.handoff.formatHandoffPulseLine(b),
      followUp: [],
      confidence: { level: "high", notes: b.paths.find((p) => p.id === "qr-embed") ? "QR is self-contained — phone scans → browser opens offline → user copies → pastes into AI." : "Payload exceeded QR embed cap; use markdown or NEXUS code." },
    };
  },
};

export const consensusOpenBallotTool: MnemeTool = {
  name: "mneme.consensus.open_ballot",
  category: "audit",
  description:
    "SHADOW CONSENSUS -- open an HMAC-signed N-vendor ballot. The user asks a high-stakes question; AI fans it across multiple vendors via soul prompts; SHADOW CONSENSUS later fuses the replies via TRUTH KERNEL.",
  whenToUse: "High-stakes question where one vendor isn't enough. Open the ballot first, then record each vendor's reply, then close.",
  triggers: ["open ballot", "cross-vendor consensus", "ask all vendors"],
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      vendors: { type: "array", items: { type: "string" } },
      context: { type: "string" },
      secret: { type: "string", description: "HMAC secret. Use a stable per-repo value (e.g. the pole-secret)." },
    },
    required: ["question", "vendors", "secret"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get cross-vendor consensus", args: { question: "Is Postgres scaling to 10k QPS?", vendors: ["claude", "gpt", "gemini"], secret: "..." }, expectedOutput: "{ ballot: { id, sig, ... } }" }],
  pitfalls: ["Vendors not listed at open time cannot reply later. Plan the slate up front."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ballot = core.shadowConsensus.openBallot({
      question: String(args["question"] ?? ""),
      vendors: (args["vendors"] as string[]) ?? [],
      context: args["context"] ? String(args["context"]) : undefined,
      secret: String(args["secret"] ?? ""),
    });
    return { data: ballot, wisdom: `SHADOW-CONSENSUS · ballot opened id=${ballot.id.slice(0, 8)} vendors=${ballot.vendors.length}`, confidence: { level: "high" } };
  },
};

export const consensusRecordReplyTool: MnemeTool = {
  name: "mneme.consensus.record_reply",
  category: "audit",
  description:
    "SHADOW CONSENSUS -- record one vendor's reply to an open ballot. Returns the signed reply object for the caller to persist + later pass to close.",
  whenToUse: "After each vendor returns its verdict. Build the replies array; pass all of them to close.",
  triggers: ["record vote", "consensus reply"],
  inputSchema: {
    type: "object",
    properties: {
      ballot: { type: "object" },
      vendor: { type: "string" },
      verdict: { type: "string", enum: ["TRUE", "FALSE", "UNCERTAIN", "INAPPLICABLE"] },
      confidence: { type: "number" },
      rationale: { type: "string" },
      secret: { type: "string" },
    },
    required: ["ballot", "vendor", "verdict", "confidence", "secret"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record Claude's vote", args: { ballot: {}, vendor: "claude", verdict: "TRUE", confidence: 0.9, secret: "..." }, expectedOutput: "{ ok, reply: { sig, ... } }" }],
  pitfalls: ["Same vendor recording twice → second call is silently dropped at close time. One vote per vendor."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.shadowConsensus.recordReply({
      ballot: args["ballot"] as Parameters<typeof core.shadowConsensus.recordReply>[0]["ballot"],
      vendor: String(args["vendor"] ?? ""),
      verdict: (args["verdict"] as "TRUE" | "FALSE" | "UNCERTAIN" | "INAPPLICABLE") ?? "UNCERTAIN",
      confidence: Number(args["confidence"] ?? 0),
      rationale: args["rationale"] ? String(args["rationale"]) : undefined,
      secret: String(args["secret"] ?? ""),
    });
    return { data: r, wisdom: r.ok ? `reply recorded vendor=${args["vendor"]}` : `reply rejected: ${r.reason}`, confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const consensusCloseTool: MnemeTool = {
  name: "mneme.consensus.close",
  category: "audit",
  description:
    "SHADOW CONSENSUS -- close the ballot and fuse all collected replies via TRUTH KERNEL into a single verdict + coverage + quorum + disagreement signal.",
  whenToUse: "When you've collected enough vendor replies (≥ quorum) and want the final consensus.",
  triggers: ["close ballot", "fuse consensus"],
  inputSchema: {
    type: "object",
    properties: {
      ballot: { type: "object" },
      replies: { type: "array" },
      secret: { type: "string" },
      quorumOverride: { type: "integer" },
    },
    required: ["ballot", "replies", "secret"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Close ballot", args: { ballot: {}, replies: [], secret: "..." }, expectedOutput: "{ truth: {verdict, pTrue, disagreement}, quorate, coverage }" }],
  pitfalls: ["Replies with bad HMAC are silently dropped. Check the returned replies.length vs how many you submitted."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = await core.shadowConsensus.closeConsensus({
      ballot: args["ballot"] as Parameters<typeof core.shadowConsensus.closeConsensus>[0]["ballot"],
      replies: (args["replies"] as Parameters<typeof core.shadowConsensus.closeConsensus>[0]["replies"]) ?? [],
      secret: String(args["secret"] ?? ""),
      quorumOverride: args["quorumOverride"] as number | undefined,
    });
    return { data: c, wisdom: core.shadowConsensus.formatConsensusPulseLine(c), confidence: { level: c.quorate ? "high" : "medium", notes: c.quorate ? undefined : "Below quorum — gather more votes before trusting the verdict." } };
  },
};

export const birthrightMintTool: MnemeTool = {
  name: "mneme.birthright.mint",
  category: "meta",
  description:
    "BIRTHRIGHT TOKEN -- mint (or return existing) the repo's birthright token. HMAC-chained to the repo fingerprint + parent pole; mode 0600. Idempotent — second call returns the same token.",
  whenToUse: "First-time setup of cross-device federation; or when you need the canonical proof that THIS Mneme instance speaks for the repo.",
  triggers: ["mint birthright", "issue birthright", "repo identity"],
  inputSchema: {
    type: "object",
    properties: {
      secret: { type: "string", description: "HMAC secret. Typically the pole-secret from anchor." },
      parentId: { type: "string", description: "Optional parent token id for spawned replicas." },
      force: { type: "boolean", description: "Force re-mint even if a token exists. Rare." },
    },
    required: ["secret"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mint my birthright", args: { secret: "..." }, expectedOutput: "{ v:1, id, repoFingerprint, mintedAt, hmac }" }],
  pitfalls: ["force=true on an existing token is non-reversible. Don't use it unless the existing token is genuinely lost."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const t = core.birthright.mintBirthright({
      repoRoot: repoRootOf(rt),
      secret: String(args["secret"] ?? ""),
      parentId: args["parentId"] ? String(args["parentId"]) : undefined,
      force: args["force"] === true,
    });
    return { data: t, wisdom: core.birthright.formatBirthrightPulseLine(t), confidence: { level: "high" } };
  },
};

export const birthrightVerifyTool: MnemeTool = {
  name: "mneme.birthright.verify",
  category: "meta",
  description:
    "BIRTHRIGHT TOKEN -- verify a presented token against the current repo. Returns VALID / TAMPERED / WRONG_REPO so the caller can reject copied or forged `.mneme/` directories.",
  whenToUse: "Before federating with another claimed Mneme instance; before accepting a cross-device handoff signed by an unfamiliar peer.",
  triggers: ["verify birthright", "is this Mneme legit"],
  inputSchema: {
    type: "object",
    properties: {
      token: { type: "object" },
      secret: { type: "string" },
      checkRepo: { type: "boolean", description: "If true (default), also verify the token was minted for THIS repo." },
    },
    required: ["token", "secret"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this birthright", args: { token: {}, secret: "...", checkRepo: true }, expectedOutput: "{ ok, verdict: 'VALID'|'TAMPERED'|'WRONG_REPO' }" }],
  pitfalls: ["WRONG_REPO is normal when verifying a peer's token from another repo. Pass checkRepo=false when verifying a peer signature, true when checking the LOCAL birthright."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const checkRepo = args["checkRepo"] !== false;
    const v = core.birthright.verifyBirthright(
      args["token"] as Parameters<typeof core.birthright.verifyBirthright>[0],
      String(args["secret"] ?? ""),
      checkRepo ? repoRootOf(rt) : undefined,
    );
    return { data: v, wisdom: `BIRTHRIGHT · ${v.verdict}`, confidence: { level: "high" } };
  },
};

export const V28_TOOLS: MnemeTool[] = [
  handoffUniversalTool,
  consensusOpenBallotTool,
  consensusRecordReplyTool,
  consensusCloseTool,
  birthrightMintTool,
  birthrightVerifyTool,
];
