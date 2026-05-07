import { describe, expect, it } from "vitest";
import { parseLog } from "./scan.js";
import { matchOpenDebts, debtWeight, buildReport } from "./score.js";

describe("karma — parseLog", () => {
  it("extracts TODO additions from a unified diff", () => {
    const raw =
      "--MNEME-COMMIT--\n" +
      "abc1234567\n" +
      "alice@example.com\n" +
      "Alice\n" +
      "1700000000\n" +
      "diff --git a/src/foo.ts b/src/foo.ts\n" +
      "index 1..2 100644\n" +
      "--- a/src/foo.ts\n" +
      "+++ b/src/foo.ts\n" +
      "@@ -1,1 +1,2 @@\n" +
      " const x = 1;\n" +
      "+// TODO: refactor this\n";
    const events = parseLog(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      email: "alice@example.com",
      type: "incurred",
      filePath: "src/foo.ts",
      marker: "TODO",
    });
    expect(events[0]!.content).toContain("refactor");
  });

  it("extracts TODO removals as settlements", () => {
    const raw =
      "--MNEME-COMMIT--\n" +
      "def4567890\n" +
      "bob@example.com\n" +
      "Bob\n" +
      "1700000100\n" +
      "diff --git a/src/foo.ts b/src/foo.ts\n" +
      "index 2..3 100644\n" +
      "--- a/src/foo.ts\n" +
      "+++ b/src/foo.ts\n" +
      "@@ -1,2 +1,1 @@\n" +
      "-// TODO: refactor this\n" +
      " const x = 1;\n";
    const events = parseLog(raw);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("settled");
    expect(events[0]!.email).toBe("bob@example.com");
  });

  it("ignores diff metadata lines (index, +++, ---, @@)", () => {
    const raw =
      "--MNEME-COMMIT--\n" +
      "deadbeef00\n" +
      "alice@example.com\n" +
      "Alice\n" +
      "1700000000\n" +
      "diff --git a/x b/x\n" +
      "index 1..2\n" +
      "--- a/x\n" +
      "+++ b/x\n" +
      "@@ -1 +1 @@\n" +
      "-old line\n" +
      "+new line\n";
    const events = parseLog(raw);
    expect(events).toHaveLength(0);
  });

  it("recognises FIXME / XXX / HACK markers (case-insensitive)", () => {
    const cases = ["FIXME", "fixme", "Xxx", "HACK"];
    for (const m of cases) {
      const raw =
        "--MNEME-COMMIT--\n" +
        "1234567890\n" +
        "a@x\n" +
        "A\n" +
        "1700000000\n" +
        "diff --git a/f b/f\n" +
        "+// " + m + ": something\n";
      const events = parseLog(raw);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]!.marker).toBe(m.toUpperCase());
    }
  });

  it("skips binary diffs", () => {
    const raw =
      "--MNEME-COMMIT--\n" +
      "1234567890\n" +
      "a@x\n" +
      "A\n" +
      "1700000000\n" +
      "diff --git a/img.png b/img.png\n" +
      "Binary files a/img.png and b/img.png differ\n";
    const events = parseLog(raw);
    expect(events).toHaveLength(0);
  });
});

describe("karma — matchOpenDebts", () => {
  it("settles an incurrence when a matching removal arrives later", () => {
    const events = [
      { email: "alice@x", name: "Alice", commit: "a", timestamp: 100, filePath: "src/foo.ts", marker: "TODO" as const, content: "refactor", type: "incurred" as const },
      { email: "bob@x", name: "Bob", commit: "b", timestamp: 200, filePath: "src/foo.ts", marker: "TODO" as const, content: "refactor", type: "settled" as const },
    ];
    const open = matchOpenDebts(events, 1000);
    expect(open).toHaveLength(0);
  });

  it("keeps unmatched incurrences open", () => {
    const events = [
      { email: "alice@x", name: "Alice", commit: "a", timestamp: 100, filePath: "src/foo.ts", marker: "TODO" as const, content: "refactor", type: "incurred" as const },
      { email: "bob@x", name: "Bob", commit: "b", timestamp: 200, filePath: "src/bar.ts", marker: "TODO" as const, content: "different file", type: "incurred" as const },
    ];
    const open = matchOpenDebts(events, 1000);
    expect(open).toHaveLength(2);
  });

  it("requires marker + filePath + content all to match", () => {
    const events = [
      { email: "alice@x", name: "Alice", commit: "a", timestamp: 100, filePath: "src/foo.ts", marker: "TODO" as const, content: "refactor", type: "incurred" as const },
      // wrong marker
      { email: "bob@x", name: "Bob", commit: "b", timestamp: 200, filePath: "src/foo.ts", marker: "FIXME" as const, content: "refactor", type: "settled" as const },
    ];
    const open = matchOpenDebts(events, 1000);
    expect(open).toHaveLength(1);
  });
});

describe("karma — debtWeight", () => {
  it("compounds sub-linearly with age", () => {
    const w1 = debtWeight(1);
    const w7 = debtWeight(7);
    const w180 = debtWeight(180);
    expect(w1).toBeLessThan(w7);
    expect(w7).toBeLessThan(w180);
    // Sub-linear: 180-day weight should NOT be 180× the 1-day weight
    expect(w180 / w1).toBeLessThan(20);
  });

  it("clamps negative ages to 0", () => {
    expect(debtWeight(-5)).toBe(0);
    expect(debtWeight(0)).toBe(0);
  });
});

describe("karma — buildReport", () => {
  it("ranks authors by weighted debt", () => {
    const asOf = 1_000_000_000;
    const events = [
      { email: "alice@x", name: "Alice", commit: "a", timestamp: asOf - 86400 * 365, filePath: "f.ts", marker: "TODO" as const, content: "ancient debt", type: "incurred" as const },
      { email: "bob@x", name: "Bob", commit: "b", timestamp: asOf - 86400, filePath: "f.ts", marker: "TODO" as const, content: "fresh debt", type: "incurred" as const },
    ];
    const report = buildReport(events, asOf);
    expect(report.authors[0]!.email).toBe("alice@x");  // older debt = higher weight
    expect(report.authors[0]!.weightedDebt).toBeGreaterThan(report.authors[1]!.weightedDebt);
    expect(report.authors[0]!.oldestUnpaid?.ageDays).toBeGreaterThan(360);
  });

  it("counts settled events without giving them weight", () => {
    const asOf = 1_000_000_000;
    const events = [
      { email: "alice@x", name: "Alice", commit: "a", timestamp: asOf - 86400 * 100, filePath: "f.ts", marker: "TODO" as const, content: "x", type: "incurred" as const },
      { email: "alice@x", name: "Alice", commit: "b", timestamp: asOf - 86400 * 50, filePath: "f.ts", marker: "TODO" as const, content: "x", type: "settled" as const },
    ];
    const report = buildReport(events, asOf);
    expect(report.authors[0]!.totalIncurred).toBe(1);
    expect(report.authors[0]!.totalSettled).toBe(1);
    expect(report.authors[0]!.netDebt).toBe(0);
    expect(report.authors[0]!.weightedDebt).toBe(0);
  });
});
