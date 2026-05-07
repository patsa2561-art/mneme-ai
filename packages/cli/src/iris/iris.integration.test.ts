import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  iris,
  flash,
  generateHeadline,
  renderCommit,
  renderAuthor,
  recordCommandRun,
  shouldShowVerboseGuide,
  readIrisState,
  checkContract,
  singleSection,
  stripAnsi,
} from "./index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-iris-int-test-"));
  delete process.env.NO_COLOR;
});
afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  process.env.NO_COLOR = "1";
});

/** Sample fake forensics-anomaly result wired through Iris end-to-end. */
describe("Iris end-to-end — fake forensics-anomaly result", () => {
  it("produces output that satisfies the 30-second contract", async () => {
    // Build the data the way `mneme forensics` would.
    const data = { criticalCount: 3, highCount: 2, topSubject: "verify alice@bank.com identity" };

    // Step 1: AI-or-extractive headline.
    const headline = await generateHeadline({
      commandType: "forensics",
      data,
      repoRoot: tmpDir,
    });
    expect(headline).toMatch(/3 critical anomalies/);

    // Step 2: Build the entity-rendered citations.
    const commit = renderCommit(
      {
        hash: "abc123456789",
        shortHash: "abc1234",
        subject: "feat: add payment retry",
        authorName: "alice",
        authorDate: "2024-08-12T00:00:00Z",
      },
      { compact: true, emphasized: true },
    );
    const author = renderAuthor("alice", "alice@bank.com", { isYou: false });

    // Step 3: Render the inverted-pyramid layout.
    const output = iris.render({
      headline: `🛡  ${headline}`,
      sections: [
        singleSection("lede", "✦ Findings", [
          `  ${commit}`,
          `  Suspect: ${author}`,
          "  Run mneme why abc1234 to inspect.",
        ]),
        singleSection("key-facts", "Key facts", [
          "  3 critical / 2 high / 0 medium",
          "  Window: last 30 days",
        ]),
        singleSection("body", "📘 How to read", [
          "  CRIT entries are likely fraud-style anomalies.",
          "  Try mneme guard next to set up a CI gate.",
        ]),
        singleSection(
          "details",
          "Detail rows",
          ["row1", "row2", "row3", "row4", "row5"],
        ),
      ],
      whyShown: "→ Try next: mneme why abc1234",
      widthOverride: 80,
    });

    // Validate against the contract.
    const r = checkContract(output);
    if (!r.ok) {
      console.error("contract violations:", r.violations);
      console.error(output);
    }
    expect(r.ok).toBe(true);

    // Smoke checks
    const stripped = stripAnsi(output);
    expect(stripped).toContain("3 critical anomalies");
    expect(stripped).toContain("abc1234");
    expect(stripped).toContain("alice");
    expect(stripped).toContain("--verbose"); // details collapsed
    expect(stripped).toContain("→ Try next"); // whyShown footer
  });
});

describe("Iris end-to-end — adaptive verbosity flow", () => {
  it("shouldShowVerboseGuide flips false after threshold runs", () => {
    const cmd = "forensics";
    expect(shouldShowVerboseGuide(readIrisState(tmpDir), cmd)).toBe(true);
    for (let i = 0; i < 5; i++) recordCommandRun(tmpDir, cmd);
    const s = readIrisState(tmpDir);
    expect(shouldShowVerboseGuide(s, cmd)).toBe(false);
    expect(s.preferTerse).toBe(true);
  });
});

describe("Iris end-to-end — flash footer", () => {
  it("verdict flash + render + contract still pass", () => {
    const summary = flash({
      type: "verdict",
      data: { headline: "ok", severity: "info", next: "Run mneme ask" },
    });
    expect(summary).toHaveLength(3);
    const out = iris.render({
      headline: "📰 Verdict ready",
      sections: [singleSection("lede", undefined, summary)],
      widthOverride: 80,
    });
    const r = checkContract(out);
    expect(r.ok).toBe(true);
  });
});
