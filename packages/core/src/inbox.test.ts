import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushInbox, readInbox, popUnsent, formatForWisdom, deterministicId, _clearInboxForTests } from "./inbox.js";

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
