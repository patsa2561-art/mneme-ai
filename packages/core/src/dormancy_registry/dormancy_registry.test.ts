import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyDormancy, renderTombstone, shouldShowTombstone, _resetShownForTests,
  DEFAULTS,
} from "./index.js";

describe("dormancy_registry (v2.21.8)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-dorm-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  const TIER0 = new Set<string>(["mneme verify-self", "mneme ask", "mneme route", "mneme earthquake drift", "mneme stillness gate"]);

  it("classifyDormancy: Tier-0 verb is never a candidate", () => {
    const r = classifyDormancy({ command: "mneme verify-self", since: "1.0", group: "trust", what: "", when: "" } as any, 0, TIER0);
    expect(r.candidateForRemoval).toBe(false);
    expect(r.reason.toLowerCase()).toContain("tier-0");
  });

  it("classifyDormancy: matured + zero hits → candidate=true", () => {
    const r = classifyDormancy({ command: "mneme synapse mint_code", since: "1.81.0", group: "synapse", what: "", when: "" } as any, 0, TIER0);
    expect(r.candidateForRemoval).toBe(true);
  });

  it("classifyDormancy: hits above threshold → not candidate", () => {
    const r = classifyDormancy({ command: "mneme some-verb", since: "1.0", group: "x", what: "", when: "" } as any, 5, TIER0);
    expect(r.candidateForRemoval).toBe(false);
  });

  it("classifyDormancy: too-recent verb → not candidate (gestation not elapsed)", () => {
    const r = classifyDormancy({ command: "mneme new-verb", since: "2.21.8", group: "x", what: "", when: "" } as any, 0, TIER0);
    // Verb introduced in latest minor → likely zero or negative age; not candidate.
    expect(r.candidateForRemoval).toBe(false);
  });

  it("renderTombstone includes verb name + reason + status", () => {
    const r = classifyDormancy({ command: "mneme x", since: "1.0", group: "g", what: "", when: "" } as any, 0, TIER0);
    const out = renderTombstone(r);
    expect(out).toContain("mneme x");
    expect(out).toContain("TOMBSTONE");
    expect(out).toContain("v3.0");
    expect(out).toContain("functional");
  });

  it("shouldShowTombstone: true on first call, false on second", () => {
    const a = shouldShowTombstone(repo, "mneme x");
    const b = shouldShowTombstone(repo, "mneme x");
    expect(a).toBe(true);
    expect(b).toBe(false);
  });

  it("shouldShowTombstone: different verbs each shown once", () => {
    expect(shouldShowTombstone(repo, "mneme x")).toBe(true);
    expect(shouldShowTombstone(repo, "mneme y")).toBe(true);
    expect(shouldShowTombstone(repo, "mneme x")).toBe(false);
  });

  it("DEFAULTS surface lookback / gestation / threshold for inspection", () => {
    expect(DEFAULTS.lookbackDays).toBe(90);
    expect(DEFAULTS.gestationDays).toBe(90);
    expect(DEFAULTS.hitThreshold).toBe(0);
  });

  it("_resetShownForTests clears the shown registry", () => {
    shouldShowTombstone(repo, "mneme z");
    _resetShownForTests(repo);
    expect(shouldShowTombstone(repo, "mneme z")).toBe(true);
  });
});
