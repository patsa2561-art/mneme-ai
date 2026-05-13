import { describe, it, expect } from "vitest";

import { renderMobilePage, renderPcPage } from "./page_renderer.js";

describe("v1.91 RAINBOW · mobile page renderer", () => {
  it("emits a complete HTML document", () => {
    const html = renderMobilePage({ soulText: "# SOUL\nbody" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("Mneme handoff");
  });

  it("includes Web Share API + clipboard + textarea fallback chain", () => {
    const html = renderMobilePage({ soulText: "x" });
    expect(html).toContain("navigator.share");
    expect(html).toContain("navigator.clipboard");
    expect(html).toContain("execCommand");
  });

  it("XSS-safe: closing </script> in soul is escaped", () => {
    const html = renderMobilePage({ soulText: 'evil </script><img onerror=alert(1)>' });
    expect(html).toContain("<\\/script>");
    // Original (raw) </script> token must NOT appear in the JS string section
    const scriptStart = html.indexOf("const SOUL = ");
    const scriptEnd = html.indexOf(";", scriptStart);
    const soulLiteral = html.slice(scriptStart, scriptEnd);
    expect(soulLiteral).not.toContain("</script>");
  });

  it("ships bilingual data-en/data-th attributes for UI strings", () => {
    const html = renderMobilePage({ soulText: "x" });
    expect(html).toContain('data-en="Mneme handoff"');
    expect(html).toContain('data-th="ส่งสมอง Mneme"');
  });

  it("includes the honest capability matrix (paste vs MCP truth)", () => {
    const html = renderMobilePage({ soulText: "x" });
    expect(html).toContain("Read this conversation");
    expect(html).toContain("Call Mneme MCP tools");
    expect(html).toContain("HOMUNCULUS RETURN block");
  });

  it("includes 4-vendor quick links (ChatGPT/Gemini/Claude/Perplexity)", () => {
    const html = renderMobilePage({ soulText: "x" });
    expect(html).toContain("chatgpt.com");
    expect(html).toContain("gemini.google.com");
    expect(html).toContain("claude.ai");
    expect(html).toContain("perplexity.ai");
  });

  it("respects defaultLang option", () => {
    const en = renderMobilePage({ soulText: "x", defaultLang: "en" });
    const th = renderMobilePage({ soulText: "x", defaultLang: "th" });
    expect(en).toContain('let lang = "en"');
    expect(th).toContain('let lang = "th"');
  });
});

describe("v1.91 RAINBOW · PC page renderer", () => {
  const baseInput = {
    primaryUrl: "http://192.168.1.10:7741",
    label: { en: "Same Wi-Fi · 1 tap", th: "WiFi เดียวกัน · 1 แตะ" },
    note: { en: "Phone MUST be on the same WiFi", th: "มือถือต้องอยู่ WiFi เดียวกับ PC" },
    soulTokens: 1234,
    hasTunnel: false,
    hasPaste: true,
  };

  it("emits a complete HTML page", () => {
    const html = renderPcPage(baseInput);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("Send brain to phone");
  });

  it("renders ONE primary QR pointing at the QR rendering service", () => {
    const html = renderPcPage(baseInput);
    expect(html).toContain("api.qrserver.com");
    expect(html).toContain(encodeURIComponent("http://192.168.1.10:7741"));
  });

  it("includes STOP button (no Ctrl+C jargon)", () => {
    const html = renderPcPage(baseInput);
    expect(html).toContain("🛑 STOP");
    expect(html).toContain('id="stop"');
    expect(html).not.toContain("Ctrl+C in the terminal");
    expect(html).not.toContain("Press Ctrl+C");
  });

  it("STOP button confirms before stopping (in selected language)", () => {
    const html = renderPcPage(baseInput);
    expect(html).toContain("confirm(");
    expect(html).toContain("Server stopped");
    expect(html).toContain("Server หยุดแล้ว");
  });

  it("footer reflects tunnel + paste availability", () => {
    const noTunnel = renderPcPage({ ...baseInput, hasTunnel: false, hasPaste: false });
    expect(noTunnel).not.toContain("Cloudflare tunnel");
    const withTunnel = renderPcPage({ ...baseInput, hasTunnel: true, hasPaste: true });
    expect(withTunnel).toContain("Cloudflare tunnel");
    expect(withTunnel).toContain("paste fallback");
  });

  it("escapes HTML in label/note (XSS-safe)", () => {
    const evil = {
      ...baseInput,
      label: { en: '<script>alert(1)</script>', th: 'ก' },
      note: { en: 'a"b', th: 'b' },
    };
    const html = renderPcPage(evil);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("primary URL appears as displayed text + inside the QR encoder URL", () => {
    const html = renderPcPage({ ...baseInput, primaryUrl: "https://abc.trycloudflare.com" });
    expect(html).toContain("https://abc.trycloudflare.com");
    expect(html).toContain(encodeURIComponent("https://abc.trycloudflare.com"));
  });

  it("STOP fetch URL is the primaryUrl + /stop, JSON-encoded for safety", () => {
    const html = renderPcPage({ ...baseInput, primaryUrl: 'http://x.com/"</script>' });
    // </script> in fetch arg must be escaped
    expect(html).toContain("<\\/script>");
  });
});
