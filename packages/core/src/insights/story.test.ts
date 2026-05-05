import { describe, it, expect } from "vitest";
import { buildStory } from "./story.js";
import type { Commit } from "../types.js";

const cmt = (hash: string, date: string, subject: string, body = ""): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: "alice",
  authorEmail: "alice@example.com",
  authorDate: `${date}T00:00:00Z`,
  committerDate: `${date}T00:00:00Z`,
  subject,
  body,
  parents: [],
  files: [],
});

describe("buildStory — basic structure", () => {
  it("returns empty story for empty commit list", () => {
    const s = buildStory("auth", []);
    expect(s.acts).toEqual([]);
    expect(s.totalCommits).toBe(0);
    expect(s.spanDays).toBe(0);
  });

  it("first commit always opens Act I", () => {
    const s = buildStory("auth", [cmt("a1", "2024-01-01", "feat: add passport.js")]);
    expect(s.acts[0]!.id).toBe("initial");
    expect(s.acts[0]!.title).toContain("Beginning");
  });

  it("totalCommits and spanDays reflect input", () => {
    const s = buildStory("auth", [
      cmt("a1", "2024-01-01", "feat: passport"),
      cmt("a2", "2024-04-01", "refactor: replace passport"),
    ]);
    expect(s.totalCommits).toBe(2);
    expect(s.spanDays).toBeGreaterThanOrEqual(89); // about 90 days between Jan 1 and Apr 1
  });
});

describe("buildStory — act detection", () => {
  it("groups consecutive refactor-style commits into one Refactor act", () => {
    const s = buildStory("auth", [
      cmt("a1", "2024-01-01", "feat: passport"),
      cmt("a2", "2024-04-01", "refactor: replace passport with custom"),
      cmt("a3", "2024-04-08", "refactor: switch to JWT signing"),
      cmt("a4", "2024-04-15", "refactor: migrate session middleware"),
    ]);
    const refactorActs = s.acts.filter((a) => a.id === "refactor");
    expect(refactorActs).toHaveLength(1);
    expect(refactorActs[0]!.commits).toHaveLength(3);
  });

  it("flags 'hotfix' and 'incident' commits as incident acts", () => {
    const s = buildStory("auth", [
      cmt("a1", "2024-01-01", "feat: passport"),
      cmt("a2", "2024-02-01", "hotfix: CSRF bypass after refactor", ""),
      cmt("a3", "2024-02-02", "revert: PR #42 caused outage"),
    ]);
    expect(s.acts.find((a) => a.id === "incident")).toBeDefined();
  });

  it("commits without keywords flagged as evolution", () => {
    const s = buildStory("auth", [
      cmt("a1", "2024-01-01", "feat: passport"),
      cmt("a2", "2024-01-15", "feat: add /me endpoint"),
      cmt("a3", "2024-02-01", "feat: add /logout endpoint"),
    ]);
    expect(s.acts.find((a) => a.id === "evolution")).toBeDefined();
  });

  it("transitions across flavors close+open separate acts", () => {
    const s = buildStory("auth", [
      cmt("a1", "2024-01-01", "feat: passport"),                  // initial
      cmt("a2", "2024-01-10", "feat: add session cookies"),       // evolution
      cmt("a3", "2024-02-01", "refactor: replace passport"),      // refactor
      cmt("a4", "2024-02-15", "feat: add audit logs"),            // evolution
      cmt("a5", "2024-03-01", "hotfix: critical XSS"),            // incident
    ]);
    const ids = s.acts.map((a) => a.id);
    expect(ids[0]).toBe("initial");
    expect(ids).toContain("refactor");
    expect(ids).toContain("evolution");
    expect(ids).toContain("incident");
  });

  it("appends a Stable State act when the latest commit is > 90 days old", () => {
    const oneYearAgo = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const s = buildStory("auth", [cmt("a1", oneYearAgo, "feat: passport")]);
    const stable = s.acts.find((a) => a.id === "stable");
    expect(stable).toBeDefined();
  });
});

describe("buildStory — date metadata", () => {
  it("each act records fromDate and toDate", () => {
    const s = buildStory("auth", [
      cmt("a1", "2024-01-01", "feat: passport"),
      cmt("a2", "2024-04-01", "refactor: replace passport"),
      cmt("a3", "2024-04-15", "refactor: switch to JWT"),
    ]);
    for (const act of s.acts) {
      expect(act.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(act.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(act.fromDate <= act.toDate).toBe(true);
    }
  });
});
