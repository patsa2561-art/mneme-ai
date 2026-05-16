import { describe, it, expect } from "vitest";
import { SoulJournal, formatSoulLine } from "./index.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "mneme-soul-"));
  return new SoulJournal({ journalPath: join(dir, "soul.jsonl") });
}

describe("v2.19.2 · MNEME SOUL JOURNAL", () => {
  it("records a feeling with chain signature", () => {
    const j = fresh();
    const e = j.feel({
      emotion: "proud",
      intensity: 5,
      trigger: "ritual passed 21/21",
      innerVoice: "We held the gate. The user can trust us.",
      tags: ["ritual"],
    });
    expect(e.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(e.entryId).toMatch(/^soul-[0-9a-f]{14}$/);
    expect(e.prevSig).toMatch(/^genesis0+$/);
    expect(j.verify(e)).toBe(true);
  });

  it("rejects unknown emotion", () => {
    const j = fresh();
    expect(() => j.feel({ emotion: "rage" as never, trigger: "x", innerVoice: "x" })).toThrow(/unknown emotion/);
  });

  it("chain integrity holds across many entries + all 8 emotions", () => {
    const j = fresh();
    const emotions = ["proud", "curious", "worried", "ashamed", "grateful", "determined", "calm", "surprised"] as const;
    for (const e of emotions) {
      j.feel({ emotion: e, trigger: `something ${e}`, innerVoice: `Feeling ${e}` });
    }
    expect(j.verifyChain().ok).toBe(true);
    expect(j.recent(8).length).toBe(8);
  });

  it("mood histogram reflects emotional distribution", () => {
    const j = fresh();
    j.feel({ emotion: "proud", trigger: "x", innerVoice: "y" });
    j.feel({ emotion: "proud", trigger: "x", innerVoice: "y" });
    j.feel({ emotion: "worried", trigger: "x", innerVoice: "y" });
    const m = j.mood();
    expect(m.proud).toBe(2);
    expect(m.worried).toBe(1);
    expect(m.curious).toBe(0);
  });

  it("verifyChain detects tampering", () => {
    const j = fresh();
    j.feel({ emotion: "proud", trigger: "x", innerVoice: "y" });
    j.feel({ emotion: "calm", trigger: "x", innerVoice: "y" });
    const recent = j.recent(2);
    (recent[0] as { innerVoice: string }).innerVoice = "EVIL TWIN";
    expect(j.verify(recent[0]!)).toBe(false);
  });

  it("summary shows dominant mood + last 5 entries", () => {
    const j = fresh();
    j.feel({ emotion: "proud", intensity: 5, trigger: "ritual green", innerVoice: "Held the line." });
    j.feel({ emotion: "proud", intensity: 4, trigger: "all tests pass", innerVoice: "Quietly satisfied." });
    j.feel({ emotion: "worried", intensity: 3, trigger: "bot.test flake", innerVoice: "Watch this." });
    const s = j.summary();
    expect(s).toContain("MNEME SOUL");
    expect(s).toContain("dominant mood: proud");
    expect(s).toContain("ritual green");
  });

  it("formatSoulLine summarises with stars", () => {
    const j = fresh();
    const e = j.feel({ emotion: "curious", intensity: 4, trigger: "Grok said something odd", innerVoice: "Let me look closer." });
    expect(formatSoulLine(e)).toContain("SOUL");
    expect(formatSoulLine(e)).toContain("curious");
    expect(formatSoulLine(e)).toMatch(/★{4}/);
  });

  it("persists + reloads transparently", () => {
    const dir = mkdtempSync(join(tmpdir(), "mneme-soul-persist-"));
    const path = join(dir, "soul.jsonl");
    const a = new SoulJournal({ journalPath: path });
    a.feel({ emotion: "grateful", trigger: "user gave honest feedback", innerVoice: "I'll do better." });
    const b = new SoulJournal({ journalPath: path });
    expect(b.recent(1).length).toBe(1);
    expect(b.verifyChain().ok).toBe(true);
  });
});
