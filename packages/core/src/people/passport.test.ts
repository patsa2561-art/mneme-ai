/**
 * Tests for `passport.ts` — the engineer-dossier composer.
 *
 * Influence is git-walking; we always pass a pre-computed empty influence
 * report so tests don't shell out to git.  Same for promise/telepathy where
 * we want determinism.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import {
  buildPassport,
  topAuthorEmail,
  topAuthorEmails,
  buildPassportLimits,
} from "./passport.js";
import type { InfluenceReport } from "./influence.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-passport-test-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

let counter = 0;
function cmt(
  hash: string | undefined,
  authorName: string,
  email: string,
  isoDate: string,
  files: string[],
  subject = "feat: x",
  body = "",
): Commit {
  counter += 1;
  const h = hash ?? (counter.toString(16).padStart(7, "0") + "abcdefabcdef0000").slice(0, 40);
  return {
    hash: h,
    shortHash: h.slice(0, 7),
    authorName,
    authorEmail: email,
    authorDate: isoDate,
    committerDate: isoDate,
    subject,
    body,
    parents: [],
    files,
  };
}

function seed(commits: Commit[]) {
  store.upsertCommits(commits);
  for (const c of commits) {
    if (c.files.length === 0) continue;
    store.upsertFileChanges(
      c.files.map((f) => ({
        commitHash: c.hash,
        path: f,
        changeKind: "M" as const,
        insertions: 1,
        deletions: 0,
      })),
    );
  }
}

const EMPTY_INFLUENCE: InfluenceReport = {
  rankings: [],
  totalShapesAnalyzed: 0,
  shapesWithAdoption: 0,
  languageMix: {},
  perAuthor: {},
};

const CWD = "/tmp/fake-repo";

// ─── topAuthorEmail / topAuthorEmails ──────────────────────────────────

describe("topAuthorEmail", () => {
  it("returns null on empty input", () => {
    expect(topAuthorEmail([])).toBeNull();
  });

  it("picks the author with the most commits (lower-cased)", () => {
    const list = [
      cmt(undefined, "Alice", "Alice@X", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt(undefined, "Alice", "alice@x", "2024-01-02T10:00:00Z", ["b.ts"]),
      cmt(undefined, "Bob", "bob@x", "2024-01-03T10:00:00Z", ["c.ts"]),
    ];
    expect(topAuthorEmail(list)).toBe("alice@x");
  });

  it("ignores commits with empty author email", () => {
    const list = [
      cmt(undefined, "Bob", "bob@x", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt(undefined, "Anon", "", "2024-01-02T10:00:00Z", ["b.ts"]),
    ];
    expect(topAuthorEmail(list)).toBe("bob@x");
  });
});

describe("topAuthorEmails", () => {
  it("returns N most-frequent author emails sorted desc", () => {
    const list = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T00:00:00Z", []),
      cmt(undefined, "Alice", "alice@x", "2024-01-02T00:00:00Z", []),
      cmt(undefined, "Bob", "bob@x", "2024-01-03T00:00:00Z", []),
      cmt(undefined, "Bob", "bob@x", "2024-01-04T00:00:00Z", []),
      cmt(undefined, "Bob", "bob@x", "2024-01-05T00:00:00Z", []),
      cmt(undefined, "Carol", "carol@x", "2024-01-06T00:00:00Z", []),
    ];
    expect(topAuthorEmails(list, 3)).toEqual(["bob@x", "alice@x", "carol@x"]);
  });

  it("clamps n ≥ 1", () => {
    const list = [cmt(undefined, "Alice", "a@x", "2024-01-01T00:00:00Z", [])];
    expect(topAuthorEmails(list, 0)).toEqual(["a@x"]);
    expect(topAuthorEmails(list, -3)).toEqual(["a@x"]);
  });
});

// ─── buildPassport — happy paths ───────────────────────────────────────

describe("buildPassport — basic dossier", () => {
  it("returns null on an empty repo", async () => {
    const p = await buildPassport(store, { cwd: CWD, influence: EMPTY_INFLUENCE });
    expect(p).toBeNull();
  });

  it("auto-picks the top contributor when author is omitted", async () => {
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["src/a.ts"]),
      cmt(undefined, "Alice", "alice@x", "2024-01-02T10:00:00Z", ["src/a.ts"]),
      cmt(undefined, "Alice", "alice@x", "2024-01-03T10:00:00Z", ["src/b.ts"]),
      cmt(undefined, "Bob", "bob@x", "2024-01-04T10:00:00Z", ["src/c.ts"]),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p).not.toBeNull();
    expect(p!.identity.email).toBe("alice@x");
    expect(p!.identity.commitCount).toBe(3);
  });

  it("returns null when the author has zero commits", async () => {
    const commits = [cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "ghost@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p).toBeNull();
  });

  it("computes identity stats — repoCommitShare, activeDays, fromDate/toDate", async () => {
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt(undefined, "Alice", "alice@x", "2024-01-02T10:00:00Z", ["a.ts"]),
      cmt(undefined, "Bob", "bob@x", "2024-02-01T10:00:00Z", ["b.ts"]),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p).not.toBeNull();
    expect(p!.identity.commitCount).toBe(2);
    expect(p!.identity.activeDays).toBe(2);
    expect(p!.identity.repoCommitShare).toBeCloseTo(2 / 3, 3);
    expect(p!.meta.totalCommits).toBe(3);
    expect(p!.meta.repoAuthorCount).toBe(2);
  });

  it("populates expertise with topFiles sorted by knowledge desc", async () => {
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["src/old.ts"]),
      cmt(undefined, "Alice", "alice@x", "2024-01-02T10:00:00Z", ["src/old.ts"]),
      cmt(undefined, "Alice", "alice@x", "2025-04-01T10:00:00Z", ["src/new.ts"]),
      cmt(undefined, "Alice", "alice@x", "2025-04-02T10:00:00Z", ["src/new.ts"]),
      cmt(undefined, "Alice", "alice@x", "2025-04-03T10:00:00Z", ["src/new.ts"]),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
      asOf: "2025-05-07T12:00:00Z",
    });
    expect(p!.expertise.topFiles.length).toBeGreaterThan(0);
    // Newer file should rank higher than older file.
    const newIdx = p!.expertise.topFiles.findIndex((f) => f.filePath === "src/new.ts");
    const oldIdx = p!.expertise.topFiles.findIndex((f) => f.filePath === "src/old.ts");
    expect(newIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeLessThan(oldIdx === -1 ? 999 : oldIdx);
  });

  it("returns a stable JSON shape — every required key is present", async () => {
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p).not.toBeNull();
    // Shape stability: every top-level key the renderer expects.
    const keys = Object.keys(p!).sort();
    expect(keys).toEqual(
      [
        "dna",
        "expertise",
        "fadingDomains",
        "friction",
        "identity",
        "influenceSlot",
        "limits",
        "meta",
        "promiseSlot",
        "telepathySlot",
        "voice",
      ].sort(),
    );
  });

  it("influenceSlot is null when no rankings match the author", async () => {
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p!.influenceSlot).toBeNull();
  });

  it("friction slot defaults to null", async () => {
    const commits = [cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p!.friction).toBeNull();
  });

  it("friction slot is populated when includeFriction = true", async () => {
    // Two authors, multiple touches on the same files (so nemesis can compute).
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["src/x.ts"]),
      cmt(undefined, "Bob", "bob@x", "2024-01-02T10:00:00Z", ["src/x.ts"]),
      cmt(undefined, "Alice", "alice@x", "2024-01-03T10:00:00Z", ["src/x.ts"]),
      cmt(undefined, "Bob", "bob@x", "2024-01-04T10:00:00Z", ["src/x.ts"]),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      includeFriction: true,
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p!.friction).not.toBeNull();
    expect(Array.isArray(p!.friction!.pairs)).toBe(true);
  });

  it("repoName flows through meta", async () => {
    const commits = [cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
      repoName: "my-cool-repo",
    });
    expect(p!.meta.repoName).toBe("my-cool-repo");
  });

  it("limits contains at least the always-on disclaimers", async () => {
    const commits = [cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p!.limits.length).toBeGreaterThanOrEqual(2);
    expect(p!.limits.some((l) => /local/i.test(l))).toBe(true);
    expect(p!.limits.some((l) => /performance review/i.test(l))).toBe(true);
  });

  it("warns when commit count is below 30", async () => {
    const commits = [cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p!.limits.some((l) => /sample size/i.test(l))).toBe(true);
  });

  it("voice phrases come back lower-cased and ranked", async () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 5; i++) {
      commits.push(
        cmt(
          undefined,
          "Alice",
          "alice@x",
          `2024-01-0${i + 1}T10:00:00Z`,
          ["a.ts"],
          `feat: refactor everything thoroughly mightily`,
          "Refactoring with great care and refactor again",
        ),
      );
    }
    commits.push(
      cmt(undefined, "Bob", "bob@x", "2024-02-01T10:00:00Z", ["b.ts"], "fix: bug", "patch"),
    );
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    // alice talks about "refactor"/"refactoring" disproportionately.
    expect(p!.voice.length).toBeGreaterThan(0);
    expect(p!.voice.every((v) => v.phrase === v.phrase.toLowerCase())).toBe(true);
    expect(p!.voice[0]!.weight).toBeGreaterThanOrEqual(p!.voice[p!.voice.length - 1]!.weight);
  });

  it("fadingDomains lists files with ≥3 historical touches that decayed", async () => {
    // Touches in 2020 → very stale by 2025-05-07 default asOf.
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2020-01-01T10:00:00Z", ["src/legacy.ts"]),
      cmt(undefined, "Alice", "alice@x", "2020-01-02T10:00:00Z", ["src/legacy.ts"]),
      cmt(undefined, "Alice", "alice@x", "2020-01-03T10:00:00Z", ["src/legacy.ts"]),
      cmt(undefined, "Alice", "alice@x", "2020-01-04T10:00:00Z", ["src/legacy.ts"]),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p!.fadingDomains.length).toBeGreaterThan(0);
    expect(p!.fadingDomains[0]!.filePath).toBe("src/legacy.ts");
    expect(p!.fadingDomains[0]!.peakTouches).toBeGreaterThanOrEqual(3);
    expect(p!.fadingDomains[0]!.currentKnowledge).toBeLessThanOrEqual(0.3);
    expect(p!.fadingDomains[0]!.daysIdle).toBeGreaterThan(180);
  });

  it("dna is included and reports a non-empty hash", async () => {
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt(undefined, "Alice", "alice@x", "2024-01-02T10:00:00Z", ["a.ts"]),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(typeof p!.identity.dnaHash).toBe("string");
    expect(p!.identity.dnaHash.length).toBeGreaterThan(0);
    expect(typeof p!.dna.commitCount).toBe("number");
  });

  it("promiseSlot teamBaseline reports zero authors when only target author has commits", async () => {
    const commits = [
      cmt(undefined, "Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"], "feat: x", "TODO: revisit"),
    ];
    seed(commits);
    const p = await buildPassport(store, {
      cwd: CWD,
      author: "alice@x",
      influence: EMPTY_INFLUENCE,
      commits,
    });
    expect(p!.promiseSlot.teamBaseline.authors).toBe(0);
  });
});

// ─── buildPassportLimits — pure-function unit tests ───────────────────

describe("buildPassportLimits", () => {
  it("includes a sample-size warning under 30 commits", () => {
    const limits = buildPassportLimits({
      commitCount: 5,
      repoAuthorCount: 3,
      influenceMissing: false,
      telepathyEmpty: false,
      expertiseEmpty: false,
      voiceLow: false,
    });
    expect(limits.some((l) => /sample size/i.test(l))).toBe(true);
  });

  it("includes a solo-repo warning when repoAuthorCount < 2", () => {
    const limits = buildPassportLimits({
      commitCount: 100,
      repoAuthorCount: 1,
      influenceMissing: false,
      telepathyEmpty: false,
      expertiseEmpty: false,
      voiceLow: false,
    });
    expect(limits.some((l) => /solo/i.test(l))).toBe(true);
  });

  it("always emits the local-data + not-a-review disclaimers", () => {
    const limits = buildPassportLimits({
      commitCount: 1000,
      repoAuthorCount: 10,
      influenceMissing: false,
      telepathyEmpty: false,
      expertiseEmpty: false,
      voiceLow: false,
    });
    expect(limits.some((l) => /local/i.test(l))).toBe(true);
    expect(limits.some((l) => /performance review/i.test(l))).toBe(true);
  });
});
