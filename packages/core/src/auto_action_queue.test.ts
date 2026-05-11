import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { enqueueMandate, readQueue, drainQueue } from "./auto_action_queue.js";

describe("auto_action_queue", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-q-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("enqueueMandate writes one JSONL line + readQueue returns it", () => {
    enqueueMandate(repo, "mneme.system.upgrade", { force: true });
    const q = readQueue(repo);
    expect(q).toHaveLength(1);
    expect(q[0]!.mandate).toBe("mneme.system.upgrade");
    expect(q[0]!.args).toEqual({ force: true });
    expect(q[0]!.executedAt).toBeUndefined();
  });

  it("readQueue returns [] when queue file missing", () => {
    expect(readQueue(repo)).toEqual([]);
  });

  it("readQueue filters out already-executed entries (those carry executedAt)", () => {
    // First enqueue + drain (success)
    enqueueMandate(repo, "mneme.system.upgrade", {});
    return drainQueue(repo, async () => ({ ok: true })).then(() => {
      // Now the queue file contains the executed entry — readQueue should hide it
      expect(readQueue(repo)).toHaveLength(0);
    });
  });

  it("drainQueue invokes the executor for each pending mandate + reports counts", async () => {
    enqueueMandate(repo, "tool.a", { x: 1 });
    enqueueMandate(repo, "tool.b", { y: 2 });
    enqueueMandate(repo, "tool.c", {});
    const seen: string[] = [];
    const result = await drainQueue(repo, async (mandate) => {
      seen.push(mandate);
      return { ok: mandate !== "tool.b", error: mandate === "tool.b" ? "boom" : undefined };
    });
    expect(seen.sort()).toEqual(["tool.a", "tool.b", "tool.c"]);
    expect(result.drained).toBe(3);
    expect(result.executed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("tool.b: boom");
  });

  it("drainQueue on empty queue is a fast no-op (drained=0)", async () => {
    const result = await drainQueue(repo, async () => ({ ok: true }));
    expect(result).toEqual({ drained: 0, executed: 0, failed: 0, errors: [] });
  });

  it("drainQueue after success archives the file (rename) — second drain is empty", async () => {
    enqueueMandate(repo, "tool.x", {});
    await drainQueue(repo, async () => ({ ok: true }));
    // After drain, the original file is renamed to .drained-<ts>; primary file is gone
    expect(existsSync(join(repo, ".mneme/auto-action-queue.jsonl"))).toBe(false);
    const second = await drainQueue(repo, async () => ({ ok: true }));
    expect(second.drained).toBe(0);
  });
});
