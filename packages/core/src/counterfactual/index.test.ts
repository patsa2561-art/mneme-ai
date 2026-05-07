import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import type { Commit } from "../types.js";
import {
  buildShadowStore,
  runCounterfactual,
  stripCoAuthorTrailer,
} from "./index.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-counterfactual-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function commit(
  hash: string,
  authorEmail: string,
  isoDate: string,
  files: string[],
  body = "",
): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: authorEmail.split("@")[0]!,
    authorEmail,
    authorDate: isoDate,
    committerDate: isoDate,
    subject: `commit by ${authorEmail}`,
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

// Pad hashes to 16 chars so they look git-like and short-hashing works.
function h(prefix: string, n: number): string {
  return (prefix + n.toString().padStart(2, "0")).padEnd(16, "f");
}

describe("counterfactual/stripCoAuthorTrailer", () => {
  it("removes a Co-authored-by line whose email matches", () => {
    const body = "fix bug\n\nCo-authored-by: Alice <alice@x.io>";
    const out = stripCoAuthorTrailer(body, "alice@x.io");
    expect(out).not.toContain("Co-authored-by");
  });

  it("preserves Co-authored-by lines that don't match", () => {
    const body = "fix bug\n\nCo-authored-by: Alice <alice@x.io>\nCo-authored-by: Bob <bob@x.io>";
    const out = stripCoAuthorTrailer(body, "alice@x.io");
    expect(out).toContain("bob@x.io");
    expect(out).not.toContain("alice@x.io");
  });

  it("returns body unchanged when there is no trailer", () => {
    expect(stripCoAuthorTrailer("plain message", "alice@x.io")).toBe("plain message");
  });

  it("is case-insensitive on the email match", () => {
    const out = stripCoAuthorTrailer("x\nCo-authored-by: A <ALICE@x.io>", "alice@x.io");
    expect(out).not.toContain("ALICE@x.io");
  });
});

describe("counterfactual/buildShadowStore", () => {
  it("drops every commit by the target author", () => {
    seed([
      commit(h("aaaa", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["a.ts"]),
      commit(h("aaaa", 2), "alice@x.io", "2024-01-02T00:00:00Z", ["a.ts"]),
      commit(h("bbbb", 3), "bob@x.io", "2024-01-03T00:00:00Z", ["b.ts"]),
    ]);
    const shadow = buildShadowStore(store, "alice@x.io");
    try {
      expect(shadow.countCommits()).toBe(1);
    } finally {
      shadow.close();
    }
  });

  it("drops file_changes belonging to dropped commits", () => {
    seed([
      commit(h("aaaa", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["a.ts", "b.ts"]),
      commit(h("bbbb", 2), "bob@x.io", "2024-01-02T00:00:00Z", ["b.ts"]),
    ]);
    const shadow = buildShadowStore(store, "alice@x.io");
    try {
      const rows = shadow.db
        .prepare("SELECT COUNT(*) AS n FROM file_changes")
        .get() as { n: number };
      expect(rows.n).toBe(1);
    } finally {
      shadow.close();
    }
  });

  it("strips the target's Co-authored-by trailer from kept commits", () => {
    seed([
      commit(h("aaaa", 1), "bob@x.io", "2024-01-01T00:00:00Z", ["a.ts"], "fix\n\nCo-authored-by: Alice <alice@x.io>"),
    ]);
    const shadow = buildShadowStore(store, "alice@x.io");
    try {
      const r = shadow.db
        .prepare("SELECT body FROM commits WHERE hash = ?")
        .get(h("aaaa", 1)) as { body: string };
      expect(r.body).not.toContain("alice@x.io");
    } finally {
      shadow.close();
    }
  });
});

describe("counterfactual/runCounterfactual — degenerate paths", () => {
  it("flags author-not-found when the email never appears", () => {
    seed([commit(h("bbbb", 1), "bob@x.io", "2024-01-01T00:00:00Z", ["a.ts"])]);
    const r = runCounterfactual(store, { authorEmail: "alice@x.io" });
    expect(r.authorWasPresent).toBe(false);
    expect(r.narrative).toContain("never contributed");
  });

  it("flags solo-author repos as no-other-contributors", () => {
    seed([
      commit(h("aaaa", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["a.ts"]),
      commit(h("aaaa", 2), "alice@x.io", "2024-01-02T00:00:00Z", ["b.ts"]),
    ]);
    const r = runCounterfactual(store, { authorEmail: "alice@x.io" });
    expect(r.authorWasPresent).toBe(true);
    expect(r.remainingContributors).toBe(0);
    expect(r.narrative).toContain("only contributor");
  });

  it("returns empty atrophy + telepathy on solo-author runs", () => {
    seed([commit(h("aaaa", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["a.ts"])]);
    const r = runCounterfactual(store, { authorEmail: "alice@x.io" });
    expect(r.atrophy.filesLoseLastExpert).toEqual([]);
    expect(r.telepathy.vanishedPairs).toEqual([]);
  });
});

describe("counterfactual/runCounterfactual — happy path", () => {
  it("identifies files where the target was the only expert", () => {
    // Alice owns auth.ts (3 touches, recent); Bob owns billing.ts.
    const recent = "2024-12-01T00:00:00Z";
    seed([
      commit(h("aaaa", 1), "alice@x.io", recent, ["src/auth.ts"]),
      commit(h("aaaa", 2), "alice@x.io", recent, ["src/auth.ts"]),
      commit(h("aaaa", 3), "alice@x.io", recent, ["src/auth.ts"]),
      commit(h("bbbb", 4), "bob@x.io", recent, ["src/billing.ts"]),
      commit(h("bbbb", 5), "bob@x.io", recent, ["src/billing.ts"]),
    ]);
    const r = runCounterfactual(store, {
      authorEmail: "alice@x.io",
      asOf: "2024-12-15T00:00:00Z",
    });
    expect(r.authorWasPresent).toBe(true);
    expect(r.remainingContributors).toBeGreaterThan(0);
    const orphaned = r.atrophy.filesLoseLastExpert.map((f) => f.filePath);
    expect(orphaned).toContain("src/auth.ts");
    expect(orphaned).not.toContain("src/billing.ts");
  });

  it("counts knowledgeMassRemoved as a positive number when there is real loss", () => {
    const recent = "2024-12-01T00:00:00Z";
    seed([
      commit(h("aaaa", 1), "alice@x.io", recent, ["a.ts"]),
      commit(h("aaaa", 2), "alice@x.io", recent, ["a.ts"]),
      commit(h("bbbb", 3), "bob@x.io", recent, ["b.ts"]),
    ]);
    const r = runCounterfactual(store, {
      authorEmail: "alice@x.io",
      asOf: "2024-12-15T00:00:00Z",
    });
    expect(r.atrophy.knowledgeMassRemoved).toBeGreaterThan(0);
  });

  it("preserves remaining authors in the meta block", () => {
    seed([
      commit(h("aaaa", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["a.ts"]),
      commit(h("bbbb", 2), "bob@x.io", "2024-01-02T00:00:00Z", ["b.ts"]),
      commit(h("cccc", 3), "carol@x.io", "2024-01-03T00:00:00Z", ["c.ts"]),
    ]);
    const r = runCounterfactual(store, { authorEmail: "alice@x.io" });
    expect(r.meta.commitsBefore).toBe(3);
    expect(r.meta.commitsAfter).toBe(2);
    expect(r.meta.authorsBefore).toBe(3);
    expect(r.meta.authorsAfter).toBe(2);
  });

  it("normalizes the email to lowercase", () => {
    seed([
      commit(h("aaaa", 1), "Alice@X.io", "2024-01-01T00:00:00Z", ["a.ts"]),
      commit(h("bbbb", 2), "bob@x.io", "2024-01-02T00:00:00Z", ["b.ts"]),
    ]);
    const r = runCounterfactual(store, { authorEmail: "ALICE@x.io" });
    expect(r.authorWasPresent).toBe(true);
    expect(r.meta.commitsAfter).toBe(1);
  });

  it("includes a narrative string ending in a period", () => {
    seed([
      commit(h("aaaa", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["a.ts"]),
      commit(h("bbbb", 2), "bob@x.io", "2024-01-02T00:00:00Z", ["a.ts"]),
    ]);
    const r = runCounterfactual(store, { authorEmail: "alice@x.io" });
    expect(r.narrative.endsWith(".")).toBe(true);
    expect(r.narrative.toLowerCase()).toContain("bayesian");
  });

  it("identifies tier degradation on shared files", () => {
    // Both Alice and Bob recently edit the same file; remove Alice → Bob still live.
    const recent = "2024-12-01T00:00:00Z";
    const old = "2023-01-01T00:00:00Z";
    seed([
      commit(h("aaaa", 1), "alice@x.io", recent, ["src/shared.ts"]),
      commit(h("aaaa", 2), "alice@x.io", recent, ["src/shared.ts"]),
      commit(h("aaaa", 3), "alice@x.io", recent, ["src/shared.ts"]),
      commit(h("bbbb", 4), "bob@x.io", old, ["src/shared.ts"]),
    ]);
    const r = runCounterfactual(store, {
      authorEmail: "alice@x.io",
      asOf: "2024-12-15T00:00:00Z",
    });
    // shared.ts had Alice fresh + Bob old. After removing Alice, Bob alone is stale.
    const shift = r.atrophy.fileShifts.find((s) => s.filePath === "src/shared.ts");
    expect(shift).toBeDefined();
    // freshestBefore should be > freshestAfter.
    expect(shift!.freshestBefore).toBeGreaterThan(shift!.freshestAfter);
  });

  it("respects topN cap on file shifts + lost experts", () => {
    const recent = "2024-12-01T00:00:00Z";
    const cs: Commit[] = [];
    for (let i = 0; i < 20; i++) {
      cs.push(commit(h("aaaa", i), "alice@x.io", recent, [`src/f${i}.ts`]));
      cs.push(commit(h("aaaa", i), "alice@x.io", recent, [`src/f${i}.ts`])); // 2 touches
    }
    cs.push(commit(h("bbbb", 99), "bob@x.io", recent, ["src/other.ts"]));
    seed(cs);
    const r = runCounterfactual(store, {
      authorEmail: "alice@x.io",
      asOf: "2024-12-15T00:00:00Z",
      topN: 5,
    });
    expect(r.atrophy.filesLoseLastExpert.length).toBeLessThanOrEqual(5);
    expect(r.atrophy.fileShifts.length).toBeLessThanOrEqual(5);
  });

  it("handles a target who only appears as a co-author", () => {
    seed([
      commit(
        h("bbbb", 1),
        "bob@x.io",
        "2024-01-01T00:00:00Z",
        ["a.ts"],
        "fix\n\nCo-authored-by: Alice <alice@x.io>",
      ),
    ]);
    const r = runCounterfactual(store, { authorEmail: "alice@x.io" });
    // Alice is not a primary author, so she's "not present" by our definition.
    expect(r.authorWasPresent).toBe(false);
  });
});
