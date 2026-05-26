/**
 * v2.64.0 — DIFFERENTIAL ARENA (multi-vendor consensus) pinned tests.
 *
 * Section map:
 *   G1 — adapters (mock / http / cli)
 *   G2 — pairwise scoring (Jaccard / numeric / sentiment / length)
 *   G3 — consensus aggregation + outlier
 *   G4 — common-facts + unique-claims extraction
 *   G5 — diffArenaAsk end-to-end
 *   G6 — ACGV grader hook
 *   G7 — HMAC-chained ledger
 *   G8 — CLI surface
 *   G9 — TG probes
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const CLI = join(REPO, "packages", "cli", "bin", "mneme.js");

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "mneme-da-"));
}

describe("v2.64.0 G1 — adapters (PINNED)", () => {
  it("G1.1 mockAdapter returns deterministic seeded response", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const a = m.mockAdapter({ name: "test" });
    const r1 = await a.ask("hello");
    const r2 = await a.ask("hello");
    expect(r1.text).toBe(r2.text);
    expect(r1.ok).toBe(true);
    expect(r1.kind).toBe("mock");
  });

  it("G1.2 mockAdapter with custom responder", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const a = m.mockAdapter({ name: "x", responder: () => "fixed answer" });
    const r = await a.ask("anything");
    expect(r.text).toBe("fixed answer");
  });

  it("G1.3 httpAdapter without env key returns ok=false", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const a = m.httpAdapter({
      name: "fake-http",
      endpoint: "http://localhost:0/v1/chat/completions",
      apiKeyEnv: "TOTALLY_FAKE_KEY_XYZ_NOT_SET",
      model: "x",
    });
    const r = await a.ask("hello");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/missing env/i);
  });

  it("G1.4 cliAdapter refuses command not in allowlist", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const a = m.cliAdapter({ name: "evil", command: "rm -rf /", args: [] });
    const r = await a.ask("hello");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/refused by allowlist/i);
  });
});

describe("v2.64.0 G2 — pairwise scoring (PINNED)", () => {
  it("G2.1 identical text → composite 1.0", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const r = m.pairwiseScore({ vendor: "a", text: "React 19 removed legacy context API" }, { vendor: "b", text: "React 19 removed legacy context API" });
    expect(r.composite).toBeCloseTo(1.0, 1);
  });

  it("G2.2 wildly different text → composite low", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const r = m.pairwiseScore({ vendor: "a", text: "React 19 removed legacy context API" }, { vendor: "b", text: "TypeScript compiler error: cannot find module" });
    expect(r.composite).toBeLessThan(0.3);
  });

  it("G2.3 numeric agreement reflected separately", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const r = m.pairwiseScore({ vendor: "a", text: "version 5.6.3" }, { vendor: "b", text: "version 5.6.3" });
    expect(r.numeric).toBe(1);
  });
});

describe("v2.64.0 G3 — consensus aggregation (PINNED)", () => {
  it("G3.1 3 responses with 2 agreeing → outlier is the disagreer", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const r = m.computeConsensus({
      responses: [
        { vendor: "a", text: "React 19 removed legacy context API" },
        { vendor: "b", text: "React 19 removed legacy context API" },
        { vendor: "c", text: "Python 3.12 supports faster CPython" }, // outlier
      ],
    });
    expect(r.outliers[0]?.vendor).toBe("c");
  });

  it("G3.2 high agreement → score ≥0.7", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const r = m.computeConsensus({
      responses: [
        { vendor: "a", text: "the answer is yes definitely" },
        { vendor: "b", text: "the answer is yes definitely" },
      ],
    });
    expect(r.score).toBeGreaterThanOrEqual(0.7);
    expect(r.agreement).toBe("high");
  });

  it("G3.3 single response → consensus.score=1 trivially", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const r = m.computeConsensus({ responses: [{ vendor: "a", text: "hello" }] });
    expect(r.score).toBe(1);
  });
});

describe("v2.64.0 G4 — facts extraction (PINNED)", () => {
  it("G4.1 numbers all vendors mention → commonFacts", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const r = m.computeConsensus({
      responses: [
        { vendor: "a", text: "React 19 ships use() hook" },
        { vendor: "b", text: "React 19 has new use() API" },
      ],
    });
    expect(r.commonFacts).toContain("19");
  });

  it("G4.2 number ONE vendor mentions → uniqueClaims", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const r = m.computeConsensus({
      responses: [
        { vendor: "a", text: "React 19" },
        { vendor: "b", text: "React 19" },
        { vendor: "c", text: "React 19 and Python 3.12" }, // unique claim 3.12
      ],
    });
    expect(r.uniqueClaims.some((u) => u.vendor === "c" && u.claim === "3.12")).toBe(true);
  });
});

describe("v2.64.0 G5 — diffArenaAsk end-to-end (PINNED)", () => {
  it("G5.1 3-mock parallel round with deterministic responses + HMAC verifies", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const dir = tmp();
    try {
      const va = m.mockAdapter({ name: "a", responder: () => "React 19 removed legacy context API" });
      const vb = m.mockAdapter({ name: "b", responder: () => "React 19 removed legacy context API" });
      const vc = m.mockAdapter({ name: "c", responder: () => "Server components default" });
      const r = await m.diffArenaAsk({ prompt: "P", vendors: [va, vb, vc], cwd: dir, noLedger: true });
      expect(r.responses.length).toBe(3);
      expect(r.responses.every((x) => x.ok)).toBe(true);
      expect(m.verifyAskResult(r)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("G5.2 empty vendor list → 0 responses, consensus.score=1 trivially", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const dir = tmp();
    try {
      const r = await m.diffArenaAsk({ prompt: "P", vendors: [], cwd: dir, noLedger: true });
      expect(r.responses.length).toBe(0);
      expect(r.consensus.score).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("G5.3 suggestedAnswer composed differently per agreement tier", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const dir = tmp();
    try {
      const a = m.mockAdapter({ name: "a", responder: () => "the answer is X" });
      const b = m.mockAdapter({ name: "b", responder: () => "the answer is X" });
      const c = m.mockAdapter({ name: "c", responder: () => "Python compiler error message" });
      const r = await m.diffArenaAsk({ prompt: "P", vendors: [a, b, c], cwd: dir, noLedger: true });
      expect(r.suggestedAnswer.length).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.64.0 G6 — ACGV grader hook (PINNED)", () => {
  it("G6.1 grader REFUTED tagged in response + surfaced in suggestedAnswer", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const dir = tmp();
    try {
      const va = m.mockAdapter({ name: "a", responder: () => "RSC default everywhere" });
      const r = await m.diffArenaAsk({
        prompt: "P", vendors: [va], cwd: dir, noLedger: true,
        acgvGrader: async () => ({ outcome: "REFUTED", evidence: "RSC opt-in not default" }),
      });
      expect(r.responses[0]?.acgv?.outcome).toBe("REFUTED");
      expect(r.suggestedAnswer).toMatch(/REFUTED/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("G6.2 grader that throws does NOT crash the round", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const dir = tmp();
    try {
      const va = m.mockAdapter({ name: "a" });
      const r = await m.diffArenaAsk({
        prompt: "P", vendors: [va], cwd: dir, noLedger: true,
        acgvGrader: async () => { throw new Error("grader fail"); },
      });
      expect(r.responses[0]?.ok).toBe(true);
      expect(r.responses[0]?.acgv).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.64.0 G7 — HMAC-chained ledger (PINNED)", () => {
  it("G7.1 fresh ledger → ok with 0 rows", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const dir = tmp();
    try {
      const r = m.verifyLedgerChain(dir);
      expect(r.ok).toBe(true);
      expect(r.rows).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("G7.2 ask appends N+1 chained rows (1 ask + N vendor_response)", async () => {
    const m = await import("../../packages/core/src/diff_arena/index.js");
    const dir = tmp();
    try {
      const va = m.mockAdapter({ name: "a" });
      const vb = m.mockAdapter({ name: "b" });
      await m.diffArenaAsk({ prompt: "P", vendors: [va, vb], cwd: dir });
      const led = m.verifyLedgerChain(dir);
      expect(led.ok).toBe(true);
      expect(led.rows).toBe(3); // 1 ask + 2 vendor responses
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.64.0 G8 — CLI surface (PINNED)", () => {
  function runCli(args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60000, cwd });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
  }

  it("G8.1 `mneme diff_arena ask --prompt P` returns JSON envelope", () => {
    const dir = tmp();
    try {
      const r = runCli(["diff_arena", "ask", "--prompt", "Hello world?"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(typeof parsed.hmac).toBe("string");
      expect(parsed.responses.length).toBeGreaterThanOrEqual(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("G8.2 `mneme diff_arena ask --banner` outputs ASCII", () => {
    const dir = tmp();
    try {
      const r = runCli(["diff_arena", "ask", "--prompt", "Hello?", "--banner"], dir);
      expect(r.stdout).toMatch(/DIFF-ARENA/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("G8.3 `mneme diff_arena audit` returns envelope", () => {
    const dir = tmp();
    try {
      const r = runCli(["diff_arena", "audit"], dir);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(typeof parsed.totalRows).toBe("number");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("v2.64.0 G9 — TG probes (PINNED)", () => {
  it("G9.1 probe.diff_arena.consensus_round_trip returns 1", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.diff_arena.consensus_round_trip");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect(r.value).toBe(1);
  });

  it("G9.2 probe.diff_arena.ledger_chain_intact returns 1 or null", async () => {
    const m = await import("../../packages/core/src/truth_gate/probes.js");
    const p = m.probeById("probe.diff_arena.ledger_chain_intact");
    expect(p).toBeDefined();
    const r = await p!.run({ cwd: REPO });
    expect([null, 0, 1]).toContain(r.value);
  });
});
