import { describe, it, expect } from "vitest";
import {
  decideBreath,
  heartbeatBudgetMs,
  emptyLedger,
  recordBreath,
  verifyLedger,
  computeStats,
  formatBreathLine,
  type BreathProbe,
  type BreathOutcome,
  type BreathLedger,
} from "./index.js";

const SECRET = "breath-test-secret-997744";

function probeAlive(): BreathProbe {
  return { pidIsAlive: true, pidFileExists: true, pid: 1234, pidFileMtimeMs: 1_000_000, nowMs: 1_000_000 };
}

function probeDead(): BreathProbe {
  return { pidIsAlive: false, pidFileExists: true, pid: 1234, pidFileMtimeMs: 1_000_000, nowMs: 1_000_000 };
}

function probeNoPid(): BreathProbe {
  return { pidIsAlive: false, pidFileExists: false, pid: NaN, pidFileMtimeMs: 0, nowMs: 1_000_000 };
}

describe("v2.19.23 BREATH · decideBreath (G1 killer)", () => {
  it("alive daemon -> no respawn", () => {
    const d = decideBreath({ probe: probeAlive() });
    expect(d.shouldRespawn).toBe(false);
    expect(d.shouldCleanStalePidFile).toBe(false);
    expect(d.reason).toContain("already_alive");
  });

  it("no PID file -> respawn (never_started)", () => {
    const d = decideBreath({ probe: probeNoPid() });
    expect(d.shouldRespawn).toBe(true);
    expect(d.shouldCleanStalePidFile).toBe(false);
    expect(d.reason).toContain("no_pid_file");
  });

  it("dead PID + fresh file -> respawn + clean", () => {
    const d = decideBreath({ probe: probeDead() });
    expect(d.shouldRespawn).toBe(true);
    expect(d.shouldCleanStalePidFile).toBe(true);
    expect(d.reason).toContain("dead_pid");
  });

  it("dead PID + 31-day-old file -> respawn + clean (stale)", () => {
    const probe: BreathProbe = {
      pidIsAlive: false, pidFileExists: true, pid: 1, pidFileMtimeMs: 0,
      nowMs: 31 * 86400 * 1000,
    };
    const d = decideBreath({ probe });
    expect(d.shouldRespawn).toBe(true);
    expect(d.shouldCleanStalePidFile).toBe(true);
    expect(d.reason).toContain("stale_pid");
  });

  it("default policy: windowsHide + detached + silentStdio = true (silent ghost-sniper)", () => {
    const d = decideBreath({ probe: probeNoPid() });
    expect(d.windowsHide).toBe(true);
    expect(d.detached).toBe(true);
    expect(d.silentStdio).toBe(true);
  });

  it("caller can override hints (foreground debug mode)", () => {
    const d = decideBreath({ probe: probeNoPid(), windowsHide: false, silentStdio: false });
    expect(d.windowsHide).toBe(false);
    expect(d.silentStdio).toBe(false);
  });
});

describe("v2.19.23 BREATH · heartbeatBudgetMs (HORMONAL coupling)", () => {
  it("zero fatigue -> 50ms", () => {
    expect(heartbeatBudgetMs()).toBe(50);
    expect(heartbeatBudgetMs({ hormonal: { fatigue: 0 } })).toBe(50);
  });
  it("full fatigue -> 200ms (linear scale)", () => {
    expect(heartbeatBudgetMs({ hormonal: { fatigue: 1 } })).toBe(200);
  });
  it("mid fatigue -> ~125ms", () => {
    expect(heartbeatBudgetMs({ hormonal: { fatigue: 0.5 } })).toBe(125);
  });
  it("clamps out-of-range fatigue", () => {
    expect(heartbeatBudgetMs({ hormonal: { fatigue: -1 } })).toBe(50);
    expect(heartbeatBudgetMs({ hormonal: { fatigue: 99 } })).toBe(200);
  });
});

describe("v2.19.23 BREATH · ledger (HMAC chain)", () => {
  function ok(action: BreathOutcome["action"], ms = 12): BreathOutcome {
    return { action, ms };
  }

  it("recordBreath appends + chains; verify passes on untampered", () => {
    let L: BreathLedger = emptyLedger();
    const probe = probeAlive();
    const decision = decideBreath({ probe });
    L = recordBreath({ ledger: L, probe, decision, outcome: ok("already_alive"), secret: SECRET });
    L = recordBreath({ ledger: L, probe: probeDead(), decision: decideBreath({ probe: probeDead() }), outcome: ok("respawned", 250), secret: SECRET });
    expect(L.records).toHaveLength(2);
    expect(L.records[0]!.prevSig).toBeNull();
    expect(L.records[1]!.prevSig).toBe(L.records[0]!.sig);
    expect(verifyLedger(L, SECRET).ok).toBe(true);
  });

  it("verifyLedger detects tamper at exact step", () => {
    let L: BreathLedger = emptyLedger();
    const probe = probeAlive();
    for (let i = 0; i < 4; i++) {
      L = recordBreath({ ledger: L, probe, decision: decideBreath({ probe }), outcome: ok("already_alive", i), secret: SECRET });
    }
    const tampered: BreathLedger = {
      ...L,
      records: L.records.map((r, i) => (i === 2 ? { ...r, outcome: { ...r.outcome, ms: 999 } } : r)),
    };
    const v = verifyLedger(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });

  it("computeStats: alive 4, respawn 1, failed 0 -> uptimeRatio 4/5", () => {
    let L: BreathLedger = emptyLedger();
    const aliveDecision = decideBreath({ probe: probeAlive() });
    const respawnDecision = decideBreath({ probe: probeDead() });
    for (let i = 0; i < 4; i++) {
      L = recordBreath({ ledger: L, probe: probeAlive(), decision: aliveDecision, outcome: ok("already_alive"), secret: SECRET });
    }
    L = recordBreath({ ledger: L, probe: probeDead(), decision: respawnDecision, outcome: ok("respawned", 250), secret: SECRET });
    const s = computeStats(L);
    expect(s.totalChecks).toBe(5);
    expect(s.alreadyAlive).toBe(4);
    expect(s.respawned).toBe(1);
    expect(s.uptimeRatio).toBeCloseTo(4 / 5, 5);
  });

  it("MEASURED 100% determinism: same input -> same chain sig (20 trials)", () => {
    const probe = probeAlive();
    const decision = decideBreath({ probe });
    const outcome = ok("already_alive", 12);
    const baseLedger = recordBreath({ ledger: emptyLedger(), probe, decision, outcome, nowMs: 1_000_000, secret: SECRET });
    const firstSig = baseLedger.records[0]!.sig;
    let allEqual = true;
    for (let i = 0; i < 20; i++) {
      const L = recordBreath({ ledger: emptyLedger(), probe, decision, outcome, nowMs: 1_000_000, secret: SECRET });
      if (L.records[0]!.sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.23 BREATH · formatter", () => {
  it("formatBreathLine uses 🫁 / 🌱 / 💀 / 🧹 per action", () => {
    const probe = probeAlive();
    const decision = decideBreath({ probe });
    expect(formatBreathLine(decision, { action: "already_alive", ms: 12 })).toContain("🫁");
    expect(formatBreathLine(decision, { action: "respawned", ms: 250 })).toContain("🌱");
    expect(formatBreathLine(decision, { action: "failed", ms: 5 })).toContain("💀");
    expect(formatBreathLine(decision, { action: "stale_pid_cleaned", ms: 2 })).toContain("🧹");
  });
});
