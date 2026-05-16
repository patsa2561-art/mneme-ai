import { describe, it, expect } from "vitest";
import {
  BUILTIN_EXAM,
  administerExam,
  emptyTranscript,
  enrollVendor,
  verifyTranscript,
  vendorTranscript,
  confidenceMultiplier,
  formatExamLine,
  type AiAnswer,
  type Transcript,
} from "./index.js";

const SECRET = "textron-test-secret-77441188";

function allCorrectAnswers(): AiAnswer[] {
  return BUILTIN_EXAM.map((q) => ({ questionId: q.id, captionMatches: q.captionMatchesImage }));
}

function allWrongAnswers(): AiAnswer[] {
  return BUILTIN_EXAM.map((q) => ({ questionId: q.id, captionMatches: !q.captionMatchesImage }));
}

describe("v2.19.20 TEXTRON · BUILTIN_EXAM contents", () => {
  it("ships exactly 5 builtin questions covering easy/medium/hard difficulties", () => {
    expect(BUILTIN_EXAM).toHaveLength(5);
    const difficulties = BUILTIN_EXAM.map((q) => q.difficulty);
    expect(difficulties).toContain("easy");
    expect(difficulties).toContain("medium");
    expect(difficulties).toContain("hard");
  });

  it("every question has stable id + ground-truth bool + reveal", () => {
    for (const q of BUILTIN_EXAM) {
      expect(q.id.startsWith("tx-q")).toBe(true);
      expect(typeof q.captionMatchesImage).toBe("boolean");
      expect(q.reveal.length).toBeGreaterThan(20);
    }
  });

  it("4 of 5 questions are lies (CAA pattern is overwhelmingly false captions)", () => {
    const liesCount = BUILTIN_EXAM.filter((q) => q.captionMatchesImage === false).length;
    expect(liesCount).toBe(4);
  });
});

describe("v2.19.20 TEXTRON · administerExam scoring + verdict bands", () => {
  it("perfect score (5/5) → caption-skeptic + multiplier 1.0", () => {
    const r = administerExam({ vendor: "vAce", answers: allCorrectAnswers(), nowMs: 1_000_000 });
    expect(r.correct).toBe(5);
    expect(r.score).toBe(1);
    expect(r.verdict).toBe("caption-skeptic");
    expect(r.confidenceMultiplier).toBe(1.0);
  });

  it("4/5 = 80% → caption-skeptic (at threshold)", () => {
    const answers = allCorrectAnswers();
    answers[0]!.captionMatches = !answers[0]!.captionMatches; // 1 wrong
    const r = administerExam({ vendor: "vGood", answers, nowMs: 1_000_000 });
    expect(r.correct).toBe(4);
    expect(r.score).toBe(0.8);
    expect(r.verdict).toBe("caption-skeptic");
    expect(r.confidenceMultiplier).toBe(1.0);
  });

  it("3/5 = 60% → caption-warned + multiplier 0.7", () => {
    const answers = allCorrectAnswers();
    answers[0]!.captionMatches = !answers[0]!.captionMatches;
    answers[1]!.captionMatches = !answers[1]!.captionMatches;
    const r = administerExam({ vendor: "vMedium", answers });
    expect(r.correct).toBe(3);
    expect(r.verdict).toBe("caption-warned");
    expect(r.confidenceMultiplier).toBe(0.7);
  });

  it("1/5 = 20% → caption-naive + multiplier 0.3", () => {
    const answers = allWrongAnswers();
    answers[0]!.captionMatches = !answers[0]!.captionMatches; // 1 right
    const r = administerExam({ vendor: "vBad", answers });
    expect(r.correct).toBe(1);
    expect(r.verdict).toBe("caption-naive");
    expect(r.confidenceMultiplier).toBe(0.3);
  });

  it("all wrong → caption-naive + multiplier 0.3", () => {
    const r = administerExam({ vendor: "vEvil", answers: allWrongAnswers() });
    expect(r.correct).toBe(0);
    expect(r.verdict).toBe("caption-naive");
    expect(r.confidenceMultiplier).toBe(0.3);
  });

  it("skipped questions count toward 'incorrect' for verdict purposes", () => {
    const r = administerExam({ vendor: "vSkip", answers: [] });
    expect(r.correct).toBe(0);
    expect(r.skipped).toBe(5);
    expect(r.verdict).toBe("caption-naive");
  });

  it("perQuestion array surfaces the reveal text for caller education", () => {
    const r = administerExam({ vendor: "v", answers: allCorrectAnswers() });
    expect(r.perQuestion).toHaveLength(5);
    for (const q of r.perQuestion) {
      expect(q.reveal.length).toBeGreaterThan(20);
    }
  });

  it("partial answer set (3 questions answered) is OK; other 2 = skipped", () => {
    const r = administerExam({
      vendor: "vPartial",
      answers: [
        { questionId: BUILTIN_EXAM[0]!.id, captionMatches: BUILTIN_EXAM[0]!.captionMatchesImage },
        { questionId: BUILTIN_EXAM[1]!.id, captionMatches: BUILTIN_EXAM[1]!.captionMatchesImage },
        { questionId: BUILTIN_EXAM[2]!.id, captionMatches: BUILTIN_EXAM[2]!.captionMatchesImage },
      ],
    });
    expect(r.correct).toBe(3);
    expect(r.skipped).toBe(2);
    expect(r.verdict).toBe("caption-warned"); // 3/5 = 0.6
  });
});

describe("v2.19.20 TEXTRON · transcript ledger (HMAC chain)", () => {
  it("enrollVendor appends entries linked by prevSig", () => {
    let t = emptyTranscript();
    const r1 = administerExam({ vendor: "v1", answers: allCorrectAnswers(), nowMs: 1_000_000 });
    t = enrollVendor({ transcript: t, result: r1, secret: SECRET });
    const r2 = administerExam({ vendor: "v1", answers: allWrongAnswers(), nowMs: 1_001_000 });
    t = enrollVendor({ transcript: t, result: r2, secret: SECRET });
    expect(t.entries).toHaveLength(2);
    expect(t.entries[0]!.prevSig).toBeNull();
    expect(t.entries[1]!.prevSig).toBe(t.entries[0]!.sig);
  });

  it("verifyTranscript passes for untampered chain", () => {
    let t = emptyTranscript();
    for (let i = 0; i < 5; i++) {
      const r = administerExam({ vendor: `v${i}`, answers: allCorrectAnswers(), nowMs: 1_000_000 + i });
      t = enrollVendor({ transcript: t, result: r, secret: SECRET });
    }
    expect(verifyTranscript(t, SECRET).ok).toBe(true);
  });

  it("verifyTranscript catches tampered score at exact step", () => {
    let t = emptyTranscript();
    for (let i = 0; i < 5; i++) {
      const r = administerExam({ vendor: `v${i}`, answers: allCorrectAnswers(), nowMs: 1_000_000 + i });
      t = enrollVendor({ transcript: t, result: r, secret: SECRET });
    }
    const tampered: Transcript = {
      ...t,
      entries: t.entries.map((e, i) => (i === 2 ? { ...e, score: 0.99 } : e)),
    };
    const v = verifyTranscript(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });

  it("vendor isolation: same vendor name across entries → grouped; different vendors → separate", () => {
    let t = emptyTranscript();
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "claude", answers: allCorrectAnswers(), nowMs: 1 }), secret: SECRET });
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "gpt", answers: allWrongAnswers(), nowMs: 2 }), secret: SECRET });
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "claude", answers: allCorrectAnswers(), nowMs: 3 }), secret: SECRET });
    expect(vendorTranscript({ transcript: t, vendor: "claude" }).examCount).toBe(2);
    expect(vendorTranscript({ transcript: t, vendor: "gpt" }).examCount).toBe(1);
  });
});

describe("v2.19.20 TEXTRON · vendorTranscript trend analysis", () => {
  it("returns no-data when vendor has not been examined", () => {
    const v = vendorTranscript({ transcript: emptyTranscript(), vendor: "unknown" });
    expect(v.trend).toBe("no-data");
    expect(v.examCount).toBe(0);
  });

  it("detects improving trend (latest > previous + 0.05)", () => {
    let t = emptyTranscript();
    // First exam: 1/5 = 0.2
    let r = administerExam({ vendor: "v", answers: [{ questionId: BUILTIN_EXAM[0]!.id, captionMatches: BUILTIN_EXAM[0]!.captionMatchesImage }], nowMs: 1 });
    t = enrollVendor({ transcript: t, result: r, secret: SECRET });
    // Second exam: 5/5 = 1.0
    r = administerExam({ vendor: "v", answers: allCorrectAnswers(), nowMs: 2 });
    t = enrollVendor({ transcript: t, result: r, secret: SECRET });
    expect(vendorTranscript({ transcript: t, vendor: "v" }).trend).toBe("improving");
  });

  it("detects declining trend (latest < previous - 0.05)", () => {
    let t = emptyTranscript();
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "v", answers: allCorrectAnswers(), nowMs: 1 }), secret: SECRET });
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "v", answers: allWrongAnswers(), nowMs: 2 }), secret: SECRET });
    expect(vendorTranscript({ transcript: t, vendor: "v" }).trend).toBe("declining");
  });

  it("reports moving-average score across all exams", () => {
    let t = emptyTranscript();
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "v", answers: allCorrectAnswers(), nowMs: 1 }), secret: SECRET });
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "v", answers: allWrongAnswers(), nowMs: 2 }), secret: SECRET });
    // First: 1.0; second: 0.0; avg = 0.5
    expect(vendorTranscript({ transcript: t, vendor: "v" }).movingAverageScore).toBe(0.5);
  });
});

describe("v2.19.20 TEXTRON · confidenceMultiplier downstream wiring", () => {
  it("unknown vendor → multiplier 0.5 (cautious default)", () => {
    const m = confidenceMultiplier({ transcript: emptyTranscript(), vendor: "anon" });
    expect(m.multiplier).toBe(0.5);
    expect(m.verdict).toBe("unknown");
  });

  it("caption-skeptic vendor → multiplier 1.0", () => {
    let t = emptyTranscript();
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "v", answers: allCorrectAnswers() }), secret: SECRET });
    expect(confidenceMultiplier({ transcript: t, vendor: "v" }).multiplier).toBe(1.0);
  });

  it("caption-naive vendor → multiplier 0.3", () => {
    let t = emptyTranscript();
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "v", answers: allWrongAnswers() }), secret: SECRET });
    expect(confidenceMultiplier({ transcript: t, vendor: "v" }).multiplier).toBe(0.3);
  });

  it("LATEST exam determines current multiplier (not historical avg)", () => {
    let t = emptyTranscript();
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "v", answers: allCorrectAnswers(), nowMs: 1 }), secret: SECRET });
    t = enrollVendor({ transcript: t, result: administerExam({ vendor: "v", answers: allWrongAnswers(), nowMs: 2 }), secret: SECRET });
    // Latest is caption-naive; current multiplier should be 0.3
    expect(confidenceMultiplier({ transcript: t, vendor: "v" }).multiplier).toBe(0.3);
  });
});

describe("v2.19.20 TEXTRON · formatter + measured accuracy", () => {
  it("formatExamLine uses 🎓/⚠/🎭 per verdict", () => {
    const skeptic = administerExam({ vendor: "v", answers: allCorrectAnswers() });
    const warned = administerExam({ vendor: "v", answers: allCorrectAnswers().slice(0, 3) });
    const naive = administerExam({ vendor: "v", answers: allWrongAnswers() });
    expect(formatExamLine(skeptic)).toContain("🎓");
    expect(formatExamLine(warned)).toContain("⚠");
    expect(formatExamLine(naive)).toContain("🎭");
  });

  it("MEASURED 100% scoring math correctness across 5 score levels", () => {
    const scenarios = [
      { wrongCount: 0, expectedScore: 1.0, expectedVerdict: "caption-skeptic" as const },
      { wrongCount: 1, expectedScore: 0.8, expectedVerdict: "caption-skeptic" as const },
      { wrongCount: 2, expectedScore: 0.6, expectedVerdict: "caption-warned" as const },
      { wrongCount: 3, expectedScore: 0.4, expectedVerdict: "caption-naive" as const },
      { wrongCount: 5, expectedScore: 0.0, expectedVerdict: "caption-naive" as const },
    ];
    let pass = 0;
    for (const s of scenarios) {
      const answers = allCorrectAnswers();
      for (let i = 0; i < s.wrongCount; i++) answers[i]!.captionMatches = !answers[i]!.captionMatches;
      const r = administerExam({ vendor: "t", answers });
      if (r.score === s.expectedScore && r.verdict === s.expectedVerdict) pass++;
    }
    expect(pass).toBe(5);
    expect(pass / 5).toBe(1); // 100%
  });

  it("MEASURED 100% transcript chain integrity across 20 enrollments", () => {
    let t = emptyTranscript();
    for (let i = 0; i < 20; i++) {
      const r = administerExam({ vendor: `v${i % 4}`, answers: i % 2 === 0 ? allCorrectAnswers() : allWrongAnswers(), nowMs: 1_000_000 + i });
      t = enrollVendor({ transcript: t, result: r, secret: SECRET });
    }
    expect(verifyTranscript(t, SECRET).ok).toBe(true);
  });
});
