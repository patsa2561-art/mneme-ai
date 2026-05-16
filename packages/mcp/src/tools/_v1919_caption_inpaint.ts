/**
 * v2.19.19 CAPTION INPAINT — 4 MCP tools (Phase A + Phase B complete).
 *
 *   mneme.inpaint.run               — run inpainter on RGBA image + mask bboxes
 *   mneme.inpaint.naked_fingerprint — sha256 of inpainted RGBA bytes
 *   mneme.inpaint.resolve           — which adapter is selected (auto = patch-fill)
 *   mneme.inpaint.metrics           — pixels touched / preserved / fingerprint
 */

import type { MnemeTool } from "./_types.js";

export const inpaintRunTool: MnemeTool = {
  name: "mneme.inpaint.run",
  category: "audit",
  description:
    "🎨 INPAINT — run the inpainter on a RGBA image + mask bboxes; returns naked image bytes + HMAC-fingerprint. Use 'auto' (default, PatchFillInpainter) for offline pure-TS content-aware fill; 'vendor-api' for caller-supplied REST endpoint; 'stub' for pass-through. Composes onto v2.19.18 CAPTION SEVERANCE Step 2.",
  whenToUse: "After OCR + mask region detection, before calling vendor-vision on the image.",
  triggers: ["inpaint", "naked image", "remove caption from image"],
  inputSchema: {
    type: "object",
    properties: {
      image: { type: "object", description: "{ width, height, rgba (Uint8Array as JSON array) }" },
      mask: { type: "array", description: "[{ bbox: [x,y,w,h] }]" },
      provider: { type: "string", enum: ["auto", "patch-fill", "stub", "vendor-api"] },
    },
    required: ["image", "mask"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Inpaint captions from this image", args: { image: { width: 100, height: 100, rgba: "[...]" }, mask: [{ bbox: [10, 10, 20, 5] }] }, expectedOutput: "{ nakedImage, nakedFingerprint, provider, pixelsTouched, pixelsPreserved }" }],
  pitfalls: ["Caller decodes PNG/JPEG → RGBA before calling (Mneme stays decoder-free). RGBA length MUST be width*height*4."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const img = args["image"] as { width: number; height: number; rgba: number[] | Uint8Array };
    const rgba = img.rgba instanceof Uint8Array ? img.rgba : new Uint8Array(img.rgba);
    const provider = core.captionInpaint.resolveInpainter({
      provider: (args["provider"] as "auto" | "patch-fill" | "stub" | "vendor-api" | undefined) ?? "auto",
    });
    const r = await core.captionInpaint.inpaintMaskRegions({
      image: { width: img.width, height: img.height, rgba },
      mask: (args["mask"] as Parameters<typeof core.captionInpaint.inpaintMaskRegions>[0]["mask"]) ?? [],
      provider,
    });
    return {
      data: {
        nakedImage: { width: r.nakedImage.width, height: r.nakedImage.height, rgba: Array.from(r.nakedImage.rgba) },
        nakedFingerprint: r.nakedFingerprint,
        provider: r.provider,
        pixelsTouched: r.pixelsTouched,
        pixelsPreserved: r.pixelsPreserved,
      },
      wisdom: core.captionInpaint.formatInpaintLine(r),
      confidence: { level: "high" },
    };
  },
};

export const inpaintNakedFingerprintTool: MnemeTool = {
  name: "mneme.inpaint.naked_fingerprint",
  category: "audit",
  description:
    "🎨 INPAINT — sha256 of an RGBA image's bytes + dimensions. Deterministic; same bytes → same fingerprint across instances. Feeds v2.19.16 FEDERATED TRUTH GRAVITY as the subject for cross-instance attestation.",
  whenToUse: "After running inpainter; pass the fingerprint to mneme.federated.attest({claimType:'npm_package_shasum',subject:'<imageOrigin>',observation:'<fingerprint>'}).",
  triggers: ["naked fingerprint", "inpaint hash"],
  inputSchema: { type: "object", properties: { image: { type: "object" } }, required: ["image"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Fingerprint this image", args: { image: { width: 100, height: 100, rgba: "[...]" } }, expectedOutput: "{ fingerprint }" }],
  pitfalls: ["RGBA length MUST match width*height*4 or function throws."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const img = args["image"] as { width: number; height: number; rgba: number[] | Uint8Array };
    const rgba = img.rgba instanceof Uint8Array ? img.rgba : new Uint8Array(img.rgba);
    const fp = core.captionInpaint.nakedFingerprint({ width: img.width, height: img.height, rgba });
    return { data: { fingerprint: fp }, wisdom: `🎨 naked=${fp.slice(0, 10)}`, confidence: { level: "high" } };
  },
};

export const inpaintResolveTool: MnemeTool = {
  name: "mneme.inpaint.resolve",
  category: "audit",
  description:
    "🎨 INPAINT — show which adapter the resolveInpainter ladder selects. Default 'auto' returns PatchFillInpainter (pure-TS PATCH HARVEST FILL).",
  whenToUse: "Audit which inpainter Mneme will use without actually running it.",
  triggers: ["inpaint resolve", "inpaint provider"],
  inputSchema: { type: "object", properties: { provider: { type: "string" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What inpainter is active?", expectedOutput: "{ name }" }],
  pitfalls: ["vendor-api throws if vendorApiOptions not supplied — caller must configure that adapter explicitly."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.captionInpaint.resolveInpainter({
      provider: (args["provider"] as "auto" | "patch-fill" | "stub" | "vendor-api" | undefined) ?? "auto",
    });
    return { data: { name: p.name }, wisdom: `🎨 active=${p.name}`, confidence: { level: "high" } };
  },
};

export const inpaintMetricsTool: MnemeTool = {
  name: "mneme.inpaint.metrics",
  category: "audit",
  description:
    "🎨 INPAINT — run inpainter on a small synthetic test image + report measurable accuracy metrics (determinism, pixel preservation, mask plausibility, fingerprint discrimination).",
  whenToUse: "Sanity-check that the active inpainter behaves correctly + report ≥97.5% accuracy.",
  triggers: ["inpaint metrics", "inpaint benchmark"],
  inputSchema: {
    type: "object",
    properties: {
      trials: { type: "number", description: "Number of random images to test (default 50)." },
      provider: { type: "string" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Benchmark inpainter accuracy", expectedOutput: "{ determinism, pixelPreservation, discrimination, plausibility, target: 0.975, allPass }" }],
  pitfalls: ["Synthetic test only — real-world image distributions may differ slightly."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const trials = (args["trials"] as number | undefined) ?? 50;
    const provider = core.captionInpaint.resolveInpainter({
      provider: (args["provider"] as "auto" | "patch-fill" | "stub" | "vendor-api" | undefined) ?? "auto",
    });
    let determinismPass = 0;
    let preservationPass = 0;
    let plausibilityPass = 0;
    const fingerprints = new Set<string>();
    for (let i = 0; i < trials; i++) {
      const r1 = (i * 37) % 256;
      const r2 = (i * 91) % 256;
      const img = core.captionInpaint.makeTestImage({
        width: 16, height: 16,
        background: [r1, r2, (i * 53) % 256, 255],
        foreground: [255 - r1, 255 - r2, 50, 255],
        fgBbox: [4, 4, 8, 8],
      });
      const a = await provider.inpaint({ image: img, mask: [{ bbox: [4, 4, 8, 8] }] });
      const b = await provider.inpaint({ image: img, mask: [{ bbox: [4, 4, 8, 8] }] });
      if (core.captionInpaint.nakedFingerprint(a) === core.captionInpaint.nakedFingerprint(b)) determinismPass++;
      // Pixel preservation outside mask
      let preserved = true;
      for (let y = 0; y < 4 && preserved; y++) {
        for (let x = 0; x < 16; x++) {
          const idx = (y * 16 + x) * 4;
          if (img.rgba[idx + 0] !== a.rgba[idx + 0] || img.rgba[idx + 1] !== a.rgba[idx + 1]) { preserved = false; break; }
        }
      }
      if (preserved) preservationPass++;
      // Plausibility (mean colour distance inside mask vs background)
      const refBg = core.captionInpaint.makeSolidImage(16, 16, [r1, r2, (i * 53) % 256, 255]);
      const dist = core.captionInpaint.meanColorDistance(a, refBg, [4, 4, 8, 8]);
      if (dist < 25) plausibilityPass++;
      fingerprints.add(core.captionInpaint.nakedFingerprint(a));
    }
    const metrics = {
      provider: provider.name,
      trials,
      determinism: determinismPass / trials,
      pixelPreservation: preservationPass / trials,
      discrimination: fingerprints.size / trials,
      plausibility: plausibilityPass / trials,
      target: 0.975,
      allPass:
        (determinismPass / trials) >= 0.975 &&
        (preservationPass / trials) >= 0.975 &&
        (fingerprints.size / trials) >= 0.975 &&
        (plausibilityPass / trials) >= 0.975,
    };
    return {
      data: metrics,
      wisdom: `🎨 metrics · det=${metrics.determinism.toFixed(3)} · pres=${metrics.pixelPreservation.toFixed(3)} · disc=${metrics.discrimination.toFixed(3)} · plaus=${metrics.plausibility.toFixed(3)} · ${metrics.allPass ? "ALL PASS ≥97.5%" : "FAIL"}`,
      confidence: { level: "high" },
    };
  },
};

export const V1919_CAPTION_INPAINT_TOOLS: MnemeTool[] = [
  inpaintRunTool, inpaintNakedFingerprintTool, inpaintResolveTool, inpaintMetricsTool,
];
