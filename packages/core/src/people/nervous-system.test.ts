/**
 * Tests for `nervous-system.ts` — the repo-level neural map composer.
 *
 * Same isolation strategy as passport.test.ts: pre-compute a stub influence
 * report so nothing shells out to git.  We use sqlite directly via tmp dir.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { buildNervousSystem } from "./nervous-system.js";
import * as influenceMod from "./influence.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-nervous-test-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));

  // Stub buildInfluenceReport so we never shell to git in tests.
  vi.spyOn(influenceMod, "buildInfluenceReport").mockResolvedValue({
    rankings: [],
    totalShapesAnalyzed: 0,
    shapesWithAdoption: 0,
    languageMix: {},
    perAuthor: {},
  });
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

let counter = 0;
function cmt(
  authorName: string,
  email: string,
  isoDate: string,
  files: string[],
  subject = "feat: x",
  body = "",
): Commit {
  counter += 1;
  const h = (counter.toString(16).padStart(7, "0") + "deadbeefcafebabe").slice(0, 40);
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

const CWD = "/tmp/fake-repo";

// ─── basic shape ───────────────────────────────────────────────────────

describe("buildNervousSystem — shape stability", () => {
  it("returns null on an empty repo", async () => {
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns).toBeNull();
  });

  it("populates every required top-level key", async () => {
    seed([
      cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["src/a.ts"]),
      cmt("Bob", "bob@x", "2024-01-02T10:00:00Z", ["src/b.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns).not.toBeNull();
    const keys = Object.keys(ns!).sort();
    expect(keys).toEqual(
      [
        "alphas",
        "atrophy",
        "hero",
        "limits",
        "lobes",
        "meta",
        "passports",
        "promises",
        "surprising",
        "telepathy",
      ].sort(),
    );
  });

  it("meta reports total commits, authors, half-life", async () => {
    seed([
      cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt("Bob", "bob@x", "2024-01-02T10:00:00Z", ["b.ts"]),
      cmt("Alice", "alice@x", "2024-01-03T10:00:00Z", ["a.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.meta.totalCommits).toBe(3);
    expect(ns!.meta.totalAuthors).toBe(2);
    expect(ns!.meta.halfLifeDays).toBeGreaterThan(0);
    expect(ns!.meta.repoName).toBeTruthy();
  });

  it("repoName flows from options", async () => {
    seed([cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])]);
    const ns = await buildNervousSystem(store, { cwd: CWD, repoName: "my-app" });
    expect(ns!.meta.repoName).toBe("my-app");
  });
});

// ─── hero / sparklines ─────────────────────────────────────────────────

describe("buildNervousSystem — hero metrics", () => {
  it("hero contains 4 metric cards each with a sparkline array", async () => {
    seed([
      cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt("Alice", "alice@x", "2024-01-08T10:00:00Z", ["a.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.hero.metrics).toHaveLength(4);
    for (const m of ns!.hero.metrics) {
      expect(typeof m.label).toBe("string");
      expect(typeof m.value).toBe("string");
      expect(Array.isArray(m.sparkline)).toBe(true);
      expect(m.sparkline.length).toBe(12);
    }
  });

  it("hero.headline is plain English", async () => {
    seed([cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.hero.headline).toMatch(/cultural alpha|invisible team|critical file/);
  });
});

// ─── alphas ────────────────────────────────────────────────────────────

describe("buildNervousSystem — alphas", () => {
  it("returns an empty alphas list when no influence rankings", async () => {
    seed([cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.alphas).toEqual([]);
  });

  it("maps influence rankings into AlphaSlot rows", async () => {
    vi.spyOn(influenceMod, "buildInfluenceReport").mockResolvedValueOnce({
      rankings: [
        {
          rank: 1,
          author: { name: "Alice", email: "alice@x" },
          pageRank: 0.42,
          originatedShapesAdopted: 3,
          originatedShapesTotal: 5,
          adoptionsByOthers: 12,
          uniqueAdopters: 4,
          adoptionsByThisAuthor: 1,
        },
      ],
      totalShapesAnalyzed: 10,
      shapesWithAdoption: 5,
      languageMix: { ts: 1 },
      perAuthor: {
        "alice@x": {
          topShapes: [
            {
              shape: { key: "func:compose:2", kind: "function", name: "compose", arity: 2 },
              adoptions: 12,
              adopters: [{ email: "bob@x", name: "Bob", file: "src/b.ts" }],
            },
          ],
        },
      },
    });
    seed([cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.alphas).toHaveLength(1);
    expect(ns!.alphas[0]!.name).toBe("Alice");
    expect(ns!.alphas[0]!.adoptionsByOthers).toBe(12);
    expect(ns!.alphas[0]!.topShape).toEqual({
      kind: "function",
      name: "compose",
      arity: 2,
      adoptions: 12,
    });
  });
});

// ─── atrophy block ────────────────────────────────────────────────────

describe("buildNervousSystem — atrophy block", () => {
  it("populates atrophy.criticalFiles", async () => {
    // Files Alice once knew but never returned to.
    seed([
      cmt("Alice", "alice@x", "2020-01-01T10:00:00Z", ["src/legacy.ts"]),
      cmt("Alice", "alice@x", "2020-01-02T10:00:00Z", ["src/legacy.ts"]),
      cmt("Alice", "alice@x", "2024-12-30T10:00:00Z", ["src/fresh.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.atrophy.fileCount).toBeGreaterThan(0);
    // Tier values are constrained.
    for (const f of ns!.atrophy.criticalFiles) {
      expect(["safe", "warn", "at-risk"]).toContain(f.tier);
    }
  });

  it("respects topFiles option (caps criticalFiles length)", async () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 25; i++) {
      commits.push(
        cmt("Alice", "alice@x", `2020-01-${(i % 28) + 1}T10:00:00Z`, [`src/f${i}.ts`]),
      );
    }
    seed(commits);
    const ns = await buildNervousSystem(store, { cwd: CWD, topFiles: 5 });
    expect(ns!.atrophy.criticalFiles.length).toBeLessThanOrEqual(5);
  });
});

// ─── lobes ────────────────────────────────────────────────────────────

describe("buildNervousSystem — brain lobes", () => {
  it("groups files by depth-3 directory", async () => {
    seed([
      cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["packages/core/src/foo.ts"]),
      cmt("Alice", "alice@x", "2024-01-02T10:00:00Z", ["packages/core/src/bar.ts"]),
      cmt("Bob", "bob@x", "2024-01-03T10:00:00Z", ["packages/cli/src/baz.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    const lobeKeys = ns!.lobes.map((l) => l.lobe);
    expect(lobeKeys).toContain("packages/core/src");
    expect(lobeKeys).toContain("packages/cli/src");
  });

  it("each lobe reports a top owner with touches", async () => {
    seed([
      cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["pkg/a/x.ts"]),
      cmt("Alice", "alice@x", "2024-01-02T10:00:00Z", ["pkg/a/x.ts"]),
      cmt("Alice", "alice@x", "2024-01-03T10:00:00Z", ["pkg/a/x.ts"]),
      cmt("Bob", "bob@x", "2024-01-04T10:00:00Z", ["pkg/a/x.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    const lobe = ns!.lobes.find((l) => l.lobe === "pkg/a")!;
    expect(lobe).toBeDefined();
    expect(lobe.topOwner!.email).toBe("alice@x");
    expect(lobe.topOwner!.touches).toBe(3);
  });

  it("caps lobes at 10", async () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 20; i++) {
      commits.push(cmt("Alice", "alice@x", `2024-01-${(i % 28) + 1}T10:00:00Z`, [`p${i}/q/r.ts`]));
    }
    seed(commits);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.lobes.length).toBeLessThanOrEqual(10);
  });
});

// ─── passports ────────────────────────────────────────────────────────

describe("buildNervousSystem — passports", () => {
  it("embeds a mini-passport for each top contributor", async () => {
    seed([
      cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt("Alice", "alice@x", "2024-01-02T10:00:00Z", ["a.ts"]),
      cmt("Bob", "bob@x", "2024-01-03T10:00:00Z", ["b.ts"]),
      cmt("Carol", "carol@x", "2024-01-04T10:00:00Z", ["c.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD, topPeople: 3 });
    expect(ns!.passports.length).toBeGreaterThan(0);
    expect(ns!.passports.length).toBeLessThanOrEqual(3);
    expect(ns!.passports[0]!.identity.email).toBe("alice@x");
  });

  it("respects topPeople option", async () => {
    seed([
      cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt("Bob", "bob@x", "2024-01-02T10:00:00Z", ["b.ts"]),
      cmt("Carol", "carol@x", "2024-01-03T10:00:00Z", ["c.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD, topPeople: 1 });
    expect(ns!.passports).toHaveLength(1);
  });
});

// ─── promises + surprises + limits ────────────────────────────────────

describe("buildNervousSystem — promises + surprises + limits", () => {
  it("aggregates promise totals across the repo", async () => {
    seed([
      cmt(
        "Alice",
        "alice@x",
        "2024-01-01T10:00:00Z",
        ["a.ts"],
        "feat: x",
        "TODO: revisit caching",
      ),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(typeof ns!.promises.open).toBe("number");
    expect(typeof ns!.promises.kept).toBe("number");
    expect(typeof ns!.promises.stale).toBe("number");
    expect(typeof ns!.promises.keepRate).toBe("number");
  });

  it("honest limits always include the local-data + not-a-review disclaimer", async () => {
    seed([cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.limits.some((l) => /local/i.test(l))).toBe(true);
    expect(ns!.limits.some((l) => /describes patterns, not people/i.test(l))).toBe(true);
  });

  it("warns about small samples / solo repos in limits", async () => {
    seed([cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.limits.some((l) => /sample size/i.test(l))).toBe(true);
    expect(ns!.limits.some((l) => /solo|small team/i.test(l))).toBe(true);
  });

  it("surprising findings list at most 4 items", async () => {
    seed([cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"])]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(ns!.surprising.length).toBeLessThanOrEqual(4);
  });
});

// ─── telepathy slot ───────────────────────────────────────────────────

describe("buildNervousSystem — telepathy", () => {
  it("returns telepathy.pairs as an array (possibly empty)", async () => {
    seed([
      cmt("Alice", "alice@x", "2024-01-01T10:00:00Z", ["a.ts"]),
      cmt("Bob", "bob@x", "2024-01-02T10:00:00Z", ["b.ts"]),
    ]);
    const ns = await buildNervousSystem(store, { cwd: CWD });
    expect(Array.isArray(ns!.telepathy.pairs)).toBe(true);
    expect(typeof ns!.telepathy.pairsEvaluated).toBe("number");
    expect(typeof ns!.telepathy.distinctAuthorsInGrid).toBe("number");
  });
});
