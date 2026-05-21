import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, advance, graduate, loadState, formatState, PHASE_ORDER } from "./index.js";

describe("intern", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-intern-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("start initialises HMAC-signed state in observation phase", async () => {
    const s = await start(repo, { vendor: "claude-opus-4-7" });
    expect(s.currentPhase).toBe("observation");
    expect(s.vendor).toBe("claude-opus-4-7");
    expect(s.transitions.length).toBe(1);
    expect(s.transitions[0]!.sig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(existsSync(join(repo, ".mneme/intern/state.json"))).toBe(true);
  });

  it("advance walks all 5 phase transitions", async () => {
    let s = await start(repo, { vendor: "claude-opus-4-7" });
    for (let i = 0; i < 4; i++) s = await advance(repo);
    expect(s.currentPhase).toBe("near-autonomous");
    expect(s.transitions.length).toBe(5); // start + 4 advances
  });

  it("graduate refuses early (before near-autonomous)", async () => {
    await start(repo, { vendor: "claude-opus-4-7" });
    await expect(graduate(repo)).rejects.toThrow(/near-autonomous/);
  });

  it("graduate succeeds from near-autonomous + mints cert + assigns tier", async () => {
    await start(repo, { vendor: "claude-opus-4-7" });
    for (let i = 0; i < 4; i++) await advance(repo);
    const s = await graduate(repo);
    expect(s.currentPhase).toBe("graduated");
    expect(s.tier).toMatch(/Tier 1|Tier 2|Tier 3|Failed/);
    expect(s.graduationCertId).toMatch(/^cert_/);
    expect(s.transitions.length).toBe(6);
  });

  it("loadState round-trips JSON state from disk", async () => {
    const s = await start(repo, { vendor: "claude-opus-4-7" });
    const loaded = loadState(repo);
    expect(loaded?.internId).toBe(s.internId);
  });

  it("advance refuses after graduation", async () => {
    await start(repo, { vendor: "claude-opus-4-7" });
    for (let i = 0; i < 4; i++) await advance(repo);
    await graduate(repo);
    await expect(advance(repo)).rejects.toThrow(/already graduated/);
  });

  it("formatState prints human summary with phase + transitions count", async () => {
    const s = await start(repo, { vendor: "test-vendor" });
    const out = formatState(s);
    expect(out).toContain("AI INTERNSHIP");
    expect(out).toContain("test-vendor");
    expect(out).toContain("observation");
  });

  it("PHASE_ORDER has the 6 phases in canonical order", () => {
    expect(PHASE_ORDER).toEqual([
      "observation", "supervised-low", "supervised-medium",
      "progressive", "near-autonomous", "graduated",
    ]);
  });
});
