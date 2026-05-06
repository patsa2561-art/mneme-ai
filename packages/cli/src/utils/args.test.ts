/**
 * Tests for arg validators that turn user mistakes into clear errors.
 * Every test here represents a real user trip that we caught in v0.19.2.
 */
import { describe, it, expect } from "vitest";
import { parseIntStrict, parseFloatStrict, parseSinceDate, commitNotFoundMessage } from "./args.js";

describe("parseIntStrict — strict positive int parser", () => {
  it("accepts a positive integer", () => {
    expect(parseIntStrict("--top")("5")).toBe(5);
    expect(parseIntStrict("--top")("100")).toBe(100);
  });

  it("rejects NaN / non-numeric strings (no more 'fatal: NaN' git leak)", () => {
    expect(() => parseIntStrict("--top")("abc")).toThrow(/positive integer/);
    expect(() => parseIntStrict("--top")("")).toThrow(/positive integer/);
    expect(() => parseIntStrict("--top")("3.14")).toThrow(/positive integer/);
  });

  it("rejects negatives and zero by default (min=1)", () => {
    expect(() => parseIntStrict("--top")("-5")).toThrow(/positive integer/);
    expect(() => parseIntStrict("--top")("0")).toThrow(/positive integer/);
  });

  it("respects custom min", () => {
    expect(parseIntStrict("--n", 0)("0")).toBe(0);
    expect(() => parseIntStrict("--n", 0)("-1")).toThrow();
  });
});

describe("parseFloatStrict — strict non-negative float parser", () => {
  it("accepts floats including 0", () => {
    expect(parseFloatStrict("--threshold")("0")).toBe(0);
    expect(parseFloatStrict("--threshold")("1.5")).toBe(1.5);
    expect(parseFloatStrict("--threshold")("0.001")).toBe(0.001);
  });

  it("rejects non-numeric and negatives", () => {
    expect(() => parseFloatStrict("--threshold")("abc")).toThrow(/number/);
    expect(() => parseFloatStrict("--threshold")("-1")).toThrow(/number/);
    expect(() => parseFloatStrict("--threshold")("Infinity")).toThrow();
  });
});

describe("parseSinceDate — accepts the formats git accepts, rejects garbage", () => {
  it("accepts ISO dates", () => {
    expect(parseSinceDate("2024-01-01")).toBe("2024-01-01");
  });

  it("accepts git-style relative dates", () => {
    expect(parseSinceDate("7d")).toBe("7d");
    expect(parseSinceDate("2.weeks.ago")).toBe("2.weeks.ago");
    expect(parseSinceDate("3.months")).toBe("3.months");
  });

  it("accepts named relatives", () => {
    expect(parseSinceDate("yesterday")).toBe("yesterday");
    expect(parseSinceDate("last week")).toBe("last week");
  });

  it("rejects empty / pure garbage", () => {
    expect(() => parseSinceDate("")).toThrow(/cannot be empty/);
    expect(() => parseSinceDate("notadate")).toThrow(/not a date/);
    expect(() => parseSinceDate("xyz")).toThrow(/not a date/);
  });
});

describe("commitNotFoundMessage — actionable error template", () => {
  it("includes the commit ref + 3 concrete remedies", () => {
    const msg = commitNotFoundMessage("deadbeef");
    expect(msg).toContain("deadbeef");
    expect(msg).toContain("git log --oneline");
    expect(msg).toContain("mneme index");
    expect(msg).toContain("mneme forensics attribute HEAD");
  });
});
