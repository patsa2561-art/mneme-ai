import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { chunkFrame, reassemble, pipeRoundTrip, wireSize, decodeRequest, matrixGauntlet, type Frame } from "./index.js";

const enc = new TextEncoder();
function entropy(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n); let off = 0, ctr = 0;
  while (off < n) { const b = createHash("sha256").update(`${seed}:${ctr++}`).digest(); const t = Math.min(b.length, n - off); out.set(b.subarray(0, t), off); off += t; }
  return out;
}

describe("MATRIX RAIL — the pipe core", () => {
  it("scores 100 on its gauntlet (pipe + corruption + size A/B)", () => {
    const g = matrixGauntlet();
    expect(g.score).toBe(100);
    expect(g.pipe.passed).toBe(g.pipe.cases);
    expect(g.corruption.caught).toBe(g.corruption.cases);
    expect(g.ab.savedPct).toBeGreaterThan(0);
  });

  it("ANY payload round-trips byte-identical (0B, 1B, 5MB, binary, unicode)", () => {
    const cases: (Uint8Array | string)[] = [
      new Uint8Array(0),
      new Uint8Array([0x42]),
      entropy(5_000_000, 9),       // 5 MB → many frames, well past gRPC's 4 MB cap
      new Uint8Array(2048),         // all-NUL
      "héllo 世界 🌍🔥".repeat(1000),
    ];
    for (const c of cases) {
      const r = pipeRoundTrip(c, 64 * 1024);
      expect(r.ok).toBe(true);
      const orig = typeof c === "string" ? enc.encode(c) : c;
      expect(Buffer.from(r.payload).equals(Buffer.from(orig))).toBe(true);
    }
  });

  it("a large payload spans many frames (the gRPC 4MB cap is not a wall)", () => {
    const frames = chunkFrame(entropy(5_000_000, 3), 64 * 1024);
    expect(frames.length).toBeGreaterThan(50);
    expect(frames.every((f) => f.data.length <= 64 * 1024)).toBe(true);
  });

  it("catches a dropped chunk", () => {
    const f = chunkFrame(entropy(300_000, 5), 64 * 1024);
    expect(reassemble(f.slice(0, f.length - 1)).ok).toBe(false);
  });

  it("catches a reordered/missing set", () => {
    const f = chunkFrame(entropy(300_000, 6), 64 * 1024);
    expect(reassemble([f[2]!, f[0]!]).ok).toBe(false);
  });

  it("catches a flipped byte (integrity hash)", () => {
    const f = chunkFrame(entropy(300_000, 7), 64 * 1024);
    const tampered = f.map((fr, i) => (i === 1 ? { ...fr, data: (() => { const d = Uint8Array.from(fr.data); d[0] = d[0]! ^ 0xff; return d; })() } : fr)) as Frame[];
    expect(reassemble(tampered).ok).toBe(false);
  });

  it("catches a manifest tamper", () => {
    const f = chunkFrame(entropy(300_000, 8), 64 * 1024);
    expect(reassemble(f.map((fr) => ({ ...fr, origBytes: fr.origBytes + 1 }))).ok).toBe(false);
  });

  it("wire is smaller than raw JSON (measured)", () => {
    const ctx = { history: Array.from({ length: 100 }, (_, i) => ({ role: "user", text: "lorem ipsum ".repeat(10) })) };
    const ws = wireSize(ctx);
    expect(ws.wireBytes).toBeLessThan(ws.rawBytes);
    expect(ws.savedPct).toBeGreaterThan(0);
  });

  it("decodeRequest parses a valid request + rejects garbage", () => {
    const ok = decodeRequest(enc.encode(JSON.stringify({ tool: "mneme.verify", argsJson: "{}" })));
    expect(ok?.tool).toBe("mneme.verify");
    expect(decodeRequest(new Uint8Array([0xff, 0xfe]))).toBeNull();
  });

  it("total — never throws on garbage", () => {
    expect(() => chunkFrame(null as unknown as string)).not.toThrow();
    expect(() => reassemble(null as unknown as Frame[])).not.toThrow();
    expect(reassemble([]).ok).toBe(false);
  });
});
