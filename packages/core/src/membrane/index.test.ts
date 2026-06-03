import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMembrane,
  sealMembrane,
  verifyMembrane,
  membraneGauntlet,
  catalogToEntries,
  type MembranePacket,
} from "./index.js";
import type { ManifestCommand } from "../agent_manifest.js";
import type { AxiaEvent } from "../axia/index.js";

const CAT: ManifestCommand[] = [
  { command: "mneme a", since: "1.0", group: "core", what: "alpha cmd", when: "x" },
  { command: "mneme b", since: "1.0", group: "core", what: "beta cmd", when: "y" },
];
const EVENTS: Array<Partial<AxiaEvent>> = [
  { kind: "tokens-saved", count: 750, source: "treasury", at: 1 },
  { kind: "destructive-gated", count: 2, source: "heph", at: 2 },
];

describe("MEMBRANE — the 3-pillar fusion", () => {
  it("scores 100 on its own gauntlet", () => {
    const g = membraneGauntlet();
    expect(g.score).toBe(100);
    expect(g.checks.every((c) => c.pass)).toBe(true);
  });

  it("fuses all three pillars in one packet", () => {
    const m = buildMembrane({ version: "9.9.9", catalog: CAT, axiaEvents: EVENTS });
    // PILLAR 1 — STELE capability surface
    expect(m.capability.root).toHaveLength(64);
    expect(m.capability.count).toBe(2);
    // PILLAR 3 — BOOT activation
    expect(m.activation.decisionTable.length).toBeGreaterThan(0);
    expect(typeof m.activation.instructions).toBe("string");
    // PILLAR 2 — AXIA value
    expect(m.value.tokensSaved).toBe(750);
    expect(m.value.byKind["destructive-gated"]).toBe(2);
    expect(m.value.chainValid).toBe(true);
  });

  it("PILLAR 1: delta-sync — held root matches ⇒ 0 tokens, mismatch ⇒ full delta", () => {
    const cold = buildMembrane({ version: "1.0", catalog: CAT });
    expect(cold.capability.upToDate).toBe(false);
    expect(cold.capability.added).toHaveLength(2);

    const warm = buildMembrane({ version: "1.0", catalog: CAT, heldRoot: cold.capability.root });
    expect(warm.capability.upToDate).toBe(true);
    expect(warm.capability.deltaTokenEstimate).toBe(0);
  });

  it("catalogToEntries maps command→identity leaf", () => {
    const entries = catalogToEntries(CAT);
    expect(entries).toEqual([
      { name: "mneme a", version: "1.0", summary: "alpha cmd" },
      { name: "mneme b", version: "1.0", summary: "beta cmd" },
    ]);
  });

  it("seal/verify round-trip — a genuine sealed membrane verifies", () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-membrane-"));
    try {
      const m = buildMembrane({ version: "9.9.9", catalog: CAT, axiaEvents: EVENTS });
      const signed = sealMembrane(dir, m, 1_700_000_000_000);
      const v = verifyMembrane(signed);
      expect(v.valid).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tamper detection — a mutated packet fails verification", () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-membrane-"));
    try {
      const m = buildMembrane({ version: "9.9.9", catalog: CAT, axiaEvents: EVENTS });
      const signed = sealMembrane(dir, m, 1_700_000_000_000);
      // forge the value ledger after signing
      const forged = { ...signed, packet: { ...signed.packet, value: { ...signed.packet.value, tokensSaved: 999999 } } as MembranePacket };
      const v = verifyMembrane(forged);
      expect(v.valid).toBe(false);
      expect(v.reason).toMatch(/tampered|payloadHash|signature/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("total — never throws on garbage input", () => {
    expect(() =>
      buildMembrane({ version: undefined as unknown as string, catalog: null as unknown as ManifestCommand[] }),
    ).not.toThrow();
  });

  it("honest — no fabricated value, USD only with a supplied price", () => {
    const none = buildMembrane({ version: "1.0", catalog: CAT });
    expect(none.value.tokensSaved).toBe(0);
    expect(none.value.usdSaved).toBeNull();

    const priced = buildMembrane({
      version: "1.0",
      catalog: CAT,
      axiaEvents: [{ kind: "tokens-saved", count: 1000, source: "treasury", at: 1 }],
      pricePer1k: 3,
    });
    expect(priced.value.usdSaved).toBe(3);
  });
});
