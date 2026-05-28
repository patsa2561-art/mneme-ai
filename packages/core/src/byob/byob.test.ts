/**
 * v2.82.0 — BYOB portable brain pinned + QUAN tests (💎2).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCapsule, packCapsule, verifyCapsule, mergeCapsules, type MemoryItem } from "./index.js";
import { type NotaryReceipt } from "../notary/index.js";

const repo = () => mkdtempSync(join(tmpdir(), "mneme-byob-"));

describe("v2.82.0 💎2 BYOB (PINNED)", () => {
  it("Y1 pack → verify offline; tamper fails", () => {
    const r = repo();
    const cap = makeCapsule({ owner: "user", vendor: "claude", items: [{ id: "m1", content: "prefer pnpm", ts: 1 }] });
    const receipt = packCapsule(r, cap);
    const v = verifyCapsule(JSON.parse(JSON.stringify(receipt)));
    expect(v.valid).toBe(true);
    expect(v.capsule!.items[0]!.content).toBe("prefer pnpm");
    expect(verifyCapsule({ ...receipt, payload: { ...(receipt.payload as object), owner: "attacker" } } as NotaryReceipt).valid).toBe(false);
  });
  it("Y2 merge: union by id, last-write-wins by ts, vendors unioned", () => {
    const a = makeCapsule({ owner: "u", vendor: "claude", items: [{ id: "m1", content: "v1", ts: 1 }, { id: "m2", content: "keep", ts: 1 }] });
    const b = makeCapsule({ owner: "u", vendor: "gpt", items: [{ id: "m1", content: "v2-newer", ts: 5 }, { id: "m3", content: "new", ts: 2 }] });
    const m = mergeCapsules(a, b);
    expect(m.items.find((i) => i.id === "m1")!.content).toBe("v2-newer"); // LWW
    expect(m.items.map((i) => i.id)).toEqual(["m1", "m2", "m3"]);
    expect(m.vendors).toEqual(["claude", "gpt"]);
  });
});

describe("v2.82.0 💎2 QUAN", () => {
  function randCap(seed: number) {
    const items: MemoryItem[] = [];
    for (let i = 0; i < 8; i++) {
      const id = `m${(seed * 3 + i) % 12}`;
      items.push({ id, content: `c${seed}-${i}`, ts: (seed * 7 + i * 13) % 100 });
    }
    return makeCapsule({ owner: "u", vendor: `v${seed % 3}`, items });
  }
  it("Q merge is commutative + idempotent (CRDT convergence)", () => {
    for (let s = 0; s < 60; s++) {
      const a = randCap(s); const b = randCap(s + 1);
      const ab = mergeCapsules(a, b);
      const ba = mergeCapsules(b, a);
      // commutative (item set + LWW values converge; owner from first arg may differ, compare items+vendors)
      expect(ab.items).toEqual(ba.items);
      expect(ab.vendors).toEqual(ba.vendors);
      // idempotent
      expect(mergeCapsules(ab, ab).items).toEqual(ab.items);
      // associative-ish: merging a third then re-merging converges
      const c = randCap(s + 2);
      const left = mergeCapsules(mergeCapsules(a, b), c);
      const right = mergeCapsules(a, mergeCapsules(b, c));
      expect(left.items).toEqual(right.items);
    }
  });
});
