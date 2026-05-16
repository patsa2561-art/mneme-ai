import { describe, it, expect, beforeEach } from "vitest";
import {
  WrapperGenesplicing, formatChimeraLine, formatExecutionLine,
  type ToolRegistry,
} from "./index.js";

function makeRegistry(): ToolRegistry {
  const r = new Map();
  r.set("mneme.fake.double", (args: Record<string, unknown>) => ({ value: Number(args["value"] ?? 0) * 2 }));
  r.set("mneme.fake.plus_one", (args: Record<string, unknown>) => ({ value: Number(args["value"] ?? 0) + 1 }));
  r.set("mneme.fake.square", (args: Record<string, unknown>) => ({ value: Number(args["value"] ?? 0) ** 2 }));
  r.set("mneme.fake.throws", () => { throw new Error("intentional fault"); });
  r.set("mneme.fake.slow_ok", async (args: Record<string, unknown>) => {
    await new Promise((r) => setTimeout(r, 5));
    return { value: `slow:${args["value"]}` };
  });
  return r;
}

describe("v2.19.9 · WRAPPER GENESPLICING — runtime chimera composition", () => {
  let g: WrapperGenesplicing;
  beforeEach(() => { g = new WrapperGenesplicing(); });

  // ── splice ─────────────────────────────────────────────────────────
  describe("splice", () => {
    it("creates a chimera with HMAC + content-addressed name", () => {
      const c = g.splice({ recipe: ["mneme.fake.double", "mneme.fake.plus_one"] });
      expect(c.chimeraName).toMatch(/^mneme\.chimera\.[0-9a-f]{16}$/);
      expect(c.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(c.composer).toBe("sequential");
      expect(c.ttlSec).toBe(600);
      expect(g.verifyChimera(c)).toBe(true);
    });

    it("DEDUPES — same recipe + composer + argMapping → same name", () => {
      const a = g.splice({ recipe: ["mneme.fake.double", "mneme.fake.plus_one"] });
      const b = g.splice({ recipe: ["mneme.fake.double", "mneme.fake.plus_one"] });
      expect(a.chimeraName).toBe(b.chimeraName);
    });

    it("DIFFERENT recipes → different names (order matters)", () => {
      const a = g.splice({ recipe: ["mneme.fake.double", "mneme.fake.plus_one"] });
      const b = g.splice({ recipe: ["mneme.fake.plus_one", "mneme.fake.double"] });
      expect(a.chimeraName).not.toBe(b.chimeraName);
    });

    it("rejects empty recipe", () => {
      expect(() => g.splice({ recipe: [] })).toThrow(/at least 1 tool/);
    });

    it("rejects recipe > 16 tools (sanity cap)", () => {
      const recipe = Array.from({ length: 17 }, (_, i) => `mneme.fake.t${i}`);
      expect(() => g.splice({ recipe })).toThrow(/> 16/);
    });
  });

  // ── execute: sequential ───────────────────────────────────────────────
  describe("execute (sequential)", () => {
    it("pipes outputs through steps in order", async () => {
      const c = g.splice({ recipe: ["mneme.fake.double", "mneme.fake.plus_one"] });
      const r = await g.execute({
        chimeraName: c.chimeraName,
        inputs: { value: 3 },
        registry: makeRegistry(),
      });
      expect(r.ok).toBe(true);
      expect(r.steps.length).toBe(2);
      // 3 → double → 6 → plus_one → 7
      expect((r.finalOutput as { value: number }).value).toBe(7);
    });

    it("aborts at first error (sequential)", async () => {
      const c = g.splice({ recipe: ["mneme.fake.double", "mneme.fake.throws", "mneme.fake.plus_one"] });
      const r = await g.execute({
        chimeraName: c.chimeraName,
        inputs: { value: 3 },
        registry: makeRegistry(),
      });
      expect(r.ok).toBe(false);
      expect(r.steps.length).toBe(2); // aborted after the throws step
      expect(r.steps[1]!.ok).toBe(false);
    });

    it("reports missing tool gracefully", async () => {
      const c = g.splice({ recipe: ["mneme.fake.double", "mneme.does.not.exist"] });
      const r = await g.execute({
        chimeraName: c.chimeraName,
        inputs: { value: 3 },
        registry: makeRegistry(),
      });
      expect(r.ok).toBe(false);
      expect(r.steps[1]!.error).toContain("not in registry");
    });
  });

  // ── execute: fan_out ──────────────────────────────────────────────────
  describe("execute (fan_out)", () => {
    it("runs all tools in parallel; final is array of results", async () => {
      const c = g.splice({
        recipe: ["mneme.fake.double", "mneme.fake.plus_one", "mneme.fake.square"],
        composer: "fan_out",
      });
      const r = await g.execute({ chimeraName: c.chimeraName, inputs: { value: 4 }, registry: makeRegistry() });
      expect(r.ok).toBe(true);
      expect(r.steps.length).toBe(3);
      const final = r.finalOutput as Array<{ value: number }>;
      expect(final[0]!.value).toBe(8);  // 4 * 2
      expect(final[1]!.value).toBe(5);  // 4 + 1
      expect(final[2]!.value).toBe(16); // 4^2
    });

    it("ok=true if AT LEAST ONE step succeeds; partial errors don't abort", async () => {
      const c = g.splice({
        recipe: ["mneme.fake.double", "mneme.fake.throws", "mneme.fake.plus_one"],
        composer: "fan_out",
      });
      const r = await g.execute({ chimeraName: c.chimeraName, inputs: { value: 5 }, registry: makeRegistry() });
      expect(r.ok).toBe(true);
      expect(r.steps.filter((s) => s.ok).length).toBe(2);
      expect(r.steps.filter((s) => !s.ok).length).toBe(1);
    });
  });

  // ── execute: first_success ────────────────────────────────────────────
  describe("execute (first_success)", () => {
    it("returns first non-error result; subsequent steps not invoked", async () => {
      const c = g.splice({
        recipe: ["mneme.fake.throws", "mneme.fake.double", "mneme.fake.square"],
        composer: "first_success",
      });
      const r = await g.execute({ chimeraName: c.chimeraName, inputs: { value: 5 }, registry: makeRegistry() });
      expect(r.ok).toBe(true);
      expect(r.steps.length).toBe(2); // throws (failed) + double (ok)
      expect((r.finalOutput as { value: number }).value).toBe(10);
    });

    it("ok=false when ALL steps fail", async () => {
      const c = g.splice({
        recipe: ["mneme.fake.throws", "mneme.does.not.exist"],
        composer: "first_success",
      });
      const r = await g.execute({ chimeraName: c.chimeraName, inputs: { value: 5 }, registry: makeRegistry() });
      expect(r.ok).toBe(false);
    });
  });

  // ── TTL + GC ────────────────────────────────────────────────────────
  describe("TTL + GC", () => {
    it("execute throws on expired chimera", async () => {
      const t0 = 1_000_000_000_000;
      const c = g.splice({ recipe: ["mneme.fake.double"], ttlSec: 60, nowMs: t0 });
      await expect(g.execute({
        chimeraName: c.chimeraName,
        inputs: { value: 3 },
        registry: makeRegistry(),
        nowMs: t0 + 120_000,
      })).rejects.toThrow(/expired/);
    });

    it("gc removes expired chimeras", () => {
      const t0 = 1_000_000_000_000;
      g.splice({ recipe: ["mneme.fake.double"], ttlSec: 60, nowMs: t0 });
      g.splice({ recipe: ["mneme.fake.plus_one"], ttlSec: 600, nowMs: t0 });
      const r = g.gc(t0 + 120_000);
      expect(r.removed).toBe(1);
      expect(r.remaining).toBe(1);
    });

    it("gc does NOT remove promoted chimeras even if expired", () => {
      const t0 = 1_000_000_000_000;
      const c = g.splice({ recipe: ["mneme.fake.double"], ttlSec: 60, nowMs: t0 });
      g.promote(c.chimeraName);
      const r = g.gc(t0 + 120_000);
      expect(r.remaining).toBe(1);
      expect(r.removed).toBe(0);
    });
  });

  // ── Promotion ─────────────────────────────────────────────────────────
  describe("promotion", () => {
    it("promotionCandidates surfaces chimeras with calls >= threshold", async () => {
      const g2 = new WrapperGenesplicing({ promotionThreshold: 3 });
      const c = g2.splice({ recipe: ["mneme.fake.double"] });
      const reg = makeRegistry();
      for (let i = 0; i < 3; i++) {
        await g2.execute({ chimeraName: c.chimeraName, inputs: { value: i }, registry: reg });
      }
      expect(g2.promotionCandidates().length).toBe(1);
    });

    it("promote() extends TTL 100x + marks promoted=true", () => {
      const t0 = 1_000_000_000_000;
      const c = g.splice({ recipe: ["mneme.fake.double"], ttlSec: 60, nowMs: t0 });
      const before = Date.parse(c.expiresAt);
      const p = g.promote(c.chimeraName);
      expect(p!.promoted).toBe(true);
      const after = Date.parse(p!.expiresAt);
      expect(after - before).toBeGreaterThan(60 * 99 * 1000); // ~100x extension
    });
  });

  // ── stats + introspection ─────────────────────────────────────────────
  describe("stats", () => {
    it("reports total, promoted, expired, avgCallCount, mostUsed", async () => {
      const c1 = g.splice({ recipe: ["mneme.fake.double"] });
      const c2 = g.splice({ recipe: ["mneme.fake.plus_one"] });
      const reg = makeRegistry();
      await g.execute({ chimeraName: c1.chimeraName, inputs: { value: 1 }, registry: reg });
      await g.execute({ chimeraName: c1.chimeraName, inputs: { value: 2 }, registry: reg });
      await g.execute({ chimeraName: c2.chimeraName, inputs: { value: 3 }, registry: reg });
      const s = g.stats();
      expect(s.total).toBe(2);
      expect(s.avgCallCount).toBe(1.5);
      expect(s.mostUsed!.name).toBe(c1.chimeraName);
      expect(s.mostUsed!.count).toBe(2);
    });
  });

  // ── HMAC integrity ────────────────────────────────────────────────────
  describe("HMAC + tamper detection", () => {
    it("verifyChimera detects recipe tampering", () => {
      const c = g.splice({ recipe: ["mneme.fake.double"] });
      const tampered = { ...c, recipe: ["mneme.evil.tool"] };
      expect(g.verifyChimera(tampered)).toBe(false);
    });

    it("verifyExecution detects step tampering", async () => {
      const c = g.splice({ recipe: ["mneme.fake.double"] });
      const r = await g.execute({ chimeraName: c.chimeraName, inputs: { value: 3 }, registry: makeRegistry() });
      expect(g.verifyExecution(r)).toBe(true);
      const tampered = { ...r, ok: false, finalOutput: { value: 999 } };
      expect(g.verifyExecution(tampered)).toBe(false);
    });
  });

  // ── formatters ────────────────────────────────────────────────────────
  describe("formatters", () => {
    it("formatChimeraLine + formatExecutionLine emit short summaries", async () => {
      const c = g.splice({ recipe: ["mneme.fake.double"] });
      expect(formatChimeraLine(c)).toContain("CHIMERA");
      const r = await g.execute({ chimeraName: c.chimeraName, inputs: { value: 1 }, registry: makeRegistry() });
      expect(formatExecutionLine(r)).toContain("EXEC");
    });
  });

  // ── audit-grade end-to-end ────────────────────────────────────────────
  describe("end-to-end audit-grade", () => {
    it("recipe (double → plus_one → square) on input 2 → ((2*2)+1)^2 = 25", async () => {
      const c = g.splice({ recipe: ["mneme.fake.double", "mneme.fake.plus_one", "mneme.fake.square"] });
      const r = await g.execute({ chimeraName: c.chimeraName, inputs: { value: 2 }, registry: makeRegistry() });
      expect((r.finalOutput as { value: number }).value).toBe(25);
    });
  });
});
