import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { matchTemplate } from "./templates.js";
import { applyAndVerify } from "./verify.js";
import { synthesize, verifySignature, evolutionPass, autoPr } from "./synthesize.js";
import type { EvolveProposal, EvolveSignal } from "../types.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mneme-synth-"));
  // We run gates in-process; they shell out to git/tsc/vitest. We just
  // need a writable repo dir for the tests that don't actually run
  // gates (template matching, HMAC).
});
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

function writeChecks(repoRoot: string, content: string): void {
  const dir = join(repoRoot, "packages/core/src/selfcheck");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "checks.ts"), content, "utf8");
}

function writeProposal(repoRoot: string, p: EvolveProposal): void {
  const dir = join(repoRoot, ".mneme/proposals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${p.id}.json`), JSON.stringify(p, null, 2), "utf8");
}

const SAMPLE_CHECKS_SRC = `
const antivirusReadyCheck: AuditCheck = {
  name: "antivirus-ready",
  description: "Antivirus pharmacopoeia is initialized",
  failSeverity: "info",
  async run(repoRoot: string) {
    const start = t0();
    const path = join(repoRoot, ".mneme/antivirus/pharmacopoeia.json");
    if (!existsSync(path)) {
      return v(start, {
        name: "antivirus-ready", description: "antivirus ready",
        status: "warn",
        evidence: "no pharmacopoeia.json",
        fixHint: "Run \`mneme antivirus lab\` to auto-seed.",
      });
    }
    return v(start, { name: "antivirus-ready", description: "antivirus ready", status: "pass", evidence: "ok" });
  },
};
`;

const SAMPLE_SIGNAL: EvolveSignal = {
  kind: "selfcheck-fail",
  pattern: "selfcheck:antivirus-ready:warn",
  occurrences: 3,
  firstSeen: "2026-05-10T09:33:05.614Z",
  lastSeen: "2026-05-10T09:33:05.614Z",
  evidence: "no pharmacopoeia.json -- fix hint: Run `mneme antivirus lab` to auto-seed.",
};

const SAMPLE_PROPOSAL: EvolveProposal = {
  id: "test-proposal-001",
  generatedAt: "2026-05-10T10:00:00.000Z",
  title: "Self-heal: selfcheck \"antivirus-ready\" keeps failing",
  body: "...",
  confidence: 0.13,
  signals: [SAMPLE_SIGNAL],
  suggestion: { files: ["packages/core/src/selfcheck/checks.ts"], direction: "..." },
};

// ─────────────────────────────────────────────────────────────────────────
// Template matching
// ─────────────────────────────────────────────────────────────────────────
describe("templates -- selfcheck-warn-to-skip-on-missing-file", () => {
  it("matches when source has the canonical warn-on-missing pattern", () => {
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    const m = matchTemplate(repo, SAMPLE_SIGNAL);
    expect(m).not.toBeNull();
    expect(m!.templateId).toBe("selfcheck-warn-to-skip-on-missing-file");
    expect(m!.filePath).toBe("packages/core/src/selfcheck/checks.ts");
    expect(m!.before).toContain('"warn"');
    expect(m!.after).toContain('"skip"');
  });

  it("returns null when signal pattern is not selfcheck:*:warn", () => {
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    const m = matchTemplate(repo, { ...SAMPLE_SIGNAL, pattern: "antivirus:citatio_viridis" });
    expect(m).toBeNull();
  });

  it("returns null when target file does not exist", () => {
    expect(matchTemplate(repo, SAMPLE_SIGNAL)).toBeNull();
  });

  it("returns null when source has no matching check", () => {
    writeChecks(repo, "// nothing matches\n");
    const m = matchTemplate(repo, SAMPLE_SIGNAL);
    expect(m).toBeNull();
  });

  it("matches different check names independently", () => {
    const src = SAMPLE_CHECKS_SRC.replace(/antivirus-ready/g, "agent-files-synced");
    writeChecks(repo, src);
    const m = matchTemplate(repo, { ...SAMPLE_SIGNAL, pattern: "selfcheck:agent-files-synced:warn" });
    expect(m).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// applyAndVerify -- without external gates (we simulate them being
// missing). This test verifies the in-memory string replacement +
// restore behavior. Real-tool gate tests live in the e2e file.
// ─────────────────────────────────────────────────────────────────────────
describe("applyAndVerify -- string-replace + restore", () => {
  function gitInit(repoRoot: string): void {
    spawnSync("git", ["init", "-q"], { cwd: repoRoot });
    spawnSync("git", ["config", "user.email", "test@test"], { cwd: repoRoot });
    spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot });
  }

  it("rejects when working tree is dirty for the file", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    // Dirty the file.
    writeFileSync(join(repo, "packages/core/src/selfcheck/checks.ts"), SAMPLE_CHECKS_SRC + "\n// dirty\n", "utf8");
    const m = matchTemplate(repo, SAMPLE_SIGNAL);
    expect(m).not.toBeNull();
    const r = applyAndVerify(repo, m!);
    expect(r.gates.workingTreeClean).toBe(false);
    expect(r.kept).toBe(false);
  });

  it("restores original when tsc is missing (compile gate fails)", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    const original = readFileSync(join(repo, "packages/core/src/selfcheck/checks.ts"), "utf8");
    const m = matchTemplate(repo, SAMPLE_SIGNAL);
    expect(m).not.toBeNull();
    const r = applyAndVerify(repo, m!);
    // No node_modules in temp repo -> tsc binary missing -> compile fails -> restored.
    expect(r.gates.workingTreeClean).toBe(true);
    expect(r.gates.compileOk).toBe(false);
    expect(r.kept).toBe(false);
    const after = readFileSync(join(repo, "packages/core/src/selfcheck/checks.ts"), "utf8");
    expect(after).toBe(original);
  });

  it("produces a unified-diff patchText even when gates fail", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    const m = matchTemplate(repo, SAMPLE_SIGNAL)!;
    const r = applyAndVerify(repo, m);
    expect(r.patchText).toContain("--- a/packages/core/src/selfcheck/checks.ts");
    expect(r.patchText).toContain("+++ b/packages/core/src/selfcheck/checks.ts");
    expect(r.patchText).toContain('-        status: "warn",');
    expect(r.patchText).toContain('+        status: "skip",');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// synthesize() + HMAC verifySignature
// ─────────────────────────────────────────────────────────────────────────
describe("synthesize + HMAC", () => {
  function gitInit(repoRoot: string): void {
    spawnSync("git", ["init", "-q"], { cwd: repoRoot });
    spawnSync("git", ["config", "user.email", "test@test"], { cwd: repoRoot });
    spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot });
  }

  it("returns null when proposal id does not exist", () => {
    expect(synthesize(repo, "does-not-exist")).toBeNull();
  });

  it("synthesizes + signs result + persists synth.json", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    writeProposal(repo, SAMPLE_PROPOSAL);
    const r = synthesize(repo, SAMPLE_PROPOSAL.id);
    expect(r).not.toBeNull();
    expect(r!.proposalId).toBe(SAMPLE_PROPOSAL.id);
    expect(r!.templateId).toBe("selfcheck-warn-to-skip-on-missing-file");
    expect(r!.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySignature(repo, r!)).toBe(true);
    // synth.json sidecar persisted
    expect(existsSync(join(repo, ".mneme/proposals", `${SAMPLE_PROPOSAL.id}.synth.json`))).toBe(true);
  });

  it("only persists .patch file when verified=true", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    writeProposal(repo, SAMPLE_PROPOSAL);
    const r = synthesize(repo, SAMPLE_PROPOSAL.id);
    // tsc binary missing in temp repo -> verified=false -> .patch NOT written
    expect(r!.verified).toBe(false);
    expect(existsSync(join(repo, ".mneme/proposals", `${SAMPLE_PROPOSAL.id}.patch`))).toBe(false);
  });

  it("verifySignature returns false on tamper", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    writeProposal(repo, SAMPLE_PROPOSAL);
    const r = synthesize(repo, SAMPLE_PROPOSAL.id)!;
    const tampered = { ...r, patchText: r.patchText + "\n// tampered\n" };
    expect(verifySignature(repo, tampered)).toBe(false);
  });

  it("v1.27.4: differentiated confidence is below verified threshold when gates fail (no node_modules in temp)", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    writeProposal(repo, SAMPLE_PROPOSAL);
    const r = synthesize(repo, SAMPLE_PROPOSAL.id)!;
    // v1.27.4 formula: 0.20*signal + 0.20*track + 0.10*test + 0.50*verify.
    // Temp repo has no node_modules -> tsc gate fails (status null);
    // verify=false -> the 0.50*verify term is 0. Confidence lands well
    // below 0.50 (no verified bonus, no template history).
    expect(r.confidence).toBeLessThan(0.4);
    expect(r.confidence).toBeGreaterThanOrEqual(0.05);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// evolutionPass -- Phase 5 daemon entry point
// ─────────────────────────────────────────────────────────────────────────
describe("evolutionPass", () => {
  function gitInit(repoRoot: string): void {
    spawnSync("git", ["init", "-q"], { cwd: repoRoot });
    spawnSync("git", ["config", "user.email", "test@test"], { cwd: repoRoot });
    spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot });
  }

  it("returns 0 scanned when no proposals exist", () => {
    const r = evolutionPass(repo);
    expect(r.scanned).toBe(0);
    expect(r.synthesized).toBe(0);
  });

  it("scans every proposal that lacks a synth sidecar", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    writeProposal(repo, SAMPLE_PROPOSAL);
    writeProposal(repo, { ...SAMPLE_PROPOSAL, id: "test-proposal-002" });
    const r = evolutionPass(repo);
    expect(r.scanned).toBe(2);
    expect(r.synthesized).toBe(2);
  });

  it("is idempotent -- re-running skips already-synthesized proposals", () => {
    gitInit(repo);
    writeChecks(repo, SAMPLE_CHECKS_SRC);
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "-q"], { cwd: repo });
    writeProposal(repo, SAMPLE_PROPOSAL);
    evolutionPass(repo);
    const r2 = evolutionPass(repo);
    expect(r2.synthesized).toBe(0); // already done
  });
});

// ─────────────────────────────────────────────────────────────────────────
// autoPr -- guard rails (we don't actually call gh; just check refusals)
// ─────────────────────────────────────────────────────────────────────────
describe("autoPr -- safety gates", () => {
  it("refuses without synthesis artifacts", () => {
    const r = autoPr(repo, "does-not-exist");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no synthesis artifacts/);
  });

  it("refuses unverified patch", () => {
    // Write a fake unverified synth.json + patch.
    const dir = join(repo, ".mneme/proposals");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fake.synth.json"), JSON.stringify({
      id: "x", proposalId: "fake", templateId: "x", synthesizedAt: "x",
      filePath: "x", patchText: "", gates: { workingTreeClean: true, compileOk: false, testsOk: null, errors: [] },
      verified: false, signature: "x", confidence: 0.1,
    }), "utf8");
    writeFileSync(join(dir, "fake.patch"), "diff --git ...", "utf8");
    const r = autoPr(repo, "fake");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not verified/);
  });
});
