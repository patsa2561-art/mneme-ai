import { describe, expect, it } from "vitest";
import { detectFts5, fts5RemedyMessage } from "./fts5_detect.js";

describe("fts5_detect", () => {
  it("returns available=false on null db handle", () => {
    const r = detectFts5(null);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("no db handle");
  });

  it("returns available=true when probe succeeds", () => {
    let execCount = 0;
    const fakeDb = {
      exec: (sql: string) => {
        execCount++;
        if (sql.includes("CREATE VIRTUAL TABLE") || sql.includes("DROP TABLE")) return undefined;
        throw new Error("unexpected sql");
      },
    };
    const r = detectFts5(fakeDb);
    expect(r.available).toBe(true);
    expect(execCount).toBe(2);             // create + drop
  });

  it("returns available=false with reason when CREATE VIRTUAL throws", () => {
    const fakeDb = {
      exec: (_sql: string) => { throw new Error("no such module: fts5"); },
    };
    const r = detectFts5(fakeDb);
    expect(r.available).toBe(false);
    expect(r.reason).toContain("no such module: fts5");
  });

  describe("fts5RemedyMessage", () => {
    it("returns empty string when FTS5 is available", () => {
      expect(fts5RemedyMessage({ available: true, backend: "node:sqlite" })).toBe("");
    });
    it("returns multi-line remedy when FTS5 is missing", () => {
      const m = fts5RemedyMessage({ available: false, reason: "no such module: fts5", backend: "node:sqlite" });
      expect(m).toContain("[FTS5 MISSING]");
      expect(m).toContain("TRIPLE-INDEX WAR mode");
      expect(m).toContain("better-sqlite3");
      expect(m).toContain("Node 22.13+");
    });
  });
});
