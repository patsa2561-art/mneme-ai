import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { encodeFact, decodeFact, checkSyndrome, repair, adamasGauntlet } from "./index.js";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

describe("ADAMAS — QEC-inspired self-healing memory", () => {
  it("gauntlet scores 100 (round-trip · self-heal ≤M · refuse >M · never-wrong · erasure · root-seal · repair · GF)", () => {
    const g = adamasGauntlet();
    expect(g.score).toBe(100);
    expect(g.checks.every((c) => c.pass)).toBe(true);
  });

  it("healthy encode→decode is byte-identical (incl empty + unicode + large)", () => {
    for (const f of ["", "x=42", "δμνημε 🩸", "z".repeat(9999)]) {
      const d = decodeFact(encodeFact(f, { k: 6, m: 3 }));
      expect(d.ok).toBe(true);
      expect(d.value).toBe(f);
      expect(d.recovered).toBe(false);
    }
  });

  it("recovers byte-identical with exactly M corrupted shards, names which it healed", () => {
    const blk = encodeFact("authoritative number = 100000", { k: 4, m: 2 });
    for (const i of [1, 5]) { const s = blk.shards.find((x) => x.idx === i)!; const b = unb64(s.b64); b[0] ^= 0xff; s.b64 = b64(b); }
    const d = decodeFact(blk);
    expect(d.ok).toBe(true);
    expect(d.value).toBe("authoritative number = 100000");
    expect(d.recovered).toBe(true);
    expect(d.corrected.sort()).toEqual([1, 5]);
  });

  it("refuses (UNRECOVERABLE) past M — never emits a wrong value", () => {
    const blk = encodeFact("do-not-guess", { k: 4, m: 2 });
    for (const i of [0, 1, 4]) { const s = blk.shards.find((x) => x.idx === i)!; const b = unb64(s.b64); for (let z = 0; z < b.length; z++) b[z] ^= 0x5a; s.b64 = b64(b); }
    const d = decodeFact(blk);
    expect(d.ok).toBe(false);
    expect(d.value).toBeUndefined();
    expect(d.reason).toMatch(/UNRECOVERABLE/);
  });

  it("block root catches coordinated tamper (bytes + per-shard hash both rewritten)", () => {
    const blk = encodeFact("ground truth", { k: 5, m: 2 });
    const s = blk.shards[2]; const b = unb64(s.b64); b[0] ^= 0x33;
    s.b64 = b64(b); s.hash = createHash("sha256").update(b).digest("hex");
    const syn = checkSyndrome(blk);
    expect(syn.rootOk).toBe(false);
    expect(syn.healthy).toBe(false);
  });

  it("repair() yields a fresh, fully-healthy, byte-identical block", () => {
    const blk = encodeFact("heal then persist", { k: 6, m: 3 });
    const s = blk.shards[1]; const b = unb64(s.b64); b[0] ^= 0x9c; s.b64 = b64(b);
    const r = repair(blk);
    expect(r.ok).toBe(true);
    expect(checkSyndrome(r.block!).healthy).toBe(true);
    expect(decodeFact(r.block!).value).toBe("heal then persist");
  });
});
