import { describe, it, expect } from "vitest";
import { VendorBoomerang, formatBoomerangLine } from "./index.js";

describe("v2.19 · MNEME VENDOR BOOMERANG — cross-vendor context injection", () => {
  it("records activity with chain signature", () => {
    const b = new VendorBoomerang();
    const r = b.record({
      vendor: "claude",
      kind: "symbol_create",
      filePath: "src/foo.ts",
      symbol: "calculateTotal",
      location: "L42",
      note: "added calculateTotal helper",
    });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(r.recordId).toMatch(/^act-[0-9a-f]{14}$/);
    expect(r.prevSig).toMatch(/^genesis0+$/);
    expect(b.verifyRecord(r)).toBe(true);
  });

  it("chain integrity holds across multiple records", () => {
    const b = new VendorBoomerang();
    b.record({ vendor: "claude", kind: "file_edit", filePath: "src/a.ts", note: "init" });
    b.record({ vendor: "chatgpt", kind: "file_edit", filePath: "src/a.ts", note: "tweak" });
    b.record({ vendor: "grok", kind: "file_edit", filePath: "src/a.ts", note: "refactor" });
    const chk = b.verifyChain();
    expect(chk.ok).toBe(true);
  });

  it("verifyChain detects tampering", () => {
    const b = new VendorBoomerang();
    b.record({ vendor: "claude", kind: "file_edit", filePath: "src/a.ts", note: "init" });
    b.record({ vendor: "chatgpt", kind: "file_edit", filePath: "src/a.ts", note: "tweak" });
    const ledger = b.exportLedger();
    // Mutate a record in place — chain should break.
    (ledger[0] as { note: string }).note = "EVIL TWIN";
    // Re-inject via a fresh instance by replaying:
    const corrupt = new VendorBoomerang();
    // @ts-expect-error testing privates
    corrupt.ledger = ledger;
    const chk = corrupt.verifyChain();
    expect(chk.ok).toBe(false);
  });

  it("boomerang context excludes incoming vendor's own records", () => {
    const b = new VendorBoomerang();
    b.record({ vendor: "claude", kind: "symbol_create", filePath: "src/foo.ts", symbol: "calculateTotal", note: "added" });
    b.record({ vendor: "grok", kind: "file_edit", filePath: "src/foo.ts", note: "grok was here" });
    const ctx = b.build({ incomingVendor: "grok", filePath: "src/foo.ts" });
    // grok's record should be filtered out — only claude's appears.
    expect(ctx.relevantRecords.length).toBe(1);
    expect(ctx.relevantRecords[0]!.vendor).toBe("claude");
  });

  it("boomerang context respects lookback window", () => {
    const b = new VendorBoomerang();
    const t0 = 1_000_000_000_000;
    b.record({ vendor: "claude", kind: "file_edit", filePath: "src/a.ts", note: "old", ts: new Date(t0).toISOString() });
    b.record({ vendor: "chatgpt", kind: "file_edit", filePath: "src/a.ts", note: "recent", ts: new Date(t0 + 60_000).toISOString() });
    // Query 90s later with 30s lookback — only the recent one survives.
    const ctx = b.build({ incomingVendor: "grok", filePath: "src/a.ts", lookbackSeconds: 30, nowMs: t0 + 90_000 });
    expect(ctx.relevantRecords.length).toBe(1);
    expect(ctx.relevantRecords[0]!.note).toBe("recent");
  });

  it("boomerang context handles empty case gracefully", () => {
    const b = new VendorBoomerang();
    const ctx = b.build({ incomingVendor: "grok", filePath: "src/unknown.ts" });
    expect(ctx.relevantRecords.length).toBe(0);
    expect(ctx.injectedContextBlock).toContain("no recent cross-vendor activity");
  });

  it("works for every supported vendor as recorder + reader", () => {
    const vendors = ["claude", "chatgpt", "gemini", "cursor", "copilot", "codex", "llama", "mistral", "qwen", "deepseek", "grok", "perplexity", "other"] as const;
    const b = new VendorBoomerang();
    for (const v of vendors) {
      b.record({ vendor: v, kind: "file_edit", filePath: `src/${v}.ts`, note: `${v} was here` });
    }
    expect(b.verifyChain().ok).toBe(true);
    expect(b.stats().totalRecords).toBe(vendors.length);
  });

  it("injectedContextBlock contains ALL relevant vendor names + symbols", () => {
    const b = new VendorBoomerang();
    b.record({ vendor: "claude", kind: "symbol_create", filePath: "src/foo.ts", symbol: "calculateTotal", location: "L42", note: "added helper" });
    b.record({ vendor: "chatgpt", kind: "symbol_move", filePath: "src/foo.ts", symbol: "calculateTotal", location: "L80", note: "moved" });
    const ctx = b.build({ incomingVendor: "grok", filePath: "src/foo.ts" });
    expect(ctx.injectedContextBlock).toContain("claude");
    expect(ctx.injectedContextBlock).toContain("chatgpt");
    expect(ctx.injectedContextBlock).toContain("calculateTotal");
  });

  it("stats() reports per-vendor counts + unique files", () => {
    const b = new VendorBoomerang();
    b.record({ vendor: "claude", kind: "file_edit", filePath: "src/a.ts", note: "x" });
    b.record({ vendor: "claude", kind: "file_edit", filePath: "src/b.ts", note: "x" });
    b.record({ vendor: "grok", kind: "file_edit", filePath: "src/a.ts", note: "x" });
    const s = b.stats();
    expect(s.totalRecords).toBe(3);
    expect(s.perVendor["claude"]).toBe(2);
    expect(s.perVendor["grok"]).toBe(1);
    expect(s.uniqueFiles).toBe(2);
  });

  it("formatBoomerangLine summarises", () => {
    const b = new VendorBoomerang();
    b.record({ vendor: "claude", kind: "file_edit", filePath: "src/a.ts", note: "x" });
    const ctx = b.build({ incomingVendor: "grok", filePath: "src/a.ts" });
    expect(formatBoomerangLine(ctx)).toContain("BOOMERANG");
  });
});
