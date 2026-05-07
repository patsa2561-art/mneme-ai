import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkContract } from "./contract.js";
import { renderPyramid, singleSection } from "./pyramid.js";

beforeEach(() => {
  // Contract checks rely on ANSI bold being present, so we DO want colour on.
  delete process.env.NO_COLOR;
});
afterEach(() => {
  process.env.NO_COLOR = "1";
});

describe("checkContract — passes on a journalist-shaped output", () => {
  it("a renderPyramid output with headline + actionable hint passes", () => {
    const out = renderPyramid({
      headline: "📰 3 critical anomalies",
      sections: [
        singleSection("lede", "✦ Findings", ["Run mneme forensics --verbose for detail"]),
      ],
      whyShown: "Try forensics next",
      widthOverride: 80,
    });
    const r = checkContract(out);
    if (!r.ok) console.error(r.violations, JSON.stringify(out));
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
});

describe("checkContract — failure modes", () => {
  it("flags missing headline (plain text output)", () => {
    const r = checkContract("just a wall of plain text\nwith nothing fancy");
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("headline"))).toBe(true);
  });

  it("flags missing actionable hint", () => {
    // Build output WITH a headline but NO mneme/Try/Run hint.
    const out = "\x1b[1m\x1b[36m  📰 Headline only\x1b[0m\nfiller content\nmore filler\n";
    const r = checkContract(out);
    expect(r.violations.some((v) => v.includes("actionable hint"))).toBe(true);
  });

  it("flags lines wider than 200 chars", () => {
    const huge = "\x1b[1m\x1b[36m  📰 head\x1b[0m\n" + "x".repeat(220) + "\n run mneme forensics";
    const r = checkContract(huge);
    expect(r.violations.some((v) => v.includes("too wide"))).toBe(true);
  });

  it("flags excessively deep indentation", () => {
    const deeplyNested =
      "\x1b[1m\x1b[36m  📰 ok\x1b[0m\n" +
      "          deep content here\n" + // 10 spaces = depth 5
      "Try mneme ask";
    const r = checkContract(deeplyNested);
    expect(r.violations.some((v) => v.includes("nested too deep"))).toBe(true);
  });

  it("flags long output without 'Try next' marker", () => {
    const lines: string[] = ["\x1b[1m\x1b[36m  📰 ok\x1b[0m"];
    for (let i = 0; i < 35; i++) lines.push(`line ${i}`);
    lines.push("Run mneme ask");
    const r = checkContract(lines.join("\n"));
    expect(r.violations.some((v) => v.includes("Try next"))).toBe(true);
  });

  it("does not flag long output WITH 'Try next'", () => {
    const lines: string[] = ["\x1b[1m\x1b[36m  📰 ok\x1b[0m"];
    for (let i = 0; i < 35; i++) lines.push(`line ${i}`);
    lines.push("→ Try next: mneme ask");
    const r = checkContract(lines.join("\n"));
    expect(r.violations.some((v) => v.includes("Try next"))).toBe(false);
  });
});

describe("checkContract — return shape", () => {
  it("returns ok=true with empty violations on a perfect output", () => {
    const out = renderPyramid({
      headline: "📰 ok",
      sections: [singleSection("body", undefined, ["Run mneme ask now"])],
      widthOverride: 80,
    });
    const r = checkContract(out);
    expect(r).toHaveProperty("ok");
    expect(r).toHaveProperty("violations");
    expect(Array.isArray(r.violations)).toBe(true);
  });
});
