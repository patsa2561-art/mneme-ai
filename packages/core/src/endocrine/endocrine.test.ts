import { describe, it, expect } from "vitest";
import {
  neutralEndocrineState,
  produceFromSignals,
  crossOrganEffects,
  emptyEndocrineLedger,
  recordEndocrine,
  verifyEndocrineLedger,
  formatEndocrineLine,
  listHormoneInfo,
  detectCortisolDelta,
  detectDopamineDelta,
  detectMelatoninDelta,
  detectOxytocinDelta,
  type EndocrineState,
} from "./index.js";

const SECRET = "endocrine-test-secret-997744";

describe("v2.19.25 ENDOCRINE · neutralEndocrineState", () => {
  it("starts all 4 hormones at 0", () => {
    const s = neutralEndocrineState();
    expect(s.cortisol).toBe(0);
    expect(s.dopamine).toBe(0);
    expect(s.melatonin).toBe(0);
    expect(s.oxytocin).toBe(0);
  });
});

describe("v2.19.25 ENDOCRINE · 🩸 CORTISOL (stress)", () => {
  it("rises on commit FUCK/DAMN/finally/hotfix/wtf", () => {
    expect(detectCortisolDelta({ commitMessage: "fix: damn that bug", elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectCortisolDelta({ commitMessage: "FINALLY working", elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectCortisolDelta({ commitMessage: "hotfix: production down", elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectCortisolDelta({ commitMessage: "wtf is this", elapsedMs: 0 })).toBeGreaterThan(0);
  });
  it("rises on errorCountWindow > 3", () => {
    expect(detectCortisolDelta({ errorCountWindow: 5, elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectCortisolDelta({ errorCountWindow: 0, elapsedMs: 0 })).toBe(0);
  });
  it("rises late-night (hour 23 or hour 2)", () => {
    expect(detectCortisolDelta({ hourOfDay: 23, elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectCortisolDelta({ hourOfDay: 2, elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectCortisolDelta({ hourOfDay: 14, elapsedMs: 0 })).toBe(0);
  });
});

describe("v2.19.25 ENDOCRINE · ⚡ DOPAMINE (flow)", () => {
  it("rises on greenStreak >= 5", () => {
    expect(detectDopamineDelta({ greenStreakCount: 7, elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectDopamineDelta({ greenStreakCount: 2, elapsedMs: 0 })).toBe(0);
  });
  it("rises on testPassStreak >= 5", () => {
    expect(detectDopamineDelta({ testPassStreakCount: 10, elapsedMs: 0 })).toBeGreaterThan(0);
  });
  it("rises on zero errors window", () => {
    expect(detectDopamineDelta({ errorCountWindow: 0, elapsedMs: 0 })).toBeGreaterThan(0);
  });
});

describe("v2.19.25 ENDOCRINE · 🌙 MELATONIN (rest)", () => {
  it("rises late hour (22 onwards) and early morning (00-06)", () => {
    expect(detectMelatoninDelta({ hourOfDay: 22, elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectMelatoninDelta({ hourOfDay: 2, elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectMelatoninDelta({ hourOfDay: 14, elapsedMs: 0 })).toBe(0);
  });
  it("rises on idle > 15min", () => {
    expect(detectMelatoninDelta({ idleMs: 20 * 60_000, elapsedMs: 0 })).toBeGreaterThan(0);
    expect(detectMelatoninDelta({ idleMs: 5 * 60_000, elapsedMs: 0 })).toBe(0);
  });
});

describe("v2.19.25 ENDOCRINE · 💞 OXYTOCIN (social)", () => {
  it("rises on hasCoAuthor", () => {
    expect(detectOxytocinDelta({ hasCoAuthor: true, elapsedMs: 0 })).toBeGreaterThan(0);
  });
  it("rises on Co-Authored-By trailer in commit", () => {
    expect(detectOxytocinDelta({
      commitMessage: "feat: x\n\nCo-Authored-By: Bob <bob@example.com>",
      elapsedMs: 0,
    })).toBeGreaterThan(0);
  });
  it("rises with distinctAuthorsHour >= 2", () => {
    expect(detectOxytocinDelta({ distinctAuthorsHour: 3, elapsedMs: 0 })).toBeGreaterThan(0);
  });
});

describe("v2.19.25 ENDOCRINE · produceFromSignals (state evolution + decay)", () => {
  it("starts at neutral; cortisol rises on stress signal", () => {
    const s = produceFromSignals({
      state: neutralEndocrineState(0),
      signals: { commitMessage: "wtf this is broken", errorCountWindow: 5, elapsedMs: 0 },
    });
    expect(s.cortisol).toBeGreaterThan(0);
    expect(s.cortisol).toBeLessThanOrEqual(1);
  });

  it("hormones clamped to [0, 1]", () => {
    let s: EndocrineState = neutralEndocrineState(0);
    for (let i = 0; i < 100; i++) {
      s = produceFromSignals({
        state: s,
        signals: {
          commitMessage: "fuck damn wtf hotfix",
          errorCountWindow: 100,
          hourOfDay: 2,
          greenStreakCount: 50,
          testPassStreakCount: 50,
          hasCoAuthor: true,
          distinctAuthorsHour: 10,
          idleMs: 60 * 60_000,
          elapsedMs: 0,
        },
      });
    }
    expect(s.cortisol).toBeLessThanOrEqual(1);
    expect(s.dopamine).toBeLessThanOrEqual(1);
    expect(s.melatonin).toBeLessThanOrEqual(1);
    expect(s.oxytocin).toBeLessThanOrEqual(1);
  });

  it("natural half-life decay (cortisol fast, melatonin slow)", () => {
    const start: EndocrineState = { v: 1, cortisol: 0.9, dopamine: 0.5, melatonin: 0.9, oxytocin: 0.5, ts: 0 };
    const after30min = produceFromSignals({
      state: start,
      signals: { elapsedMs: 30 * 60_000 },
    });
    // cortisol half-life = 30min -> ~0.45
    expect(after30min.cortisol).toBeCloseTo(0.45, 1);
    // melatonin half-life = 90min -> 30/90 ≈ 0.33 half-lives -> 0.9 * 0.5^0.33 ≈ 0.71
    expect(after30min.melatonin).toBeGreaterThan(0.65);
    expect(after30min.melatonin).toBeLessThan(0.75);
  });

  it("MEASURED 100% determinism: same input -> same state (50 trials)", () => {
    const start = neutralEndocrineState(0);
    const signals = { commitMessage: "fix: bug", greenStreakCount: 6, elapsedMs: 0 };
    const first = JSON.stringify(produceFromSignals({ state: start, signals }));
    let allEqual = true;
    for (let i = 0; i < 50; i++) {
      if (JSON.stringify(produceFromSignals({ state: start, signals })) !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.25 ENDOCRINE · crossOrganEffects (hormones -> organ behavior)", () => {
  it("neutral hormones -> baseline behavior", () => {
    const e = crossOrganEffects(neutralEndocrineState());
    expect(e.reflexAggressiveness).toBe(0.5);
    expect(e.notificationsSuppressed).toBe(false);
    expect(e.surfaceTrinityAndConfessional).toBe(false);
  });

  it("high cortisol -> reflex calmer + daemon quieter + notifications suppressed at >= 0.7", () => {
    const e = crossOrganEffects({ v: 1, cortisol: 0.8, dopamine: 0, melatonin: 0, oxytocin: 0, ts: 0 });
    expect(e.reflexAggressiveness).toBeLessThan(0.5);
    expect(e.daemonQuietness).toBeGreaterThan(0.5);
    expect(e.notificationsSuppressed).toBe(true);
  });

  it("high dopamine -> reflex MORE aggressive", () => {
    const e = crossOrganEffects({ v: 1, cortisol: 0, dopamine: 0.8, melatonin: 0, oxytocin: 0, ts: 0 });
    expect(e.reflexAggressiveness).toBeGreaterThan(0.5);
  });

  it("high melatonin -> deep dream cycle + notifications suppressed at >= 0.6", () => {
    const e = crossOrganEffects({ v: 1, cortisol: 0, dopamine: 0, melatonin: 0.9, oxytocin: 0, ts: 0 });
    expect(e.dreamCycleDepth).toBeGreaterThan(0.5);
    expect(e.notificationsSuppressed).toBe(true);
  });

  it("oxytocin >= 0.4 -> surface TRINITY + CONFESSIONAL", () => {
    const e = crossOrganEffects({ v: 1, cortisol: 0, dopamine: 0, melatonin: 0, oxytocin: 0.5, ts: 0 });
    expect(e.surfaceTrinityAndConfessional).toBe(true);
  });

  it("dominantMood names the top hormone", () => {
    const e = crossOrganEffects({ v: 1, cortisol: 0.8, dopamine: 0.2, melatonin: 0.1, oxytocin: 0.1, ts: 0 });
    expect(e.dominantMood).toContain("cortisol");
  });
});

describe("v2.19.25 ENDOCRINE · ledger (HMAC chain)", () => {
  it("recordEndocrine chains; verify passes untampered", () => {
    let L = emptyEndocrineLedger();
    let s = neutralEndocrineState(0);
    L = recordEndocrine({ ledger: L, state: s, signals: { commitMessage: "fix: x", elapsedMs: 0 }, secret: SECRET });
    s = produceFromSignals({ state: s, signals: { commitMessage: "fix: x", elapsedMs: 0 } });
    L = recordEndocrine({ ledger: L, state: s, signals: { greenStreakCount: 10, elapsedMs: 0 }, secret: SECRET });
    expect(L.records.length).toBe(2);
    expect(L.records[1]!.prevSig).toBe(L.records[0]!.sig);
    expect(verifyEndocrineLedger(L, SECRET).ok).toBe(true);
  });

  it("verifyEndocrineLedger detects tamper at exact step", () => {
    let L = emptyEndocrineLedger();
    for (let i = 0; i < 4; i++) {
      L = recordEndocrine({ ledger: L, state: neutralEndocrineState(i), signals: { elapsedMs: 0 }, secret: SECRET });
    }
    const tampered = {
      ...L,
      records: L.records.map((r, i) => (i === 2 ? { ...r, state: { ...r.state, cortisol: 0.99 } } : r)),
    };
    const v = verifyEndocrineLedger(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });
});

describe("v2.19.25 ENDOCRINE · formatter + introspection", () => {
  it("formatEndocrineLine includes all 4 hormones", () => {
    const line = formatEndocrineLine({ v: 1, cortisol: 0.1, dopamine: 0.2, melatonin: 0.3, oxytocin: 0.4, ts: 0 });
    expect(line).toContain("🩸");
    expect(line).toContain("⚡");
    expect(line).toContain("🌙");
    expect(line).toContain("💞");
  });

  it("listHormoneInfo returns 4 entries with sources + effects", () => {
    const info = listHormoneInfo();
    expect(info.length).toBe(4);
    for (const h of info) {
      expect(h.sources.length).toBeGreaterThan(0);
      expect(h.effects.length).toBeGreaterThan(0);
    }
  });
});
