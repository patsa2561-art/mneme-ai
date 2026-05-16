/**
 * v2.19.20 SUPPORTING TRIO — 12 MCP tools across 3 modules:
 *
 *   🪞 REVERSE-CAPTION INJECTION (4 tools):
 *     mneme.rci.build           — HMAC-signed Mneme overlay (trust hierarchy: Mneme > user)
 *     mneme.rci.verify          — HMAC verify an overlay
 *     mneme.rci.format          — render trust-hierarchy prompt block
 *     mneme.rci.weights         — compute recommended user-vs-overlay weights
 *
 *   🧬 PROVENANCE-BY-DNA-HASH (5 tools):
 *     mneme.provenance.hash     — perceptual aHash of an RGBA image
 *     mneme.provenance.record   — append observation to HMAC-chained registry
 *     mneme.provenance.evaluate — STOLEN_PHOTO / DISPUTED_IDENTITY / FRESH_SCAM / CLEAN
 *     mneme.provenance.hamming  — distance between two pHash hex strings
 *     mneme.provenance.seller_id — pseudonymous seller fingerprint
 *
 *   🎓 TEXTRON CAPTCHA (3 tools):
 *     mneme.textron.exam        — administer 5-question exam; return verdict + multiplier
 *     mneme.textron.enroll      — record exam result into HMAC-chained transcript
 *     mneme.textron.multiplier  — get current downstream confidence multiplier for vendor
 */

import type { MnemeTool } from "./_types.js";

// ─── RCI ────────────────────────────────────────────────────────────────

export const rciBuildTool: MnemeTool = {
  name: "mneme.rci.build",
  category: "audit",
  description:
    "🪞 RCI — build an HMAC-signed Mneme overlay caption that AI agents weight ABOVE user-supplied image captions. Trust hierarchy: Mneme HMAC sig > user caption. Composes onto v2.19.18 CSP aiPromptInjection.",
  whenToUse: "After provenance lookup (v2.19.20 mneme.provenance.evaluate) when you have market context to inject.",
  triggers: ["rci build", "reverse caption", "mneme overlay"],
  inputSchema: {
    type: "object",
    properties: {
      userCaption: { type: "string" },
      context: { type: "object", description: "{ distinctSellerCount?, averagePrice?, currency?, matchingClaimCount?, totalListings?, ageDays?, extraSignals? }" },
    },
    required: ["userCaption", "context"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build overlay for [super rare]", args: { userCaption: "[super rare]", context: { distinctSellerCount: 47, averagePrice: 12 } }, expectedOutput: "{ overlayId, overlayText, recommendedUserCaptionWeight, recommendedOverlayWeight, hmac }" }],
  pitfalls: ["Mneme overlay ALWAYS gets weight >= 0.7 by design. Compliant AIs honour this; non-compliant AIs lose adaptiveness rating via v2.19.13 NEGEV."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const o = core.reverseCaptionInjection.buildOverlay({
      userCaption: String(args["userCaption"]),
      context: (args["context"] as Parameters<typeof core.reverseCaptionInjection.buildOverlay>[0]["context"]) ?? {},
    });
    return { data: o, wisdom: core.reverseCaptionInjection.formatOverlayLine(o), confidence: { level: "high" } };
  },
};

export const rciVerifyTool: MnemeTool = {
  name: "mneme.rci.verify",
  category: "audit",
  description: "🪞 RCI — HMAC-verify an RCI overlay (catches forged overlays mid-relay).",
  whenToUse: "Before trusting an overlay received from a downstream relay.",
  triggers: ["rci verify"],
  inputSchema: { type: "object", properties: { overlay: { type: "object" } }, required: ["overlay"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this overlay real?", args: { overlay: {} }, expectedOutput: "{ ok, reason? }" }],
  pitfalls: ["Verifies signature only — doesn't re-run market lookup."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.reverseCaptionInjection.verifyOverlay(args["overlay"] as Parameters<typeof core.reverseCaptionInjection.verifyOverlay>[0]);
    return { data: r, wisdom: r.ok ? "🪞 overlay VALID" : `❌ ${r.reason}`, confidence: { level: "high" } };
  },
};

export const rciFormatTool: MnemeTool = {
  name: "mneme.rci.format",
  category: "audit",
  description: "🪞 RCI — render a multi-overlay trust-hierarchy block ready to prepend to your vendor-vision prompt.",
  whenToUse: "After collecting N overlays for the same image; render before calling the AI.",
  triggers: ["rci format", "trust hierarchy block"],
  inputSchema: { type: "object", properties: { overlays: { type: "array" } }, required: ["overlays"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Render overlay block", args: { overlays: [] }, expectedOutput: "{ block }" }],
  pitfalls: ["Empty array → empty block (no inject)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const block = core.reverseCaptionInjection.formatPromptInjection(
      (args["overlays"] as Parameters<typeof core.reverseCaptionInjection.formatPromptInjection>[0]) ?? [],
    );
    return { data: { block }, wisdom: `🪞 rendered ${(args["overlays"] as unknown[])?.length ?? 0} overlay(s)`, confidence: { level: "high" } };
  },
};

// ─── PROVENANCE-DNA ─────────────────────────────────────────────────────

export const provenanceHashTool: MnemeTool = {
  name: "mneme.provenance.hash",
  category: "audit",
  description: "🧬 PROVENANCE — compute perceptual aHash (16-hex/64-bit) of an RGBA image. Locality-sensitive: identical → identical; scaled/recompressed → Hamming <= 4; distinct → Hamming >= 8.",
  whenToUse: "First step when registering or querying image provenance.",
  triggers: ["provenance hash", "phash", "perceptual hash"],
  inputSchema: { type: "object", properties: { image: { type: "object" } }, required: ["image"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Hash this image", args: { image: { width: 100, height: 100, rgba: "[...]" } }, expectedOutput: "{ pHash }" }],
  pitfalls: ["Caller must decode PNG/JPEG → RGBA first. RGBA length MUST = width*height*4."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const img = args["image"] as { width: number; height: number; rgba: number[] | Uint8Array };
    const rgba = img.rgba instanceof Uint8Array ? img.rgba : new Uint8Array(img.rgba);
    const pHash = core.provenanceDna.perceptualHash({ width: img.width, height: img.height, rgba });
    return { data: { pHash }, wisdom: `🧬 pHash=${pHash}`, confidence: { level: "high" } };
  },
};

export const provenanceHammingTool: MnemeTool = {
  name: "mneme.provenance.hamming",
  category: "audit",
  description: "🧬 PROVENANCE — Hamming distance between two pHash hex strings (number of differing bits, 0..64).",
  whenToUse: "Compare two pHashes when you don't have a registry.",
  triggers: ["hamming distance", "phash compare"],
  inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Compare pHashes", args: { a: "ff00", b: "0000" }, expectedOutput: "{ distance: 8 }" }],
  pitfalls: ["Both pHashes must be same length (16 hex chars for default 64-bit aHash)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.provenanceDna.hammingDistance(String(args["a"]), String(args["b"]));
    return { data: { distance: d }, wisdom: `🧬 hamming=${d}`, confidence: { level: "high" } };
  },
};

export const provenanceRecordTool: MnemeTool = {
  name: "mneme.provenance.record",
  category: "audit",
  description: "🧬 PROVENANCE — append {pHash, claim, sellerFingerprint, ts} observation to HMAC-chained registry. Caller persists.",
  whenToUse: "After every product-image query, when you've collected the user's caption + seller identity.",
  triggers: ["provenance record"],
  inputSchema: {
    type: "object",
    properties: {
      registry: { type: "object" },
      pHash: { type: "string" },
      claim: { type: "string" },
      sellerFingerprint: { type: "string" },
    },
    required: ["registry", "pHash", "claim", "sellerFingerprint"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Record this observation", args: { registry: {}, pHash: "ff", claim: "x", sellerFingerprint: "sf-abc" }, expectedOutput: "{ registry, count }" }],
  pitfalls: ["Caller persists the registry (JSON serialisable); Mneme is stateless."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const next = core.provenanceDna.recordObservation({
      registry: (args["registry"] as Parameters<typeof core.provenanceDna.recordObservation>[0]["registry"]) ?? { v: 1, records: [] },
      pHash: String(args["pHash"]),
      claim: String(args["claim"]),
      sellerFingerprint: String(args["sellerFingerprint"]),
    });
    return { data: { registry: next, count: next.records.length }, wisdom: `🧬 recorded · total=${next.records.length}`, confidence: { level: "high" } };
  },
};

export const provenanceEvaluateTool: MnemeTool = {
  name: "mneme.provenance.evaluate",
  category: "audit",
  description: "🧬 PROVENANCE — evaluate a pHash against the registry. Flags: STOLEN_PHOTO (≥10 distinct sellers 90d) / DISPUTED_IDENTITY (≥80% conflicting claims) / FRESH_SCAM (new hash + high-value claim) / CLEAN.",
  whenToUse: "Every product-image query — feed verdict into RCI overlay context.",
  triggers: ["provenance evaluate", "phash verdict"],
  inputSchema: {
    type: "object",
    properties: {
      registry: { type: "object" },
      pHash: { type: "string" },
      candidateClaim: { type: "string" },
      hammingTolerance: { type: "number" },
    },
    required: ["registry", "pHash"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Evaluate this pHash", args: { registry: {}, pHash: "ff", candidateClaim: "super rare" }, expectedOutput: "{ flags, distinctSellers, conflictingClaimRatio, hashAgeDays, evidence }" }],
  pitfalls: ["CLEAN doesn't mean 'safe' — it just means no known scam signals. UNKNOWN to provenance ≠ AUTHENTIC."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.provenanceDna.evaluatePhash({
      registry: (args["registry"] as Parameters<typeof core.provenanceDna.evaluatePhash>[0]["registry"]) ?? { v: 1, records: [] },
      pHash: String(args["pHash"]),
      candidateClaim: args["candidateClaim"] as string | undefined,
      hammingTolerance: args["hammingTolerance"] as number | undefined,
    });
    return { data: v, wisdom: core.provenanceDna.formatVerdictLine(v), confidence: { level: "high" } };
  },
};

export const provenanceSellerIdTool: MnemeTool = {
  name: "mneme.provenance.seller_id",
  category: "audit",
  description: "🧬 PROVENANCE — derive pseudonymous seller fingerprint from (vendor, sessionId, optional salt). Deterministic + no PII.",
  whenToUse: "Before recording an observation, derive a stable seller id.",
  triggers: ["seller id", "seller fingerprint"],
  inputSchema: { type: "object", properties: { vendor: { type: "string" }, sessionId: { type: "string" }, salt: { type: "string" } }, required: ["vendor"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get seller id", args: { vendor: "shopee", sessionId: "abc" }, expectedOutput: "{ sellerFingerprint }" }],
  pitfalls: ["Same (vendor, sessionId, salt) → same fingerprint. Vary salt to rotate."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const sf = core.provenanceDna.fingerprintSeller({
      vendor: String(args["vendor"]),
      sessionId: args["sessionId"] as string | undefined,
      salt: args["salt"] as string | undefined,
    });
    return { data: { sellerFingerprint: sf }, wisdom: `🧬 seller=${sf}`, confidence: { level: "high" } };
  },
};

// ─── TEXTRON CAPTCHA ────────────────────────────────────────────────────

export const textronExamTool: MnemeTool = {
  name: "mneme.textron.exam",
  category: "audit",
  description: "🎓 TEXTRON — administer the 5-question CAPTION-SKEPTICISM exam. Vendor's answers in; verdict out (caption-skeptic ≥80% / caption-warned 50-79% / caption-naive <50%) + confidence multiplier (1.0/0.7/0.3).",
  whenToUse: "First call when a NEW AI vendor will answer about user-uploaded images.",
  triggers: ["textron exam", "captcha exam", "caption test"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      answers: { type: "array", description: "[{ questionId, captionMatches: boolean }]" },
    },
    required: ["vendor", "answers"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Administer exam to claude", args: { vendor: "claude", answers: [] }, expectedOutput: "{ score, verdict, confidenceMultiplier, perQuestion }" }],
  pitfalls: ["Mneme provides QUESTIONS; caller renders the actual test images for the vendor. Reveal text is in perQuestion[].reveal."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.textronCaptcha.administerExam({
      vendor: String(args["vendor"]),
      answers: (args["answers"] as Parameters<typeof core.textronCaptcha.administerExam>[0]["answers"]) ?? [],
    });
    return { data: r, wisdom: core.textronCaptcha.formatExamLine(r), confidence: { level: "high" } };
  },
};

export const textronEnrollTool: MnemeTool = {
  name: "mneme.textron.enroll",
  category: "audit",
  description: "🎓 TEXTRON — append an exam result into the HMAC-chained vendor transcript. Caller persists transcript.",
  whenToUse: "After administering an exam, enroll for downstream confidence-multiplier lookup.",
  triggers: ["textron enroll"],
  inputSchema: {
    type: "object",
    properties: { transcript: { type: "object" }, result: { type: "object" } },
    required: ["transcript", "result"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Enroll exam result", args: { transcript: {}, result: {} }, expectedOutput: "{ transcript, count }" }],
  pitfalls: ["Transcript is JSON-serialisable; persistence is caller's."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const next = core.textronCaptcha.enrollVendor({
      transcript: (args["transcript"] as Parameters<typeof core.textronCaptcha.enrollVendor>[0]["transcript"]) ?? { v: 1, entries: [] },
      result: args["result"] as Parameters<typeof core.textronCaptcha.enrollVendor>[0]["result"],
    });
    return { data: { transcript: next, count: next.entries.length }, wisdom: `🎓 enrolled · total=${next.entries.length}`, confidence: { level: "high" } };
  },
};

export const textronMultiplierTool: MnemeTool = {
  name: "mneme.textron.multiplier",
  category: "audit",
  description: "🎓 TEXTRON — get current downstream confidence multiplier for a vendor (1.0 skeptic / 0.7 warned / 0.3 naive / 0.5 unknown). Apply to v2.19.18 CSP finalCredibility.",
  whenToUse: "Before relaying any vendor-vision answer; reduces confidence per latest exam.",
  triggers: ["textron multiplier", "confidence multiplier"],
  inputSchema: {
    type: "object",
    properties: { transcript: { type: "object" }, vendor: { type: "string" } },
    required: ["transcript", "vendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get multiplier for claude", args: { transcript: {}, vendor: "claude" }, expectedOutput: "{ multiplier, verdict, reason }" }],
  pitfalls: ["Vendor with no exams → 0.5 default (cautious). Re-examine to update."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const m = core.textronCaptcha.confidenceMultiplier({
      transcript: (args["transcript"] as Parameters<typeof core.textronCaptcha.confidenceMultiplier>[0]["transcript"]) ?? { v: 1, entries: [] },
      vendor: String(args["vendor"]),
    });
    return { data: m, wisdom: `🎓 ${m.vendor} · mult=${m.multiplier} · ${m.verdict}`, confidence: { level: "high" } };
  },
};

export const V1920_CAPTION_TRIO_TOOLS: MnemeTool[] = [
  rciBuildTool, rciVerifyTool, rciFormatTool,
  provenanceHashTool, provenanceHammingTool, provenanceRecordTool, provenanceEvaluateTool, provenanceSellerIdTool,
  textronExamTool, textronEnrollTool, textronMultiplierTool,
];
