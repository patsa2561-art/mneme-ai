import { describe, it, expect } from "vitest";
import { generateHandoffPwaHtml, computePwaStats, HANDOFF_PWA_TUNABLES } from "./index.js";

describe("v2.19.32 HANDOFF PWA -- device-adaptive self-contained HTML", () => {
  const baseInput = {
    body: "# Mneme Handoff\nfresh snapshot",
    pairCode: "ZOZ-CAT",
    sasEmoji: ["🐱", "🌟", "🌊", "🔥"],
    expiresInMs: 25_000,
    title: "Test Handoff",
    parentDeviceId: "macbook-pro",
  };

  it("generates valid HTML5 with viewport + theme-color", () => {
    const html = generateHandoffPwaHtml(baseInput);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<meta name=\"viewport\"");
    expect(html).toContain("<meta name=\"theme-color\"");
    expect(html).toContain("</html>");
  });

  it("embeds pair code prominently for user readability", () => {
    const html = generateHandoffPwaHtml(baseInput);
    expect(html).toContain("ZOZ-CAT");
    // It should appear in the pair-code class
    expect(html).toMatch(/class="pair-code">.*ZOZ-CAT/s);
  });

  it("embeds all 4 SAS emoji for MITM verification", () => {
    const html = generateHandoffPwaHtml(baseInput);
    expect(html).toContain("🐱");
    expect(html).toContain("🌟");
    expect(html).toContain("🌊");
    expect(html).toContain("🔥");
  });

  it("embeds parent device id + title for context", () => {
    const html = generateHandoffPwaHtml(baseInput);
    expect(html).toContain("macbook-pro");
    expect(html).toContain("Test Handoff");
  });

  it("embeds countdown timer based on expiresInMs", () => {
    const html = generateHandoffPwaHtml({ ...baseInput, expiresInMs: 45_000 });
    expect(html).toContain("45s");
  });

  it("device-detect JS includes android/ios/desktop branches", () => {
    const html = generateHandoffPwaHtml(baseInput);
    expect(html).toContain("isAndroid");
    expect(html).toContain("isIOS");
    expect(html).toContain("isMobile");
    expect(html).toContain("navigator.share");
    expect(html).toContain("navigator.clipboard");
  });

  it("deep links include cursor:// + vscode:// + claude-code:// + mneme://", () => {
    const html = generateHandoffPwaHtml(baseInput);
    expect(html).toContain("cursor://");
    expect(html).toContain("vscode://");
    expect(html).toContain("claude-code://");
    expect(html).toContain("mneme://receive?code=");
  });

  it("XSS-DEFENSE: HTML-escapes user-supplied pairCode + title + parentDeviceId", () => {
    const html = generateHandoffPwaHtml({
      ...baseInput,
      pairCode: "<script>evil</script>",
      title: '"><img src=x onerror=alert(1)>',
      parentDeviceId: "</div><script>x</script>",
    });
    expect(html).not.toContain("<script>evil</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;evil&lt;/script&gt;");
    expect(html).toContain("&lt;/div&gt;");
  });

  it("XSS-DEFENSE: body is JS-escaped (no </script> closure attack)", () => {
    const html = generateHandoffPwaHtml({
      ...baseInput,
      body: "evil </script><script>alert(1)</script>",
    });
    // The </script> sequence is escaped to <\/script> inside the JS string literal
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("<\\/script>");
  });

  it("falls back gracefully when sasEmoji is wrong shape", () => {
    const html = generateHandoffPwaHtml({ ...baseInput, sasEmoji: [] });
    expect(html).toContain("❓");
  });

  it("uses default shareTargets [Gemini, ChatGPT, Claude] when none provided", () => {
    const html = generateHandoffPwaHtml(baseInput);
    expect(html).toContain("Gemini");
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Claude");
  });

  it("supports custom shareTargets list", () => {
    const html = generateHandoffPwaHtml({ ...baseInput, shareTargets: ["Grok", "Pi"] });
    expect(html).toContain("Grok");
    expect(html).toContain("Pi");
  });

  it("ships ZERO external CDN requests (offline-safe on LAN)", () => {
    const html = generateHandoffPwaHtml(baseInput);
    expect(html).not.toMatch(/https?:\/\/[^"'\s]+\/(css|js|fonts)/);
    expect(html).not.toContain("googleapis.com");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("unpkg.com");
  });

  it("computePwaStats reports byte size + emoji presence", () => {
    const html = generateHandoffPwaHtml(baseInput);
    const s = computePwaStats(baseInput, html);
    expect(s.htmlBytes).toBe(html.length);
    expect(s.hasEmoji).toBe(true);
    expect(s.embeddedBodyBytes).toBe(baseInput.body.length);
  });

  it("PROTOCOL_VERSION exposed for caller compatibility check", () => {
    expect(HANDOFF_PWA_TUNABLES.PROTOCOL_VERSION).toBe(1);
  });

  it("DEFENSIVE: empty/missing input never throws", () => {
    expect(() => generateHandoffPwaHtml({
      body: "", pairCode: "", sasEmoji: [], expiresInMs: 0,
    })).not.toThrow();
  });

  it("DEFENSIVE: NaN expiresInMs handled", () => {
    const html = generateHandoffPwaHtml({ ...baseInput, expiresInMs: NaN });
    expect(html).toContain("0s");
  });
});
