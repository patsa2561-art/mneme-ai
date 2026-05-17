/**
 * v2.19.37 TALK OF THE TOWN — MCP tools (Gaps #1-#6 closed)
 *
 *   PROTOCOL (3):
 *     mneme.protocol.spec        — emit RFC-style spec text
 *     mneme.protocol.validate    — strict spec checker
 *     mneme.protocol.mint        — reference impl receipt mint
 *
 *   BROWSER (3):
 *     mneme.browser.detect       — vendor detection from URL
 *     mneme.browser.extract      — chat turn extraction from DOM text
 *     mneme.browser.mint         — capture → protocol receipt
 *
 *   CITIZENS (2):
 *     mneme.citizens.aggregate   — anonymise + aggregate
 *     mneme.citizens.report      — emit quarterly markdown
 *
 *   CARD (2):
 *     mneme.card.build           — build conscience card
 *     mneme.card.render          — emit shareable text + SVG
 *
 *   MAYOR (3):
 *     mneme.mayor.vote           — cast vote
 *     mneme.mayor.tally          — tally election (mid-term snapshot)
 *     mneme.mayor.rotate         — run scheduled rotation
 */

import type { MnemeTool } from "./_types.js";

// ─── PROTOCOL ──────────────────────────────────────────────────────────

export const protocolSpecTool: MnemeTool = {
  name: "mneme.protocol.spec",
  category: "meta",
  description: "📜 PROTOCOL (v2.19.37) — emit Mneme Receipt Protocol v1.0 RFC-style spec text. The OPEN STANDARD any AI tool can adopt for interoperable accountability receipts. MIT licensed.",
  whenToUse: "Reference doc for implementing the protocol; auditor inspection; submission to standards bodies (IETF / NIST / EU AI Act WG).",
  triggers: ["protocol spec", "mneme rfc", "receipt protocol"],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show me the receipt spec", args: {}, expectedOutput: "{ spec: '# Mneme Receipt Protocol v1.0\\n...' }" }],
  pitfalls: ["Spec text is deterministic — bundled in npm tarball; safe to mirror."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const spec = core.mnemeReceiptProtocol.specText();
    const stats = core.mnemeReceiptProtocol.computeProtocolStats();
    return { data: { spec, stats }, wisdom: core.mnemeReceiptProtocol.formatProtocolLine(stats), confidence: { level: "high" } };
  },
};

export const protocolValidateTool: MnemeTool = {
  name: "mneme.protocol.validate",
  category: "audit",
  description: "📜 PROTOCOL — strict validator for Mneme Receipt Protocol v1.0. Returns VALID / INVALID / WARNING with structured issues per field.",
  whenToUse: "Before trusting any receipt from a 3rd-party implementation; after parsing JSON from disk / network.",
  triggers: ["protocol validate", "validate receipt"],
  inputSchema: { type: "object", properties: { receipt: { type: "object" } }, required: ["receipt"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this receipt spec-compliant?", args: { receipt: {} }, expectedOutput: "{ verdict, issues, versionSupported }" }],
  pitfalls: ["WARNING means valid but contains unknown fields or implementation extensions (forward compat); INVALID means at least one error."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.mnemeReceiptProtocol.validateReceipt(args["receipt"]);
    return { data: r, wisdom: `📜 ${r.verdict} · ${r.issues.length} issues`, confidence: { level: r.verdict === "VALID" ? "high" : (r.verdict === "WARNING" ? "medium" : "low") } };
  },
};

export const protocolMintTool: MnemeTool = {
  name: "mneme.protocol.mint",
  category: "audit",
  description: "📜 PROTOCOL — reference-impl mint of a v1.0 receipt. Output always passes validate(). Defensive: garbage in → safe-default receipt out, never throws.",
  whenToUse: "Anywhere you'd previously emit a proprietary AI-call log entry; now emit a portable protocol receipt instead.",
  triggers: ["protocol mint", "mint receipt"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" }, modelVersion: { type: "string" },
      promptText: { type: "string" }, responseText: { type: "string" },
      toolsCalled: { type: "array" }, filesTouched: { type: "array" },
      tokensIn: { type: "number" }, tokensOut: { type: "number" },
      costUsdMicros: { type: "number" }, vaccinesTriggered: { type: "array" },
      outcomeClass: { type: "string" }, controls: { type: "object" },
      note: { type: "string" }, prevContentHash: { type: "string" },
      ext: { type: "object" },
    },
    required: ["vendor", "modelVersion"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mint a portable receipt", args: { vendor: "claude", modelVersion: "opus-4.7" }, expectedOutput: "{ protocol, protocolVersion, ...fields, contentHash }" }],
  pitfalls: ["promptText hashed (not stored) so secrets don't leak. Pass promptSha256 directly if pre-hashed."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.mnemeReceiptProtocol.mintProtocolReceipt(args as unknown as Parameters<typeof core.mnemeReceiptProtocol.mintProtocolReceipt>[0]);
    return { data: r, wisdom: `📜 receipt ${r.contentHash.slice(0, 12)}… (${r.vendor})`, confidence: { level: "high" } };
  },
};

// ─── BROWSER ───────────────────────────────────────────────────────────

export const browserDetectTool: MnemeTool = {
  name: "mneme.browser.detect",
  category: "meta",
  description: "🌐 BROWSER — detect AI vendor from a web URL (chatgpt / claude / gemini / grok / perplexity / copilot / unknown).",
  whenToUse: "First step of a browser-extension capture pipeline.",
  triggers: ["browser detect vendor", "vendor from url"],
  inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Which vendor is this URL?", args: { url: "https://claude.ai/chats/abc" }, expectedOutput: "{ vendor: 'claude' }" }],
  pitfalls: ["Returns 'unknown' on garbage / non-AI URLs — caller MUST handle."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const vendor = core.browserReceipt.detectVendorFromUrl(args["url"]);
    return { data: { vendor }, wisdom: `🌐 vendor=${vendor}`, confidence: { level: vendor === "unknown" ? "low" : "high" } };
  },
};

export const browserExtractTool: MnemeTool = {
  name: "mneme.browser.extract",
  category: "meta",
  description: "🌐 BROWSER — extract chat turns from a vendor DOM text snapshot. Pure parser; caller supplies serialised DOM text.",
  whenToUse: "After mneme.browser.detect; turns are then paired and minted via mneme.browser.mint.",
  triggers: ["browser extract turns", "chat turn extract"],
  inputSchema: { type: "object", properties: { vendor: { type: "string" }, domText: { type: "string" } }, required: ["vendor", "domText"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Extract turns from this DOM", args: { vendor: "claude", domText: "You\\nhi\\nClaude\\nhello" }, expectedOutput: "{ turns: [{role, text, capturedAtMs}, ...] }" }],
  pitfalls: ["Per-turn text capped at 50,000 chars (safety)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const turns = core.browserReceipt.extractChatTurns({
      vendor: args["vendor"] as Parameters<typeof core.browserReceipt.extractChatTurns>[0]["vendor"],
      domText: String(args["domText"] ?? ""),
    });
    return { data: { turns, count: turns.length }, wisdom: `🌐 ${turns.length} turn(s) extracted`, confidence: { level: turns.length > 0 ? "high" : "low" } };
  },
};

export const browserMintTool: MnemeTool = {
  name: "mneme.browser.mint",
  category: "audit",
  description: "🌐 BROWSER — mint a protocol receipt from a captured (user, assistant) turn pair. Token estimation falls back to char/4 if not supplied.",
  whenToUse: "After mneme.browser.extract; takes the latest user+assistant turn pair.",
  triggers: ["browser mint receipt", "capture to receipt"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" }, userTurn: { type: "object" }, assistantTurn: { type: "object" },
      modelHint: { type: "string" }, tokensIn: { type: "number" }, tokensOut: { type: "number" },
      costUsdMicros: { type: "number" },
    },
    required: ["vendor", "userTurn", "assistantTurn"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Mint receipt for this Claude turn", args: { vendor: "claude", userTurn: {}, assistantTurn: {} }, expectedOutput: "{ protocol, contentHash, ext: {...} }" }],
  pitfalls: ["ext.@mneme-ai/browser-receipt.* fields fire WARNING in validate — that's expected (forward-compat by design)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.browserReceipt.mintFromBrowserCapture(args as unknown as Parameters<typeof core.browserReceipt.mintFromBrowserCapture>[0]);
    return { data: r, wisdom: `🌐 receipt ${r.contentHash.slice(0, 12)}…`, confidence: { level: "high" } };
  },
};

// ─── CITIZENS ──────────────────────────────────────────────────────────

export const citizensAggregateTool: MnemeTool = {
  name: "mneme.citizens.aggregate",
  category: "audit",
  description: "🪞 CITIZENS — anonymise + aggregate protocol receipts. Strips PII; keeps stats. Leaderboards require ≥10 receipts per vendor.",
  whenToUse: "Quarterly public report; cross-instance aggregation; vendor pressure mechanism.",
  triggers: ["citizens aggregate", "audit aggregate"],
  inputSchema: { type: "object", properties: { receipts: { type: "array" }, quarter: { type: "string" } }, required: ["receipts"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Aggregate this batch of receipts", args: { receipts: [] }, expectedOutput: "{ vendorRows, hallucinationLeaderboard, blockedLeaderboard }" }],
  pitfalls: ["Caller MUST anonymise first; aggregator filters out non-anonymized."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    // Coerce — if caller passed raw protocol receipts, anonymise them first.
    const rawList = Array.isArray(args["receipts"]) ? args["receipts"] as unknown[] : [];
    const anonymised = rawList.map((r) => {
      const rec = r as Record<string, unknown>;
      if (rec && typeof rec === "object" && "anonymizedId" in rec && rec.v === 1) {
        return rec as unknown as Parameters<typeof core.citizensAudit.aggregateCitizens>[0]["receipts"][number];
      }
      // assume raw protocol receipt
      try { return core.citizensAudit.anonymizeReceipt(rec as unknown as Parameters<typeof core.citizensAudit.anonymizeReceipt>[0]); }
      catch { return null; }
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    const agg = core.citizensAudit.aggregateCitizens({ receipts: anonymised, quarter: args["quarter"] as string | undefined });
    const stats = core.citizensAudit.computeAuditStats(agg);
    return { data: agg, wisdom: core.citizensAudit.formatAuditLine(stats), confidence: { level: "high" } };
  },
};

export const citizensReportTool: MnemeTool = {
  name: "mneme.citizens.report",
  category: "audit",
  description: "🪞 CITIZENS — emit quarterly public markdown report from an AuditAggregate. Includes hallucination + blocked leaderboards + vendor volume breakdown + methodology.",
  whenToUse: "End of quarter; press/regulator submission; vendor pressure mechanism.",
  triggers: ["citizens report", "quarterly report"],
  inputSchema: { type: "object", properties: { aggregate: { type: "object" }, organizationName: { type: "string" } }, required: ["aggregate"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Generate the quarterly state-of-AI report", args: { aggregate: {} }, expectedOutput: "{ markdown: '# State of AI Accountability — 2026-Q2\\n...' }" }],
  pitfalls: ["CC-BY-4.0 license footer included — publish freely."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const md = core.citizensAudit.renderQuarterlyReport(
      args["aggregate"] as Parameters<typeof core.citizensAudit.renderQuarterlyReport>[0],
      typeof args["organizationName"] === "string" ? args["organizationName"] as string : undefined,
    );
    return { data: { markdown: md }, wisdom: `🪞 report ${md.length} chars`, confidence: { level: "high" } };
  },
};

// ─── CARD ──────────────────────────────────────────────────────────────

export const cardBuildTool: MnemeTool = {
  name: "mneme.card.build",
  category: "meta",
  description: "📣 CARD — build a Mneme Conscience Card from an AI-failure event. Wordle-style: deterministic, dedupe-friendly, screenshot-grade.",
  whenToUse: "When a vaccine triggers / paradox is caught / fairness fails / guard blocks. Emit the card, then render to SVG/text for user share.",
  triggers: ["card build", "conscience card"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" }, modelVersion: { type: "string" }, kind: { type: "string" },
      aiClaim: { type: "string" }, detection: { type: "string" }, savedValue: { type: "string" },
    },
    required: ["vendor", "modelVersion", "kind", "aiClaim", "detection"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build a card for this caught hallucination", args: { vendor: "claude", modelVersion: "opus", kind: "hallucination", aiClaim: "cited paper", detection: "no such paper" }, expectedOutput: "{ cardId, vendor, kind, ... }" }],
  pitfalls: ["Card ID is deterministic from (vendor, kind, claim, dayBucket) so dedupe is automatic across user shares of the same incident."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const card = core.conscienceCard.buildConscienceCard(args as unknown as Parameters<typeof core.conscienceCard.buildConscienceCard>[0]);
    return { data: card, wisdom: `📣 card ${card.cardId} (${card.kind})`, confidence: { level: "high" } };
  },
};

export const cardRenderTool: MnemeTool = {
  name: "mneme.card.render",
  category: "meta",
  description: "📣 CARD — render a conscience card as shareable text (for X/tweet) + SVG (for screenshot/embed). No external refs.",
  whenToUse: "After mneme.card.build; surface to user for share.",
  triggers: ["card render", "shareable card"],
  inputSchema: { type: "object", properties: { card: { type: "object" }, width: { type: "number" }, height: { type: "number" } }, required: ["card"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Render this card", args: { card: {} }, expectedOutput: "{ text, svg }" }],
  pitfalls: ["SVG is self-contained — no fonts loaded — works as plain JPEG/PNG via any SVG→raster converter."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const card = args["card"] as Parameters<typeof core.conscienceCard.renderCardText>[0];
    const text = core.conscienceCard.renderCardText(card);
    const svg = core.conscienceCard.renderCardSvg(card, {
      width: typeof args["width"] === "number" ? args["width"] as number : undefined,
      height: typeof args["height"] === "number" ? args["height"] as number : undefined,
    });
    return { data: { text, svg }, wisdom: `📣 rendered ${text.length}-char text + ${svg.length}-char svg`, confidence: { level: "high" } };
  },
};

// ─── MAYOR ─────────────────────────────────────────────────────────────

export const mayorVoteTool: MnemeTool = {
  name: "mneme.mayor.vote",
  category: "lab",
  description: "👑 MAYOR — cast a vote for an AI vendor in the current term. HMAC-chained ledger prevents ballot-stuffing post-hoc. Returns null if vote outside term window.",
  whenToUse: "On every commit (caller wires); periodic election cycle (auto-rotate via mneme.mayor.rotate).",
  triggers: ["mayor vote", "vote vendor"],
  inputSchema: { type: "object", properties: { state: { type: "object" }, vendor: { type: "string" }, commitSha: { type: "string" } }, required: ["state", "vendor"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Vote for claude this commit", args: { state: {}, vendor: "claude" }, expectedOutput: "{ state, vote, reason? }" }],
  pitfalls: ["State must be persisted by caller; HMAC chain is the integrity primitive."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.mayorElection.recordVote(args as unknown as Parameters<typeof core.mayorElection.recordVote>[0]);
    return { data: r, wisdom: r.vote ? `👑 voted ${r.vote.vendor}` : `👑 vote REJECTED: ${r.reason}`, confidence: { level: r.vote ? "high" : "low" } };
  },
};

export const mayorTallyTool: MnemeTool = {
  name: "mneme.mayor.tally",
  category: "lab",
  description: "👑 MAYOR — tally current election (mid-term snapshot). Composite = 50% votes + 25% reputation + 15% fairness + 10% trick-test pass. Does NOT rotate.",
  whenToUse: "Status line; user dashboard; before rotation.",
  triggers: ["mayor tally", "election tally"],
  inputSchema: { type: "object", properties: { state: { type: "object" }, signals: { type: "array" } }, required: ["state"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Who's winning right now?", args: { state: {}, signals: [] }, expectedOutput: "{ winnerVendor, margin, scores, sig }" }],
  pitfalls: ["For rotation use mneme.mayor.rotate — tally is read-only."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.mayorElection.tallyElection({
      state: args["state"] as Parameters<typeof core.mayorElection.tallyElection>[0]["state"],
      signals: Array.isArray(args["signals"]) ? args["signals"] as Parameters<typeof core.mayorElection.tallyElection>[0]["signals"] : [],
    });
    return { data: r, wisdom: core.mayorElection.formatMayorLine(r), confidence: { level: "high" } };
  },
};

export const mayorRotateTool: MnemeTool = {
  name: "mneme.mayor.rotate",
  category: "lab",
  description: "👑 MAYOR — run scheduled election: tally + (if term ended) rotate to winner + reset ballot box. Idempotent mid-term.",
  whenToUse: "Periodic (daily/weekly) so post-term rotation fires when ready.",
  triggers: ["mayor rotate", "rotate mayor"],
  inputSchema: { type: "object", properties: { state: { type: "object" }, signals: { type: "array" } }, required: ["state"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Rotate mayor if term ended", args: { state: {}, signals: [] }, expectedOutput: "{ state, rotated, result }" }],
  pitfalls: ["After rotation the ballot box is fresh — older votes are summarised in lastResult."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.mayorElection.runScheduledElection({
      state: args["state"] as Parameters<typeof core.mayorElection.runScheduledElection>[0]["state"],
      signals: Array.isArray(args["signals"]) ? args["signals"] as Parameters<typeof core.mayorElection.runScheduledElection>[0]["signals"] : [],
    });
    return { data: r, wisdom: r.rotated ? `👑 rotated → ${r.state.currentMayor}` : `👑 mid-term (no rotation)`, confidence: { level: "high" } };
  },
};

export const V1937_TALK_OF_TOWN_TOOLS: MnemeTool[] = [
  protocolSpecTool, protocolValidateTool, protocolMintTool,
  browserDetectTool, browserExtractTool, browserMintTool,
  citizensAggregateTool, citizensReportTool,
  cardBuildTool, cardRenderTool,
  mayorVoteTool, mayorTallyTool, mayorRotateTool,
];
