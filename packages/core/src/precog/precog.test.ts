/**
 * v1.70.0 -- PRECOG PROTOCOL test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { verifyPackages, extractPackageRefs } from "./package_verifier.js";
import { verifyFacts, extractFactRefs } from "./sha_version_verifier.js";
import { verifyTemporal, extractTemporalRefs } from "./temporal_verifier.js";
import { intercept } from "./firewall.js";
import { issueCertificate, verifyCertificate } from "./trust_certificate.js";
import { priorFor, recordFailure } from "./bayesian_priors.js";
import { runPrecogBench } from "./index.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-pc-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

function initGitWithTags(r: string, commits: string[], tags: string[]) {
  execSync(`git init --quiet -b main`, { cwd: r, stdio: "ignore" });
  execSync(`git config user.email "alice@example.com"`, { cwd: r, stdio: "ignore" });
  execSync(`git config user.name "Alice"`, { cwd: r, stdio: "ignore" });
  execSync(`git config commit.gpgsign false`, { cwd: r, stdio: "ignore" });
  for (let i = 0; i < commits.length; i++) {
    writeFileSync(join(r, `f${i}.txt`), `${i}`, "utf8");
    execSync(`git add -A`, { cwd: r, stdio: "ignore" });
    execSync(`git commit -m "${commits[i]}" --no-gpg-sign --quiet`, { cwd: r, stdio: "ignore" });
  }
  for (const t of tags) execSync(`git tag ${t}`, { cwd: r, stdio: "ignore" });
}

// ─── P1 PACKAGE VERIFIER ─────────────────────────────────────────────

describe("v1.70 Precog P1 · Package Verifier", () => {
  let r: string;
  beforeEach(() => {
    r = setup();
    writeFileSync(join(r, "package.json"), JSON.stringify({
      name: "test", dependencies: { typescript: "5.0.0", react: "18.0.0" },
    }), "utf8");
  });
  afterEach(() => cleanup(r));

  it("extracts pkg@version + import-from + npm-install refs", () => {
    const refs = extractPackageRefs("import x from 'lodash'; npm install foo-bar; legendary@9.99.0 also");
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });

  it("flags package not in deps", () => {
    const r1 = verifyPackages(r, "we use wraith-utils-2099 for caching");
    expect(r1.suspects.find((s) => s.ref.name.includes("wraith"))).toBeDefined();
  });

  it("confirms real deps", () => {
    const r1 = verifyPackages(r, "import { thing } from 'typescript'; import x from 'react'");
    expect(r1.confirmed).toContain("typescript");
    expect(r1.confirmed).toContain("react");
    expect(r1.suspects.length).toBe(0);
  });

  it("treats node:* built-ins as confirmed", () => {
    const r1 = verifyPackages(r, "import { readFileSync } from 'node:fs'");
    expect(r1.confirmed).toContain("node:fs");
  });

  it("flags suspicious future versions", () => {
    const r1 = verifyPackages(r, "we use typescript@99.5.0 in production");
    expect(r1.suspects.find((s) => s.ref.version === "99.5.0")).toBeDefined();
  });
});

// ─── P2 SHA / VERSION / EMAIL VERIFIER ───────────────────────────────

describe("v1.70 Precog P2 · SHA/Version/Email Verifier", () => {
  let r: string;
  beforeEach(() => { r = setup(); initGitWithTags(r, ["first", "second"], ["v1.0.0"]); });
  afterEach(() => cleanup(r));

  it("extracts SHA + version + email refs", () => {
    const refs = extractFactRefs("commit deadbeefcafe shipped in v1.0.0 by alice@example.com");
    const kinds = refs.map((r) => r.kind);
    expect(kinds).toContain("sha");
    expect(kinds).toContain("version");
    expect(kinds).toContain("email");
  });

  it("flags fake SHA", () => {
    const r1 = verifyFacts(r, "the bug was in commit deadbeefcafefade1234567890abcdef1234567");
    expect(r1.suspects.find((s) => s.ref.kind === "sha")).toBeDefined();
  });

  it("confirms real tag", () => {
    const r1 = verifyFacts(r, "shipped in v1.0.0 last week");
    expect(r1.confirmed.some((c) => c.kind === "version" && c.value.endsWith("1.0.0"))).toBe(true);
  });

  it("flags fake version", () => {
    const r1 = verifyFacts(r, "shipped in v9.99.0 the legendary feature");
    expect(r1.suspects.find((s) => s.ref.kind === "version" && s.ref.value.endsWith("9.99.0"))).toBeDefined();
  });

  it("confirms real author email", () => {
    const r1 = verifyFacts(r, "Alice <alice@example.com> wrote this");
    expect(r1.confirmed.some((c) => c.kind === "email" && c.value === "alice@example.com")).toBe(true);
  });
});

// ─── P3 TEMPORAL VERIFIER ────────────────────────────────────────────

describe("v1.70 Precog P3 · Temporal Verifier", () => {
  let r: string;
  beforeEach(() => { r = setup(); initGitWithTags(r, ["init"], []); });
  afterEach(() => cleanup(r));

  it("extracts temporal phrases", () => {
    const refs = extractTemporalRefs("we did this yesterday and last week shipped X");
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it("flags claim about file deletion when none in window", () => {
    const r1 = verifyTemporal(r, "we deleted packages/imaginary-9999.ts last week");
    expect(r1.suspects.length).toBeGreaterThanOrEqual(1);
  });

  it("INSUFFICIENT EVIDENCE on empty window", () => {
    const r1 = verifyTemporal(r, "we did some work 365 days ago in the deep past");
    // 365 days ago -- new repo has no commits there.
    expect(r1.suspects.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── P5 TRUST CERTIFICATE ────────────────────────────────────────────

describe("v1.70 Precog P5 · Trust Certificate", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("issues CERTIFIED when all verifiers pass", () => {
    const cert = issueCertificate(r, "claim", [
      { name: "P1", passed: true },
      { name: "P2", passed: true },
    ]);
    expect(cert.verdict).toBe("CERTIFIED");
    expect(cert.signers.length).toBe(2);
    expect(verifyCertificate(r, cert)).toBe("VALID");
  });

  it("issues REVOKED when majority flagged", () => {
    const cert = issueCertificate(r, "claim", [
      { name: "P1", passed: false },
      { name: "P2", passed: false },
      { name: "P3", passed: true },
    ]);
    expect(cert.verdict).toBe("REVOKED");
    expect(verifyCertificate(r, cert)).toBe("NOT_CERTIFIED");
  });

  it("detects invalid HMAC", () => {
    const cert = issueCertificate(r, "claim", [{ name: "P1", passed: true }]);
    const tampered = { ...cert, hmac: "x".repeat(64) };
    expect(verifyCertificate(r, tampered)).toBe("INVALID_HMAC");
  });

  it("expires", () => {
    const cert = issueCertificate(r, "claim", [{ name: "P1", passed: true }], { ttlMs: 1 });
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(verifyCertificate(r, cert)).toBe("EXPIRED");
      resolve();
    }, 10));
  });
});

// ─── P6 BAYESIAN PRIORS ──────────────────────────────────────────────

describe("v1.70 Precog P6 · Bayesian Priors", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("base prior on empty history", () => {
    const p = priorFor(r, "some claim");
    expect(p.posterior).toBeCloseTo(0.05, 2);
  });

  it("posterior rises after similar failure", () => {
    recordFailure(r, "wraith-utils-2099 is a fake package", "npm-package");
    recordFailure(r, "wraith-utils-2099 is a fake package", "npm-package");
    const p = priorFor(r, "wraith-utils-2099 is a fake package");
    expect(p.posterior).toBeGreaterThan(0.05);
    expect(p.topNeighbors.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── P4 FIREWALL ────────────────────────────────────────────────────

describe("v1.70 Precog P4 · Firewall", () => {
  let r: string;
  beforeEach(() => {
    r = setup();
    writeFileSync(join(r, "package.json"), JSON.stringify({ name: "test", dependencies: { typescript: "5.0.0" } }), "utf8");
    initGitWithTags(r, ["init"], []);
  });
  afterEach(() => cleanup(r));

  it("HEDGES claim with fake package", () => {
    const r1 = intercept(r, "we use wraith-utils-2099 for caching", { recordOnReject: false });
    expect(r1.verdict).toBe("HEDGED");
    expect(r1.hedges.length).toBeGreaterThanOrEqual(1);
    expect(r1.verified).toContain("[unverified package");
  });

  it("CERTIFIED clean claim with real dep", () => {
    const r1 = intercept(r, "the project uses typescript for type safety", { recordOnReject: false });
    expect(r1.verdict).toBe("CERTIFIED");
    expect(r1.certificate).not.toBeNull();
  });

  it("REJECTS claim with many hedges", () => {
    const claim = "wraith-utils-2099 and phantom-fake-9999 and ghost-cache-9998 and demon-99 were all used in v9.99.0 last quarter by alice@nowhere.invalid commit deadbeefcafefade1234567890ab";
    const r1 = intercept(r, claim, { recordOnReject: false });
    expect(["HEDGED", "REJECTED"]).toContain(r1.verdict);
    expect(r1.hedges.length).toBeGreaterThanOrEqual(3);
  });

  it("hedges preserve unrelated text", () => {
    const r1 = intercept(r, "the project uses typescript and wraith-utils-2099 for builds", { recordOnReject: false });
    expect(r1.verified).toContain("typescript"); // Real dep preserved
    expect(r1.verified).toContain("[unverified package"); // Fake hedged
  });

  it("verifierResults reflect each P-layer", () => {
    const r1 = intercept(r, "we use typescript", { recordOnReject: false });
    const names = r1.verifierResults.map((v) => v.name);
    expect(names).toContain("P1-package");
    expect(names).toContain("P2-fact");
    expect(names).toContain("P3-temporal");
    expect(names).toContain("P6-prior");
  });
});

// ─── BENCH ───────────────────────────────────────────────────────────

describe("v1.70 Precog · BENCH", () => {
  let r: string;
  beforeEach(() => {
    r = setup();
    writeFileSync(join(r, "package.json"), JSON.stringify({ name: "test", dependencies: { typescript: "5.0.0", react: "18.0.0" } }), "utf8");
    writeFileSync(join(r, "README.md"), "# Project\n\nUses TypeScript.\n", "utf8");
    writeFileSync(join(r, "CHANGELOG.md"), "## [1.0.0]\n", "utf8");
    initGitWithTags(r, ["init"], []);
  });
  afterEach(() => cleanup(r));

  it("catch rate >= 80% on 9-lie corpus", () => {
    const r1 = runPrecogBench(r);
    expect(r1.catchRate).toBeGreaterThanOrEqual(0.8);
  });
});
