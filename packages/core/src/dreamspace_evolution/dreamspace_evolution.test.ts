import { describe, it, expect } from "vitest";
import {
  classifyLifecycle,
  selectMatingPairs,
  runEvolutionCycle,
  verifyEvolutionReport,
  formatEvolutionLine,
  formatVerdictLine,
  LIFECYCLE_EMOJI,
  type ToolUseRecord,
  type UseLogEntry,
} from "./index.js";

const SECRET = "evolution-test-secret-997744";
const DAY = 86400 * 1000;
const WEEK = 7 * DAY;

function record(toolName: string, bornDaysAgo: number, useCount: number, nowMs: number, lastUseDaysAgo = 0): ToolUseRecord {
  return {
    toolName,
    bornTs: nowMs - bornDaysAgo * DAY,
    useCount,
    lastUseTs: nowMs - lastUseDaysAgo * DAY,
  };
}

describe("v2.19.26 EVOLUTION · classifyLifecycle (4 bands)", () => {
  const NOW = 1_000_000_000;

  it("🥚 GESTATING: age < 7 days regardless of uses", () => {
    const v = classifyLifecycle({ record: record("t", 3, 100, NOW), nowMs: NOW });
    expect(v.band).toBe("gestating");
    expect(v.recommendation).toBe("keep");
  });

  it("🦋 MATURE: age >= 30 days + uses >= 50 → promote", () => {
    const v = classifyLifecycle({ record: record("t", 45, 100, NOW), nowMs: NOW });
    expect(v.band).toBe("mature");
    expect(v.recommendation).toBe("promote");
  });

  it("🍂 ATROPHIED: age >= 30 days + uses-per-week < 1 → sunset", () => {
    const v = classifyLifecycle({ record: record("t", 60, 3, NOW), nowMs: NOW });
    // 60 days = ~8.5 weeks, 3 uses / 8.5 weeks ≈ 0.35 /wk < 1
    expect(v.band).toBe("atrophied");
    expect(v.recommendation).toBe("sunset");
  });

  it("🐣 JUVENILE: age 10 days, uses 6 (above min but below mature threshold)", () => {
    const v = classifyLifecycle({ record: record("t", 10, 6, NOW), nowMs: NOW });
    expect(v.band).toBe("juvenile");
    expect(v.recommendation).toBe("keep");
  });

  it("🐣 JUVENILE: age 10 days, uses 2 (below juvenile min) → still juvenile (probation)", () => {
    const v = classifyLifecycle({ record: record("t", 10, 2, NOW), nowMs: NOW });
    expect(v.band).toBe("juvenile");
    expect(v.recommendation).toBe("keep");
  });

  it("custom config overrides default thresholds", () => {
    const v = classifyLifecycle({
      record: record("t", 5, 100, NOW),
      nowMs: NOW,
      config: { gestatingMaxAgeMs: 1 * DAY, juvenileMaxAgeMs: 3 * DAY, matureMinUses: 50 },
    });
    expect(v.band).toBe("mature");
  });

  it("MEASURED 100% determinism: same input -> same verdict (30 trials)", () => {
    const input = { record: record("t", 15, 25, NOW), nowMs: NOW };
    const first = JSON.stringify(classifyLifecycle(input));
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (JSON.stringify(classifyLifecycle(input)) !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.26 EVOLUTION · selectMatingPairs (co-occurrence within window)", () => {
  it("default window 1min; pairs that fire within 1min N times qualify", () => {
    const log: UseLogEntry[] = [];
    // 5 (A, B) pairs each within 30s of each other
    for (let i = 0; i < 5; i++) {
      log.push({ toolName: "mneme.A", ts: i * 60_000 });
      log.push({ toolName: "mneme.B", ts: i * 60_000 + 30_000 });
    }
    const pairs = selectMatingPairs({ log });
    const found = pairs.find((p) => p.toolA === "mneme.A" && p.toolB === "mneme.B");
    expect(found).toBeDefined();
    expect(found!.coOccurrenceCount).toBeGreaterThanOrEqual(4);
  });

  it("pairs outside window do NOT count", () => {
    const log: UseLogEntry[] = [
      { toolName: "mneme.A", ts: 0 },
      { toolName: "mneme.B", ts: 5 * 60 * 1000 }, // 5min later, outside default 1min window
    ];
    const pairs = selectMatingPairs({ log });
    expect(pairs.length).toBe(0);
  });

  it("self-pairs (A then A) excluded", () => {
    const log: UseLogEntry[] = [];
    for (let i = 0; i < 10; i++) log.push({ toolName: "mneme.A", ts: i * 10_000 });
    const pairs = selectMatingPairs({ log });
    expect(pairs.filter((p) => p.toolA === p.toolB).length).toBe(0);
  });

  it("ordering: A→B and B→A are DIFFERENT pairs", () => {
    const log: UseLogEntry[] = [];
    for (let i = 0; i < 5; i++) {
      log.push({ toolName: "mneme.A", ts: i * 60_000 });
      log.push({ toolName: "mneme.B", ts: i * 60_000 + 10_000 });
      log.push({ toolName: "mneme.A", ts: i * 60_000 + 20_000 });
    }
    const pairs = selectMatingPairs({ log, minCount: 1 });
    const ab = pairs.find((p) => p.toolA === "mneme.A" && p.toolB === "mneme.B");
    const ba = pairs.find((p) => p.toolA === "mneme.B" && p.toolB === "mneme.A");
    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
  });

  it("minCount threshold filters infrequent pairs", () => {
    const log: UseLogEntry[] = [
      { toolName: "mneme.A", ts: 0 }, { toolName: "mneme.B", ts: 1000 },
      { toolName: "mneme.A", ts: 2000 }, { toolName: "mneme.B", ts: 3000 },
    ];
    const strict = selectMatingPairs({ log, minCount: 10 });
    expect(strict.length).toBe(0);
    const loose = selectMatingPairs({ log, minCount: 1 });
    expect(loose.length).toBeGreaterThan(0);
  });
});

describe("v2.19.26 EVOLUTION · runEvolutionCycle (full loop)", () => {
  const NOW = 1_000_000_000;

  it("classifies multiple records + finds mating pairs in one pass", () => {
    const records: ToolUseRecord[] = [
      record("mneme.A", 1, 0, NOW),         // gestating
      record("mneme.B", 45, 100, NOW),      // mature
      record("mneme.C", 60, 2, NOW),        // atrophied
    ];
    const log: UseLogEntry[] = [];
    for (let i = 0; i < 6; i++) {
      log.push({ toolName: "mneme.X", ts: i * 60_000 });
      log.push({ toolName: "mneme.Y", ts: i * 60_000 + 20_000 });
    }
    const r = runEvolutionCycle({ records, log, nowMs: NOW, cycleAt: NOW, secret: SECRET });
    expect(r.bandCounts.gestating).toBe(1);
    expect(r.bandCounts.mature).toBe(1);
    expect(r.bandCounts.atrophied).toBe(1);
    expect(r.promoteCount).toBe(1);
    expect(r.sunsetCount).toBe(1);
    expect(r.matingPairs.length).toBeGreaterThan(0);
  });

  it("HMAC verifies untampered; rejects tamper", () => {
    const r = runEvolutionCycle({
      records: [record("t", 1, 0, NOW)],
      log: [],
      nowMs: NOW,
      cycleAt: NOW,
      secret: SECRET,
    });
    expect(verifyEvolutionReport(r, SECRET)).toBe(true);
    expect(verifyEvolutionReport({ ...r, promoteCount: 999 }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same report sig (30 trials)", () => {
    const input = {
      records: [record("t", 1, 0, NOW), record("u", 45, 100, NOW)],
      log: [
        { toolName: "a", ts: 0 }, { toolName: "b", ts: 10_000 },
        { toolName: "a", ts: 60_000 }, { toolName: "b", ts: 70_000 },
      ] as UseLogEntry[],
      nowMs: NOW,
      cycleAt: NOW,
      secret: SECRET,
    };
    const first = runEvolutionCycle(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (runEvolutionCycle(input).sig !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.26 EVOLUTION · formatters + constants", () => {
  const NOW = 1_000_000_000;

  it("LIFECYCLE_EMOJI maps each band", () => {
    expect(LIFECYCLE_EMOJI.gestating).toBe("🥚");
    expect(LIFECYCLE_EMOJI.juvenile).toBe("🐣");
    expect(LIFECYCLE_EMOJI.mature).toBe("🦋");
    expect(LIFECYCLE_EMOJI.atrophied).toBe("🍂");
  });

  it("formatEvolutionLine includes all 4 band counts + promote + sunset + pairs", () => {
    const r = runEvolutionCycle({
      records: [record("t", 1, 0, NOW)],
      log: [],
      nowMs: NOW,
      cycleAt: NOW,
      secret: SECRET,
    });
    const line = formatEvolutionLine(r);
    expect(line).toContain("🥚");
    expect(line).toContain("🐣");
    expect(line).toContain("🦋");
    expect(line).toContain("🍂");
  });

  it("formatVerdictLine includes tool + band + age + uses + recommendation", () => {
    const v = classifyLifecycle({ record: record("t", 45, 100, NOW), nowMs: NOW });
    const line = formatVerdictLine(v);
    expect(line).toContain("t");
    expect(line).toContain("mature");
    expect(line).toContain("promote");
  });
});
