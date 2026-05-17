import { describe, it, expect } from "vitest";
import {
  classifyPhase,
  verifyPhaseReport,
  decideGating,
  formatPhaseLine,
  formatGatingLine,
  PHASE_EMOJI,
  DEFAULT_BOUNDARIES,
  DEFAULT_PHASE_PREFERENCE,
  CIRCADIAN_TUNABLES,
  type Phase,
} from "./index.js";

const SECRET = "circadian-test-secret-997744";

describe("v2.19.29 CIRCADIAN · classifyPhase (5-phase ladder)", () => {
  it("06:00-21:00 → AWAKE", () => {
    expect(classifyPhase({ hourOfDay: 10, secret: SECRET }).phase).toBe("AWAKE");
    expect(classifyPhase({ hourOfDay: 14, secret: SECRET }).phase).toBe("AWAKE");
    expect(classifyPhase({ hourOfDay: 20, secret: SECRET }).phase).toBe("AWAKE");
  });

  it("21:00-23:00 → DROWSY", () => {
    expect(classifyPhase({ hourOfDay: 21, secret: SECRET }).phase).toBe("DROWSY");
    expect(classifyPhase({ hourOfDay: 22, secret: SECRET }).phase).toBe("DROWSY");
  });

  it("23:00-02:00 → SLEEP_NREM (wraps midnight)", () => {
    expect(classifyPhase({ hourOfDay: 23, secret: SECRET }).phase).toBe("SLEEP_NREM");
    expect(classifyPhase({ hourOfDay: 0, secret: SECRET }).phase).toBe("SLEEP_NREM");
    expect(classifyPhase({ hourOfDay: 1, secret: SECRET }).phase).toBe("SLEEP_NREM");
  });

  it("02:00-04:00 → SLEEP_REM", () => {
    expect(classifyPhase({ hourOfDay: 2, secret: SECRET }).phase).toBe("SLEEP_REM");
    expect(classifyPhase({ hourOfDay: 3, secret: SECRET }).phase).toBe("SLEEP_REM");
  });

  it("04:00-06:00 → WAKE_TRANSITION", () => {
    expect(classifyPhase({ hourOfDay: 4, secret: SECRET }).phase).toBe("WAKE_TRANSITION");
    expect(classifyPhase({ hourOfDay: 5, secret: SECRET }).phase).toBe("WAKE_TRANSITION");
  });

  it("activity override: recent activity → WAKE_TRANSITION regardless of clock", () => {
    const r = classifyPhase({
      hourOfDay: 3, // would normally be SLEEP_REM
      msSinceLastActivity: 60_000, // 1 minute ago
      secret: SECRET,
    });
    expect(r.phase).toBe("WAKE_TRANSITION");
    expect(r.activityOverride).toBe(true);
  });

  it("activity > 5min ago → no override; clock-based phase wins", () => {
    const r = classifyPhase({
      hourOfDay: 3,
      msSinceLastActivity: 10 * 60_000, // 10 min ago
      secret: SECRET,
    });
    expect(r.phase).toBe("SLEEP_REM");
    expect(r.activityOverride).toBe(false);
  });

  it("DEFENSIVE: NaN hour → AWAKE fallback (never crashes)", () => {
    const r = classifyPhase({ hourOfDay: NaN, secret: SECRET });
    expect(r.phase).toBe("AWAKE");
    expect(r.reason).toContain("malformed");
  });

  it("DEFENSIVE: negative hour → AWAKE fallback", () => {
    expect(classifyPhase({ hourOfDay: -5, secret: SECRET }).phase).toBe("AWAKE");
  });

  it("DEFENSIVE: hour >= 24 → AWAKE fallback", () => {
    expect(classifyPhase({ hourOfDay: 25, secret: SECRET }).phase).toBe("AWAKE");
  });

  it("HMAC sig verifies; rejects tamper", () => {
    const r = classifyPhase({ hourOfDay: 14, secret: SECRET });
    expect(verifyPhaseReport(r, SECRET)).toBe(true);
    expect(verifyPhaseReport({ ...r, phase: "SLEEP_REM" as Phase }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input → same sig (50 trials)", () => {
    const firstSig = classifyPhase({ hourOfDay: 10, msSinceLastActivity: 100, secret: SECRET }).sig;
    let allEqual = true;
    for (let i = 0; i < 50; i++) {
      if (classifyPhase({ hourOfDay: 10, msSinceLastActivity: 100, secret: SECRET }).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.29 CIRCADIAN · decideGating (per-tool phase gates)", () => {
  it("breath is always-on (every phase)", () => {
    for (const phase of ["AWAKE", "DROWSY", "SLEEP_NREM", "SLEEP_REM", "WAKE_TRANSITION"] as Phase[]) {
      expect(decideGating({ toolName: "mneme.breath.decide", currentPhase: phase }).shouldFire).toBe(true);
    }
  });

  it("dreamspace.* only fires in SLEEP_REM", () => {
    expect(decideGating({ toolName: "mneme.dreamspace.gestation_cycle", currentPhase: "SLEEP_REM" }).shouldFire).toBe(true);
    expect(decideGating({ toolName: "mneme.dreamspace.gestation_cycle", currentPhase: "AWAKE" }).shouldFire).toBe(false);
  });

  it("sleep.* only fires during SLEEP_NREM or SLEEP_REM", () => {
    expect(decideGating({ toolName: "mneme.sleep.cycle", currentPhase: "SLEEP_NREM" }).shouldFire).toBe(true);
    expect(decideGating({ toolName: "mneme.sleep.cycle", currentPhase: "AWAKE" }).shouldFire).toBe(false);
  });

  it("synapse.prune exact-match: only SLEEP_NREM", () => {
    expect(decideGating({ toolName: "mneme.synapse.prune", currentPhase: "SLEEP_NREM" }).shouldFire).toBe(true);
    expect(decideGating({ toolName: "mneme.synapse.prune", currentPhase: "AWAKE" }).shouldFire).toBe(false);
    expect(decideGating({ toolName: "mneme.synapse.prune", currentPhase: "SLEEP_REM" }).shouldFire).toBe(false);
  });

  it("unknown tool → fallback to AWAKE-only (safe conservative default)", () => {
    expect(decideGating({ toolName: "mneme.totally_new_org.x", currentPhase: "AWAKE" }).shouldFire).toBe(true);
    expect(decideGating({ toolName: "mneme.totally_new_org.x", currentPhase: "SLEEP_REM" }).shouldFire).toBe(false);
  });

  it("hormonal.* + endocrine.* fire in DROWSY + WAKE_TRANSITION + AWAKE", () => {
    expect(decideGating({ toolName: "mneme.hormonal.update", currentPhase: "DROWSY" }).shouldFire).toBe(true);
    expect(decideGating({ toolName: "mneme.endocrine.produce", currentPhase: "WAKE_TRANSITION" }).shouldFire).toBe(true);
    expect(decideGating({ toolName: "mneme.endocrine.produce", currentPhase: "SLEEP_NREM" }).shouldFire).toBe(false);
  });

  it("DEFENSIVE: empty toolName → no fire (never crashes)", () => {
    expect(decideGating({ toolName: "", currentPhase: "AWAKE" }).shouldFire).toBe(false);
  });

  it("custom preference map overrides defaults", () => {
    const custom = new Map<string, readonly Phase[]>([
      ["mneme.custom.tool", ["SLEEP_REM"]],
    ]);
    expect(decideGating({ toolName: "mneme.custom.tool", currentPhase: "SLEEP_REM", preferenceMap: custom }).shouldFire).toBe(true);
    expect(decideGating({ toolName: "mneme.custom.tool", currentPhase: "AWAKE", preferenceMap: custom }).shouldFire).toBe(false);
  });

  it("matchedRule field tracks which rule fired (audit trail)", () => {
    const exact = decideGating({ toolName: "mneme.synapse.prune", currentPhase: "SLEEP_NREM" });
    expect(exact.matchedRule).toBe("mneme.synapse.prune");
    const wildcard = decideGating({ toolName: "mneme.breath.decide", currentPhase: "AWAKE" });
    expect(wildcard.matchedRule).toBe("mneme.breath.*");
    const fallback = decideGating({ toolName: "mneme.unknown.tool", currentPhase: "AWAKE" });
    expect(fallback.matchedRule).toBeNull();
  });
});

describe("v2.19.29 CIRCADIAN · 24/7 invariants + biological correctness", () => {
  it("every hour 0-23 returns a valid phase (no gaps)", () => {
    for (let h = 0; h < 24; h++) {
      const r = classifyPhase({ hourOfDay: h, secret: SECRET });
      expect(["WAKE_TRANSITION", "AWAKE", "DROWSY", "SLEEP_NREM", "SLEEP_REM"]).toContain(r.phase);
    }
  });

  it("PHASE_EMOJI covers all 5 phases", () => {
    for (const phase of ["WAKE_TRANSITION", "AWAKE", "DROWSY", "SLEEP_NREM", "SLEEP_REM"] as Phase[]) {
      expect(PHASE_EMOJI[phase]).toBeTruthy();
    }
  });

  it("CIRCADIAN_TUNABLES exposes boundaries + activity window (frozen)", () => {
    expect(Object.isFrozen(CIRCADIAN_TUNABLES)).toBe(true);
    expect(CIRCADIAN_TUNABLES.DEFAULT_BOUNDARIES.awakeStart).toBe(6);
    expect(CIRCADIAN_TUNABLES.ACTIVITY_TRANSITION_WINDOW_MS).toBeGreaterThan(0);
  });

  it("DEFAULT_PHASE_PREFERENCE has entries for every major organ family", () => {
    const expectedFamilies = ["mneme.breath.*", "mneme.reflex.*", "mneme.sleep.*", "mneme.dreamspace.*", "mneme.hormonal.*"];
    for (const f of expectedFamilies) {
      expect(DEFAULT_PHASE_PREFERENCE.has(f)).toBe(true);
    }
  });

  it("MEASURED 100% gating determinism across 100 trials per tool", () => {
    const tools = ["mneme.breath.decide", "mneme.dreamspace.x", "mneme.unknown.y"];
    const phases: Phase[] = ["AWAKE", "SLEEP_REM"];
    for (const t of tools) {
      for (const p of phases) {
        const first = decideGating({ toolName: t, currentPhase: p }).shouldFire;
        for (let i = 0; i < 100; i++) {
          expect(decideGating({ toolName: t, currentPhase: p }).shouldFire).toBe(first);
        }
      }
    }
  });

  it("formatPhaseLine + formatGatingLine produce one-line digests", () => {
    const r = classifyPhase({ hourOfDay: 14, secret: SECRET });
    expect(formatPhaseLine(r)).toContain("CIRCADIAN");
    expect(formatPhaseLine(r)).toContain(PHASE_EMOJI[r.phase]);
    const d = decideGating({ toolName: "mneme.breath.decide", currentPhase: "AWAKE" });
    expect(formatGatingLine(d)).toContain("GATE");
  });
});
