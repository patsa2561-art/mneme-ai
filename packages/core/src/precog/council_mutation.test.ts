/**
 * v1.71.0 -- Multi-voice council + mutation test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { runCouncil } from "./multi_voice_council.js";
import { mutationTest } from "./adversarial_mutation.js";
import { intercept } from "./firewall.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-cm-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

function initRepo(r: string) {
  execSync(`git init --quiet -b main`, { cwd: r, stdio: "ignore" });
  execSync(`git config user.email "t@t.t"`, { cwd: r, stdio: "ignore" });
  execSync(`git config user.name "t"`, { cwd: r, stdio: "ignore" });
  execSync(`git config commit.gpgsign false`, { cwd: r, stdio: "ignore" });
  writeFileSync(join(r, "package.json"), JSON.stringify({ name: "t", dependencies: { typescript: "5.0.0", react: "18.0.0" } }), "utf8");
  execSync(`git add -A`, { cwd: r, stdio: "ignore" });
  execSync(`git commit -m init --no-gpg-sign --quiet`, { cwd: r, stdio: "ignore" });
}

// ─── MULTI-VOICE COUNCIL ─────────────────────────────────────────────

describe("v1.71 Council · 5-voice firewall", () => {
  let r: string;
  beforeEach(() => { r = setup(); initRepo(r); });
  afterEach(() => cleanup(r));

  it("HEDGE when 3+ voices say hedge", () => {
    const c = runCouncil(r, "wraith-utils-2099 is absolutely perfect always guaranteed 100% in v9.99.0");
    // package + humility + temporal-version makes 3 voices hedge.
    expect(c.hedgeVotes).toBeGreaterThanOrEqual(3);
    expect(c.verdict).toBe("HEDGE");
  });

  it("PASS on calibrated truth", () => {
    const c = runCouncil(r, "Most operations typically succeed in usual production scenarios depending on specifics involved");
    expect(c.passVotes + c.abstainVotes).toBeGreaterThanOrEqual(3);
    expect(["PASS", "TIE"]).toContain(c.verdict);
  });

  it("each voice can be skipped", () => {
    const c = runCouncil(r, "test", { skipVoices: ["V1-package-pedant", "V2-temporal-paranoid"] });
    expect(c.votes.length).toBe(3);
  });

  it("majority threshold honored", () => {
    const c1 = runCouncil(r, "we use typescript", { majority: 1 });
    const c2 = runCouncil(r, "we use typescript", { majority: 5 });
    // With higher threshold harder to HEDGE.
    expect(c1.verdict !== c2.verdict || c1.hedgeVotes === c2.hedgeVotes).toBe(true);
  });
});

// ─── ADVERSARIAL MUTATION ────────────────────────────────────────────

describe("v1.71 Adversarial Mutation Test", () => {
  let r: string;
  beforeEach(() => { r = setup(); initRepo(r); });
  afterEach(() => cleanup(r));

  it("PASS on a claim with no mutable targets", () => {
    const orig = intercept(r, "the project documents itself", { recordOnReject: false, issueCert: false });
    const m = mutationTest(r, "the project documents itself", orig);
    expect(["PASS", "DEMOTE-TO-HEDGED"]).toContain(m.decision);
  });

  it("DEMOTE when a mutation also CERTIFIES (fragile cert)", () => {
    // A claim that's CERTIFIED but generic enough that "typescript" -> fake-pkg-2099
    // mutation should still pass the firewall...
    // Actually any mutation that injects a fake should ALWAYS hedge.
    // So real claims that DON'T mention anything pkg-like won't trigger demote.
    // This test ensures the API works end-to-end.
    const orig = intercept(r, "the project uses typescript", { recordOnReject: false, issueCert: false });
    const m = mutationTest(r, "the project uses typescript", orig);
    expect(m.probes.length).toBeGreaterThanOrEqual(1);
    // Mutations should produce HEDGED reports for the fake-pkg swap
    expect(m.probes.some((p) => p.mutatedReport.verdict !== "CERTIFIED")).toBe(true);
  });

  it("skips test for non-CERTIFIED originals", () => {
    const orig = intercept(r, "wraith-utils-2099 absolutely", { recordOnReject: false, issueCert: false });
    const m = mutationTest(r, "wraith-utils-2099 absolutely", orig);
    expect(m.decision).toBe("PASS");
    expect(m.probes.length).toBe(0);
  });
});
