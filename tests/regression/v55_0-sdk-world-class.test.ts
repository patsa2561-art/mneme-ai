// v2.55.0 — @mneme-ai/sdk WORLD-CLASS in-process SDK
//
// Proves the SDK:
//   1. Wraps core primitives with type-safe envelopes
//   2. Wild features: tagged-template verify, async-iterator events,
//      branded types, file-lock adapter, built-in CLI benchmark
//   3. createMneme({ dataDir, hmacKey, strict }) factory
//   4. Output equivalent to CLI (contract test)
//
// Pinned via test so SDK API stays stable; v1.x semver-locked.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../../packages/cli/bin/mneme.js");

// ═══════════════════════════════════════════════════════════════════════
//  SDK.1 — Factory + branded types
// ═══════════════════════════════════════════════════════════════════════

describe("v2.55.0 SDK.1 — createMneme factory (PINNED)", () => {
  it("SDK1.1 createMneme() returns full surface object", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    expect(mneme.nemesis).toBeTruthy();
    expect(typeof mneme.verify).toBe("function");
    expect(mneme.truth).toBeTruthy();
    expect(mneme.benchmark).toBeTruthy();
    expect(typeof mneme.events).toBe("function");
    expect(mneme.version).toMatch(/^2\.\d+\.\d+$/);
  });

  it("SDK1.2 createMneme({ strict: true }) without key throws", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const prev = process.env["MNEME_NEMESIS_KEY"];
    delete process.env["MNEME_NEMESIS_KEY"];
    try {
      expect(() => m.createMneme({ strict: true })).toThrow(/strict/i);
    } finally {
      if (prev) process.env["MNEME_NEMESIS_KEY"] = prev;
    }
  });

  it("SDK1.3 createMneme({ strict: true, hmacKey }) succeeds", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const prev = process.env["MNEME_NEMESIS_KEY"];
    delete process.env["MNEME_NEMESIS_KEY"];
    try {
      const mneme = m.createMneme({ strict: true, hmacKey: "x".repeat(32) });
      expect(mneme.version).toMatch(/^2\.\d+\.\d+$/);
    } finally {
      if (prev) process.env["MNEME_NEMESIS_KEY"] = prev;
    }
  });

  it("SDK1.4 branded type constructors validate", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    expect(() => m.asHmacHash("notahash")).toThrow();
    expect(m.asHmacHash("a".repeat(64))).toBe("a".repeat(64));
    expect(() => m.asVendorId("UPPERCASE")).toThrow();
    expect(m.asVendorId("claude-code")).toBe("claude-code");
    expect(() => m.asCommitRef("xyz")).toThrow();
    expect(m.asCommitRef("abc1234")).toBe("abc1234");
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SDK.2 — NEMESIS in-process surface (faster + type-safe)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.55.0 SDK.2 — NEMESIS in-process (PINNED)", () => {
  const fx = { diff: "+const x = 1;\n+function foo() { return x; }\n", prDescription: "## Changes\n- a\n", commitMessages: ["x"] };

  it("SDK2.1 nemesis.fingerprint returns envelope with latencyMs", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const r = mneme.nemesis.fingerprint(fx);
    expect(r.ok).toBe(true);
    expect(typeof r.data).toBe("object");
    expect(typeof r.latencyMs).toBe("number");
    expect(r.latencyMs).toBeLessThan(100);
  });

  it("SDK2.2 nemesis.classify accepts fixture OR fingerprint", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const r1 = mneme.nemesis.classify(fx);
    expect(r1.ok).toBe(true);
    expect(typeof r1.data.topVendor).toBe("string");
    const fp = mneme.nemesis.fingerprint(fx);
    const r2 = mneme.nemesis.classify(fp.data);
    expect(r2.ok).toBe(true);
  });

  it("SDK2.3 nemesis.stamp warm latency < 50ms (5-call avg)", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    mneme.nemesis.stamp({ message: "warm", vendor: "claude-code" });
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      const r = mneme.nemesis.stamp({ message: `msg ${i}`, vendor: "claude-code" });
      sum += r.latencyMs;
    }
    expect(sum / 5).toBeLessThan(50);
  });

  it("SDK2.4 nemesis.stealthScore + capillary + janusObserve all return envelopes", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    expect(mneme.nemesis.stealthScore(fx).ok).toBe(true);
    expect(mneme.nemesis.capillary(fx.diff).ok).toBe(true);
    expect(mneme.nemesis.janusObserve(fx).ok).toBe(true);
  });

  it("SDK2.5 nemesis.alibi returns THEMIS verdict envelope", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const r = mneme.nemesis.alibi({ notVendor: "codex", fixture: fx });
    expect(["CONFIRMED", "DENIED", "INCONCLUSIVE"]).toContain(r.data.verdict);
  });

  it("SDK2.6 nemesis.gavelPack returns bundle envelope with merkle root", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const alibi = mneme.nemesis.alibi({ notVendor: "codex", fixture: fx });
    const r = mneme.nemesis.gavelPack({ commitRef: "test-commit", alibi: alibi.data });
    expect(r.ok).toBe(true);
    expect(r.data.bundle?.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SDK.3 — Tagged template literal verify (wild feature)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.55.0 SDK.3 — tagged template verify (PINNED)", () => {
  it("SDK3.1 mneme.verify`...` as tagged template returns ACGV verdict", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const r = await mneme.verify`Mneme is a CLI tool`;
    expect(r.ok).toBe(true);
    expect(r.data?.verdict).toBe("FUSION");
  });

  it("SDK3.2 mneme.verify`...` with substitutions interpolates safely", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const tool = "CLI tool";
    const r = await mneme.verify`Mneme is a ${tool}`;
    expect(r.ok).toBe(true);
    expect(r.data?.verdict).toBe("FUSION");
  });

  it("SDK3.3 mneme.verify('string') as plain call also works", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const r = await mneme.verify("Mneme is a quantum GPU shader");
    expect(r.ok).toBe(true);
    expect(r.data?.verdict).toBe("BLACK_HOLE");
  });

  it("SDK3.4 verify latency < 1000ms cold + reports latencyMs", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const r = await mneme.verify`Mneme uses HMAC for verifiable receipts`;
    expect(typeof r.latencyMs).toBe("number");
    expect(r.latencyMs).toBeLessThan(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SDK.4 — Async-iterator event bus
// ═══════════════════════════════════════════════════════════════════════

describe("v2.55.0 SDK.4 — async-iterator events (PINNED)", () => {
  it("SDK4.1 events() yields stamp.issued after nemesis.stamp call", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const ac = new AbortController();
    const received: unknown[] = [];
    const ready = (async () => {
      for await (const ev of m.subscribeEvents(["stamp.issued"], { signal: ac.signal })) {
        received.push(ev);
        if (received.length >= 1) { ac.abort(); break; }
      }
    })();
    // wait one microtask + fire
    await new Promise((r) => setTimeout(r, 5));
    mneme.nemesis.stamp({ message: "trigger", vendor: "claude-code" });
    await ready;
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect((received[0] as { kind: string }).kind).toBe("stamp.issued");
  });

  it("SDK4.2 subscribing to all-kinds receives multiple events", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const ac = new AbortController();
    const received: unknown[] = [];
    const ready = (async () => {
      for await (const ev of m.subscribeEvents(undefined, { signal: ac.signal })) {
        received.push(ev);
        if (received.length >= 2) { ac.abort(); break; }
      }
    })();
    await new Promise((r) => setTimeout(r, 5));
    mneme.nemesis.stamp({ message: "a", vendor: "claude-code" });
    mneme.nemesis.stamp({ message: "b", vendor: "claude-code" });
    await ready;
    expect(received.length).toBeGreaterThanOrEqual(2);
  });

  it("SDK4.3 AbortSignal stops the iterator cleanly", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const ac = new AbortController();
    let stopped = false;
    const ready = (async () => {
      for await (const _ev of m.subscribeEvents(undefined, { signal: ac.signal })) {
        void _ev;
      }
      stopped = true;
    })();
    ac.abort();
    await ready;
    expect(stopped).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SDK.5 — File lock adapter
// ═══════════════════════════════════════════════════════════════════════

describe("v2.55.0 SDK.5 — file lock adapter (PINNED)", () => {
  it("SDK5.1 acquireLock + releaseLock round-trip", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v55-lock-"));
    const target = join(dir, "ledger.jsonl");
    const r = m.acquireLock(target);
    expect(r.acquired).toBe(true);
    expect(existsSync(r.lockPath)).toBe(true);
    m.releaseLock(r);
    expect(existsSync(r.lockPath)).toBe(false);
  });

  it("SDK5.2 second acquire while locked returns acquired=false", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v55-lock-"));
    const target = join(dir, "x.jsonl");
    const r1 = m.acquireLock(target);
    expect(r1.acquired).toBe(true);
    const r2 = m.acquireLock(target);
    expect(r2.acquired).toBe(false);
    m.releaseLock(r1);
  });

  it("SDK5.3 withLock runs critical section + releases on throw", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v55-lock-"));
    const target = join(dir, "y.jsonl");
    let ran = false;
    const r = await m.withLock(target, () => { ran = true; throw new Error("test"); });
    expect(ran).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/test/);
    // Lock must be released
    const r2 = m.acquireLock(target);
    expect(r2.acquired).toBe(true);
    m.releaseLock(r2);
  });

  it("SDK5.4 isLocked reports holder PID + age", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const dir = mkdtempSync(join(tmpdir(), "v55-lock-"));
    const target = join(dir, "z.jsonl");
    expect(m.isLocked(target).locked).toBe(false);
    const r = m.acquireLock(target);
    const s = m.isLocked(target);
    expect(s.locked).toBe(true);
    expect(s.holderPid).toBe(process.pid);
    expect(typeof s.ageMs).toBe("number");
    m.releaseLock(r);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SDK.6 — Built-in benchmark (proves SDK > CLI)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.55.0 SDK.6 — built-in benchmark (PINNED)", () => {
  it("SDK6.1 benchEuStamp returns sdkMeanMs + cliMeanMs + speedup", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const r = await m.benchEuStamp({ iterations: 5 });
    expect(typeof r.sdkMeanMs).toBe("number");
    expect(r.sdkMeanMs).toBeGreaterThan(0);
    expect(typeof r.speedupRatio).toBe("number");
  });

  it("SDK6.2 benchEuStamp shows SDK >= 5× faster than CLI (when CLI present)", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const r = await m.benchEuStamp({ iterations: 5 });
    if (r.cliMeanMs > 0) {
      expect(r.speedupRatio).toBeGreaterThanOrEqual(5);
      expect(r.sdkWins).toBe(true);
    }
  });

  it("SDK6.3 benchClassify same SDK > CLI when CLI present", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const r = await m.benchClassify({ iterations: 5 });
    if (r.cliMeanMs > 0) {
      expect(r.speedupRatio).toBeGreaterThanOrEqual(5);
    }
  });

  it("SDK6.4 benchmark.vsCli returns aggregate average speedup", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const r = await m.benchVsCli({ iterations: 3 });
    expect(typeof r.averageSpeedup).toBe("number");
    expect(r.results.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SDK.7 — Contract test: SDK output ≡ CLI output (round-trip)
// ═══════════════════════════════════════════════════════════════════════

describe("v2.55.0 SDK.7 — SDK ≡ CLI contract (PINNED)", () => {
  it("SDK7.1 stealth_score: SDK band == CLI band for same fixture", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const fx = { diff: "+const x = 1;\n", prDescription: "", commitMessages: ["x"] };
    const sdkOut = mneme.nemesis.stealthScore(fx);
    const cli = spawnSync(process.execPath, [CLI, "nemesis", "stealth_score", "--stdin"], {
      encoding: "utf8", input: JSON.stringify(fx), timeout: 60_000,
      env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
    });
    const cliJson = JSON.parse(cli.stdout);
    expect(sdkOut.data.band).toBe(cliJson.verdict.band);
    expect(sdkOut.data.topVendor).toBe(cliJson.verdict.topVendor);
  });

  it("SDK7.2 capillary: SDK feature count == CLI feature count for same diff", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const mneme = m.createMneme();
    const diff = "+const x = 1;\n+const y = 2;\n+function f() { return x + y; }\n";
    const sdkOut = mneme.nemesis.capillary(diff);
    const cli = spawnSync(process.execPath, [CLI, "nemesis", "capillary", "--stdin"], {
      encoding: "utf8", input: JSON.stringify({ diff }), timeout: 60_000,
      env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
    });
    const cliJson = JSON.parse(cli.stdout);
    expect(Object.keys(sdkOut.data.features).length).toBe(cliJson.totalFeatures);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SDK.8 — TRUTH GATE in-process probe runner
// ═══════════════════════════════════════════════════════════════════════

describe("v2.55.0 SDK.8 — truth probe runner (PINNED)", () => {
  it("SDK8.1 listProbes returns ≥10 probes with id+kind+description", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const list = m.listProbes();
    expect(list.length).toBeGreaterThanOrEqual(10);
    for (const p of list.slice(0, 5)) {
      expect(p.id).toMatch(/^probe\./);
      expect(p.kind).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it("SDK8.2 runProbe on known probe returns envelope with value + latency", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const r = await m.runProbe({ probeId: "probe.audit.open_wounds_patched" });
    expect(r.ok).toBe(true);
    expect(r.data).toBeTruthy();
    expect(typeof r.data!.latencyMs).toBe("number");
  });

  it("SDK8.3 runProbe on unknown probe returns ok=false", async () => {
    const m = await import("../../packages/sdk/dist/index.js");
    const r = await m.runProbe({ probeId: "probe.does.not.exist" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown/);
  });
});

void mkdirSync; void writeFileSync; void readFileSync;
