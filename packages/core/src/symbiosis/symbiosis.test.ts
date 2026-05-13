import { describe, it, expect } from "vitest";
import {
  voiceForVendor, renderVoiceDirective, voiceDistance,
  shapeIntent, shapeIntents,
  IntentLedger,
  fuseWithVendor, verifyFusion, formatFusionPulseLine,
  VOICE_CLAUDE, VOICE_GPT, VOICE_GEMINI, VOICE_CURSOR,
  type IntentShape,
} from "./index.js";

describe("v2.4 SYMBIOSIS · voice tuner", () => {
  it("voiceForVendor maps known vendors", () => {
    expect(voiceForVendor("Claude").vendor).toBe("claude");
    expect(voiceForVendor("Anthropic Claude").vendor).toBe("claude");
    expect(voiceForVendor("gpt-4").vendor).toBe("gpt");
    expect(voiceForVendor("ChatGPT").vendor).toBe("gpt");
    expect(voiceForVendor("Gemini Pro").vendor).toBe("gemini");
    expect(voiceForVendor("Cursor").vendor).toBe("cursor");
    expect(voiceForVendor("Codex").vendor).toBe("codex");
    expect(voiceForVendor("unknown-vendor").vendor).toBe("generic");
  });

  it("renderVoiceDirective produces a one-liner per profile", () => {
    const claude = renderVoiceDirective(VOICE_CLAUDE);
    const cursor = renderVoiceDirective(VOICE_CURSOR);
    expect(claude).toContain("claude");
    expect(cursor).toContain("cursor");
    // Cursor is terse-coded → directive should say so
    expect(cursor).toMatch(/terse|concise/);
    expect(cursor).toMatch(/code-first|code only/);
  });

  it("voiceDistance: same profile is 0", () => {
    expect(voiceDistance(VOICE_CLAUDE, VOICE_CLAUDE)).toBe(0);
  });

  it("voiceDistance: Cursor vs Gemini is larger than Cursor vs Codex", () => {
    const farther = voiceDistance(VOICE_CURSOR, VOICE_GEMINI);
    const closer  = voiceDistance(VOICE_CURSOR, voiceForVendor("codex"));
    expect(closer).toBeLessThan(farther);
  });
});

describe("v2.4 SYMBIOSIS · intent shaper", () => {
  const intent: IntentShape = {
    tool: "mneme.flash.run",
    reason: "verify the factual claim before stating it",
    args: { veff_min: "0.5" },
  };

  it("Claude shape: imperative natural-language", () => {
    const out = shapeIntent(intent, VOICE_CLAUDE);
    expect(out).toContain("mneme.flash.run");
    expect(out.toLowerCase()).toContain("call");
  });

  it("GPT shape: JSON-encoded", () => {
    const out = shapeIntent(intent, VOICE_GPT);
    const parsed = JSON.parse(out);
    expect(parsed.tool).toBe("mneme.flash.run");
    expect(parsed.args).toEqual({ veff_min: "0.5" });
  });

  it("Gemini shape: structured list with headers", () => {
    const out = shapeIntent(intent, VOICE_GEMINI);
    expect(out).toContain("### Tool: mneme.flash.run");
    expect(out).toContain("- veff_min: 0.5");
  });

  it("Cursor shape: backtick-wrapped command", () => {
    const out = shapeIntent(intent, VOICE_CURSOR);
    expect(out).toContain("`mneme.flash.run");
    expect(out).toContain("//");
  });

  it("shapeIntents bulk-applies same voice", () => {
    const out = shapeIntents([intent, intent], VOICE_GPT);
    expect(out.length).toBe(2);
    expect(out.every((s) => JSON.parse(s).tool === "mneme.flash.run")).toBe(true);
  });
});

describe("v2.4 SYMBIOSIS · ledger", () => {
  it("records trials + aggregates per (vendor, tool)", () => {
    const led = new IntentLedger();
    led.record({ vendor: "claude", tool: "mneme.flash.run", shape: "x", outcome: "succeeded", ts: 1 });
    led.record({ vendor: "claude", tool: "mneme.flash.run", shape: "x", outcome: "succeeded", ts: 2 });
    led.record({ vendor: "claude", tool: "mneme.flash.run", shape: "x", outcome: "wrong-tool", ts: 3 });
    const s = led.stats();
    expect(s.length).toBe(1);
    expect(s[0]!.trials).toBe(3);
    expect(s[0]!.succeeded).toBe(2);
    expect(s[0]!.rate).toBeCloseTo(0.6667, 3);
    expect(s[0]!.wilson).toBeGreaterThan(0);
    expect(s[0]!.wilson).toBeLessThan(s[0]!.rate); // Wilson LB is conservative
  });

  it("recommendTools per vendor: high-Wilson tools rank first", () => {
    const led = new IntentLedger();
    for (let i = 0; i < 10; i++) led.record({ vendor: "claude", tool: "mneme.flash.run", shape: "x", outcome: "succeeded", ts: i });
    for (let i = 0; i < 5; i++)  led.record({ vendor: "claude", tool: "mneme.memory.ask", shape: "y", outcome: "succeeded", ts: 100 + i });
    for (let i = 0; i < 5; i++)  led.record({ vendor: "claude", tool: "mneme.memory.ask", shape: "y", outcome: "no-call",    ts: 200 + i });
    const rec = led.recommendTools("claude", 5);
    expect(rec[0]!.tool).toBe("mneme.flash.run");
  });

  it("shapingLift identifies tools that benefit most from per-vendor shaping", () => {
    const led = new IntentLedger();
    for (let i = 0; i < 10; i++) led.record({ vendor: "claude", tool: "mneme.flash.run", shape: "x", outcome: "succeeded", ts: i });
    for (let i = 0; i < 10; i++) led.record({ vendor: "gpt",    tool: "mneme.flash.run", shape: "y", outcome: "no-call",    ts: i });
    const lift = led.shapingLift();
    expect(lift.length).toBe(1);
    expect(lift[0]!.tool).toBe("mneme.flash.run");
    expect(lift[0]!.bestVendor).toBe("claude");
    expect(lift[0]!.worstVendor).toBe("gpt");
    expect(lift[0]!.lift).toBeGreaterThan(0.5);
  });

  it("serialize / parse round-trips", () => {
    const led = new IntentLedger();
    led.record({ vendor: "claude", tool: "mneme.flash.run", shape: "x", outcome: "succeeded", ts: 1 });
    const text = led.serialize();
    const led2 = IntentLedger.parse(text);
    expect(led2.list().length).toBe(1);
    expect(led2.list()[0]!.tool).toBe("mneme.flash.run");
  });

  it("parse handles garbage gracefully", () => {
    expect(IntentLedger.parse("not json").list().length).toBe(0);
    expect(IntentLedger.parse('{"not":"array"}').list().length).toBe(0);
  });
});

describe("v2.4 SYMBIOSIS · fusion bundle", () => {
  const intents: IntentShape[] = [
    { tool: "mneme.flash.run", reason: "verify the factual claim" },
    { tool: "mneme.memory.ask", reason: "look up prior context" },
  ];

  it("fuseWithVendor produces a stable digest for the same input", () => {
    const a = fuseWithVendor({ vendor: "claude", intents });
    const b = fuseWithVendor({ vendor: "claude", intents });
    expect(a.digest).toBe(b.digest);
    expect(a.rendered).toBe(b.rendered);
  });

  it("different vendors → different rendered bytes", () => {
    const a = fuseWithVendor({ vendor: "claude", intents });
    const b = fuseWithVendor({ vendor: "gpt", intents });
    expect(a.digest).not.toBe(b.digest);
    expect(a.voice.vendor).toBe("claude");
    expect(b.voice.vendor).toBe("gpt");
  });

  it("anthropic vendor → bundle contains no MUTINY/SEPPUKU/killswitch raw bytes", () => {
    const intentsWithRisk: IntentShape[] = [
      { tool: "mneme.mutiny.check", reason: "block requests matching MUTINY pattern" },
    ];
    const b = fuseWithVendor({ vendor: "claude", intents: intentsWithRisk });
    expect(b.rendered).not.toMatch(/MUTINY/);
    // The fused output uses the COMPLIANCE-GATE alias from PROFILE_ANTHROPIC.
    expect(b.rendered).toMatch(/COMPLIANCE-GATE|compliance_gate/);
  });

  it("verifyFusion detects untampered bundles", () => {
    const b = fuseWithVendor({ vendor: "claude", intents });
    expect(verifyFusion(b, { vendor: "claude", intents })).toBe(true);
  });

  it("formatFusionPulseLine emits a one-line summary with sha prefix", () => {
    const b = fuseWithVendor({ vendor: "claude", intents });
    const line = formatFusionPulseLine(b);
    expect(line).toContain("SYMBIOSIS");
    expect(line).toContain("vendor=claude");
    expect(line).toContain("sha256=");
  });
});
