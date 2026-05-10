import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pushInbox, readInbox, popUnsent, formatForWisdom, deterministicId, _clearInboxForTests,
  popInboxBySource, pushInboxReplacingSource, ackInbox, clearInbox, countUnsent,
} from "./inbox.js";

describe("inbox.push + read", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-inbox-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("push writes a JSONL line and read returns it", () => {
    const m = pushInbox(repo, { priority: "high", source: "test", title: "hello" });
    expect(m.id).toMatch(/^[a-f0-9]{12}$/);
    expect(m.sent).toBe(false);
    expect(m.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const all = readInbox(repo);
    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe("hello");
  });

  it("is idempotent on id — repeated push of same id is a no-op", () => {
    pushInbox(repo, { priority: "low", source: "test", title: "same", id: "fixed-id" });
    pushInbox(repo, { priority: "low", source: "test", title: "same", id: "fixed-id" });
    pushInbox(repo, { priority: "low", source: "test", title: "same", id: "fixed-id" });
    expect(readInbox(repo)).toHaveLength(1);
  });

  it("auto-derives id from title+source+body when not given", () => {
    const a = pushInbox(repo, { priority: "low", source: "test", title: "alpha", body: "x" });
    // re-push same content → idempotent
    pushInbox(repo, { priority: "low", source: "test", title: "alpha", body: "x" });
    // different body → new entry
    pushInbox(repo, { priority: "low", source: "test", title: "alpha", body: "y" });
    const all = readInbox(repo);
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(a.id);
    expect(all[1]!.id).not.toBe(a.id);
  });

  it("returns empty when file does not exist", () => {
    expect(readInbox(repo)).toEqual([]);
  });

  it("survives malformed lines", () => {
    pushInbox(repo, { priority: "low", source: "test", title: "ok" });
    // Append garbage manually.
    const path = join(repo, ".mneme", "inbox.jsonl");
    const raw = readFileSync(path, "utf8");
    writeFileSync(path, raw + "not-json\n", "utf8");
    expect(readInbox(repo)).toHaveLength(1);
  });
});

describe("popUnsent", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-inbox-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns up to N unsent and flips their sent flag", () => {
    pushInbox(repo, { priority: "low", source: "t", title: "a" });
    pushInbox(repo, { priority: "low", source: "t", title: "b" });
    pushInbox(repo, { priority: "low", source: "t", title: "c" });
    const out = popUnsent(repo, 2);
    expect(out).toHaveLength(2);
    // Re-pop should only return what's left
    const out2 = popUnsent(repo, 5);
    expect(out2).toHaveLength(1);
    // All marked sent now
    const all = readInbox(repo);
    expect(all.every((m) => m.sent)).toBe(true);
    expect(all.every((m) => typeof m.sentAt === "string")).toBe(true);
  });

  it("sorts by priority desc then createdAt asc", () => {
    pushInbox(repo, { priority: "low", source: "t", title: "low-1" });
    pushInbox(repo, { priority: "critical", source: "t", title: "crit" });
    pushInbox(repo, { priority: "high", source: "t", title: "high" });
    pushInbox(repo, { priority: "medium", source: "t", title: "med" });
    const out = popUnsent(repo, 4);
    expect(out.map((m) => m.title)).toEqual(["crit", "high", "med", "low-1"]);
  });

  it("returns [] when there is nothing to pop", () => {
    expect(popUnsent(repo, 3)).toEqual([]);
  });
});

describe("formatForWisdom", () => {
  it("returns empty string for no messages", () => {
    expect(formatForWisdom([])).toBe("");
  });
  it("renders priority glyphs and CTAs", () => {
    const out = formatForWisdom([
      { id: "1", createdAt: "x", priority: "critical", source: "t", title: "boom", sent: false, body: "core melt", cta: "say 'fix'" },
      { id: "2", createdAt: "x", priority: "low", source: "t", title: "fyi", sent: false },
    ]);
    expect(out).toContain("🚨");
    expect(out).toContain("**Mneme · boom**");
    expect(out).toContain("core melt");
    expect(out).toContain("(say 'fix')");
    expect(out).toContain("💬");
  });
});

describe("deterministicId", () => {
  it("returns stable 12-char hex for the same seed", () => {
    expect(deterministicId("abc")).toBe(deterministicId("abc"));
    expect(deterministicId("abc")).toMatch(/^[a-f0-9]{12}$/);
    expect(deterministicId("abc")).not.toBe(deterministicId("abd"));
  });
});

describe("_clearInboxForTests", () => {
  it("empties the inbox", () => {
    const repo = mkdtempSync(join(tmpdir(), "mneme-inbox-"));
    pushInbox(repo, { priority: "low", source: "t", title: "x" });
    _clearInboxForTests(repo);
    expect(readInbox(repo)).toEqual([]);
    rmSync(repo, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v1.26.3 (Bug #1) — popInboxBySource + pushInboxReplacingSource
// ─────────────────────────────────────────────────────────────────────────
describe("v1.26.3 (Bug #1): version-check inbox dedup", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-inbox-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("popInboxBySource removes only entries from the named source", () => {
    pushInbox(repo, { priority: "high", source: "version-check", title: "v1.25.2 available" });
    pushInbox(repo, { priority: "high", source: "version-check", title: "v1.26.0 available" });
    pushInbox(repo, { priority: "low", source: "daemon", title: "10 mutations" });
    expect(readInbox(repo)).toHaveLength(3);
    const removed = popInboxBySource(repo, "version-check");
    expect(removed).toBe(2);
    const left = readInbox(repo);
    expect(left).toHaveLength(1);
    expect(left[0]!.source).toBe("daemon");
  });

  it("popInboxBySource returns 0 when no entries match", () => {
    pushInbox(repo, { priority: "low", source: "daemon", title: "x" });
    expect(popInboxBySource(repo, "nonexistent")).toBe(0);
    expect(readInbox(repo)).toHaveLength(1);
  });

  it("pushInboxReplacingSource removes existing source entries before pushing", () => {
    pushInbox(repo, { priority: "high", source: "version-check", title: "v1.25.2 available" });
    pushInbox(repo, { priority: "high", source: "version-check", title: "v1.26.0 available" });
    expect(readInbox(repo)).toHaveLength(2);
    const m = pushInboxReplacingSource(repo, {
      priority: "high", source: "version-check", title: "v1.26.3 available",
    });
    expect(m).not.toBeNull();
    const left = readInbox(repo);
    expect(left).toHaveLength(1);
    expect(left[0]!.title).toBe("v1.26.3 available");
  });

  it("pushInboxReplacingSource with skip()=true pops but does not push", () => {
    pushInbox(repo, { priority: "high", source: "version-check", title: "v1.26.0 available" });
    const m = pushInboxReplacingSource(repo, {
      priority: "high", source: "version-check", title: "v1.26.3 available",
    }, { skip: () => true });
    expect(m).toBeNull();
    expect(readInbox(repo)).toHaveLength(0);
  });

  it("the bug repro: 4 stale version-check entries collapse to 1 after fix", () => {
    // Simulate v1.25.2 -> v1.25.3 -> v1.26.0 -> v1.26.1 -> v1.26.3 user history
    // BEFORE fix: every push appends, leaving 4 stale entries.
    // AFTER fix: every push replaces, leaving 1.
    for (const v of ["v1.25.3", "v1.26.0", "v1.26.1", "v1.26.3"]) {
      pushInboxReplacingSource(repo, {
        priority: "high", source: "version-check",
        title: `Mneme ${v} is available`,
      });
    }
    const left = readInbox(repo);
    expect(left).toHaveLength(1);
    expect(left[0]!.title).toBe("Mneme v1.26.3 is available");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v1.26.3 (Bug #2) — ackInbox + clearInbox + countUnsent
// ─────────────────────────────────────────────────────────────────────────
describe("v1.26.3 (Bug #2): inbox ack + clear lifecycle", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-inbox-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("ackInbox(['id']) flips just that one entry's sent flag", () => {
    const a = pushInbox(repo, { priority: "low", source: "t", title: "a" });
    const b = pushInbox(repo, { priority: "low", source: "t", title: "b" });
    const n = ackInbox(repo, [a.id]);
    expect(n).toBe(1);
    const all = readInbox(repo);
    expect(all.find((m) => m.id === a.id)!.sent).toBe(true);
    expect(all.find((m) => m.id === b.id)!.sent).toBe(false);
  });

  it("ackInbox('all') flips every unsent entry", () => {
    pushInbox(repo, { priority: "low", source: "t", title: "a" });
    pushInbox(repo, { priority: "low", source: "t", title: "b" });
    pushInbox(repo, { priority: "low", source: "t", title: "c" });
    const n = ackInbox(repo, "all");
    expect(n).toBe(3);
    expect(readInbox(repo).every((m) => m.sent)).toBe(true);
  });

  it("ackInbox is idempotent (acking again returns 0)", () => {
    pushInbox(repo, { priority: "low", source: "t", title: "a" });
    expect(ackInbox(repo, "all")).toBe(1);
    expect(ackInbox(repo, "all")).toBe(0);
  });

  it("countUnsent returns the right number after ack", () => {
    pushInbox(repo, { priority: "low", source: "t", title: "a" });
    pushInbox(repo, { priority: "low", source: "t", title: "b" });
    expect(countUnsent(repo)).toBe(2);
    ackInbox(repo, "all");
    expect(countUnsent(repo)).toBe(0);
  });

  it("clearInbox('sent') removes only acked entries", () => {
    const a = pushInbox(repo, { priority: "low", source: "t", title: "a" });
    pushInbox(repo, { priority: "low", source: "t", title: "b" });
    ackInbox(repo, [a.id]);
    const n = clearInbox(repo, "sent");
    expect(n).toBe(1);
    const left = readInbox(repo);
    expect(left).toHaveLength(1);
    expect(left[0]!.title).toBe("b");
  });

  it("clearInbox('all') wipes everything sent or unsent", () => {
    pushInbox(repo, { priority: "low", source: "t", title: "a" });
    pushInbox(repo, { priority: "low", source: "t", title: "b" });
    expect(clearInbox(repo, "all")).toBe(2);
    expect(readInbox(repo)).toEqual([]);
  });

  it("clearInbox({olderThanDays: 7}) drops only old entries", () => {
    // Manually craft an old entry by writing JSONL directly.
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    pushInbox(repo, { priority: "low", source: "t", title: "fresh" });
    const path = join(repo, ".mneme/inbox.jsonl");
    const raw = readFileSync(path, "utf8");
    writeFileSync(path, JSON.stringify({
      id: "stale-x", createdAt: oldDate, priority: "low", source: "t", title: "stale", sent: false,
    }) + "\n" + raw, "utf8");
    expect(readInbox(repo)).toHaveLength(2);
    expect(clearInbox(repo, { olderThanDays: 7 })).toBe(1);
    expect(readInbox(repo)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v1.26.3 — AUTO-ACTION inbox messages
// ─────────────────────────────────────────────────────────────────────────
describe("v1.26.3: inbox AUTO-ACTION messages", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-inbox-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("pushInbox stores autoAction { tool, args }", () => {
    const m = pushInbox(repo, {
      priority: "high", source: "manual", title: "test",
      autoAction: { tool: "mneme.test.echo", args: { hello: "world" } },
    });
    expect(m.autoAction).toEqual({ tool: "mneme.test.echo", args: { hello: "world" } });
    const persisted = readInbox(repo);
    expect(persisted[0]!.autoAction?.tool).toBe("mneme.test.echo");
  });

  it("autoAction is optional (legacy entries still work)", () => {
    const m = pushInbox(repo, { priority: "low", source: "t", title: "no-aa" });
    expect(m.autoAction).toBeUndefined();
  });
});

describe("rotation cap", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-inbox-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("does not grow unbounded — auto-rotates when above 256KB cap", () => {
    const big = "x".repeat(2000);
    for (let i = 0; i < 200; i++) {
      pushInbox(repo, { priority: "low", source: "t", title: `m${i}`, body: big });
    }
    const all = readInbox(repo);
    // After rotation, file should hold roughly half — not 200.
    expect(all.length).toBeLessThan(200);
    expect(all.length).toBeGreaterThan(0);
  });
});
