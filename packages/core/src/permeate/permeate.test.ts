/**
 * v1.74.0 -- PERMEATE PROTOCOL test suite.
 */

import { describe, it, expect } from "vitest";

import { generateUserscript } from "./userscript_generator.js";
import { generateBookmarklet } from "./bookmarklet_generator.js";
import { EDITOR_INTEGRATIONS, reportIntegrations, filterIntegrations, _resetIntegrationReportCache } from "./editor_integration_map.js";
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

  it("v1.76 Bug #3 fix -- rankedOptions sorted by score descending (best fallback first)", () => {
    const r = recommendTransport({ hasGithubAccount: true });
    expect(r.scored.length).toBe(4);
    for (let i = 1; i < r.scored.length; i++) {
      expect(r.scored[i - 1]!.score >= r.scored[i]!.score).toBe(true);
    }
    // The recommended is always the head of the ranked list.
    expect(r.rankedOptions[0]!.method).toBe(r.recommended);
  });

  it("v1.76 Bug #3 fix -- different scenarios produce DIFFERENT rankings (not all clipboard)", () => {
    const defaultRec = recommendTransport().recommended;
    const githubRec = recommendTransport({ hasGithubAccount: true }).recommended;
    const phoneRec = recommendTransport({ laptopToPhone: true }).recommended;
    const offlineRec = recommendTransport({ preferOffline: true }).recommended;
    const recs = new Set([defaultRec, githubRec, phoneRec, offlineRec]);
    // At least 3 distinct recommendations across the 4 scenarios.
    expect(recs.size).toBeGreaterThanOrEqual(3);
  });

  it("v1.76 Bug #3 fix -- every option has reasons explaining its score", () => {
    const r = recommendTransport({ hasGithubAccount: true });
    for (const s of r.scored) {
      expect(s.reasons.length).toBeGreaterThanOrEqual(2);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});

// ─── v1.76 ABYSS · Bug-fix coverage ──────────────────────────────────

describe("v1.76 ABYSS · Bug #1 fix -- IntegrationReport stringification", () => {
  it("report.toString() returns the headline, NOT '[object Object]'", () => {
    _resetIntegrationReportCache();
    const r = reportIntegrations();
    expect(String(r)).not.toContain("[object Object]");
    expect(String(r)).toBe(r.headline);
  });

  it("report.text is a non-empty multi-line markdown summary", () => {
    _resetIntegrationReportCache();
    const r = reportIntegrations();
    expect(r.text.length).toBeGreaterThan(100);
    expect(r.text).toContain("# Mneme integration report");
    expect(r.text).toContain("## Tools");
    expect(r.text.split("\n").length).toBeGreaterThan(10);
  });

  it("repeated calls hit the cache (same reference returned)", () => {
    _resetIntegrationReportCache();
    const a = reportIntegrations();
    const b = reportIntegrations();
    expect(a).toBe(b);
  });
});

describe("v1.76 ABYSS · Bug #2 fix -- bookmarklet javascript: prefix lock", () => {
  it("uri ALWAYS starts with javascript:", () => {
    const a = generateBookmarklet();
    expect(a.uri.startsWith("javascript:")).toBe(true);
    expect(a.protocol).toBe("javascript:");
  });

  it("body field equals uri minus the protocol prefix", () => {
    const a = generateBookmarklet();
    expect(a.protocol + a.body).toBe(a.uri);
  });

  it("uri body is URL-decodable (round-trip)", () => {
    const a = generateBookmarklet();
    const decoded = decodeURIComponent(a.body);
    expect(decoded).toContain("MNEME SOUL PROMPT");
  });
});
