import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeIngestedChunks, readIngestedChunks, writeStats, readStats } from "./index.js";
import type { IngestedChunk } from "./types.js";

describe("ingest persistence", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-ingest-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("writeIngestedChunks then readIngestedChunks round-trips", () => {
    const chunks: IngestedChunk[] = [
      { id: "pr-review:1:c1", source: "pr-review", text: "looks good", createdAt: "2026-01-01T00:00:00Z" },
      { id: "pr-review:1:c2", source: "pr-review", text: "ship it", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const n = writeIngestedChunks(repo, chunks);
    expect(n).toBe(2);
    const back = readIngestedChunks(repo);
    expect(back.length).toBe(2);
    expect(back[0]!.text).toBe("looks good");
  });

  it("writeIngestedChunks de-dupes on id (no duplicate writes)", () => {
    const c: IngestedChunk = { id: "x", source: "pr-review", text: "hi", createdAt: "2026-01-01T00:00:00Z" };
    writeIngestedChunks(repo, [c]);
    const n2 = writeIngestedChunks(repo, [c]);
    expect(n2).toBe(0);
    expect(readIngestedChunks(repo).length).toBe(1);
  });

  it("readIngestedChunks returns [] when file missing", () => {
    expect(readIngestedChunks(repo)).toEqual([]);
  });

  it("writeStats round-trips", () => {
    writeStats(repo, [{ source: "pr-review", fetchedCount: 5, chunkCount: 12, startedAt: "x", completedAt: "y", errors: [] }]);
    expect(existsSync(join(repo, ".mneme/ingest/stats.json"))).toBe(true);
    const back = readStats(repo);
    expect(back.length).toBe(1);
    expect(back[0]!.chunkCount).toBe(12);
  });

  it("Linear without LINEAR_API_KEY returns empty + error in stats", async () => {
    const had = process.env["LINEAR_API_KEY"];
    delete process.env["LINEAR_API_KEY"];
    const { scrapeLinear } = await import("./linear_jira.js");
    const r = await scrapeLinear();
    expect(r.chunks.length).toBe(0);
    expect(r.stats.errors.length).toBeGreaterThan(0);
    if (had) process.env["LINEAR_API_KEY"] = had;
  });

  it("Jira without env vars returns empty + error in stats", async () => {
    const hadBase = process.env["JIRA_BASE_URL"];
    delete process.env["JIRA_BASE_URL"];
    const { scrapeJira } = await import("./linear_jira.js");
    const r = await scrapeJira();
    expect(r.chunks.length).toBe(0);
    expect(r.stats.errors.length).toBeGreaterThan(0);
    if (hadBase) process.env["JIRA_BASE_URL"] = hadBase;
  });
});
