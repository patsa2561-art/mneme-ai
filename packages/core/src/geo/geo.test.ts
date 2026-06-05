import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyGeo, seedRaw, metamorphose, forget, containsRaw, verifyGeo, geoStats, deterministicAbstract, geoGauntlet } from "./index.js";

const REPO = mkdtempSync(join(tmpdir(), "mneme-geo-"));
const DAY = 86_400_000, t0 = 1_600_000_000_000;

describe("GEOLOGICAL MEMORY — raw dissolves, wisdom + proof remain", () => {
  it("raw decays to abstract: the raw is DESTROYED, a signed purge proof remains", () => {
    let st = seedRaw(emptyGeo(), { id: "r1", raw: "secret AKIA_XYZ deploy token prod", ts: t0 });
    const after = metamorphose(REPO, st, t0 + 200 * DAY, { decayDays: 90, idleDays: 30 });
    expect(containsRaw(after, "AKIA_XYZ")).toBe(false);          // raw gone
    expect(after.cells[0].tier).toBe("abstract");
    expect(after.cells[0].raw).toBeUndefined();
    expect(after.cells[0].rawHash).toBeTruthy();
    const v = verifyGeo(after);
    expect(v.proofsTotal).toBe(1);
    expect(v.proofsValid).toBe(1);                                // Ed25519 proof verifies + binds the raw hash
  });

  it("fresh + accessed raw does NOT decay (only old + idle)", () => {
    let st = seedRaw(emptyGeo(), { id: "r1", raw: "recent note", ts: t0 + 199 * DAY, lastAccess: t0 + 199 * DAY });
    const after = metamorphose(REPO, st, t0 + 200 * DAY, { decayDays: 90, idleDays: 30 });
    expect(after.cells[0].tier).toBe("raw");
  });

  it("dense near-duplicates fuse into a high-support axiom that keeps the shared essence", () => {
    let st = emptyGeo();
    st = seedRaw(st, { id: "a", raw: "deploy auth token prod east", ts: t0 });
    st = seedRaw(st, { id: "b", raw: "deploy auth token prod west", ts: t0 + DAY });
    st = seedRaw(st, { id: "c", raw: "deploy auth token prod north", ts: t0 + 2 * DAY });
    const after = metamorphose(REPO, st, t0 + 200 * DAY, { decayDays: 90, idleDays: 30, fuseThreshold: 0.5, fuseMinSupport: 2 });
    const ax = after.cells.find((c) => c.tier === "axiom");
    expect(ax).toBeTruthy();
    expect(ax!.support).toBeGreaterThanOrEqual(2);
    expect(/deploy|auth|token|prod/.test(ax!.abstract ?? "")).toBe(true);
    expect((ax!.sourceHashes ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("right-to-be-forgotten: on-demand purge leaves only a signed tombstone", () => {
    let st = seedRaw(emptyGeo(), { id: "p", raw: "Jane SSN 999-88-7777 PII", ts: t0 });
    st = forget(REPO, st, "999-88-7777", t0 + DAY);
    expect(containsRaw(st, "999-88-7777")).toBe(false);
    expect(st.cells[0].abstract).toBe("[forgotten]");
    expect(st.cells[0].purgeProof).toBeTruthy();
    expect(verifyGeo(st).ok).toBe(true);
  });

  it("audit chain is tamper-evident + deterministic abstract is no-LLM", () => {
    expect(deterministicAbstract("hello hello world world world test")).toContain("world");
    let st = seedRaw(emptyGeo(), { id: "x", raw: "alpha beta gamma delta", ts: t0 });
    const after = metamorphose(REPO, st, t0 + 200 * DAY, { decayDays: 90, idleDays: 30 });
    expect(verifyGeo(after).chainIntact).toBe(true);
    const bad = { ...after, events: after.events.map((e) => ({ ...e, ts: e.ts + 1 })) };
    expect(verifyGeo(bad).chainIntact).toBe(false);
  });

  it("total on garbage", () => {
    expect(() => metamorphose(REPO, null as never, t0)).not.toThrow();
    expect(() => forget(REPO, emptyGeo(), "", t0)).not.toThrow();
    expect(() => geoStats(null as never)).not.toThrow();
  });

  it("MEASURED: geoGauntlet = 100", () => {
    const g = geoGauntlet(REPO); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
