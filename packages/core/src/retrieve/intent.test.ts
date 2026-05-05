import { describe, it, expect } from "vitest";
import { classifyIntent } from "./intent.js";

describe("classifyIntent — vague queries (the regression we are fixing)", () => {
  it('classifies "how to improve my code" as vague', () => {
    const r = classifyIntent("how to improve my code");
    expect(r.intent).toBe("vague");
    expect(r.redirect).toBeDefined();
    expect(r.redirect).toContain("specific");
  });

  it('classifies "best practice for X" as vague when X is generic', () => {
    expect(classifyIntent("best practice for naming things").intent).toBe("vague");
    expect(classifyIntent("what is a good way to write tests").intent).toBe("vague");
  });

  it('classifies "should I X" as vague (opinion request)', () => {
    expect(classifyIntent("should I refactor this module").intent).toBe("vague");
  });

  it("classifies greetings and smoke tests as vague", () => {
    expect(classifyIntent("hello").intent).toBe("vague");
    expect(classifyIntent("test").intent).toBe("vague");
    expect(classifyIntent("help").intent).toBe("vague");
  });

  it("classifies empty string as vague", () => {
    expect(classifyIntent("").intent).toBe("vague");
    expect(classifyIntent("    ").intent).toBe("vague");
  });

  it("vague results include a redirect message that mentions specific question forms", () => {
    const r = classifyIntent("how to write good code");
    expect(r.redirect).toMatch(/why does/);
    expect(r.redirect).toMatch(/when did/);
    expect(r.redirect).toMatch(/who wrote/);
  });
});

describe("classifyIntent — specific (the happy path)", () => {
  it('classifies "why does X exist?" as specific', () => {
    expect(classifyIntent("why does parseAmount use try/catch?").intent).toBe("specific");
  });

  it('classifies "what does X do?" as specific', () => {
    expect(classifyIntent("what does the OrderQueue worker do?").intent).toBe("specific");
  });

  it('classifies "how does X work?" as specific (behavior question)', () => {
    expect(classifyIntent("how does the auth middleware work?").intent).toBe("specific");
  });

  it("classifies short keyword queries as specific", () => {
    expect(classifyIntent("stripe webhook bigint").intent).toBe("specific");
    expect(classifyIntent("auth jwt").intent).toBe("specific");
  });
});

describe("classifyIntent — lookup (author / hash / PR queries)", () => {
  it('classifies "who wrote X" as lookup', () => {
    expect(classifyIntent("who wrote the OrderQueue worker?").intent).toBe("lookup");
    expect(classifyIntent("who created src/payment.ts").intent).toBe("lookup");
  });

  it("classifies PR-number references as lookup", () => {
    expect(classifyIntent("PR #482").intent).toBe("lookup");
    expect(classifyIntent("explain pr #1234").intent).toBe("lookup");
  });

  it("classifies commit-hash references as lookup", () => {
    expect(classifyIntent("a1b2c3d4 what did this do").intent).toBe("lookup");
    expect(classifyIntent("abcdef1 changes").intent).toBe("lookup");
  });
});

describe("classifyIntent — temporal (timeline / date queries)", () => {
  it('classifies "when did X" as temporal', () => {
    expect(classifyIntent("when did we change the auth middleware?").intent).toBe("temporal");
  });

  it('classifies relative-time queries as temporal', () => {
    expect(classifyIntent("what changed last week").intent).toBe("temporal");
    expect(classifyIntent("commits from last month on payment").intent).toBe("temporal");
  });

  it('classifies absolute YYYY-MM dates as temporal', () => {
    expect(classifyIntent("auth changes in 2024-09").intent).toBe("temporal");
  });

  it("classifies superlative-time queries as temporal", () => {
    expect(classifyIntent("latest commit on stripe").intent).toBe("temporal");
    expect(classifyIntent("first time we used JWT").intent).toBe("temporal");
  });
});

describe("classifyIntent — concrete-hint override (vague pattern + concrete identifier)", () => {
  it('"how to refactor src/payment.ts" is specific despite "how to" (has file path)', () => {
    expect(classifyIntent("how to refactor src/payment.ts").intent).toBe("specific");
  });

  it("'best way to call PaymentService' is specific (CamelCase identifier)", () => {
    expect(classifyIntent("best way to call PaymentService").intent).toBe("specific");
  });

  it("'how to use PR #482' is lookup (PR reference takes priority)", () => {
    expect(classifyIntent("how to use PR #482").intent).toBe("lookup");
  });
});

describe("classifyIntent — every result has a non-empty reason for transparency", () => {
  it("returns a reason string for every intent class", () => {
    const samples = [
      "how to improve",
      "why does X exist",
      "who wrote Y",
      "when did Z change",
      "stripe bigint webhook",
      "",
    ];
    for (const q of samples) {
      const r = classifyIntent(q);
      expect(typeof r.reason).toBe("string");
      expect(r.reason.length).toBeGreaterThan(5);
    }
  });
});
