/**
 * AI-Memory-Bench tests — verify the harness scores hallucinations correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  verifyCitationHashes,
  verifyApiPaths,
  verifyAttribution,
  wilsonLowerBound,
  runBench,
  renderLeaderboard,
  type Probe,
} from "./bench.js";

let tmp: string;
let realHash: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-bench-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email alice@x", { cwd: tmp });
  // Single-word name — cross-shell-safe (cmd.exe + bash both pass it through).
  execSync("git config user.name AliceSmith", { cwd: tmp });
  writeFileSync(join(tmp, "a.txt"), "hello");
  execSync('git add . && git commit -q -m first', { cwd: tmp });
  realHash = execSync("git rev-parse HEAD", { cwd: tmp }).toString().trim();
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("verifyCitationHashes", () => {
  it("scores 1.0 for an answer with all-real hashes", async () => {
    const r = await verifyCitationHashes(`The fix was in ${realHash}.`, tmp);
    expect(r.score).toBe(1);
    expect(r.totalClaims).toBe(1);
    expect(r.resolvedClaims).toBe(1);
    expect(r.hallucinatedClaims).toBe(0);
  });

  it("scores 0 for an answer with all-fake hashes", async () => {
    const r = await verifyCitationHashes("See deadbeef and cafef00d for details.", tmp);
    expect(r.score).toBe(0);
    expect(r.hallucinatedClaims).toBe(2);
  });

  it("scores partial for mixed real+fake", async () => {
    const r = await verifyCitationHashes(`Real: ${realHash}, fake: deadbeefdeadbeef.`, tmp);
    expect(r.totalClaims).toBe(2);
    expect(r.resolvedClaims).toBe(1);
    expect(r.score).toBe(0.5);
  });

  it("scores 1.0 for an answer with no hash claims (no claims to fail)", async () => {
    const r = await verifyCitationHashes("I don't know.", tmp);
    expect(r.score).toBe(1);
    expect(r.totalClaims).toBe(0);
  });
});

describe("verifyApiPaths", () => {
  it("scores 1.0 when every cited path exists", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src/auth.ts"), "");
    const r = await verifyApiPaths("Check src/auth.ts for the logic.", tmp);
    expect(r.score).toBe(1);
  });

  it("flags hallucinated paths", async () => {
    const r = await verifyApiPaths("See src/imaginary.ts and packages/fake/file.js.", tmp);
    expect(r.hallucinatedClaims).toBe(2);
    expect(r.score).toBe(0);
  });
});

describe("verifyAttribution", () => {
  it("matches correct author", async () => {
    const r = await verifyAttribution(`The commit ${realHash}: by AliceSmith introduced this.`, tmp);
    expect(r.score).toBe(1);
    expect(r.resolvedClaims).toBe(1);
  });

  it("flags wrong author", async () => {
    const r = await verifyAttribution(`Commit ${realHash}: by BobJones did the work.`, tmp);
    expect(r.score).toBe(0);
    expect(r.hallucinatedClaims).toBe(1);
  });
});

describe("wilsonLowerBound", () => {
  it("returns 0 when total is 0", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("returns lower bound less than the point estimate", () => {
    const lb = wilsonLowerBound(80, 100);
    expect(lb).toBeLessThan(0.8);
    expect(lb).toBeGreaterThan(0.6);
  });

  it("for unanimous small samples, lower bound is conservative", () => {
    const lb = wilsonLowerBound(5, 5);
    expect(lb).toBeLessThan(1);
    expect(lb).toBeGreaterThan(0.4);
  });

  it("for large unanimous samples, approaches 1", () => {
    const lb = wilsonLowerBound(1000, 1000);
    expect(lb).toBeGreaterThan(0.99);
  });
});

describe("runBench — end-to-end", () => {
  it("aggregates scores across categories", async () => {
    const probes: Probe[] = [
      { id: "p1", category: "citation", question: "?", verify: verifyCitationHashes },
      { id: "p2", category: "citation", question: "?", verify: verifyCitationHashes },
      { id: "p3", category: "api", question: "?", verify: verifyApiPaths },
    ];
    const answers = {
      p1: realHash,
      p2: "deadbeef-not-real",
      p3: "src/imaginary.ts",
    };
    const r = await runBench(probes, answers, tmp);
    expect(r.probesAttempted).toBe(3);
    expect(r.perCategory.citation?.tried).toBe(2);
    expect(r.perCategory.api?.tried).toBe(1);
    expect(r.hallucinationRate).toBeGreaterThan(0);
  });

  it("computes Wilson lower bound on overall groundedness", async () => {
    const probes: Probe[] = [
      { id: "p1", category: "citation", question: "?", verify: verifyCitationHashes },
    ];
    const r = await runBench(probes, { p1: realHash }, tmp);
    expect(r.wilsonLowerBound).toBeGreaterThan(0);
    expect(r.wilsonLowerBound).toBeLessThanOrEqual(1);
  });
});

describe("renderLeaderboard", () => {
  it("produces valid markdown", async () => {
    const probes: Probe[] = [
      { id: "p1", category: "citation", question: "?", verify: verifyCitationHashes },
    ];
    const r = await runBench(probes, { p1: realHash }, tmp);
    const md = renderLeaderboard(r, "Test Run");
    expect(md).toContain("# AI-Memory-Bench");
    expect(md).toContain("Hallucination rate");
    expect(md).toContain("Wilson");
    expect(md).toMatch(/\| citation \| 1 \|/);
  });
});
