import { describe, it, expect } from "vitest";
import {
  buildNemesisReport,
  detectFriction,
  aggregateNemesisPairs,
} from "./nemesis.js";
import type { Commit } from "../types.js";

let counter = 0;

const cmt = (
  date: string,
  authorEmail: string,
  subject: string,
  files: string[],
  body = "",
): Commit => {
  counter += 1;
  const hash = (counter.toString(16).padStart(7, "0") + "deadbeefcafebabe").slice(0, 40);
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

describe("nemesis — friction detection", () => {
  it("returns an empty report on an empty input", () => {
    const r = buildNemesisReport([]);
    expect(r.totalEvents).toBe(0);
    expect(r.uniquePairs).toBe(0);
    expect(r.pairs).toEqual([]);
  });

  it("ignores commits by the same author touching the same file", () => {
    const commits = [
      cmt("2025-01-01", "alice@x", "feat: add cache", ["src/cache.ts"]),
      cmt("2025-01-02", "alice@x", "fix: cache key bug", ["src/cache.ts"]),
      cmt("2025-01-03", "alice@x", "fix: another cache bug", ["src/cache.ts"]),
      cmt("2025-01-04", "alice@x", "fix: more cache work", ["src/cache.ts"]),
    ];
    expect(detectFriction(commits)).toEqual([]);
  });

  it("detects an explicit `Revert \"...\"` of a prior author's commit (revert kind)", () => {
    const a = cmt("2025-01-01", "alice@x", "feat: enable HTTP/3", ["src/edge.ts"]);
    const b = cmt(
      "2025-01-02",
      "bob@x",
      `Revert "feat: enable HTTP/3"`,
      ["src/edge.ts"],
      `Reverts ${a.shortHash} — broke mobile`,
    );
    const events = detectFriction([a, b]);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("revert");
    expect(events[0]!.shipped.authorEmail).toBe("alice@x");
    expect(events[0]!.rewrote.authorEmail).toBe("bob@x");
  });

  it("detects revert by short-hash mention even when subject is generic", () => {
    const a = cmt("2025-01-01", "alice@x", "feat: HTTP/3 rollout", ["src/edge.ts"]);
    const b = cmt(
      "2025-01-03",
      "bob@x",
      "revert problematic change",
      ["src/edge.ts"],
      `This reverts commit ${a.shortHash}.`,
    );
    expect(detectFriction([a, b])[0]!.kind).toBe("revert");
  });

  it("detects rewrite-by-overlap when ≥50% of files match a prior author's commit", () => {
    const a = cmt("2025-01-01", "alice@x", "refactor: split auth helpers", [
      "src/auth.ts",
      "src/session.ts",
      "src/cookies.ts",
    ]);
    const b = cmt("2025-01-05", "bob@x", "rework auth helpers", [
      "src/auth.ts",
      "src/session.ts",
    ]);
    const events = detectFriction([a, b]);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("overlap");
  });

  it("uses fix-keyword heuristic when ≥2 files shared across authors", () => {
    const a = cmt("2025-01-01", "alice@x", "feat: payment retries", [
      "src/pay.ts",
      "src/retries.ts",
    ]);
    const b = cmt("2025-01-04", "bob@x", "fix: pay + retries broken", [
      "src/pay.ts",
      "src/retries.ts",
    ]);
    const events = detectFriction([a, b]);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind === "overlap" || events[0]!.kind === "fix-keyword").toBe(true);
  });

  it("ignores noise files (lockfiles, dist/, CHANGELOG)", () => {
    const a = cmt("2025-01-01", "alice@x", "chore: bump deps", [
      "package-lock.json",
    ]);
    const b = cmt("2025-01-02", "bob@x", "Revert chore: bump deps", [
      "package-lock.json",
    ]);
    expect(detectFriction([a, b])).toEqual([]);
  });

  it("aggregates bidirectional friction into one pair (a→b + b→a)", () => {
    const a1 = cmt("2025-01-01", "alice@x", "feat: cache", ["src/cache.ts"]);
    const b1 = cmt("2025-01-02", "bob@x", "Revert feat: cache", ["src/cache.ts"]);
    const b2 = cmt("2025-01-10", "bob@x", "feat: queue", ["src/queue.ts"]);
    const a2 = cmt("2025-01-11", "alice@x", "Revert feat: queue", ["src/queue.ts"]);
    const a3 = cmt("2025-01-20", "alice@x", "feat: tracer", ["src/trace.ts"]);
    const b3 = cmt("2025-01-21", "bob@x", "Revert feat: tracer", ["src/trace.ts"]);
    const report = buildNemesisReport([a1, b1, b2, a2, a3, b3], { minTotal: 3 });
    expect(report.uniquePairs).toBe(1);
    const pair = report.pairs[0]!;
    expect(pair.a).toBe("alice@x");
    expect(pair.b).toBe("bob@x");
    expect(pair.total).toBe(3);
    // alice wrote, bob rewrote (a1→b1, a3→b3) = 2; bob wrote, alice rewrote (b2→a2) = 1
    expect(pair.aWroteBRewrote).toBe(2);
    expect(pair.bWroteARewrote).toBe(1);
  });

  it("filters pairs below the minTotal threshold", () => {
    const a = cmt("2025-01-01", "alice@x", "feat: x", ["src/x.ts"]);
    const b = cmt("2025-01-02", "bob@x", "Revert feat: x", ["src/x.ts"]);
    const r = buildNemesisReport([a, b], { minTotal: 3 });
    expect(r.uniquePairs).toBe(0);
    expect(r.totalEvents).toBe(1);
  });

  it("respects authorFilter to surface only pairs touching that author", () => {
    const events: Commit[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(
        cmt(`2025-02-${(i + 1).toString().padStart(2, "0")}`, "alice@x", `feat: a${i}`, [
          `src/a${i}.ts`,
        ]),
      );
      events.push(
        cmt(`2025-02-${(i + 2).toString().padStart(2, "0")}`, "bob@x", `Revert feat: a${i}`, [
          `src/a${i}.ts`,
        ]),
      );
    }
    for (let i = 0; i < 3; i++) {
      events.push(
        cmt(`2025-03-${(i + 1).toString().padStart(2, "0")}`, "carol@x", `feat: c${i}`, [
          `src/c${i}.ts`,
        ]),
      );
      events.push(
        cmt(`2025-03-${(i + 2).toString().padStart(2, "0")}`, "dave@x", `Revert feat: c${i}`, [
          `src/c${i}.ts`,
        ]),
      );
    }
    const r = buildNemesisReport(events, { minTotal: 3, authorFilter: "alice@x" });
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]!.a).toBe("alice@x");
    expect(r.pairs[0]!.b).toBe("bob@x");
  });

  it("orders examples newest-first and caps at examplesPerPair", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 6; i++) {
      const day = (i * 2 + 1).toString().padStart(2, "0");
      const day2 = (i * 2 + 2).toString().padStart(2, "0");
      commits.push(cmt(`2025-04-${day}`, "alice@x", `feat: f${i}`, [`src/f${i}.ts`]));
      commits.push(cmt(`2025-04-${day2}`, "bob@x", `Revert feat: f${i}`, [`src/f${i}.ts`]));
    }
    const r = buildNemesisReport(commits, { minTotal: 3, examplesPerPair: 3 });
    expect(r.pairs[0]!.examples.length).toBe(3);
    // Newest first.
    const dates = r.pairs[0]!.examples.map((e) => e.atIso);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it("identifies the most-contested file across both directions", () => {
    const commits: Commit[] = [];
    // 4 reverts on src/cache.ts, 1 on src/other.ts
    for (let i = 0; i < 4; i++) {
      const d = (i * 2 + 1).toString().padStart(2, "0");
      const d2 = (i * 2 + 2).toString().padStart(2, "0");
      commits.push(cmt(`2025-05-${d}`, "alice@x", `feat: cache${i}`, ["src/cache.ts"]));
      commits.push(cmt(`2025-05-${d2}`, "bob@x", `Revert feat: cache${i}`, ["src/cache.ts"]));
    }
    commits.push(cmt(`2025-06-01`, "alice@x", `feat: other`, ["src/other.ts"]));
    commits.push(cmt(`2025-06-02`, "bob@x", `Revert feat: other`, ["src/other.ts"]));
    const r = buildNemesisReport(commits, { minTotal: 3 });
    expect(r.pairs[0]!.topFile).toBe("src/cache.ts");
  });

  it("records lastClashAt as the most-recent friction event in the pair", () => {
    const commits: Commit[] = [];
    commits.push(cmt(`2025-01-01`, "alice@x", `feat: x`, ["src/x.ts"]));
    commits.push(cmt(`2025-01-02`, "bob@x", `Revert feat: x`, ["src/x.ts"]));
    commits.push(cmt(`2025-01-10`, "alice@x", `feat: y`, ["src/y.ts"]));
    commits.push(cmt(`2025-01-11`, "bob@x", `Revert feat: y`, ["src/y.ts"]));
    commits.push(cmt(`2025-03-01`, "alice@x", `feat: z`, ["src/z.ts"]));
    commits.push(cmt(`2025-03-02`, "bob@x", `Revert feat: z`, ["src/z.ts"]));
    const r = buildNemesisReport(commits, { minTotal: 3 });
    expect(r.pairs[0]!.lastClashAt).toBe("2025-03-02T12:00:00Z");
  });

  it("ignores intermediate same-author commits when finding prior 'different author'", () => {
    // alice writes; alice writes again; bob reverts → bob's revert pairs with alice's WORK,
    // not a no-op self-revert.
    const a1 = cmt("2025-01-01", "alice@x", "feat: rewrite", ["src/x.ts"]);
    const a2 = cmt("2025-01-02", "alice@x", "tweak: rewrite", ["src/x.ts"]);
    const b1 = cmt("2025-01-03", "bob@x", "Revert feat", ["src/x.ts"]);
    const events = detectFriction([a1, a2, b1]);
    expect(events).toHaveLength(1);
    expect(events[0]!.shipped.authorEmail).toBe("alice@x");
    expect(events[0]!.rewrote.authorEmail).toBe("bob@x");
  });

  it("aggregates manually with custom minTotal", () => {
    const events = [
      // alice→bob (3 events)
      ...buildEventTriple("alice@x", "bob@x"),
    ];
    const report = aggregateNemesisPairs(events, { minTotal: 3 });
    expect(report.uniquePairs).toBe(1);
    expect(report.pairs[0]!.total).toBe(3);
  });

  it("normalizes emails to lowercase for stable pair keys", () => {
    const a = cmt("2025-01-01", "Alice@X", "feat: x", ["src/x.ts"]);
    const b = cmt("2025-01-02", "alice@x", "feat: y", ["src/y.ts"]);
    const c = cmt("2025-01-03", "BOB@X", "Revert feat: x", ["src/x.ts"]);
    const d = cmt("2025-01-04", "bob@x", "Revert feat: y", ["src/y.ts"]);
    const e = cmt("2025-01-05", "alice@x", "feat: z", ["src/z.ts"]);
    const f = cmt("2025-01-06", "Bob@X", "Revert feat: z", ["src/z.ts"]);
    const r = buildNemesisReport([a, b, c, d, e, f], { minTotal: 3 });
    expect(r.uniquePairs).toBe(1);
    expect(r.pairs[0]!.a).toBe("alice@x");
    expect(r.pairs[0]!.b).toBe("bob@x");
    expect(r.pairs[0]!.total).toBe(3);
  });

  it("does not flag a fix touching one shared file with a generic prefix", () => {
    // alice writes a feat; bob does a routine `fix(scope): typo` in one shared file.
    // That's not nemesis-grade — 1 file shared + conventional-commit prefix.
    const a = cmt("2025-01-01", "alice@x", "feat: huge new module", [
      "src/m.ts",
      "src/m.test.ts",
      "src/m.types.ts",
    ]);
    const b = cmt("2025-01-02", "bob@x", "fix(scope): typo", ["src/m.ts"]);
    const events = detectFriction([a, b]);
    expect(events).toEqual([]);
  });
});

// ─── helpers ────────────────────────────────────────────────────────

function buildEventTriple(shippedEmail: string, rewroteEmail: string) {
  const out: import("./nemesis.js").FrictionEvent[] = [];
  for (let i = 0; i < 3; i++) {
    const dStr = (i + 1).toString().padStart(2, "0");
    const d2 = (i + 2).toString().padStart(2, "0");
    const shipped = cmt(`2025-07-${dStr}`, shippedEmail, `feat: e${i}`, [`src/e${i}.ts`]);
    const rewrote = cmt(`2025-07-${d2}`, rewroteEmail, `Revert feat: e${i}`, [`src/e${i}.ts`]);
    out.push({
      shipped,
      rewrote,
      kind: "revert",
      filePath: `src/e${i}.ts`,
      sharedFiles: [`src/e${i}.ts`],
      atIso: rewrote.authorDate,
    });
  }
  return out;
}
