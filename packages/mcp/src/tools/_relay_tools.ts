/**
 * v1.85.0 -- MCP wrappers for RELAY PROTOCOL.
 */

import type { MnemeTool } from "./_types.js";

export const relayUploadTool: MnemeTool = {
  name: "mneme.relay.upload",
  category: "meta",
  description:
    "RELAY -- encrypt soul prompt with a NEXUS code + upload to an anonymous public paste (dpaste / paste.rs / 0x0.st). Returns URL + code + mobile-friendly prompt. No cloud deploy needed.",
  whenToUse:
    "Cross-device handover to a mobile AI app (Gemini / Claude / ChatGPT mobile) that does NOT have Mneme installed. The app fetches the URL, decrypts with the code, and resumes.",
  triggers: ["upload soul to paste", "share with mobile", "make it work on mobile"],
  inputSchema: {
    type: "object",
    properties: {
      soulText: { type: "string" },
      nexusCode: { type: "string" },
      backend: { type: "string", enum: ["dpaste", "pasters", "zero-x-zero"] },
    },
    required: ["soulText", "nexusCode"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Make this work on my phone Gemini app",
      args: { soulText: "# SOUL...", nexusCode: "K7M9X2" },
      expectedOutput: "{ url, code, mobilePrompt, qrPayload }",
    },
  ],
  pitfalls: [
    "Encrypted with AES-256-GCM derived from NEXUS code (200k PBKDF2 iterations). Combined with short TTL on paste services, ciphertext is safe.",
    "Mobile AI must support web fetch (Gemini/Claude/ChatGPT recent versions do).",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const soulText = String(args["soulText"] ?? "");
    const nexusCode = String(args["nexusCode"] ?? "");
    if (!soulText || !nexusCode) {
      return {
        data: { ok: false, reason: "soulText and nexusCode are required" },
        wisdom: "missing soulText or nexusCode",
        confidence: { level: "low" },
      };
    }
    const env = core.relay.encryptWithCode(soulText, nexusCode);
    const order = args["backend"]
      ? [args["backend"] as "dpaste" | "pasters" | "zero-x-zero"]
      : (["dpaste", "pasters", "zero-x-zero"] as const);
    const up = await core.relay.uploadWithFallback({ content: env.text }, [...order]);
    if (!up.ok || !up.url) {
      return {
        data: { ok: false, reason: up.reason },
        wisdom: `relay upload failed: ${up.reason}`,
        confidence: { level: "low" },
      };
    }
    // v1.87: emit FULL handoff artifact (QR + deep link + fallback)
    // alongside the existing mobile recipe. AI client shows QR; user
    // scans on phone; mobile AI opens with prompt pre-filled.
    const recipe = core.relay.renderMobileRecipe({ url: up.url, code: nexusCode });
    const handoff = core.relay.renderHandoff({ pasteUrl: up.url, nexusCode });
    return {
      data: {
        ok: true,
        backend: up.backend,
        expiresIn: up.expiresIn,
        recipe,
        handoff,
        algorithm: env.algorithm,
        iterations: env.iterations,
      },
      wisdom: `uploaded to ${up.backend} (${up.expiresIn}). Show user the QR (v${handoff.qr.version}, ${handoff.qr.size}x${handoff.qr.size} modules); they scan with phone camera and the AI app opens with the prompt ready.`,
      confidence: { level: "high" },
      secondBrain: { presentation: handoff.qr.svg + "\n\n" + handoff.instructions.qrScan + "\n\n" + handoff.instructions.tapLink },
    };
  },
};

export const relayDecryptTool: MnemeTool = {
  name: "mneme.relay.decrypt",
  category: "meta",
  description:
    "RELAY -- decrypt a fetched paste using a NEXUS code. Use on the receiving side (or via web AI) once the ciphertext + code are both in hand.",
  whenToUse: "Destination AI fetched the URL and has the ciphertext; user typed the NEXUS code.",
  triggers: ["decrypt soul", "decrypt with code"],
  inputSchema: {
    type: "object",
    properties: {
      envelope: { type: "string" },
      nexusCode: { type: "string" },
    },
    required: ["envelope", "nexusCode"],
  },
  outputSchema: { type: "object" },
  examples: [
    { userQuery: "Decrypt this with code K7M9X2", args: { envelope: "MNEME-NEXUS-ENC-1\n...", nexusCode: "K7M9X2" }, expectedOutput: "{ ok: true, plaintext: '# SOUL...' }" },
  ],
  pitfalls: ["wrong-code-or-tampered: the code was mistyped OR the ciphertext was modified in transit."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.relay.decryptWithCode(String(args["envelope"] ?? ""), String(args["nexusCode"] ?? ""));
    return {
      data: r,
      wisdom: r.ok ? `decrypted ${r.plaintext.length} chars` : `decrypt failed: ${r.reason}`,
      confidence: { level: r.ok ? "high" : "low" },
    };
  },
};

export const RELAY_TOOLS: MnemeTool[] = [relayUploadTool, relayDecryptTool];
