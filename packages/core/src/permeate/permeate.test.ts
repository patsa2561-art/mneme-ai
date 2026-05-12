/**
 * v1.74.0 -- PERMEATE PROTOCOL test suite.
 */

import { describe, it, expect } from "vitest";

import { generateUserscript } from "./userscript_generator.js";
import { generateBookmarklet } from "./bookmarklet_generator.js";
import { EDITOR_INTEGRATIONS, reportIntegrations, filterIntegrations } from "./editor_integration_map.js";
import { TRANSPORT_OPTIONS, recommendTransport } from "./transport_menu.js";

// ─── P1 USERSCRIPT GENERATOR ─────────────────────────────────────────

describe("v1.74 Permeate P1 · Userscript Generator", () => {
  it("produces valid Tampermonkey header + body", () => {
    const a = generateUserscript({ mnemeVersion: "1.74.0" });
    expect(a.content).toContain("// ==UserScript==");
    expect(a.content).toContain("// ==/UserScript==");
    expect(a.content).toContain("@match        https://chatgpt.com/*");
    expect(a.content).toContain("@match        https://gemini.google.com/*");
    expect(a.content).toContain("@match        https://claude.ai/*");
  });

  it("includes all 6 target sites", () => {
    const a = generateUserscript({ mnemeVersion: "1.74.0" });
    expect(a.content).toContain("chatgpt.com");
    expect(a.content).toContain("openai.com");
    expect(a.content).toContain("gemini.google.com");
    expect(a.content).toContain("claude.ai");
    expect(a.content).toContain("copilot.microsoft.com");
    expect(a.content).toContain("deepseek.com");
  });

  it("includes bridge fetch block when bridgeUrl set", () => {
    const a = generateUserscript({ mnemeVersion: "1.74.0", bridgeUrl: "http://127.0.0.1:11434", bridgeToken: "tok" });
    expect(a.content).toContain("BRIDGE_URL");
    expect(a.content).toContain("http://127.0.0.1:11434");
  });

  it("filename follows convention", () => {
    const a = generateUserscript({ mnemeVersion: "1.74.0" });
    expect(a.filename).toMatch(/mneme-soul-injector.*\.user\.js$/);
  });

  it("install note guides user step-by-step", () => {
    const a = generateUserscript({ mnemeVersion: "1.74.0" });
    expect(a.installNote).toContain("Tampermonkey");
    expect(a.installNote).toContain("💉");
  });
});

// ─── P2 BOOKMARKLET GENERATOR ────────────────────────────────────────

describe("v1.74 Permeate P2 · Bookmarklet Generator", () => {
  it("produces a valid javascript: URI", () => {
    const a = generateBookmarklet();
    expect(a.uri.startsWith("javascript:")).toBe(true);
  });

  it("contains the Mneme soul check substring", () => {
    const a = generateBookmarklet();
    expect(decodeURIComponent(a.uri)).toContain("MNEME SOUL PROMPT");
  });

  it("instructions guide setup + injection", () => {
    const a = generateBookmarklet();
    expect(a.instructions.length).toBeGreaterThanOrEqual(5);
    expect(a.instructions.join("\n")).toContain("bookmark");
  });

  it("warning fires when URI exceeds maxChars", () => {
    const a = generateBookmarklet({ maxChars: 50 });
    expect(a.warning).not.toBeNull();
  });

  it("name includes injector emoji", () => {
    const a = generateBookmarklet();
    expect(a.name).toContain("💉");
  });
});

// ─── P3 EDITOR INTEGRATION MAP ───────────────────────────────────────

describe("v1.74 Permeate P3 · Editor Integration Map", () => {
  it("tracks at least 15 AI tools", () => {
    expect(EDITOR_INTEGRATIONS.length).toBeGreaterThanOrEqual(15);
  });

  it("editor-based tools are native-mcp or parasite-bridge (working)", () => {
    const editorTools = EDITOR_INTEGRATIONS.filter((i) => i.surface === "editor-extension" || i.surface === "cli");
    for (const t of editorTools) {
      expect(["native-mcp", "parasite-bridge", "partial"]).toContain(t.integration);
    }
  });

  it("browser-only tools need paste", () => {
    const browserTools = EDITOR_INTEGRATIONS.filter((i) => i.surface === "web");
    expect(browserTools.length).toBeGreaterThanOrEqual(4);
    for (const t of browserTools) {
      expect(t.integration).toBe("browser-only");
      expect(t.status).toBe("needs-paste");
    }
  });

  it("reportIntegrations summarizes counts", () => {
    const r = reportIntegrations();
    expect(r.total).toBe(EDITOR_INTEGRATIONS.length);
    expect(r.working).toBeGreaterThanOrEqual(5);
    expect(r.headline).toContain("AI tools tracked");
  });

  it("filterIntegrations by status", () => {
    const working = filterIntegrations({ status: "working" });
    expect(working.length).toBeGreaterThanOrEqual(5);
    for (const t of working) expect(t.status).toBe("working");
  });

  it("filterIntegrations by surface", () => {
    const cli = filterIntegrations({ surface: "cli" });
    expect(cli.length).toBeGreaterThanOrEqual(2);
    for (const t of cli) expect(t.surface).toBe("cli");
  });
});

// ─── P4 TRANSPORT MENU ───────────────────────────────────────────────

describe("v1.74 Permeate P4 · Transport Menu", () => {
  it("provides 4 transport methods", () => {
    expect(TRANSPORT_OPTIONS.length).toBe(4);
  });

  it("each option has steps + pros + friction", () => {
    for (const opt of TRANSPORT_OPTIONS) {
      expect(opt.steps.length).toBeGreaterThanOrEqual(3);
      expect(opt.pros.length).toBeGreaterThanOrEqual(1);
      expect(opt.friction).toBeGreaterThanOrEqual(1);
      expect(opt.friction).toBeLessThanOrEqual(5);
    }
  });

  it("recommendTransport returns clipboard by default", () => {
    const r = recommendTransport();
    expect(r.recommended).toBe("clipboard-relay");
  });

  it("recommendTransport returns gist with github account", () => {
    const r = recommendTransport({ hasGithubAccount: true });
    expect(r.recommended).toBe("gist");
  });

  it("recommendTransport returns qr for laptop->phone", () => {
    const r = recommendTransport({ laptopToPhone: true });
    expect(r.recommended).toBe("qr-code-svg");
  });

  it("recommendTransport returns wanderer for offline", () => {
    const r = recommendTransport({ preferOffline: true });
    expect(r.recommended).toBe("wanderer-mwt");
  });

  it("rankedOptions sorted by friction ascending", () => {
    const r = recommendTransport();
    for (let i = 1; i < r.rankedOptions.length; i++) {
      expect(r.rankedOptions[i - 1]!.friction <= r.rankedOptions[i]!.friction).toBe(true);
    }
  });
});
