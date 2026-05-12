/**
 * v1.87.0 -- regression suite covering the QR/handoff/NATURAL changes.
 */

import { describe, it, expect } from "vitest";

import { encodeQRReal } from "./synapse/qr_real.js";
import { buildDeepLink, bestDeepLink, composePrompt } from "./relay/deep_link.js";
import { renderHandoff } from "./relay/handoff_artifact.js";
import { renderMobileRecipe } from "./relay/mobile_recipe.js";
import { routeIntent } from "./lattice/intent_atoms.js";

describe("v1.87 SYNAPSE · real QR encoder", () => {
  it("encodes a short URL into a valid SVG", () => {
    const q = encodeQRReal("https://dpaste.com/abc123");
    expect(q.svg).toContain("<svg");
    expect(q.svg).toContain("</svg>");
    expect(q.version).toBeGreaterThanOrEqual(1);
    expect(q.version).toBeLessThanOrEqual(10);
    expect(q.size).toBeGreaterThanOrEqual(21);
  });

  it("scales version with payload length", () => {
    const small = encodeQRReal("hi");
    const large = encodeQRReal("x".repeat(200));
    expect(large.version).toBeGreaterThanOrEqual(small.version);
  });

  it("matrix is square + version-correct", () => {
    const q = encodeQRReal("hello world");
    expect(q.matrix.length).toBe(q.size);
    for (const row of q.matrix) expect(row.length).toBe(q.size);
    expect(q.size).toBe(21 + 4 * (q.version - 1));
  });

  it("mask index is 0..7", () => {
    const q = encodeQRReal("test");
    expect(q.mask).toBeGreaterThanOrEqual(0);
    expect(q.mask).toBeLessThanOrEqual(7);
  });

  it("throws when payload too large for v1-10", () => {
    expect(() => encodeQRReal("x".repeat(400))).toThrow(/payload too large/);
  });
});

describe("v1.87 RELAY · deep link builder", () => {
  it("composePrompt is short + complete", () => {
    const p = composePrompt("https://dpaste.com/abc", "K7M9X2");
    expect(p).toContain("Fetch https://dpaste.com/abc");
    // v1.87: shortened wording -- code appears as "code K7M9X2" inside the AES clause.
    expect(p).toContain("K7M9X2");
    expect(p.toLowerCase()).toContain("code");
    expect(p.length).toBeLessThan(250);
  });

  it("buildDeepLink for Gemini produces a URL with the prompt as ?q=", () => {
    const dl = buildDeepLink({ pasteUrl: "https://dpaste.com/x", nexusCode: "ABC123", vendor: "gemini" });
    expect(dl.url.startsWith("https://gemini.google.com/?q=")).toBe(true);
    expect(dl.fitsInQR).toBe(true);
  });

  it("buildDeepLink for ChatGPT uses chat.openai.com", () => {
    const dl = buildDeepLink({ pasteUrl: "https://dpaste.com/x", nexusCode: "ABC123", vendor: "chatgpt" });
    expect(dl.url.startsWith("https://chat.openai.com/?q=")).toBe(true);
  });

  it("vendor='any' returns the prompt verbatim (copy-only fallback)", () => {
    const dl = buildDeepLink({ pasteUrl: "https://dpaste.com/x", nexusCode: "ABC123", vendor: "any" });
    expect(dl.url).toBe(dl.prompt);
  });

  it("bestDeepLink picks the shortest fitting URL", () => {
    const best = bestDeepLink({ pasteUrl: "https://paste.rs/aBc", nexusCode: "K7M9X2" });
    expect(best.fitsInQR).toBe(true);
    expect(best.url.length).toBeLessThan(270);
  });
});

describe("v1.87 RELAY · handoff artifact", () => {
  it("renderHandoff bundles QR + deep link + fallback", () => {
    const h = renderHandoff({ pasteUrl: "https://dpaste.com/abc", nexusCode: "K7M9X2" });
    expect(h.pasteUrl).toBe("https://dpaste.com/abc");
    expect(h.nexusCode).toBe("K7M9X2");
    expect(h.qr.svg).toContain("<svg");
    expect(h.qr.version).toBeGreaterThanOrEqual(1);
    expect(h.deepLink.url.length).toBeGreaterThan(0);
    expect(h.copyFallback).toContain("K7M9X2");
    expect(h.instructions.qrScan.toLowerCase()).toContain("scan");
    expect(h.instructions.tapLink).toContain("http");
    expect(h.instructions.manualCopy).toContain("copy");
  });

  it("honors vendor override", () => {
    const h = renderHandoff({ pasteUrl: "https://dpaste.com/abc", nexusCode: "X", vendor: "claude" });
    expect(h.deepLink.vendor).toBe("claude");
    expect(h.deepLink.url).toContain("claude.ai");
  });
});

describe("v1.87 RELAY · renderMobileRecipe API fix", () => {
  it("accepts object args (object form)", () => {
    const r = renderMobileRecipe({ url: "https://dpaste.com/x", code: "K7M9X2" });
    expect(r.url).toBe("https://dpaste.com/x");
    expect(r.code).toBe("K7M9X2");
  });

  it("still accepts positional args (backwards compat)", () => {
    const r = renderMobileRecipe("https://dpaste.com/x", "K7M9X2");
    expect(r.url).toBe("https://dpaste.com/x");
    expect(r.code).toBe("K7M9X2");
  });
});

describe("v1.87 NATURAL · new atom routing", () => {
  it("'code doesnt work' routes to troubleshoot", () => {
    const m = routeIntent("code doesnt work");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.synapse.resolve_code");
  });

  it("'send to gemini app' routes to relay.upload", () => {
    const m = routeIntent("send to gemini app");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.relay.upload");
  });

  it("'mobile handover' routes to relay.upload", () => {
    const m = routeIntent("mobile handover please");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.relay.upload");
  });

  it("'scan qr' routes to QR-based handover", () => {
    const m = routeIntent("scan qr code please");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.relay.upload");
  });

  it("Thai 'พิมพ์มือถือไม่ได้' routes to troubleshoot", () => {
    const m = routeIntent("พิมพ์มือถือไม่ได้");
    expect(m).not.toBeNull();
    expect(m!.atom.tool).toBe("mneme.synapse.resolve_code");
  });
});
