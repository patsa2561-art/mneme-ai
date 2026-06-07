import { describe, it, expect } from "vitest";
import { storeGauntlet, makeMemoryStore } from "./store.js";
describe("KERYX STORE — HA-ready pluggable backend", () => {
  it("MEASURED: storeGauntlet = 100 (incl. withLock no-lost-update)", async () => { const g = await storeGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("withLock serializes concurrent mutations (the property HA depends on)", async () => {
    const s = makeMemoryStore<{ n: number }>({ n: 0 });
    await Promise.all(Array.from({ length: 20 }, () => s.withLock(async () => { const c = await s.get(); await s.set({ n: c.n + 1 }); })));
    expect((await s.get()).n).toBe(20);
  });
});
