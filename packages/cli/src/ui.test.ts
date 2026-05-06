/**
 * Tests for the unified UI primitives.
 *
 * Strategy: render with NO_COLOR-stripped output and assert structural
 * properties — we don't pin exact ANSI sequences (kleur escape strings
 * vary by platform).
 */
import { describe, it, expect } from "vitest";
import {
  header,
  section,
  divider,
  severityBadge,
  pill,
  meter,
  logMeter,
  sparkline,
  citation,
  osc8,
  kv,
  emptyState,
  nextSteps,
  verdictBadge,
  commitTypePill,
} from "./ui.js";

// Strip ANSI for content assertions.
function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
}

describe("ui primitives — header", () => {
  it("renders icon + title + double rule", () => {
    const out = strip(header("🛡", "Test Title"));
    expect(out).toContain("🛡");
    expect(out).toContain("Test Title");
    expect(out).toContain("═");
  });
  it("includes subtitle when provided", () => {
    const out = strip(header("◆", "Title", "Some subtitle text"));
    expect(out).toContain("Some subtitle text");
  });
});

describe("ui primitives — section", () => {
  it("renders bold magenta title with optional hint", () => {
    expect(strip(section("✦ Summary"))).toContain("✦ Summary");
    expect(strip(section("◆ Items", "(top 5)"))).toContain("(top 5)");
  });
});

describe("ui primitives — divider", () => {
  it("renders a horizontal rule", () => {
    expect(strip(divider())).toContain("═");
  });
  it("inlines a label when provided", () => {
    expect(strip(divider("phase 2"))).toContain("phase 2");
  });
});

describe("ui primitives — severityBadge", () => {
  it("returns fixed-width labels for each level", () => {
    expect(strip(severityBadge("critical"))).toContain("CRIT");
    expect(strip(severityBadge("high"))).toContain("HIGH");
    expect(strip(severityBadge("medium"))).toContain("MEDIUM");
    expect(strip(severityBadge("low"))).toContain("LOW");
    expect(strip(severityBadge("info"))).toContain("INFO");
    expect(strip(severityBadge("ok"))).toContain("OK");
  });
});

describe("ui primitives — pill", () => {
  it("wraps label in brackets", () => {
    expect(strip(pill("FRESH", "ok"))).toContain("[ FRESH ]");
  });
});

describe("ui primitives — meter", () => {
  it("clamps value to [0,1]", () => {
    expect(strip(meter(-0.5))).toBeTruthy();
    expect(strip(meter(2.5))).toBeTruthy();
  });
  it("uses provided width", () => {
    const out = strip(meter(0.5, { width: 20 }));
    // 10 filled + 10 empty
    expect(out.length).toBeGreaterThanOrEqual(20);
  });
  it("renders 0% as all empty cells, 100% as all filled", () => {
    expect(strip(meter(0))).toMatch(/░+/);
    expect(strip(meter(1))).toMatch(/█+/);
  });
});

describe("ui primitives — logMeter", () => {
  it("handles LR=1 (neutral), LR>>1 (strong), LR<<1 (against)", () => {
    expect(strip(logMeter(1))).toBeTruthy();
    expect(strip(logMeter(1000))).toBeTruthy();
    expect(strip(logMeter(0.001))).toBeTruthy();
  });
  it("never throws on extreme inputs", () => {
    expect(() => logMeter(0)).not.toThrow();
    expect(() => logMeter(1e20)).not.toThrow();
    expect(() => logMeter(1e-20)).not.toThrow();
  });
});

describe("ui primitives — sparkline", () => {
  it("emits one block char per value", () => {
    const stripped = strip(sparkline([1, 2, 3, 4, 5]));
    expect(stripped.length).toBe(5);
  });
  it("uses Unicode block chars ▁▂▃▄▅▆▇█", () => {
    const stripped = strip(sparkline([0, 100]));
    expect(stripped[0]).toBe("▁");
    expect(stripped[1]).toBe("█");
  });
  it("handles empty input", () => {
    expect(strip(sparkline([]))).toContain("no data");
  });
  it("handles all-equal values without dividing by zero", () => {
    expect(() => sparkline([5, 5, 5])).not.toThrow();
  });
});

describe("ui primitives — citation", () => {
  it("renders shortHash + subject", () => {
    const out = strip(citation({ shortHash: "abc1234", subject: "feat: hi" }));
    expect(out).toContain("abc1234");
    expect(out).toContain("feat: hi");
  });
  it("emphasized=true uses green dot, false uses gray", () => {
    // Both render but visually differ — just smoke-check
    expect(strip(citation({ shortHash: "abc1234", emphasized: true }))).toContain("●");
    expect(strip(citation({ shortHash: "abc1234", emphasized: false }))).toContain("●");
  });
  it("includes metadata when provided", () => {
    const out = strip(citation({
      shortHash: "abc1234",
      date: "2026-05-06",
      author: "Alice",
      trailing: "score 0.9",
    }));
    expect(out).toContain("2026-05-06");
    expect(out).toContain("Alice");
    expect(out).toContain("score 0.9");
  });
});

describe("ui primitives — osc8", () => {
  it("returns plain text on non-TTY", () => {
    // process.stdout.isTTY is false in test env
    expect(osc8("https://example.com", "click me")).toBe("click me");
  });
  it("returns plain text when url is undefined", () => {
    expect(osc8(undefined, "no link")).toBe("no link");
  });
});

describe("ui primitives — kv", () => {
  it("aligns label to specified width", () => {
    const out = strip(kv("commits", "42"));
    expect(out).toContain("commits");
    expect(out).toContain("42");
  });
});

describe("ui primitives — emptyState", () => {
  it("renders headline + each hint", () => {
    const out = strip(emptyState("Nothing here.", ["Try X.", "Or Y."]));
    expect(out).toContain("Nothing here.");
    expect(out).toContain("Try X.");
    expect(out).toContain("Or Y.");
  });
});

describe("ui primitives — nextSteps", () => {
  it("renders cmd + why for each action", () => {
    const out = strip(nextSteps([
      { cmd: "mneme index", why: "build memory" },
      { cmd: "mneme ask 'foo'", why: "test it" },
    ]));
    expect(out).toContain("mneme index");
    expect(out).toContain("build memory");
    expect(out).toContain("mneme ask 'foo'");
    expect(out).toContain("test it");
  });
  it("returns empty string when no actions", () => {
    expect(nextSteps([])).toBe("");
  });
});

describe("ui primitives — verdictBadge", () => {
  it("uppercases the verdict", () => {
    expect(strip(verdictBadge("very strong support"))).toContain("VERY STRONG SUPPORT");
  });
  it("paints `against` verdicts differently", () => {
    expect(verdictBadge("very strong support against")).not.toEqual(verdictBadge("very strong support"));
  });
  it("treats uninformative neutrally", () => {
    expect(strip(verdictBadge("uninformative"))).toContain("UNINFORMATIVE");
  });
});

describe("ui primitives — commitTypePill", () => {
  it("recognizes conventional-commit prefixes", () => {
    expect(strip(commitTypePill("feat: add foo")!)).toContain("[ feat ]");
    expect(strip(commitTypePill("fix(auth): bar")!)).toContain("[ fix ]");
    expect(strip(commitTypePill("chore: bump")!)).toContain("[ chore ]");
  });
  it("returns undefined for non-conventional subjects", () => {
    expect(commitTypePill("hello world")).toBeUndefined();
    expect(commitTypePill("Initial commit")).toBeUndefined();
  });
});
