import { describe, it, expect } from "vitest";
import { blendPredictions, BUILTIN_RULES, listBuiltinRules, formatBlendLine, type BuiltinReflexRule } from "./index.js";

describe("v2.19.23 SPINAL REFLEX · BUILTIN_RULES (cold-start prior)", () => {
  it("ships 8 default rules covering common event kinds", () => {
    expect(BUILTIN_RULES.length).toBe(8);
    const kinds = new Set(BUILTIN_RULES.map((r) => r.eventKind));
    expect(kinds.has("git_commit")).toBe(true);
    expect(kinds.has("file_save")).toBe(true);
    expect(kinds.has("terminal_command")).toBe(true);
    expect(kinds.has("user_chat")).toBe(true);
    expect(kinds.has("tool_call")).toBe(true);
  });

  it("every rule has unique id + valid prior 0..1", () => {
    const ids = new Set(BUILTIN_RULES.map((r) => r.id));
    expect(ids.size).toBe(BUILTIN_RULES.length);
    for (const r of BUILTIN_RULES) {
      expect(r.priorConfidence).toBeGreaterThanOrEqual(0);
      expect(r.priorConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("listBuiltinRules returns a copy (mutation-safe)", () => {
    const a = listBuiltinRules();
    a.pop();
    expect(BUILTIN_RULES.length).toBe(8);
  });
});

describe("v2.19.23 SPINAL REFLEX · blendPredictions (cold-start works)", () => {
  it("zero observations -> matching rules supply predictions (cold-start)", () => {
    const p = blendPredictions({
      eventKind: "git_commit",
      context: { sha: "abc" },
      observations: [],
      topN: 5,
    });
    expect(p.length).toBeGreaterThan(0);
    for (const x of p) {
      expect(x.source).toBe("rule_only");
      expect(x.posteriorConfidence).toBeNull();
    }
  });

  it("zero rules + observations -> observation_only predictions", () => {
    const p = blendPredictions({
      eventKind: "git_commit",
      context: {},
      observations: [{ toolName: "mneme.custom", argsTemplate: {}, confidence: 0.5, sampleCount: 10 }],
      rules: [], // no rules at all
    });
    expect(p[0]!.source).toBe("observation_only");
    expect(p[0]!.priorConfidence).toBeNull();
    expect(p[0]!.posteriorConfidence).toBe(0.5);
  });

  it("rule + observation -> blended source", () => {
    const p = blendPredictions({
      eventKind: "git_commit",
      context: {},
      observations: [{ toolName: "mneme.ask", argsTemplate: {}, confidence: 0.9, sampleCount: 10 }],
    });
    const ask = p.find((x) => x.toolName === "mneme.ask")!;
    expect(ask.source).toBe("blended");
    expect(ask.priorConfidence).toBe(0.7); // git_commit_then_why prior
    expect(ask.posteriorConfidence).toBe(0.9);
    // sample >= 5 -> posterior weight 0.8: 0.8*0.9 + 0.2*0.7 = 0.86
    expect(ask.confidence).toBeCloseTo(0.86, 5);
  });

  it("sparse observations (n<5) -> prior dominates (weight 0.3 posterior)", () => {
    const p = blendPredictions({
      eventKind: "git_commit",
      context: {},
      observations: [{ toolName: "mneme.ask", argsTemplate: {}, confidence: 0.9, sampleCount: 2 }],
    });
    const ask = p.find((x) => x.toolName === "mneme.ask")!;
    // sample 2 < 5 -> posterior weight 0.3: 0.3*0.9 + 0.7*0.7 = 0.76
    expect(ask.confidence).toBeCloseTo(0.76, 5);
  });

  it("contextPredicate filters rules (TS file_save -> premortem fires; py file_save -> not)", () => {
    const tsPredictions = blendPredictions({
      eventKind: "file_save",
      context: { path: "src/foo.ts" },
      observations: [],
      topN: 10,
    });
    const tsHasPremortem = tsPredictions.some((x) => x.toolName === "mneme.premortem");
    expect(tsHasPremortem).toBe(true);

    const pyPredictions = blendPredictions({
      eventKind: "file_save",
      context: { path: "src/foo.py" },
      observations: [],
      topN: 10,
    });
    const pyHasPremortem = pyPredictions.some((x) => x.toolName === "mneme.premortem");
    expect(pyHasPremortem).toBe(false);
  });

  it("Thai 'ตรวจของแท้' triggers CAPTION SEVERANCE rule (multi-lingual)", () => {
    const p = blendPredictions({
      eventKind: "user_chat",
      context: { prompt: "ตรวจของแท้" },
      observations: [],
      topN: 10,
    });
    const hasCaption = p.some((x) => x.toolName === "mneme.caption.sever");
    expect(hasCaption).toBe(true);
  });

  it("top-N respected; sorted by confidence desc", () => {
    const p = blendPredictions({
      eventKind: "git_commit",
      context: {},
      observations: [{ toolName: "mneme.ask", argsTemplate: {}, confidence: 0.99, sampleCount: 100 }],
      topN: 2,
    });
    expect(p.length).toBe(2);
    for (let i = 1; i < p.length; i++) {
      expect(p[i - 1]!.confidence).toBeGreaterThanOrEqual(p[i]!.confidence);
    }
  });

  it("MEASURED 100% determinism: same input -> same output (20 trials)", () => {
    const input = {
      eventKind: "git_commit" as const,
      context: { sha: "deadbeef" },
      observations: [{ toolName: "mneme.ask", argsTemplate: {}, confidence: 0.6, sampleCount: 7 }],
    };
    const first = JSON.stringify(blendPredictions(input));
    let allEqual = true;
    for (let i = 0; i < 20; i++) {
      if (JSON.stringify(blendPredictions(input)) !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });

  it("custom rules can be passed; replaces BUILTIN_RULES", () => {
    const customRules: BuiltinReflexRule[] = [{
      id: "custom_x",
      eventKind: "git_commit",
      toolName: "custom.tool",
      argsTemplate: {},
      priorConfidence: 0.5,
      reason: "custom",
    }];
    const p = blendPredictions({
      eventKind: "git_commit",
      context: {},
      observations: [],
      rules: customRules,
      topN: 10,
    });
    expect(p.length).toBe(1);
    expect(p[0]!.toolName).toBe("custom.tool");
  });
});

describe("v2.19.23 SPINAL REFLEX · formatter", () => {
  it("formatBlendLine includes tool, conf%, source, sample count", () => {
    const line = formatBlendLine({
      toolName: "mneme.ask",
      argsTemplate: {},
      confidence: 0.86,
      source: "blended",
      priorConfidence: 0.7,
      posteriorConfidence: 0.9,
      sampleCount: 10,
    });
    expect(line).toContain("mneme.ask");
    expect(line).toContain("86%");
    expect(line).toContain("blended");
    expect(line).toContain("n=10");
  });
});
