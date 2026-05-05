import { describe, it, expect } from "vitest";
import { buildManage } from "./manage.js";
import type { Commit } from "../types.js";

const NOW = new Date("2026-05-05").getTime();

function mk(p: { hash: string; date: string; subject: string; author: string; files?: string[] }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: p.author,
    authorEmail: p.author.toLowerCase() + "@x.com",
    authorDate: p.date,
    committerDate: p.date,
    subject: p.subject,
    body: "",
    files: p.files ?? [],
    parents: [],
  };
}

describe("buildManage", () => {
  it("returns sane defaults for empty input", () => {
    const r = buildManage([], { nowMs: NOW });
    expect(r.health.windowCommits).toBe(0);
    expect(r.skillMatrix).toHaveLength(0);
    expect(r.succession).toHaveLength(0);
    expect(r.health.notes.length).toBeGreaterThan(0);
  });

  it("fills skill matrix with per-area proficiency", () => {
    const commits = [
      mk({ hash: "a1", date: "2026-04-01", subject: "x", author: "Alice", files: ["src/auth/x.ts"] }),
      mk({ hash: "a2", date: "2026-04-02", subject: "x", author: "Alice", files: ["src/auth/y.ts"] }),
      mk({ hash: "b1", date: "2026-04-03", subject: "x", author: "Bob", files: ["src/payments/z.ts"] }),
    ];
    const r = buildManage(commits, { nowMs: NOW });
    const aliceAuth = r.skillMatrix.find((c) => c.author === "Alice" && c.area === "src/auth");
    expect(aliceAuth).toBeDefined();
    expect(aliceAuth!.proficiency).toBe(1);
  });

  it("succession surfaces high-risk areas where one author dominates and no understudy", () => {
    const commits = Array.from({ length: 12 }, (_, i) =>
      mk({
        hash: `a${i}`,
        date: `2026-04-${(i + 1).toString().padStart(2, "0")}`,
        subject: "x",
        author: "Alice",
        files: ["src/legacy/x.ts"],
      }),
    );
    const r = buildManage(commits, { nowMs: NOW });
    const legacy = r.succession.find((s) => s.area === "src/legacy");
    expect(legacy).toBeDefined();
    expect(legacy!.understudy).toBeNull();
    expect(legacy!.risk).toBeGreaterThan(0.5);
  });

  it("succession risk is low when an understudy contributes meaningfully", () => {
    const commits = [
      ...Array.from({ length: 8 }, (_, i) =>
        mk({ hash: `a${i}`, date: `2026-04-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Alice", files: ["src/auth/x.ts"] }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        mk({ hash: `b${i}`, date: `2026-04-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Bob", files: ["src/auth/x.ts"] }),
      ),
    ];
    const r = buildManage(commits, { nowMs: NOW });
    const auth = r.succession.find((s) => s.area === "src/auth");
    expect(auth).toBeDefined();
    expect(auth!.understudy).toBe("Bob");
    expect(auth!.risk).toBeLessThan(0.5);
  });

  it("health.overall is bounded 0..1", () => {
    const commits = Array.from({ length: 5 }, (_, i) =>
      mk({ hash: `a${i}`, date: `2026-04-0${i + 1}`, subject: `feat: ${i}`, author: "Alice", files: ["x.ts"] }),
    );
    const r = buildManage(commits, { nowMs: NOW });
    expect(r.health.overall).toBeGreaterThanOrEqual(0);
    expect(r.health.overall).toBeLessThanOrEqual(1);
  });

  it("trajectory reflects last drift bucket", () => {
    const commits = [
      mk({ hash: "a1", date: "2026-04-01", subject: "feat: x", author: "Alice", files: ["x.ts"] }),
      mk({ hash: "a2", date: "2026-04-02", subject: "feat: y", author: "Alice", files: ["x.ts"] }),
    ];
    const r = buildManage(commits, { nowMs: NOW });
    expect(r.health.trajectory.label).not.toBe("n/a");
  });

  it("notes mention firefight when fire ratio is high", () => {
    const commits = Array.from({ length: 8 }, (_, i) =>
      mk({ hash: `b${i}`, date: `2026-04-${(i + 1).toString().padStart(2, "0")}`, subject: "fix critical bug", author: "Alice", files: ["x.ts"] }),
    );
    const r = buildManage(commits, { nowMs: NOW });
    const fireNote = r.health.notes.find((n) => n.toLowerCase().includes("firefight"));
    expect(fireNote).toBeDefined();
  });

  it("succession sorted by risk descending", () => {
    const commits = [
      ...Array.from({ length: 10 }, (_, i) =>
        mk({ hash: `a${i}`, date: `2026-04-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Alice", files: ["src/risky/x.ts"] }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        mk({ hash: `b${i}`, date: `2026-04-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Bob", files: ["src/safe/y.ts"] }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        mk({ hash: `c${i}`, date: `2026-04-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Carol", files: ["src/safe/y.ts"] }),
      ),
    ];
    const r = buildManage(commits, { nowMs: NOW });
    for (let i = 1; i < r.succession.length; i++) {
      expect(r.succession[i - 1]!.risk).toBeGreaterThanOrEqual(r.succession[i]!.risk);
    }
  });
});
