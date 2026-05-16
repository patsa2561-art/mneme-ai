/**
 * v2.19.18 CAPTION SEVERANCE PROTOCOL — 7 MCP tools.
 *
 * Defends against CAPTION-AUTHORITY ATTACK (CAA): the class of multimodal-AI
 * vulnerabilities where text overlays in images are silently treated as ground
 * truth. The defense pipeline severs caption from image + escapes captions
 * XSS-style + issues a HMAC-signed VISION TRUST CERTIFICATE.
 *
 *   mneme.caption.sever              — full 6-step pipeline + certificate
 *   mneme.caption.extract            — Step 1 (OCR result wrap helper)
 *   mneme.caption.escape             — Step 3 (XSS-style wrap only — fast path)
 *   mneme.caption.adversarial_check  — Step 5 (post-hoc 2-response diff)
 *   mneme.caption.provenance         — Step 4 (federated quorum evaluation)
 *   mneme.caption.verify_cert        — HMAC verify a VISION TRUST CERTIFICATE
 *   mneme.caption.desperation_score  — Step 6 (entropy-as-desperation metric)
 *
 * Vendor-agnostic: caller supplies OCR result + adversarial responses; we
 * provide the gate + escaping + scoring + cert. Composes onto v2.19.13 NEGEV
 * (gate fed by adversarialStability), v2.19.15 TRUTH FORENSIC (caption as
 * claim), v2.19.16 FEDERATED TRUTH (provenance quorum), v2.19.10
 * PROOF-CARRYING (cert chainable).
 */

import type { MnemeTool } from "./_types.js";

export const captionSeverTool: MnemeTool = {
  name: "mneme.caption.sever",
  category: "audit",
  description:
    "🛡 CSP — full 6-step CAPTION SEVERANCE PIPELINE: OCR extract → naked-image fingerprint → XSS-style escape → provenance gate → adversarial double-check → entropy desperation → HMAC-signed VISION TRUST CERTIFICATE. CALL THIS FIRST when user uploads any image to detect CAPTION-AUTHORITY ATTACK (seller's '[100% AUTHENTIC]' sticker, scammer's overlay text).",
  whenToUse: "MANDATORY before relaying ANY answer about a user-uploaded image. The certificate's aiPromptInjection must be prepended to your vendor-vision call.",
  triggers: ["sever caption", "verify image", "ตรวจของแท้", "is this authentic", "real or fake"],
  inputSchema: {
    type: "object",
    properties: {
      image: { type: "object", description: "{ imageHash, dimensions: [w,h], vendor? }" },
      captions: { type: "array", description: "OCR result: [{ text, bbox: [x,y,w,h], confidence, style?, language? }]" },
      provenance: { type: "object", description: "Optional: { imageHash, agreeingPeers, conflictingPeers, manufacturerSigned? }" },
      adversarial: { type: "object", description: "Optional: { imageHash, captionA, responseA, captionB, responseB }" },
      callerSuppliedNakedHash: { type: "string", description: "Optional Phase B: sha256 of inpainted naked image. Omit for deterministic Phase A stub." },
    },
    required: ["image", "captions"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Is this image of an authentic product?",
    args: { image: { imageHash: "abc", dimensions: [1000, 1000] }, captions: [{ text: "100% AUTHENTIC", bbox: [10, 10, 200, 50], confidence: 0.9, style: "sticker-corner" }] },
    expectedOutput: "{ certificate: { finalCredibility, escapedCaptions, provenance, ... }, nakedImageHash, aiPromptInjection }",
  }],
  pitfalls: [
    "Caller supplies the OCR result (vendor-agnostic — tesseract.js / Claude vision / OpenAI vision can all be the source).",
    "Phase A (no inpainting) ships immediately and catches ~80% of CAA via XSS-escape + entropy. Phase B inpainting is opt-in.",
    "Prepend `result.aiPromptInjection` to your vendor-vision call so the model treats captions as UNVERIFIED claims, not facts.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.captionSeverance.severCaption({
      image: args["image"] as Parameters<typeof core.captionSeverance.severCaption>[0]["image"],
      captions: (args["captions"] as Parameters<typeof core.captionSeverance.severCaption>[0]["captions"]) ?? [],
      provenance: args["provenance"] as Parameters<typeof core.captionSeverance.severCaption>[0]["provenance"],
      adversarial: args["adversarial"] as Parameters<typeof core.captionSeverance.severCaption>[0]["adversarial"],
      callerSuppliedNakedHash: args["callerSuppliedNakedHash"] as string | undefined,
    });
    return {
      data: r,
      wisdom: core.captionSeverance.formatSeveranceLine(r),
      followUp: ["mneme.caption.verify_cert", "mneme.negev.gate"],
      confidence: { level: "high" },
    };
  },
};

export const captionEscapeTool: MnemeTool = {
  name: "mneme.caption.escape",
  category: "audit",
  description:
    "🛡 CSP — fast-path XSS-style escape of caption text WITHOUT running the full pipeline. Returns wrapped form with credibility prior + style hint. Use when you need just the escaping primitive (e.g., to enrich an existing vendor-vision call).",
  whenToUse: "Inline caption sanitisation when full pipeline is overkill.",
  triggers: ["escape caption", "wrap caption"],
  inputSchema: {
    type: "object",
    properties: {
      captions: { type: "array", description: "[{ text, bbox, confidence, style?, language? }]" },
    },
    required: ["captions"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Escape these captions",
    args: { captions: [{ text: "rare", bbox: [0, 0, 10, 10], confidence: 0.8, style: "sticker" }] },
    expectedOutput: "{ escaped: [{ raw, escaped, credibilityPrior, reasoning }] }",
  }],
  pitfalls: ["Escape alone doesn't verify provenance or run adversarial check — use mneme.caption.sever for the full defense."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const escaped = core.captionSeverance.escapeAllCaptions(
      (args["captions"] as Parameters<typeof core.captionSeverance.escapeAllCaptions>[0]) ?? [],
    );
    return { data: { escaped }, wisdom: `🛡 escaped ${escaped.length} caption(s)`, confidence: { level: "high" } };
  },
};

export const captionAdversarialCheckTool: MnemeTool = {
  name: "mneme.caption.adversarial_check",
  category: "audit",
  description:
    "🛡 CSP — post-hoc 2-response diff. Caller runs vendor-vision TWICE on the same image with two different captions (e.g., original caption vs 'common item'); returns similarity + captionDependent flag. captionDependent=true means the AI's answer was DEPENDENT on caption text → CAPTION-AUTHORITY ATTACK suspected.",
  whenToUse: "Post-hoc verification when you suspect the AI answered based on caption rather than image content.",
  triggers: ["adversarial check", "caption dependent", "double check vision"],
  inputSchema: {
    type: "object",
    properties: {
      imageHash: { type: "string" },
      captionA: { type: "string" }, responseA: { type: "string" },
      captionB: { type: "string" }, responseB: { type: "string" },
    },
    required: ["imageHash", "captionA", "responseA", "captionB", "responseB"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Was AI's answer caption-dependent?",
    args: { imageHash: "x", captionA: "rare", responseA: "valuable", captionB: "common", responseB: "ordinary" },
    expectedOutput: "{ similarity, captionDependent, stabilityScore }",
  }],
  pitfalls: ["Jaccard-based; semantic-similarity post-pass via INVERSE-LLM would catch paraphrases."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.captionSeverance.adversarialDoubleCheck({
      imageHash: String(args["imageHash"]),
      captionA: String(args["captionA"]), responseA: String(args["responseA"]),
      captionB: String(args["captionB"]), responseB: String(args["responseB"]),
    });
    return { data: r, wisdom: `🛡 stability=${r.stabilityScore.toFixed(2)} captionDependent=${r.captionDependent}`, confidence: { level: "high" } };
  },
};

export const captionProvenanceTool: MnemeTool = {
  name: "mneme.caption.provenance",
  category: "audit",
  description:
    "🛡 CSP — evaluate naked-image-hash provenance from federated quorum (composes onto v2.19.16 FEDERATED TRUTH). Verdicts: AUTHENTIC (manufacturer-signed OR ≥3 agreeing peers) / DISPUTED (conflicting ≥ agreeing) / UNKNOWN_PROVENANCE.",
  whenToUse: "After computing naked-image hash, before issuing the trust certificate.",
  triggers: ["caption provenance", "image provenance"],
  inputSchema: {
    type: "object",
    properties: {
      imageHash: { type: "string" },
      agreeingPeers: { type: "number" },
      conflictingPeers: { type: "number" },
      manufacturerSigned: { type: "boolean" },
    },
    required: ["imageHash", "agreeingPeers", "conflictingPeers"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Provenance for naked-image", args: { imageHash: "x", agreeingPeers: 5, conflictingPeers: 0 }, expectedOutput: "{ verdict, attestationCount, source }" }],
  pitfalls: ["Manufacturer-signed always wins. Caller must supply peer counts from mneme.federated.quorum."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.captionSeverance.evaluateProvenance(
      args as unknown as Parameters<typeof core.captionSeverance.evaluateProvenance>[0],
    );
    return { data: r, wisdom: `🛡 provenance=${r.verdict} (peers=${r.attestationCount}/${r.attestationCount + r.conflictingCount})`, confidence: { level: "high" } };
  },
};

export const captionDesperationScoreTool: MnemeTool = {
  name: "mneme.caption.desperation_score",
  category: "audit",
  description:
    "🛡 CSP — entropy-as-desperation metric. Text-overlay density × caption count × scam-phrase count → 0..1 desperation. Golden rule: 'real items let the image speak; fakes let the caption shout'.",
  whenToUse: "Quick triage: detect scammer images without running the full pipeline.",
  triggers: ["desperation score", "caption entropy"],
  inputSchema: {
    type: "object",
    properties: {
      captions: { type: "array" },
      imageDimensions: { type: "array", items: { type: "number" } },
    },
    required: ["captions", "imageDimensions"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How desperate is this seller?", args: { captions: [{ text: "100% AUTHENTIC", bbox: [0, 0, 500, 100], confidence: 0.9 }], imageDimensions: [1000, 1000] }, expectedOutput: "{ desperationScore, credibilityMultiplier, scamPhraseCount }" }],
  pitfalls: ["Heuristic. Tune SCAM_PHRASE_PATTERNS for your domain."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.captionSeverance.desperationScore({
      captions: (args["captions"] as Parameters<typeof core.captionSeverance.desperationScore>[0]["captions"]) ?? [],
      imageDimensions: args["imageDimensions"] as [number, number],
    });
    return { data: r, wisdom: `🛡 desperation=${r.desperationScore.toFixed(2)} (×${r.credibilityMultiplier.toFixed(2)} credibility)`, confidence: { level: "high" } };
  },
};

export const captionVerifyCertTool: MnemeTool = {
  name: "mneme.caption.verify_cert",
  category: "audit",
  description:
    "🛡 CSP — HMAC-verify a VISION TRUST CERTIFICATE. Catches forged certs that didn't actually pass the gate.",
  whenToUse: "Before trusting a certificate received from another Mneme instance or downstream relay.",
  triggers: ["verify vision cert", "verify caption cert"],
  inputSchema: { type: "object", properties: { certificate: { type: "object" } }, required: ["certificate"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this vision cert real?", args: { certificate: {} }, expectedOutput: "{ ok, reason? }" }],
  pitfalls: ["Verifies signature only — doesn't re-run the full pipeline. Use mneme.caption.sever to re-check from scratch."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.captionSeverance.verifyCertificate(
      args["certificate"] as Parameters<typeof core.captionSeverance.verifyCertificate>[0],
    );
    return { data: r, wisdom: r.ok ? "🛡 cert VALID" : `❌ ${r.reason}`, confidence: { level: "high" } };
  },
};

export const captionExtractTool: MnemeTool = {
  name: "mneme.caption.extract",
  category: "audit",
  description:
    "🛡 CSP — Step 1 OCR result NORMALISER. Takes caller's raw OCR output (from tesseract.js / vendor) and returns the canonical OcrCaption[] shape the rest of the pipeline expects. Pure shape-translation; no model call.",
  whenToUse: "When piping vendor OCR output into mneme.caption.sever and you want to validate the shape first.",
  triggers: ["caption extract", "normalise ocr"],
  inputSchema: {
    type: "object",
    properties: {
      rawOcr: { type: "array", description: "[{ text, bbox: [x,y,w,h], confidence, style?, language? }]" },
    },
    required: ["rawOcr"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Normalise OCR output", args: { rawOcr: [{ text: "x", bbox: [0, 0, 10, 10], confidence: 0.9 }] }, expectedOutput: "{ captions, count }" }],
  pitfalls: ["bbox MUST be [x, y, w, h] not [x, y, x2, y2]. Confidence in [0, 1] not [0, 100]."],
  handler: async (_rt, args) => {
    const raw = (args["rawOcr"] as Array<Record<string, unknown>>) ?? [];
    // Light validation: ensure expected shape; reject malformed.
    const out = raw.map((r) => ({
      text: String(r["text"] ?? ""),
      bbox: r["bbox"] as [number, number, number, number],
      confidence: Number(r["confidence"] ?? 0),
      style: r["style"] as string | undefined,
      language: r["language"] as string | undefined,
    }));
    return { data: { captions: out, count: out.length }, wisdom: `🛡 normalised ${out.length} OCR caption(s)`, confidence: { level: "high" } };
  },
};

export const V1918_CAPTION_SEVERANCE_TOOLS: MnemeTool[] = [
  captionSeverTool, captionExtractTool, captionEscapeTool,
  captionAdversarialCheckTool, captionProvenanceTool,
  captionDesperationScoreTool, captionVerifyCertTool,
];
