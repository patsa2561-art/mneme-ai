import { describe, it, expect } from "vitest";
import { handoffUniversal, buildAuraDropDataUri, formatHandoffPulseLine } from "./index.js";

describe("v2.8 HANDOFF UNIVERSAL", () => {
  it("returns at least clipboard + markdown paths for any payload", () => {
    const b = handoffUniversal({ payload: "hello world" });
    const ids = b.paths.map((p) => p.id);
    expect(ids).toContain("clipboard");
    expect(ids).toContain("markdown");
    expect(ids).toContain("nexus");
  });

  it("includes a QR data: URI when payload fits in the embed cap", () => {
    const b = handoffUniversal({ payload: "small soul prompt", targetVendor: "claude" });
    const qr = b.paths.find((p) => p.id === "qr-embed");
    expect(qr).toBeDefined();
    expect(qr!.content).toMatch(/^data:text\/html;base64,/);
    expect(qr!.offline).toBe(true);
  });

  it("excludes QR path when payload exceeds embed cap", () => {
    const huge = "x".repeat(200_000);
    const b = handoffUniversal({ payload: huge });
    const qr = b.paths.find((p) => p.id === "qr-embed");
    expect(qr).toBeUndefined();
    // Fallback paths still present
    expect(b.paths.find((p) => p.id === "clipboard")).toBeDefined();
    expect(b.paths.find((p) => p.id === "markdown")).toBeDefined();
  });

  it("NEXUS code is 6 base32-style chars, deterministic per payload", () => {
    const a = handoffUniversal({ payload: "same" }).paths.find((p) => p.id === "nexus")!;
    const b = handoffUniversal({ payload: "same" }).paths.find((p) => p.id === "nexus")!;
    expect(a.content).toBe(b.content);
    expect(a.content).toMatch(/^[A-Z2-9]{6}$/);
  });

  it("AURA-DROP data: URI base64-decodes to valid HTML with the payload embedded", () => {
    const aura = buildAuraDropDataUri({ payload: "PAYLOAD-MARKER-12345" });
    expect(aura).not.toBeNull();
    const b64 = aura!.uri.slice("data:text/html;base64,".length);
    const html = Buffer.from(b64, "base64").toString("utf8");
    expect(html).toContain("PAYLOAD-MARKER-12345");
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain("navigator.clipboard.writeText");
  });

  it("AURA-DROP HTML escapes user-controlled label/payload", () => {
    const aura = buildAuraDropDataUri({ payload: "<script>alert(1)</script>", label: '<img src=x>' });
    const b64 = aura!.uri.slice("data:text/html;base64,".length);
    const html = Buffer.from(b64, "base64").toString("utf8");
    expect(html).not.toContain("<script>alert(1)</script>"); // escaped
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x>");
  });

  it("digest is stable across calls with the same payload", () => {
    const a = handoffUniversal({ payload: "stable" });
    const b = handoffUniversal({ payload: "stable" });
    expect(a.digest).toBe(b.digest);
  });

  it("formatHandoffPulseLine emits a compact summary", () => {
    const b = handoffUniversal({ payload: "x" });
    const line = formatHandoffPulseLine(b);
    expect(line).toContain("HANDOFF");
    expect(line).toContain("digest=");
  });

  it("vendor-specific paste hint is embedded in HTML", () => {
    const aura = buildAuraDropDataUri({ payload: "x", targetVendor: "claude" });
    const html = Buffer.from(aura!.uri.slice("data:text/html;base64,".length), "base64").toString("utf8");
    expect(html).toContain("claude.ai");
  });
});
