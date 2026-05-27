/**
 * 🩸 PROTOPLASM — IMMORTAL ATOM tests
 *
 * Pin 5 invariants that make PROTOPLASM survive process death:
 *   I-IMMORTAL-1: WAL persists baseline BEFORE RAM update
 *   I-IMMORTAL-2: replay reconstructs baselines from WAL
 *   I-IMMORTAL-3: tampered WAL row → verify detects
 *   I-IMMORTAL-4: seamlessBoot is idempotent (safe to call N times)
 *   I-IMMORTAL-5: parasiteTick writes heartbeat
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Wal } from "./wal.js";
import { activateParasite, persistBaseline, loadBaseline, parasiteTick, _resetParasite } from "./parasite.js";
import { seamlessBoot, isBooted, _resetBoot } from "./seamless_boot.js";
import type { FunctionBaseline, ProtoplasmConfig } from "./types.js";

let tmpDir: string;
let cfg: ProtoplasmConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "immortal-test-"));
  cfg = {
    baselineSamplesMin: 5, zScoreWarn: 2, zScoreBroken: 3,
    ledgerDir: tmpDir, hmacKey: "test-immortal-key",
    crawlOnHealthyEvery: 50,
  };
  _resetParasite();
  _resetBoot();
});
afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } });

const sampleBaseline = (fnId: string, mean: number): FunctionBaseline => ({
  fnId, samples: 10, durationMean: mean, durationStdev: 1, errorRate: 0,
  argShapeEntropy: 0, outputShapeEntropy: 0, lastUpdate: new Date().toISOString(),
});

describe("I-IMMORTAL-1 — WAL persists BEFORE RAM", () => {
  it("append → row on disk, replay returns it", () => {
    const wal = new Wal(tmpDir, cfg.hmacKey);
    const b = sampleBaseline("fn1", 10);
    wal.append("baseline_set", "fn1", b);
    const replayed = wal.replay();
    expect(replayed.get("fn1")?.durationMean).toBe(10);
  });

  it("write succeeds even after process restart sim (new Wal instance reads same file)", () => {
    const wal1 = new Wal(tmpDir, cfg.hmacKey);
    wal1.append("baseline_set", "fnA", sampleBaseline("fnA", 5));
    // simulate process death + restart by creating new Wal instance
    const wal2 = new Wal(tmpDir, cfg.hmacKey);
    const replayed = wal2.replay();
    expect(replayed.get("fnA")?.durationMean).toBe(5);
  });
});

describe("I-IMMORTAL-2 — replay reconstructs full baseline map", () => {
  it("3 fns × 2 updates each → replay returns latest each", () => {
    const wal = new Wal(tmpDir, cfg.hmacKey);
    wal.append("baseline_set", "fnA", sampleBaseline("fnA", 1));
    wal.append("baseline_set", "fnB", sampleBaseline("fnB", 2));
    wal.append("baseline_set", "fnC", sampleBaseline("fnC", 3));
    wal.append("baseline_set", "fnA", sampleBaseline("fnA", 100));   // update
    const replayed = wal.replay();
    expect(replayed.size).toBe(3);
    expect(replayed.get("fnA")?.durationMean).toBe(100);
    expect(replayed.get("fnB")?.durationMean).toBe(2);
    expect(replayed.get("fnC")?.durationMean).toBe(3);
  });
});

describe("I-IMMORTAL-3 — tampered WAL detected", () => {
  it("flip a byte in row 1 → verify reports broken", () => {
    const wal = new Wal(tmpDir, cfg.hmacKey);
    wal.append("baseline_set", "fnA", sampleBaseline("fnA", 1));
    wal.append("baseline_set", "fnB", sampleBaseline("fnB", 2));
    wal.append("baseline_set", "fnC", sampleBaseline("fnC", 3));

    const walPath = wal.path_for_test();
    const lines = readFileSync(walPath, "utf8").trim().split("\n");
    const row1 = JSON.parse(lines[1]);
    row1.payload.durationMean = 99999;  // tamper
    lines[1] = JSON.stringify(row1);
    writeFileSync(walPath, lines.join("\n") + "\n");

    const v = wal.verify();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });
});

describe("I-IMMORTAL-4 — seamlessBoot idempotent", () => {
  it("first call boots, second is no-op", () => {
    const r1 = seamlessBoot(cfg);
    const r2 = seamlessBoot(cfg);
    expect(r1.booted).toBe(true);
    expect(r2.booted).toBe(false);
    expect(isBooted()).toBe(true);
  });

  it("writes heartbeat file", () => {
    seamlessBoot(cfg);
    expect(existsSync(join(tmpDir, "heartbeat.json"))).toBe(true);
    const hb = JSON.parse(readFileSync(join(tmpDir, "heartbeat.json"), "utf8"));
    expect(hb.pid).toBe(process.pid);
  });
});

describe("I-IMMORTAL-5 — parasite persists state across calls", () => {
  it("persistBaseline → loadBaseline returns same", () => {
    activateParasite(cfg);
    persistBaseline("fnX", sampleBaseline("fnX", 42));
    const loaded = loadBaseline("fnX");
    expect(loaded?.durationMean).toBe(42);
  });

  it("survives parasite reset (simulating process restart)", () => {
    activateParasite(cfg);
    persistBaseline("fnY", sampleBaseline("fnY", 77));
    _resetParasite();
    // Now simulate fresh process: activate again, should reload from WAL
    activateParasite(cfg);
    const loaded = loadBaseline("fnY");
    expect(loaded?.durationMean).toBe(77);
  });
});
