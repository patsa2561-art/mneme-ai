import { describe, it, expect } from "vitest";
import { EvolutionLedger, formatGrowthLine } from "./index.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function fresh(): { path: string; led: EvolutionLedger } {
  const dir = mkdtempSync(join(tmpdir(), "mneme-evo-"));
  const path = join(dir, "evolution.jsonl");
  return { path, led: new EvolutionLedger({ ledgerPath: path }) };
}

const baseMetrics = {
  mnemeVersion: "2.19.2",
  mcpToolCount: 405,
  coreModuleCount: 250,
  testCount: 9860,
  ritualGateCount: 21,
  aurelianShipCount: 18,
  vendorCount: 13,
};

describe("v2.19.2 · MNEME EVOLUTION LEDGER", () => {
  it("records a first snapshot with no delta", () => {
    const { led } = fresh();
    const s = led.record({ day: "2026-05-16", metrics: baseMetrics });
    expect(s.delta).toBeNull();
    expect(s.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(s.snapshotId).toMatch(/^evo-[0-9a-f]{14}$/);
    expect(led.verify(s)).toBe(true);
  });

  it("computes positive delta when child grows", () => {
    const { led } = fresh();
    led.record({ day: "2026-05-15", metrics: { ...baseMetrics, mcpToolCount: 400 } });
    const s = led.record({ day: "2026-05-16", metrics: { ...baseMetrics, mcpToolCount: 405 } });
    expect(s.delta).not.toBeNull();
    expect(s.delta!.mcpToolCount).toBe(5);
  });

  it("computes negative delta when child shrinks (regression alert)", () => {
    const { led } = fresh();
    led.record({ day: "2026-05-15", metrics: { ...baseMetrics, testCount: 9860 } });
    const s = led.record({ day: "2026-05-16", metrics: { ...baseMetrics, testCount: 9700 } });
    expect(s.delta!.testCount).toBe(-160);
  });

  it("is idempotent per day (re-recording replaces same-day entry)", () => {
    const { led } = fresh();
    led.record({ day: "2026-05-16", metrics: { ...baseMetrics, mcpToolCount: 400 } });
    led.record({ day: "2026-05-16", metrics: { ...baseMetrics, mcpToolCount: 410 } });
    expect(led.recent(10).length).toBe(1);
    expect(led.recent(1)[0]!.metrics.mcpToolCount).toBe(410);
  });

  it("chain integrity holds across many days", () => {
    const { led } = fresh();
    for (let i = 1; i <= 7; i++) {
      led.record({ day: `2026-05-${10 + i}`, metrics: { ...baseMetrics, mcpToolCount: 400 + i } });
    }
    const chk = led.verifyChain();
    expect(chk.ok).toBe(true);
  });

  it("verifyChain detects tampering", () => {
    const { led } = fresh();
    led.record({ day: "2026-05-15", metrics: baseMetrics });
    led.record({ day: "2026-05-16", metrics: { ...baseMetrics, mcpToolCount: 999 } });
    const recent = led.recent(10);
    // Mutate in place via internal array — verify chain breaks
    (recent[0] as { metrics: { mcpToolCount: number } }).metrics.mcpToolCount = 1;
    expect(led.verify(recent[0]!)).toBe(false);
  });

  it("persists to file + reloads transparently", () => {
    const { path, led } = fresh();
    led.record({ day: "2026-05-16", metrics: baseMetrics });
    expect(readFileSync(path, "utf8")).toContain("2026-05-16");
    const led2 = new EvolutionLedger({ ledgerPath: path });
    expect(led2.recent(1).length).toBe(1);
    expect(led2.verifyChain().ok).toBe(true);
  });

  it("reportCard summarises with deltas", () => {
    const { led } = fresh();
    led.record({ day: "2026-05-15", metrics: { ...baseMetrics, mcpToolCount: 400 } });
    led.record({ day: "2026-05-16", metrics: { ...baseMetrics, mcpToolCount: 405 } });
    const card = led.reportCard();
    expect(card).toContain("MNEME GROWTH");
    expect(card).toContain("2026-05-16");
    expect(card).toMatch(/Δtools=\+5/);
  });

  it("formatGrowthLine summarises one snapshot", () => {
    const { led } = fresh();
    const s = led.record({ day: "2026-05-16", metrics: baseMetrics });
    expect(formatGrowthLine(s)).toContain("EVOLUTION");
    expect(formatGrowthLine(s)).toContain("2.19.2");
  });
});
