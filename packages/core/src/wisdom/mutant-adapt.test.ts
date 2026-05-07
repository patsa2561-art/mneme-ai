import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  decayState,
  readMutantState,
  recommend,
  recordFailure,
  recordSuccess,
  writeMutantState,
  type MutantState,
} from "./mutant-adapt.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-mutant-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("mutant-adapt — round-trip", () => {
  it("returns an empty state when nothing is stored", () => {
    const s = readMutantState(tmpDir);
    expect(s.axes).toEqual({});
  });

  it("persists across recordSuccess + readMutantState", () => {
    recordSuccess(tmpDir, "provider:groq", 120);
    const s = readMutantState(tmpDir);
    expect(s.axes["provider:groq"]).toBeDefined();
    expect(s.axes["provider:groq"]!.successCount).toBe(1);
    expect(s.axes["provider:groq"]!.lastSuccessAt).toBeDefined();
    expect(s.axes["provider:groq"]!.avgLatencyMs).toBe(120);
    expect(existsSync(join(tmpDir, ".mneme", "mutant.json"))).toBe(true);
  });

  it("recordSuccess running-average converges over many samples", () => {
    for (let i = 0; i < 10; i++) recordSuccess(tmpDir, "provider:groq", 100);
    const stat = readMutantState(tmpDir).axes["provider:groq"]!;
    expect(stat.successCount).toBe(10);
    expect(stat.avgLatencyMs).toBeCloseTo(100, 4);
  });
});

describe("mutant-adapt — recordFailure", () => {
  it("increments failureCount and stores last reason", () => {
    recordFailure(tmpDir, "provider:groq", "AllProvidersFailedError");
    const s = readMutantState(tmpDir);
    expect(s.axes["provider:groq"]!.failureCount).toBe(1);
    expect(s.axes["provider:groq"]!.lastFailureReason).toBe("AllProvidersFailedError");
    expect(s.axes["provider:groq"]!.successCount).toBe(0);
  });
});

describe("mutant-adapt — recommend", () => {
  it("returns null when no axes match the prefix", () => {
    recordSuccess(tmpDir, "provider:groq");
    const s = readMutantState(tmpDir);
    expect(recommend(s, "model:")).toBeNull();
  });

  it("returns null when state is empty", () => {
    expect(recommend({ axes: {} } as MutantState, "provider:")).toBeNull();
  });

  it("picks the highest success-rate axis within a prefix group", () => {
    // groq: 9 wins / 1 loss = 0.9
    for (let i = 0; i < 9; i++) recordSuccess(tmpDir, "provider:groq");
    recordFailure(tmpDir, "provider:groq", "rate-limit");
    // openai: 5 wins / 5 losses = 0.5
    for (let i = 0; i < 5; i++) recordSuccess(tmpDir, "provider:openai");
    for (let i = 0; i < 5; i++) recordFailure(tmpDir, "provider:openai", "auth");
    // anthropic: untouched.
    const rec = recommend(readMutantState(tmpDir), "provider:")!;
    expect(rec.bestAxis).toBe("provider:groq");
    expect(rec.successRate).toBeCloseTo(0.9, 4);
    expect(rec.reason).toContain("9/10");
  });

  it("ignores axes with no samples even if they exist in state", () => {
    // Manually craft a zero-sample axis.
    const state: MutantState = {
      axes: {
        "provider:zero": { axis: "provider:zero", successCount: 0, failureCount: 0 },
        "provider:real": {
          axis: "provider:real",
          successCount: 3,
          failureCount: 1,
          lastSuccessAt: new Date().toISOString(),
        },
      },
    };
    expect(recommend(state, "provider:")!.bestAxis).toBe("provider:real");
  });

  it("respects prefix boundaries — provider:groq does not match model:", () => {
    recordSuccess(tmpDir, "provider:groq");
    recordSuccess(tmpDir, "model:qwen");
    const s = readMutantState(tmpDir);
    expect(recommend(s, "provider:")!.bestAxis).toBe("provider:groq");
    expect(recommend(s, "model:")!.bestAxis).toBe("model:qwen");
  });
});

describe("mutant-adapt — decayState", () => {
  it("halves counts on axes older than 7 days", () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const state: MutantState = {
      axes: {
        "provider:stale": {
          axis: "provider:stale",
          successCount: 8,
          failureCount: 4,
          lastUpdatedAt: old,
        },
        "provider:fresh": {
          axis: "provider:fresh",
          successCount: 8,
          failureCount: 4,
          lastUpdatedAt: fresh,
        },
      },
    };
    const decayed = decayState(state);
    expect(decayed.axes["provider:stale"]!.successCount).toBe(4);
    expect(decayed.axes["provider:stale"]!.failureCount).toBe(2);
    // Fresh axis is untouched.
    expect(decayed.axes["provider:fresh"]!.successCount).toBe(8);
    expect(decayed.axes["provider:fresh"]!.failureCount).toBe(4);
  });

  it("uses the supplied nowMs for testability", () => {
    const baseMs = Date.parse("2026-01-01T00:00:00Z");
    const updatedAt = new Date(baseMs).toISOString();
    const state: MutantState = {
      axes: {
        "p:a": { axis: "p:a", successCount: 10, failureCount: 0, lastUpdatedAt: updatedAt },
      },
    };
    // 6 days later — not yet stale.
    const at6d = baseMs + 6 * 24 * 60 * 60 * 1000;
    expect(decayState(state, at6d).axes["p:a"]!.successCount).toBe(10);
    // 8 days later — stale.
    const at8d = baseMs + 8 * 24 * 60 * 60 * 1000;
    expect(decayState(state, at8d).axes["p:a"]!.successCount).toBe(5);
  });

  it("is pure — does not mutate input state", () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const state: MutantState = {
      axes: { "p:x": { axis: "p:x", successCount: 6, failureCount: 0, lastUpdatedAt: old } },
    };
    decayState(state);
    expect(state.axes["p:x"]!.successCount).toBe(6);
  });
});

describe("mutant-adapt — sample evolution trace", () => {
  it("after 10 successes, recommend reliably picks provider X over a 50/50 baseline", () => {
    // Bootstrap: provider X starts 50/50 against provider Y.
    for (let i = 0; i < 5; i++) {
      recordSuccess(tmpDir, "provider:x");
      recordFailure(tmpDir, "provider:x", "boot");
    }
    for (let i = 0; i < 5; i++) {
      recordSuccess(tmpDir, "provider:y");
      recordFailure(tmpDir, "provider:y", "boot");
    }
    // Initially indistinguishable — both 50%. recommend picks either; we just
    // verify it isn't null.
    expect(recommend(readMutantState(tmpDir), "provider:")).not.toBeNull();

    // 10 fresh wins for X.
    for (let i = 0; i < 10; i++) recordSuccess(tmpDir, "provider:x");

    const rec = recommend(readMutantState(tmpDir), "provider:")!;
    expect(rec.bestAxis).toBe("provider:x");
    expect(rec.successRate).toBeCloseTo(15 / 20, 4);
  });
});

describe("mutant-adapt — writeMutantState", () => {
  it("round-trips a hand-crafted state through write + read", () => {
    const state: MutantState = {
      axes: {
        "scoring:rrf-k=60": {
          axis: "scoring:rrf-k=60",
          successCount: 7,
          failureCount: 1,
          lastSuccessAt: new Date().toISOString(),
        },
      },
      lastAdaptedAt: new Date().toISOString(),
    };
    writeMutantState(tmpDir, state);
    const read = readMutantState(tmpDir);
    expect(read.axes["scoring:rrf-k=60"]!.successCount).toBe(7);
    expect(read.lastAdaptedAt).toBe(state.lastAdaptedAt);
  });
});
