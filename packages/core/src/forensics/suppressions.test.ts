import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSuppressions,
  loadSuppressedIds,
  addSuppression,
  removeSuppression,
} from "./suppressions.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-suppress-"));
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("forensics/suppressions", () => {
  it("returns empty when the file is missing", async () => {
    const entries = await loadSuppressions(tmp);
    expect(entries).toEqual([]);
  });

  it("loads valid entries", async () => {
    mkdirSync(join(tmp, ".mneme"), { recursive: true });
    writeFileSync(
      join(tmp, ".mneme/suppressions.json"),
      JSON.stringify({
        version: 1,
        entries: [{ id: "abc12345", rule: "sql-injection", reason: "log line" }],
      }),
    );
    const entries = await loadSuppressions(tmp);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("abc12345");
  });

  it("filters expired entries", async () => {
    mkdirSync(join(tmp, ".mneme"), { recursive: true });
    writeFileSync(
      join(tmp, ".mneme/suppressions.json"),
      JSON.stringify({
        version: 1,
        entries: [
          { id: "active", reason: "x" },
          { id: "expired", reason: "y", expiresAt: "2000-01-01T00:00:00Z" },
        ],
      }),
    );
    const ids = await loadSuppressedIds(tmp);
    expect(ids.has("active")).toBe(true);
    expect(ids.has("expired")).toBe(false);
  });

  it("returns empty on malformed JSON instead of throwing", async () => {
    mkdirSync(join(tmp, ".mneme"), { recursive: true });
    writeFileSync(join(tmp, ".mneme/suppressions.json"), "{not json");
    const entries = await loadSuppressions(tmp);
    expect(entries).toEqual([]);
  });

  it("addSuppression creates the file and returns it on second load", async () => {
    await addSuppression(tmp, { id: "new1", reason: "a real false positive" });
    const entries = await loadSuppressions(tmp);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("new1");
    const raw = readFileSync(join(tmp, ".mneme/suppressions.json"), "utf8");
    expect(raw).toContain("\"version\": 1");
  });

  it("addSuppression is idempotent (re-adding same id refreshes entry, no duplicate)", async () => {
    await addSuppression(tmp, { id: "id1", reason: "first reason" });
    await addSuppression(tmp, { id: "id1", reason: "updated reason" });
    const entries = await loadSuppressions(tmp);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason).toBe("updated reason");
  });

  it("removeSuppression returns true when entry existed, false otherwise", async () => {
    await addSuppression(tmp, { id: "rem1", reason: "x" });
    expect(await removeSuppression(tmp, "rem1")).toBe(true);
    expect(await removeSuppression(tmp, "rem1")).toBe(false);
  });
});
