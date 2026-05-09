import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPharmacopoeia, registerVaccine, seedPharmacopoeia, refreshEfficacies } from "./pharmacopoeia.js";
import { VAC_CITATIO_VIRIDIS, SEED_VACCINES } from "./vaccines.js";

describe("pharmacopoeia", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-av-pharm-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("auto-seeds with all 8 vaccines on first read", () => {
    const p = readPharmacopoeia(repo);
    expect(p.vaccines.length).toBe(SEED_VACCINES.length);
    expect(p.schemaVersion).toBe(1);
  });

  it("seedPharmacopoeia is idempotent", () => {
    const a = seedPharmacopoeia(repo);
    const b = seedPharmacopoeia(repo);
    expect(b.vaccines.length).toBe(a.vaccines.length);
  });

  it("registerVaccine adds a new entry", () => {
    seedPharmacopoeia(repo);
    const fakeVac = { ...VAC_CITATIO_VIRIDIS, id: "anti_test_v1", version: "9.9.9" };
    const p = registerVaccine(repo, fakeVac, "local-developed");
    expect(p.vaccines.some((v) => v.id === "anti_test_v1")).toBe(true);
  });

  it("registerVaccine de-dupes on (id, version)", () => {
    seedPharmacopoeia(repo);
    const before = readPharmacopoeia(repo).vaccines.length;
    // Re-registering an existing seed vaccine should be a no-op.
    registerVaccine(repo, VAC_CITATIO_VIRIDIS, "seed");
    const after = readPharmacopoeia(repo).vaccines.length;
    expect(after).toBe(before);
  });

  it("refreshEfficacies doesn't crash when no benchmarks exist", () => {
    seedPharmacopoeia(repo);
    const p = refreshEfficacies(repo);
    expect(p.vaccines.length).toBe(SEED_VACCINES.length);
  });
});
