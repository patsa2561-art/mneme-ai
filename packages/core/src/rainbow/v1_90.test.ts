import { describe, it, expect } from "vitest";

import { detectCloudflared } from "./tunnel.js";
import { uploadResilient } from "./multi_paste.js";
import { renderResourceHintsScript, renderLazyShareScript } from "./resource_hints.js";

function mockFetch(seq: Array<{ status: number; body: string }>): typeof fetch {
  let i = 0;
  return (async (): Promise<Response> => {
    const r = seq[Math.min(i, seq.length - 1)]!;
    i++;
    return new Response(r.body, { status: r.status });
  }) as unknown as typeof fetch;
}

describe("v1.90 RAINBOW · cloudflared detection", () => {
  it("detectCloudflared returns structured result", () => {
    const r = detectCloudflared();
    expect(typeof r.available).toBe("boolean");
    expect(typeof r.installHint).toBe("string");
    expect(r.installHint.length).toBeGreaterThan(10);
    if (r.available) {
      expect(r.version).toBeTruthy();
    } else {
      expect(r.version).toBeNull();
    }
  });

  it("installHint mentions install command for this platform", () => {
    const r = detectCloudflared();
    if (process.platform === "win32") expect(r.installHint).toMatch(/winget|scoop/i);
    if (process.platform === "darwin") expect(r.installHint).toMatch(/brew/i);
    if (process.platform === "linux") expect(r.installHint).toMatch(/github\.com|package manager/i);
  });
});

describe("v1.90 RAINBOW · multi-paste resilient upload", () => {
  it("returns first success when primary backend works", async () => {
    const r = await uploadResilient({
      content: "test",
      fetchImpl: mockFetch([{ status: 200, body: "https://dpaste.com/AB12CD" }]),
      retryWaitMs: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.backend).toBe("dpaste");
    expect(r.attempts.length).toBe(1);
  });

  it("falls through to paste.rs on dpaste failure", async () => {
    const r = await uploadResilient({
      content: "test",
      fetchImpl: mockFetch([
        { status: 429, body: "rate limit" }, // dpaste fails
        { status: 200, body: "https://paste.rs/aBcD" }, // pasters wins
      ]),
      retryWaitMs: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.backend).toBe("pasters");
    expect(r.attempts.length).toBe(2);
    expect(r.attempts[0]!.ok).toBe(false);
    expect(r.attempts[1]!.ok).toBe(true);
  });

  it("falls through to 0x0.st when both above fail", async () => {
    const r = await uploadResilient({
      content: "test",
      fetchImpl: mockFetch([
        { status: 429, body: "rate" },
        { status: 503, body: "unavail" },
        { status: 200, body: "https://0x0.st/abc.txt" },
      ]),
      retryWaitMs: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.backend).toBe("zero-x-zero");
    expect(r.attempts.length).toBe(3);
  });

  it("aggregates all failures when no backend succeeds", async () => {
    const r = await uploadResilient({
      content: "test",
      fetchImpl: mockFetch([
        { status: 500, body: "err1" },
        { status: 500, body: "err2" },
        { status: 500, body: "err3" },
      ]),
      retryWaitMs: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.url).toBeNull();
    expect(r.attempts.length).toBe(3);
    for (const a of r.attempts) expect(a.ok).toBe(false);
  });

  it("respects custom backend order", async () => {
    const r = await uploadResilient({
      content: "test",
      order: ["pasters", "dpaste"],
      fetchImpl: mockFetch([{ status: 200, body: "https://paste.rs/x" }]),
      retryWaitMs: 10,
    });
    expect(r.backend).toBe("pasters");
    expect(r.attempts[0]!.backend).toBe("pasters");
  });

  it("records elapsed time per attempt", async () => {
    const r = await uploadResilient({
      content: "test",
      fetchImpl: mockFetch([{ status: 200, body: "https://dpaste.com/X" }]),
      retryWaitMs: 10,
    });
    expect(r.attempts[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(r.totalMs).toBeGreaterThanOrEqual(0);
  });
});

describe("v1.90 RAINBOW · resource hints renderer", () => {
  it("renderResourceHintsScript emits self-executing IIFE", () => {
    const s = renderResourceHintsScript();
    expect(s).toContain("(function()");
    expect(s).toContain("navigator.connection");
    expect(s).toContain("window.__mnemeHints");
  });

  it("script detects slow networks + low memory + small screens + iOS", () => {
    const s = renderResourceHintsScript();
    expect(s).toContain("slow-2g|2g");
    expect(s).toContain("deviceMemory");
    expect(s).toContain("iPhone|iPad|iPod");
    expect(s).toContain("smallScreen");
  });

  it("renderLazyShareScript embeds the soul URL safely", () => {
    const s = renderLazyShareScript("https://dpaste.com/abc.txt");
    expect(s).toContain('"https://dpaste.com/abc.txt"');
    expect(s).toContain("navigator.share");
    expect(s).toContain("navigator.clipboard");
  });

  it("renderLazyShareScript escapes </script> via JSON.stringify (XSS-safe)", () => {
    const s = renderLazyShareScript('https://evil.com/"</script><img onerror=alert(1)>');
    // The critical XSS vector: </script> must be escaped so it can't
    // close the surrounding <script> tag in the served HTML.
    expect(s).not.toContain("</script>");
    expect(s).toContain("<\\/script>");
  });
});

describe("v1.90 RAINBOW · cross-cutting", () => {
  it("multi-paste handles empty content gracefully", async () => {
    const r = await uploadResilient({
      content: "",
      fetchImpl: mockFetch([{ status: 200, body: "https://dpaste.com/X" }]),
      retryWaitMs: 10,
    });
    // Empty content still uploaded (paste services accept it)
    expect(r.ok).toBe(true);
  });

  it("multi-paste fetchImpl error becomes an attempt failure", async () => {
    const erroring = (async () => { throw new Error("network kaboom"); }) as unknown as typeof fetch;
    const r = await uploadResilient({ content: "x", fetchImpl: erroring, retryWaitMs: 10, order: ["dpaste"] });
    expect(r.ok).toBe(false);
    expect(r.attempts[0]!.reason).toContain("kaboom");
  });
});
