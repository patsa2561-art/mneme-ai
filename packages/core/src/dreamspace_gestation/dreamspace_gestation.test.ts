import { describe, it, expect } from "vitest";
import {
  detectToolGaps,
  proposeToolSpec,
  verifyProposal,
  runGestationCycle,
  verifyGestationReport,
  formatProposalLine,
  type GapSignal,
} from "./index.js";

const SECRET = "gestation-test-secret-997744";

function sig(kind: GapSignal["kind"], label: string, relatedTools: string[], count: number, ts = 1): GapSignal {
  return { v: 1, kind, label, relatedTools, count, ts };
}

describe("v2.19.26 GESTATION · detectToolGaps", () => {
  it("filters below-threshold signals (default minGapCount=3)", () => {
    const out = detectToolGaps({
      signals: [
        sig("reflex_cache_miss", "x", [], 2),  // below threshold
        sig("reflex_cache_miss", "y", [], 5),  // above
      ],
    });
    expect(out.length).toBe(1);
    expect(out[0]!.label).toBe("y");
  });

  it("co-occurrence has higher threshold (default minCoOccurCount=4)", () => {
    const out = detectToolGaps({
      signals: [
        sig("pattern_co_occurrence", "x", ["a", "b"], 3),  // below co-threshold
        sig("pattern_co_occurrence", "y", ["a", "b"], 5),  // above
      ],
    });
    expect(out.length).toBe(1);
    expect(out[0]!.label).toBe("y");
  });

  it("sorts by count desc, then label asc", () => {
    const out = detectToolGaps({
      signals: [
        sig("reflex_cache_miss", "b", [], 5),
        sig("reflex_cache_miss", "a", [], 5),
        sig("reflex_cache_miss", "c", [], 10),
      ],
    });
    expect(out.map((g) => g.label)).toEqual(["c", "a", "b"]);
  });
});

describe("v2.19.26 GESTATION · proposeToolSpec (3 gap kinds)", () => {
  it("pattern_co_occurrence -> mneme.auto.X_then_Y chimera", () => {
    const spec = proposeToolSpec({
      gap: sig("pattern_co_occurrence", "git_commit:fix-prefix", ["mneme.ask", "mneme.why"], 6),
      secret: SECRET,
    });
    expect(spec.proposedName).toBe("mneme.auto.ask_then_why");
    expect(spec.composerKind).toBe("sequential");
    expect(spec.composerRecipe.length).toBe(2);
    expect(spec.composerRecipe[0]!.toolName).toBe("mneme.ask");
    expect(spec.composerRecipe[1]!.toolName).toBe("mneme.why");
  });

  it("reflex_cache_miss with related tools -> handler chimera", () => {
    const spec = proposeToolSpec({
      gap: sig("reflex_cache_miss", "user_chat:thai-refresh", ["mneme.status", "mneme.whats_new"], 4),
      secret: SECRET,
    });
    expect(spec.proposedName).toContain("mneme.auto.handle_");
    expect(spec.composerRecipe.length).toBe(2);
  });

  it("reflex_cache_miss with NO related tools -> smart_do fallback", () => {
    const spec = proposeToolSpec({
      gap: sig("reflex_cache_miss", "unknown:x", [], 4),
      secret: SECRET,
    });
    expect(spec.composerRecipe[0]!.toolName).toBe("mneme.smart_do");
  });

  it("user_chat_no_match -> intent handler with query schema", () => {
    const spec = proposeToolSpec({
      gap: sig("user_chat_no_match", "compress yesterday's commits", [], 5),
      secret: SECRET,
    });
    expect(spec.proposedName).toContain("mneme.auto.intent_");
    expect(spec.proposedInputSchema.required).toContain("query");
  });

  it("confidence scales with gap count (capped at 1.0)", () => {
    const low = proposeToolSpec({ gap: sig("reflex_cache_miss", "x", [], 3), secret: SECRET, minGapCount: 3 });
    const high = proposeToolSpec({ gap: sig("reflex_cache_miss", "x", [], 30), secret: SECRET, minGapCount: 3 });
    expect(high.confidence).toBeGreaterThan(low.confidence);
    expect(high.confidence).toBeLessThanOrEqual(1);
  });

  it("HMAC sig verifies untampered; rejects tamper", () => {
    const spec = proposeToolSpec({ gap: sig("reflex_cache_miss", "x", [], 5), secret: SECRET });
    expect(verifyProposal(spec, SECRET)).toBe(true);
    expect(verifyProposal({ ...spec, confidence: 0.99 }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same gap -> same proposal sig (30 trials)", () => {
    const gap = sig("pattern_co_occurrence", "stable", ["mneme.ask", "mneme.why"], 8, 1_000_000);
    const firstSig = proposeToolSpec({ gap, secret: SECRET }).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (proposeToolSpec({ gap, secret: SECRET }).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.26 GESTATION · runGestationCycle (full loop)", () => {
  it("empty signals -> empty proposals", () => {
    const r = runGestationCycle({ signals: [], cycleAt: 0, secret: SECRET });
    expect(r.qualifyingGaps).toBe(0);
    expect(r.proposals).toEqual([]);
  });

  it("mixed signals: only above-threshold yield proposals", () => {
    const r = runGestationCycle({
      signals: [
        sig("reflex_cache_miss", "x", [], 2),                              // below
        sig("reflex_cache_miss", "y", [], 5),                              // qualifies
        sig("pattern_co_occurrence", "z", ["mneme.a", "mneme.b"], 4),      // qualifies (co threshold 4)
        sig("user_chat_no_match", "?", [], 1),                             // below
      ],
      cycleAt: 0,
      secret: SECRET,
    });
    expect(r.totalSignals).toBe(4);
    expect(r.qualifyingGaps).toBe(2);
    expect(r.proposals.length).toBe(2);
  });

  it("HMAC sig verifies untampered; rejects tamper", () => {
    const r = runGestationCycle({
      signals: [sig("reflex_cache_miss", "x", [], 5)],
      cycleAt: 0,
      secret: SECRET,
    });
    expect(verifyGestationReport(r, SECRET)).toBe(true);
    expect(verifyGestationReport({ ...r, totalSignals: 999 }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same signals -> same report sig (30 trials)", () => {
    const input = {
      signals: [
        sig("reflex_cache_miss", "x", [], 5, 1),
        sig("pattern_co_occurrence", "y", ["mneme.a", "mneme.b"], 6, 2),
      ],
      cycleAt: 1_000_000,
      secret: SECRET,
    };
    const first = runGestationCycle(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (runGestationCycle(input).sig !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.26 GESTATION · formatter", () => {
  it("formatProposalLine includes name + step count + confidence + gap kind", () => {
    const spec = proposeToolSpec({
      gap: sig("pattern_co_occurrence", "x", ["mneme.a", "mneme.b"], 10),
      secret: SECRET,
    });
    const line = formatProposalLine(spec);
    expect(line).toContain("mneme.auto");
    expect(line).toContain("2-step");
    expect(line).toContain("sequential");
  });
});
