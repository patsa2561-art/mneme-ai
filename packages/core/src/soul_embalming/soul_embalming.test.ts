import { describe, it, expect } from "vitest";
import {
  emptyCrypt,
  embalmSoul,
  restoreLatestSoul,
  restoreSoulAt,
  verifyCrypt,
  computeCryptStats,
  formatCryptLine,
  SOUL_EMBALMING_TUNABLES,
  type AgentSoul,
  type SoulCrypt,
} from "./index.js";

const SECRET = "soul-test-secret-997744";

function mkSoul(agentId: string, ts: number, goal = "x"): AgentSoul {
  return {
    v: 1,
    agentId,
    vendorAtEmbalm: "claude",
    currentGoal: goal,
    decisionHistory: [{ summary: "decided x", ts, outcome: "merged" }],
    mentalModel: { fact: "y" },
    currentBiases: { focus: 0.7, fatigue: 0.2 },
    lastToolCalls: [{ toolName: "mneme.ask", ok: true, ts }],
    embalmedAtMs: ts,
  };
}

describe("v2.19.30 SOUL EMBALMING · core", () => {
  it("emptyCrypt has 0 records + correct agent id + default ring size", () => {
    const c = emptyCrypt("agent-A");
    expect(c.records.length).toBe(0);
    expect(c.agentId).toBe("agent-A");
    expect(c.ringBufferSize).toBe(SOUL_EMBALMING_TUNABLES.DEFAULT_RING_BUFFER_SIZE);
  });

  it("embalmSoul appends + HMAC-chains to predecessor", () => {
    let c = emptyCrypt("a");
    c = embalmSoul({ crypt: c, soul: mkSoul("a", 1), secret: SECRET });
    c = embalmSoul({ crypt: c, soul: mkSoul("a", 2), secret: SECRET });
    expect(c.records.length).toBe(2);
    expect(c.records[1]!.prevSig).toBe(c.records[0]!.sig);
    expect(verifyCrypt(c, SECRET)).toBe(true);
  });

  it("DEFENSIVE: soul with mismatched agentId is rejected (returns crypt unchanged)", () => {
    const c0 = emptyCrypt("a");
    const c1 = embalmSoul({ crypt: c0, soul: mkSoul("WRONG-AGENT", 1), secret: SECRET });
    expect(c1.records.length).toBe(0);
  });

  it("DEFENSIVE: soul missing agentId is rejected", () => {
    const c0 = emptyCrypt("a");
    const malformed = { ...mkSoul("a", 1), agentId: "" };
    const c1 = embalmSoul({ crypt: c0, soul: malformed, secret: SECRET });
    expect(c1.records.length).toBe(0);
  });

  it("ring buffer evicts oldest when exceeded", () => {
    let c = emptyCrypt("a", 3); // tiny ring for test
    for (let i = 0; i < 5; i++) {
      c = embalmSoul({ crypt: c, soul: mkSoul("a", i), secret: SECRET });
    }
    expect(c.records.length).toBe(3);
    expect(c.records[0]!.soul.embalmedAtMs).toBe(2); // oldest 3 evicted; indices 2,3,4 remain
    expect(c.records[2]!.soul.embalmedAtMs).toBe(4);
  });

  it("decisionHistory + lastToolCalls capped to defaults (no unbounded growth)", () => {
    const big: AgentSoul = {
      ...mkSoul("a", 1),
      decisionHistory: Array.from({ length: 500 }, (_, i) => ({ summary: `d${i}`, ts: i, outcome: "merged" as const })),
      lastToolCalls: Array.from({ length: 100 }, (_, i) => ({ toolName: `t${i}`, ok: true, ts: i })),
    };
    const c = embalmSoul({ crypt: emptyCrypt("a"), soul: big, secret: SECRET });
    expect(c.records[0]!.soul.decisionHistory.length).toBe(SOUL_EMBALMING_TUNABLES.DEFAULT_DECISION_HISTORY_LIMIT);
    expect(c.records[0]!.soul.lastToolCalls.length).toBe(SOUL_EMBALMING_TUNABLES.DEFAULT_TOOL_CALL_LIMIT);
  });
});

describe("v2.19.30 SOUL EMBALMING · restore (ban recovery)", () => {
  it("restoreLatestSoul returns most recent + ban-recovery scenario verified", () => {
    let c = emptyCrypt("agent-claude");
    c = embalmSoul({ crypt: c, soul: mkSoul("agent-claude", 1000, "refactor auth.ts"), secret: SECRET });
    c = embalmSoul({ crypt: c, soul: mkSoul("agent-claude", 5000, "refactor auth.ts → split into 3 files"), secret: SECRET });
    const restored = restoreLatestSoul({ crypt: c, secret: SECRET });
    expect(restored).not.toBeNull();
    expect(restored!.currentGoal).toContain("split into 3 files");
    // The "new agent" (Codex/Gemini) receives this soul and continues without rollback.
  });

  it("restoreLatestSoul on empty crypt → null (defensive)", () => {
    expect(restoreLatestSoul({ crypt: emptyCrypt("a"), secret: SECRET })).toBeNull();
  });

  it("restoreSoulAt supports negative index (-1 = newest)", () => {
    let c = emptyCrypt("a");
    c = embalmSoul({ crypt: c, soul: mkSoul("a", 1), secret: SECRET });
    c = embalmSoul({ crypt: c, soul: mkSoul("a", 2), secret: SECRET });
    expect(restoreSoulAt({ crypt: c, index: -1, secret: SECRET })!.embalmedAtMs).toBe(2);
    expect(restoreSoulAt({ crypt: c, index: 0, secret: SECRET })!.embalmedAtMs).toBe(1);
  });

  it("out-of-range index → null", () => {
    let c = emptyCrypt("a");
    c = embalmSoul({ crypt: c, soul: mkSoul("a", 1), secret: SECRET });
    expect(restoreSoulAt({ crypt: c, index: 99, secret: SECRET })).toBeNull();
  });

  it("tampered crypt → restoreLatestSoul returns null (fail-safe)", () => {
    let c = emptyCrypt("a");
    c = embalmSoul({ crypt: c, soul: mkSoul("a", 1), secret: SECRET });
    const tampered: SoulCrypt = {
      ...c,
      records: c.records.map((r) => ({ ...r, soul: { ...r.soul, currentGoal: "INJECTED" } })),
    };
    expect(restoreLatestSoul({ crypt: tampered, secret: SECRET })).toBeNull();
  });
});

describe("v2.19.30 SOUL EMBALMING · verifyCrypt", () => {
  it("verifies untampered chain (10 souls)", () => {
    let c = emptyCrypt("a");
    for (let i = 0; i < 10; i++) c = embalmSoul({ crypt: c, soul: mkSoul("a", i), secret: SECRET });
    expect(verifyCrypt(c, SECRET)).toBe(true);
  });

  it("detects tamper at any step", () => {
    let c = emptyCrypt("a");
    for (let i = 0; i < 5; i++) c = embalmSoul({ crypt: c, soul: mkSoul("a", i), secret: SECRET });
    const tampered: SoulCrypt = {
      ...c,
      records: c.records.map((r, i) => i === 2 ? { ...r, soul: { ...r.soul, vendorAtEmbalm: "EVIL" } } : r),
    };
    expect(verifyCrypt(tampered, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same souls + secret → same sig (30 trials)", () => {
    const make = () => {
      let c = emptyCrypt("a");
      c = embalmSoul({ crypt: c, soul: mkSoul("a", 1), secret: SECRET });
      return c;
    };
    const first = make().records[0]!.sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (make().records[0]!.sig !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.30 SOUL EMBALMING · stats + formatter", () => {
  it("computeCryptStats reports totals + capacity + span", () => {
    let c = emptyCrypt("a", 10);
    c = embalmSoul({ crypt: c, soul: mkSoul("a", 0), secret: SECRET });
    c = embalmSoul({ crypt: c, soul: mkSoul("a", 86400_000), secret: SECRET }); // 1 day later
    const s = computeCryptStats(c);
    expect(s.totalRecords).toBe(2);
    expect(s.capacityUsed).toBeCloseTo(0.2, 5);
    expect(s.spanMs).toBe(86400_000);
  });

  it("empty crypt stats → all zero / null (defensive)", () => {
    const s = computeCryptStats(emptyCrypt("a"));
    expect(s.totalRecords).toBe(0);
    expect(s.oldestEmbalmedAtMs).toBeNull();
  });

  it("formatCryptLine renders one-line digest", () => {
    const c = emptyCrypt("agent-claude");
    expect(formatCryptLine(computeCryptStats(c))).toContain("CRYPT agent-claude");
  });
});

describe("v2.19.30 SOUL EMBALMING · 24/7 resilience", () => {
  it("MEASURED never crashes on 1000 random embalms + restores", () => {
    let c = emptyCrypt("a", 100);
    let crashed = false;
    try {
      for (let i = 0; i < 1000; i++) {
        c = embalmSoul({ crypt: c, soul: mkSoul("a", i, `goal_${i}`), secret: SECRET });
        restoreLatestSoul({ crypt: c, secret: SECRET });
        restoreSoulAt({ crypt: c, index: i % 5, secret: SECRET });
      }
    } catch {
      crashed = true;
    }
    expect(crashed).toBe(false);
    expect(verifyCrypt(c, SECRET)).toBe(true);
    expect(c.records.length).toBe(100); // ring buffer enforced
  });
});
