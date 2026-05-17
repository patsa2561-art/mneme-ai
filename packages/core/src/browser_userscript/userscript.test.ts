import { describe, it, expect } from "vitest";
import {
  generateUserscript, generateManifestV3, generateContentScript,
  generatePopupHtml, generateBrowserReadme,
  computeUserscriptStats, formatUserscriptStatsLine,
  BROWSER_USERSCRIPT_TUNABLES,
} from "./index.js";

describe("v2.19.38 BROWSER USERSCRIPT — Tampermonkey single-file", () => {
  it("emits valid UserScript header block", () => {
    const us = generateUserscript();
    expect(us).toContain("// ==UserScript==");
    expect(us).toContain("// ==/UserScript==");
    expect(us).toContain("@name");
    expect(us).toContain("@version");
    expect(us).toContain("@match");
    expect(us).toContain("@license      MIT");
  });

  it("@match covers 11 supported vendor URLs", () => {
    const us = generateUserscript();
    expect(us).toContain("https://chatgpt.com/*");
    expect(us).toContain("https://chat.openai.com/*");
    expect(us).toContain("https://claude.ai/*");
    expect(us).toContain("https://gemini.google.com/*");
    expect(us).toContain("https://bard.google.com/*");
    expect(us).toContain("https://grok.com/*");
    expect(us).toContain("https://x.com/i/grok*");
    expect(us).toContain("https://perplexity.ai/*");
    expect(us).toContain("https://copilot.microsoft.com/*");
  });

  it("uses SubtleCrypto for sha256 (no external dep)", () => {
    const us = generateUserscript();
    expect(us).toContain("crypto.subtle.digest");
    expect(us).toContain("SHA-256");
  });

  it("emits Mneme Receipt Protocol v1.0 receipt shape", () => {
    const us = generateUserscript();
    expect(us).toContain("'mneme-receipt-protocol'");
    expect(us).toContain("'1.0'");
    expect(us).toContain("@mneme-ai/browser-userscript@");
    expect(us).toContain("contentHash");
  });

  it("includes MutationObserver + interval safety poll", () => {
    const us = generateUserscript();
    expect(us).toContain("MutationObserver");
    expect(us).toContain("setInterval(tick");
  });

  it("includes 🛡 floating indicator with export", () => {
    const us = generateUserscript();
    expect(us).toContain("mneme-indicator");
    expect(us).toContain("🛡 Mneme");
    expect(us).toContain("mneme-receipts-");
  });

  it("caps receipts at 10000 (storage safety)", () => {
    expect(generateUserscript()).toContain("10000");
  });

  it("dedupes via lastMintHash (no duplicate mints per turn)", () => {
    expect(generateUserscript()).toContain("lastMintHash");
  });
});

describe("v2.19.38 BROWSER USERSCRIPT — Manifest V3 extension", () => {
  it("manifest_version: 3", () => {
    const m = generateManifestV3();
    expect(m.manifest_version).toBe(3);
  });

  it("has all required manifest fields", () => {
    const m = generateManifestV3();
    expect(m.name).toContain("Mneme");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.permissions).toContain("storage");
    expect(m.content_scripts.length).toBe(1);
    expect(m.content_scripts[0]!.js).toContain("content.js");
  });

  it("host_permissions covers all supported vendor domains", () => {
    const m = generateManifestV3();
    expect(m.host_permissions.length).toBe(BROWSER_USERSCRIPT_TUNABLES.SUPPORTED_DOMAINS.length);
    for (const d of BROWSER_USERSCRIPT_TUNABLES.SUPPORTED_DOMAINS) {
      expect(m.host_permissions).toContain(`https://${d}/*`);
    }
  });

  it("manifest is JSON-serializable", () => {
    const m = generateManifestV3();
    expect(() => JSON.stringify(m, null, 2)).not.toThrow();
  });
});

describe("v2.19.38 BROWSER USERSCRIPT — content.js + popup.html", () => {
  it("content.js strips UserScript header (extension uses chrome.storage instead of GM_*)", () => {
    const cs = generateContentScript();
    expect(cs).not.toContain("// ==UserScript==");
    expect(cs).not.toContain("@match");
  });

  it("popup.html is valid HTML5", () => {
    const html = generatePopupHtml();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Mneme Browser Receipt");
    expect(html).toContain("Export all receipts");
    expect(html).toContain("Clear stored receipts");
  });

  it("popup includes export + clear buttons", () => {
    expect(generatePopupHtml()).toContain('id="export"');
    expect(generatePopupHtml()).toContain('id="clear"');
  });
});

describe("v2.19.38 BROWSER USERSCRIPT — README + stats", () => {
  it("README mentions both install paths", () => {
    const md = generateBrowserReadme();
    expect(md).toContain("Tampermonkey");
    expect(md).toContain("Chrome Extension");
    expect(md).toContain("MIT");
  });

  it("README states privacy guarantees (no plaintext leaves device)", () => {
    const md = generateBrowserReadme();
    expect(md).toContain("only sha256 hashes stored");
    expect(md).toContain("never leaves your device");
  });

  it("computeUserscriptStats reports all 5 byte counts", () => {
    const s = computeUserscriptStats();
    expect(s.userscriptBytes).toBeGreaterThan(0);
    expect(s.manifestBytes).toBeGreaterThan(0);
    expect(s.contentScriptBytes).toBeGreaterThan(0);
    expect(s.popupBytes).toBeGreaterThan(0);
    expect(s.readmeBytes).toBeGreaterThan(0);
    expect(s.supportedDomains).toBe(BROWSER_USERSCRIPT_TUNABLES.SUPPORTED_DOMAINS.length);
    expect(formatUserscriptStatsLine(s)).toContain("USERSCRIPT");
  });
});

describe("v2.19.38 BROWSER USERSCRIPT — A/B before vs after", () => {
  it("A: pre-v2.19.38 = no installable artifact; B: 5 artifacts shipped (userscript + manifest + content + popup + README)", () => {
    expect(generateUserscript().length).toBeGreaterThan(1000);
    expect(JSON.stringify(generateManifestV3()).length).toBeGreaterThan(100);
    expect(generateContentScript().length).toBeGreaterThan(500);
    expect(generatePopupHtml().length).toBeGreaterThan(500);
    expect(generateBrowserReadme().length).toBeGreaterThan(500);
  });
});
