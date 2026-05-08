import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  libraryId,
  readLibrary,
  recordInvocation,
  promote,
  eligibleForPromotion,
  archived,
  findByAliasOrId,
  annotate,
  forget,
} from "./library.js";
import type { MoleculePlan } from "./compiler.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-lib-"));
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const fakePlan = (steps = 2): MoleculePlan => ({
  intent: "fixture",
  steps: Array.from({ length: steps }, (_, i) => ({ id: `step.${i}`, args: {} })),
  estimatedMsP50: 100 * steps,
  source: "rule-based",
  trace: ["fixture trace"],
});

describe("library — id derivation", () => {
  it("is stable across whitespace + case variations", () => {
    expect(libraryId("Find SQL injection")).toBe(libraryId("  find  sql  injection  "));
    expect(libraryId("Find SQL injection")).toBe(libraryId("FIND SQL INJECTION"));
  });
  it("differs for different intents", () => {
    expect(libraryId("a")).not.toBe(libraryId("b"));
  });
});

describe("library — recordInvocation", () => {
  it("creates a new entry on first call", async () => {
    const e = await recordInvocation(tmp, "find todos", fakePlan());
    expect(e.hits).toBe(1);
    expect(e.intent).toBe("find todos");
    expect(e.firstSeen).toBe(e.lastSeen);
  });
  it("bumps hits + lastSeen on subsequent calls", async () => {
    await recordInvocation(tmp, "find todos", fakePlan());
    await new Promise((r) => setTimeout(r, 10));
    const e = await recordInvocation(tmp, "find todos", fakePlan());
    expect(e.hits).toBe(2);
    expect(e.lastSeen >= e.firstSeen).toBe(true);
  });
  it("treats whitespace-variant intents as the same entry", async () => {
    await recordInvocation(tmp, "find todos", fakePlan());
    await recordInvocation(tmp, "  FIND TODOS  ", fakePlan());
    const lib = await readLibrary(tmp);
    expect(Object.keys(lib.entries)).toHaveLength(1);
    expect(Object.values(lib.entries)[0]!.hits).toBe(2);
  });
});

describe("library — promote", () => {
  it("auto-derives an alias from the intent", async () => {
    const e0 = await recordInvocation(tmp, "Find SQL Injection", fakePlan());
    const e = await promote(tmp, e0.id);
    expect(e?.alias).toBe("find-sql-injection");
    expect(e?.promoted).toBe(true);
  });
  it("accepts an explicit alias", async () => {
    const e0 = await recordInvocation(tmp, "x", fakePlan());
    const e = await promote(tmp, e0.id, "weekly");
    expect(e?.alias).toBe("weekly");
  });
  it("returns undefined for unknown id", async () => {
    expect(await promote(tmp, "nonexistent")).toBeUndefined();
  });
});

describe("library — eligibleForPromotion + archived", () => {
  it("returns entries with hits >= threshold", async () => {
    const e0 = await recordInvocation(tmp, "x", fakePlan());
    for (let i = 0; i < 5; i++) await recordInvocation(tmp, "x", fakePlan());
    const lib = await readLibrary(tmp);
    expect(eligibleForPromotion(lib).map((e) => e.id)).toContain(e0.id);
  });
  it("excludes already-promoted entries", async () => {
    await recordInvocation(tmp, "x", fakePlan());
    for (let i = 0; i < 5; i++) await recordInvocation(tmp, "x", fakePlan());
    const lib0 = await readLibrary(tmp);
    const id = Object.keys(lib0.entries)[0]!;
    await promote(tmp, id);
    const lib = await readLibrary(tmp);
    expect(eligibleForPromotion(lib)).toHaveLength(0);
  });
  it("respects custom thresholds", async () => {
    await recordInvocation(tmp, "x", fakePlan());
    const lib = await readLibrary(tmp);
    expect(eligibleForPromotion(lib, { hitsThreshold: 1, cooledAfterDays: 7, archiveAfterDays: 30 }))
      .toHaveLength(1);
  });
  it("archived returns entries with old lastSeen", async () => {
    await recordInvocation(tmp, "x", fakePlan());
    let lib = await readLibrary(tmp);
    // Manually rewrite lastSeen to 60 days ago
    const id = Object.keys(lib.entries)[0]!;
    lib.entries[id]!.lastSeen = new Date(Date.now() - 60 * 86400_000).toISOString();
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.writeFile(path.join(tmp, ".mneme/library.json"), JSON.stringify(lib, null, 2));

    lib = await readLibrary(tmp);
    expect(archived(lib)).toHaveLength(1);
  });
});

describe("library — findByAliasOrId + annotate + forget", () => {
  it("finds by id", async () => {
    const e = await recordInvocation(tmp, "x", fakePlan());
    expect((await findByAliasOrId(tmp, e.id))?.intent).toBe("x");
  });
  it("finds by alias after promotion", async () => {
    const e = await recordInvocation(tmp, "weekly run", fakePlan());
    await promote(tmp, e.id, "weekly");
    expect((await findByAliasOrId(tmp, "weekly"))?.intent).toBe("weekly run");
    expect((await findByAliasOrId(tmp, "WEEKLY"))?.intent).toBe("weekly run");
  });
  it("returns undefined for unknown needle", async () => {
    expect(await findByAliasOrId(tmp, "nope")).toBeUndefined();
  });
  it("annotate writes the note", async () => {
    const e = await recordInvocation(tmp, "x", fakePlan());
    await annotate(tmp, e.id, "this is the note");
    const re = await findByAliasOrId(tmp, e.id);
    expect(re?.note).toBe("this is the note");
  });
  it("forget removes the entry", async () => {
    const e = await recordInvocation(tmp, "x", fakePlan());
    expect(await forget(tmp, e.id)).toBe(true);
    expect(await forget(tmp, e.id)).toBe(false);
    expect(await findByAliasOrId(tmp, e.id)).toBeUndefined();
  });
});

describe("library — file format resilience", () => {
  it("readLibrary returns empty file when missing", async () => {
    const lib = await readLibrary(tmp);
    expect(lib.entries).toEqual({});
    expect(lib.version).toBe(1);
  });
  it("readLibrary returns empty on malformed JSON", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(path.join(tmp, ".mneme"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".mneme/library.json"), "{not json");
    const lib = await readLibrary(tmp);
    expect(lib.entries).toEqual({});
  });
});
