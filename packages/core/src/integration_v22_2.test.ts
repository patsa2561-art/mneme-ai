// v2.22.2 — INTEGRATION · cross-module suite.
//
// Verifies that the four v2.22.2 modules + physics_lathe + conductor
// compose without surprises: shared types align, output of one is
// valid input to the next, no module-boundary bugs.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dimensionalCheck } from "./dimensional_oracle/index.js";
import { physicsCheck } from "./physics_lathe/index.js";
import { crossCheck } from "./challenger_librarian/index.js";
import { recordEvent, traceCausalChain, verifyChain } from "./mission_recorder/index.js";
import { traceOvershoot } from "./overshoot_tracer/index.js";

describe("v2.22.2 integration — cross-module composition", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-v222-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("CHALLENGER LIBRARIAN delegates to DIMENSIONAL ORACLE for Mars Climate Orbiter detection", () => {
    // The dimensional oracle should detect the dimensional mismatch on its own.
    const dim = dimensionalCheck("thrust = 9.8 N/m^2 applied");
    expect(dim.verdict).toBe("MISMATCH");

    // And challenger librarian's cross-check should pick the same up as
    // a Mars-Climate-Orbiter class match.
    const lib = crossCheck("Engine thrust = 9.8 N/m^2 applied for descent burn.");
    const mco = lib.matches.find((m) => m.id === "mars-climate-orbiter");
    expect(mco).toBeDefined();
    expect(mco!.confidence).toBeGreaterThan(0.5);
  });

  it("CHALLENGER LIBRARIAN composes with PHYSICS LATHE for Challenger O-ring class", () => {
    // Physics lathe alone won't necessarily fire on the qualitative
    // claim, but challenger librarian's keyword detector + delegate
    // to physics-lathe will catch it.
    const r = crossCheck("O-ring qualified down to 12 °C; ambient at launch is -2 °C but proceed.");
    expect(r.matches.some((m) => m.id === "challenger-o-ring")).toBe(true);
  });

  it("MISSION RECORDER ledger composes with OVERSHOOT TRACER for plan-vs-actual", () => {
    // Pretend the AI agent planned [verify-self, earthquake-drift].
    const planned = [
      { verb: "verify-self" },
      { verb: "earthquake-drift" },
    ];
    // Record the actual execution as a causal chain.
    const root = recordEvent(repo, { kind: "exec", verb: "verify-self" });
    const earthquake = recordEvent(repo, { kind: "exec", verb: "earthquake-drift", causedBy: [root.id] });
    // Bonus: agent overshoots and runs an extra verb the user didn't ask for.
    recordEvent(repo, { kind: "exec", verb: "telemetry-push", causedBy: [earthquake.id] });

    const chain = traceCausalChain(repo, root.id);
    const actual = chain.map((e) => ({ verb: e.verb ?? "" }));
    const r = traceOvershoot(planned, actual);
    expect(r.entries.some((e) => e.kind === "extra-step" && e.verb === "telemetry-push")).toBe(true);
    expect(["WANDER", "OVERSHOOT", "RUNAWAY"]).toContain(r.band);
  });

  it("MISSION RECORDER chain integrity holds across many events", () => {
    for (let i = 0; i < 20; i++) {
      recordEvent(repo, { kind: "tick", verb: `verb-${i}` });
    }
    expect(verifyChain(repo).ok).toBe(true);
  });

  it("PHYSICS LATHE refutation + CHALLENGER LIBRARIAN both fire on the SAME bad physics claim", () => {
    const claim = "Mars escape velocity is 25 km/s";
    const phys = physicsCheck(claim);
    expect(phys.verdict).toBe("REFUTED");
    const lib = crossCheck(claim);
    // No specific failure pattern matches "Mars escape claim" by name — that's
    // not a historic failure — but physics lathe alone covers it. Composition
    // means caller chains them: physics first, then librarian for context.
    expect(["SAFE", "CAUTION"]).toContain(lib.verdict);
  });

  it("DIMENSIONAL ORACLE MATCH + CHALLENGER LIBRARIAN SAFE on a correct plan", () => {
    const claim = "Engine thrust = 500 kN at sea level";
    expect(dimensionalCheck(claim).verdict).toBe("MATCH");
    const r = crossCheck("Engine thrust = 500 kN at sea level. Standard profile applies.");
    // No historical failure pattern fires.
    expect(r.verdict).toBe("SAFE");
  });

  it("end-to-end: plan → execute (recorded) → cross-check → overshoot", () => {
    const planned = [{ verb: "verify-self" }, { verb: "physics-check" }];
    const root = recordEvent(repo, { kind: "exec", verb: "verify-self" });
    recordEvent(repo, { kind: "exec", verb: "physics-check", causedBy: [root.id] });
    // Cross-check the plan text for failure pattern overlap.
    const lib = crossCheck("Run verify-self then physics-check on the latest earthquake report.");
    expect(lib.verdict).toBe("SAFE");
    // Overshoot tracer over the recorded chain matches plan exactly.
    const chain = traceCausalChain(repo, root.id);
    const actual = chain.map((e) => ({ verb: e.verb ?? "" }));
    const ot = traceOvershoot(planned, actual);
    expect(ot.band).toBe("ALIGNED");
    expect(ot.killSwitch).toBe(false);
  });
});
