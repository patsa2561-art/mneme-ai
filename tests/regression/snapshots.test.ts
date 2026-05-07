// Category 4 — output structure snapshots.
//
// We can't snapshot exact output (timestamps, hashes, durations move
// every run), but we *can* snapshot the SHAPE: which sections appear,
// in which order, with what headings. `normalize()` masks volatile bits;
// what's left is the structural skeleton.
//
// Reviewers should look at the snapshot diffs in PRs — if the structure
// changes intentionally, regenerate; if it changes accidentally, that's
// the regression we built this wall to catch.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, normalize, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("CLI regression — output structure snapshots", () => {
  it("`mneme --help` snapshot", () => {
    const r = runCli(["--help"], { cwd: REPO_ROOT });
    expect(normalize(r.stdout)).toMatchSnapshot();
  });

  it("`mneme advanced` snapshot", () => {
    const r = runCli(["advanced"], { cwd: REPO_ROOT });
    expect(normalize(r.stdout)).toMatchSnapshot();
  });

  it("`mneme ask --help` snapshot", () => {
    const r = runCli(["ask", "--help"], { cwd: REPO_ROOT });
    expect(normalize(r.stdout)).toMatchSnapshot();
  });

  it("`mneme forensics anomaly --help` snapshot", () => {
    const r = runCli(["forensics", "anomaly", "--help"], { cwd: REPO_ROOT });
    expect(normalize(r.stdout)).toMatchSnapshot();
  });

  it("`mneme wisdom -n 1` snapshot", () => {
    const r = runCli(["wisdom", "-n", "1"], { cwd: REPO_ROOT });
    expect(normalize(r.stdout)).toMatchSnapshot();
  });

  it("`mneme status` structure (sections only)", () => {
    const r = runCli(["status"], { cwd: REPO_ROOT });
    // For status, snapshot only the section headings, not values —
    // values change as the repo evolves.
    const sections = normalize(r.stdout)
      .split(/\r?\n/)
      .filter((line) => /^[\s│]*[◆◉]/.test(line) || /^[A-Z][a-zA-Z ]+:$/.test(line))
      .join("\n");
    expect(sections).toMatchSnapshot();
  });

  it("`mneme htc-stats --help` snapshot", () => {
    const r = runCli(["htc-stats", "--help"], { cwd: REPO_ROOT });
    expect(normalize(r.stdout)).toMatchSnapshot();
  });

  it("`mneme do --help` snapshot", () => {
    const r = runCli(["do", "--help"], { cwd: REPO_ROOT });
    expect(normalize(r.stdout)).toMatchSnapshot();
  });

  it("`mneme guardian --help` snapshot", () => {
    const r = runCli(["guardian", "--help"], { cwd: REPO_ROOT });
    expect(normalize(r.stdout)).toMatchSnapshot();
  });

  it("unknown-command error snapshot", () => {
    const r = runCli(["nope-not-real"], { cwd: REPO_ROOT });
    // Take stderr only; commander prints errors there
    expect(normalize(r.stderr)).toMatchSnapshot();
  });
});
