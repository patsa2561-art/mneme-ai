import { describe, it, expect } from "vitest";
import {
  buildPromiseReport,
  extractPromisesFromCommit,
  extractScope,
} from "./promise.js";
import type { Commit } from "../types.js";

let counter = 0;

const cmt = (
  date: string,
  authorEmail: string,
  subject: string,
  body = "",
  files: string[] = [],
): Commit => {
  counter += 1;
  const hash = (counter.toString(16).padStart(7, "0") + "feedfacedeadbeef").slice(0, 40);
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: authorEmail.split("@")[0] ?? authorEmail,
    authorEmail,
    authorDate: `${date}T12:00:00Z`,
    committerDate: `${date}T12:00:00Z`,
    subject,
    body,
    parents: [],
    files,
  };
};

const NOW = Date.parse("2025-05-07T12:00:00Z");

describe("promise — extractPromisesFromCommit", () => {
  it("returns empty list for a commit with no promise text", () => {
    const c = cmt("2024-01-01", "alice@x", "feat: ship X", "Description.");
    expect(extractPromisesFromCommit(c)).toEqual([]);
  });

  it("matches `TODO:` labels", () => {
    const c = cmt(
      "2024-01-01",
      "alice@x",
      "feat: cache layer",
      "TODO: refactor cache eviction policy later",
      ["src/cache.ts"],
    );
    const ps = extractPromisesFromCommit(c);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.patternKind).toBe("todo");
    expect(ps[0]!.excerpt).toContain("TODO:");
    expect(ps[0]!.scopeHint).toBeTruthy();
  });

  it("matches `FIXME:` and `HACK:` and `XXX:`", () => {
    for (const tag of ["FIXME", "HACK", "XXX", "FOLLOWUP", "FOLLOW-UP"]) {
      const c = cmt(
        "2024-01-01",
        "alice@x",
        `feat: ${tag}`,
        `${tag}: needs better error handling`,
        ["src/x.ts"],
      );
      const ps = extractPromisesFromCommit(c);
      expect(ps.length).toBeGreaterThan(0);
      expect(ps[0]!.patternKind).toBe("todo");
    }
  });

  it("matches `I'll fix` / `I will refactor` / `we'll address`", () => {
    const samples = [
      "I'll fix the cache invalidation in a follow-up",
      "I will refactor the auth helpers next sprint",
      "We'll address the retry logic later",
      "we will tackle the migration soon",
    ];
    for (const subject of samples) {
      const c = cmt("2024-01-01", "alice@x", subject, "", ["src/x.ts"]);
      const ps = extractPromisesFromCommit(c);
      expect(ps.length).toBeGreaterThan(0);
    }
  });

  it("matches `in a follow-up`, `next sprint`, `eventually`", () => {
    const samples = [
      ["feat: payments", "In a follow-up we'll add 3DS support."],
      ["feat: queue", "Next sprint: backpressure tuning."],
      ["feat: tracer", "Eventually we should switch to OpenTelemetry."],
    ];
    for (const [s, b] of samples) {
      const c = cmt("2024-01-01", "alice@x", s!, b!, ["src/x.ts"]);
      const ps = extractPromisesFromCommit(c);
      expect(ps.length).toBeGreaterThan(0);
    }
  });

  it("matches `plan to migrate` / `plans to refactor`", () => {
    const c = cmt(
      "2024-01-01",
      "alice@x",
      "feat: storage",
      "We plan to migrate to S3 in Q2.",
      ["src/store.ts"],
    );
    const ps = extractPromisesFromCommit(c);
    expect(ps.length).toBeGreaterThan(0);
    expect(ps[0]!.patternKind).toBe("plan-to");
  });

  it("de-duplicates identical excerpts within one commit", () => {
    const c = cmt(
      "2024-01-01",
      "alice@x",
      "feat: many promises",
      "TODO: refactor cache\nTODO: refactor cache\nTODO: refactor cache",
      ["src/cache.ts"],
    );
    const ps = extractPromisesFromCommit(c);
    expect(ps.length).toBe(1);
  });

  it("respects maxMatches cap", () => {
    const c = cmt(
      "2024-01-01",
      "alice@x",
      "feat: many promises",
      "TODO: a\nTODO: b\nTODO: c\nTODO: d\nTODO: e\nTODO: f",
      ["src/x.ts"],
    );
    const ps = extractPromisesFromCommit(c, 0, 3);
    expect(ps.length).toBeLessThanOrEqual(3);
  });

  it("strips noise files from the captured file list", () => {
    const c = cmt("2024-01-01", "alice@x", "TODO: clean up", "", [
      "src/x.ts",
      "package-lock.json",
      "dist/bundle.js",
    ]);
    const ps = extractPromisesFromCommit(c);
    expect(ps[0]!.files).toEqual(["src/x.ts"]);
  });
});

describe("promise — extractScope", () => {
  it("pulls a noun phrase out of a fragment", () => {
    expect(extractScope("refactor cache eviction policy")).toBe("cache eviction");
    expect(extractScope("the auth flow")).toMatch(/auth/);
    expect(extractScope(":  cache layer")).toContain("cache");
  });

  it("returns null on empty/short fragments", () => {
    expect(extractScope("")).toBeNull();
    expect(extractScope("a")).toBeNull();
    expect(extractScope("the")).toBeNull();
  });
});

describe("promise — buildPromiseReport", () => {
  it("returns empty totals for an empty repo", () => {
    const r = buildPromiseReport([], { nowMs: NOW });
    expect(r.totals.total).toBe(0);
    expect(r.byAuthor).toEqual([]);
    expect(r.oldestStaleAgeDays).toBeNull();
  });

  it("classifies a recent promise (≤ 90d) as 'open'", () => {
    const c = cmt("2025-05-01", "alice@x", "feat: cache", "TODO: refactor cache", [
      "src/cache.ts",
    ]);
    const r = buildPromiseReport([c], { nowMs: NOW });
    expect(r.promises).toHaveLength(1);
    expect(r.promises[0]!.status).toBe("open");
  });

  it("classifies an old unfulfilled promise (> 90d) as 'stale'", () => {
    const c = cmt(
      "2024-01-01",
      "alice@x",
      "feat: cache",
      "TODO: refactor cache eventually",
      ["src/cache.ts"],
    );
    const r = buildPromiseReport([c], { nowMs: NOW });
    expect(r.promises[0]!.status).toBe("stale");
    expect(r.promises[0]!.ageDays).toBeGreaterThan(90);
  });

  it("marks a promise 'kept' when a later commit touches the same file with a fulfilment keyword", () => {
    const a = cmt(
      "2025-01-01",
      "alice@x",
      "feat: cache",
      "TODO: refactor cache layer",
      ["src/cache.ts"],
    );
    const b = cmt(
      "2025-02-15",
      "bob@x",
      "refactor: cache layer cleanup",
      "Resolves the long-standing TODO.",
      ["src/cache.ts"],
    );
    const r = buildPromiseReport([a, b], { nowMs: NOW });
    expect(r.promises[0]!.status).toBe("kept");
    expect(r.promises[0]!.fulfilledBy).toBe(b.shortHash);
  });

  it("does NOT mark promise as kept if no shared file", () => {
    const a = cmt("2025-01-01", "alice@x", "feat: a", "TODO: refactor cache", [
      "src/a.ts",
    ]);
    const b = cmt("2025-02-01", "bob@x", "refactor: cache", "fix: cache logic", [
      "src/b.ts",
    ]);
    const r = buildPromiseReport([a, b], { nowMs: NOW });
    expect(r.promises[0]!.status).not.toBe("kept");
  });

  it("kept window: a fulfilment outside `keptWindowDays` does not count", () => {
    const a = cmt("2024-01-01", "alice@x", "feat: x", "TODO: refactor x", [
      "src/x.ts",
    ]);
    const b = cmt("2025-04-01", "bob@x", "refactor: x cleanup", "", ["src/x.ts"]);
    // 1y + ~3mo > default 365d window → not kept.
    const r = buildPromiseReport([a, b], { nowMs: NOW, keptWindowDays: 365 });
    expect(r.promises[0]!.status).toBe("stale");
  });

  it("aggregates per-author stats sorted by stale desc", () => {
    const commits = [
      cmt("2024-01-01", "alice@x", "feat: 1", "TODO: refactor", ["src/1.ts"]),
      cmt("2024-01-02", "alice@x", "feat: 2", "TODO: refactor", ["src/2.ts"]),
      cmt("2024-01-03", "alice@x", "feat: 3", "TODO: refactor", ["src/3.ts"]),
      cmt("2025-05-01", "bob@x", "feat: 4", "TODO: refactor", ["src/4.ts"]),
    ];
    const r = buildPromiseReport(commits, { nowMs: NOW });
    expect(r.byAuthor).toHaveLength(2);
    expect(r.byAuthor[0]!.author).toBe("alice@x");
    expect(r.byAuthor[0]!.stale).toBe(3);
    expect(r.byAuthor[1]!.author).toBe("bob@x");
    expect(r.byAuthor[1]!.open).toBe(1);
  });

  it("authorFilter narrows the result to a single email (lowercased)", () => {
    const commits = [
      cmt("2024-01-01", "alice@x", "feat: 1", "TODO: refactor", ["src/1.ts"]),
      cmt("2024-01-02", "BOB@X", "feat: 2", "TODO: refactor", ["src/2.ts"]),
    ];
    const r = buildPromiseReport(commits, { nowMs: NOW, authorFilter: "Bob@X" });
    expect(r.promises.every((p) => p.author === "bob@x")).toBe(true);
    expect(r.promises).toHaveLength(1);
  });

  it("statusFilter limits the report to one status bucket", () => {
    const commits = [
      cmt("2024-01-01", "alice@x", "feat: old", "TODO: refactor old", [
        "src/old.ts",
      ]),
      cmt("2025-05-01", "alice@x", "feat: new", "TODO: refactor new", [
        "src/new.ts",
      ]),
    ];
    const r = buildPromiseReport(commits, { nowMs: NOW, statusFilter: "stale" });
    expect(r.promises.every((p) => p.status === "stale")).toBe(true);
    expect(r.totals.open).toBe(0);
  });

  it("oldestStaleAgeDays is the maximum age across stale promises", () => {
    const commits = [
      cmt("2024-01-01", "alice@x", "feat: x", "TODO: x", ["src/x.ts"]),
      cmt("2023-08-01", "alice@x", "feat: y", "TODO: y", ["src/y.ts"]),
    ];
    const r = buildPromiseReport(commits, { nowMs: NOW });
    expect(r.totals.stale).toBe(2);
    expect(r.oldestStaleAgeDays).not.toBeNull();
    expect(r.oldestStaleAgeDays).toBeGreaterThan(600);
  });

  it("sort order: stale first (oldest), then open (newest), then kept", () => {
    const commits = [
      cmt("2025-04-01", "alice@x", "feat: open", "TODO: refactor open", [
        "src/o.ts",
      ]),
      cmt("2024-01-01", "alice@x", "feat: stale-old", "TODO: refactor s1", [
        "src/s1.ts",
      ]),
      cmt("2024-04-01", "alice@x", "feat: stale-newer", "TODO: refactor s2", [
        "src/s2.ts",
      ]),
    ];
    const r = buildPromiseReport(commits, { nowMs: NOW });
    expect(r.promises[0]!.status).toBe("stale");
    expect(r.promises[0]!.commitShort).toBe(commits[1]!.shortHash); // oldest stale first
    expect(r.promises[1]!.status).toBe("stale");
    expect(r.promises[2]!.status).toBe("open");
  });

  it("provides stable promise ids per match index", () => {
    const c = cmt(
      "2024-01-01",
      "alice@x",
      "feat: a",
      "TODO: aa\nFIXME: bb\nI will refactor cc",
      ["src/x.ts"],
    );
    const r = buildPromiseReport([c], { nowMs: NOW });
    const ids = r.promises.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(`${c.shortHash}:`)).toBe(true);
  });

  it("scopeHint mention from a later commit also marks promise kept", () => {
    const a = cmt(
      "2025-01-01",
      "alice@x",
      "feat: queue",
      "TODO: refactor queue backpressure",
      ["src/queue.ts"],
    );
    // No fulfilment keyword, but later commit mentions the scope on same file.
    const b = cmt(
      "2025-02-01",
      "bob@x",
      "tweak queue backpressure constants",
      "",
      ["src/queue.ts"],
    );
    const r = buildPromiseReport([a, b], { nowMs: NOW });
    expect(r.promises[0]!.status).toBe("kept");
  });
});
