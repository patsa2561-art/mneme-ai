import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendTurn,
  buildSessionContext,
  clearSession,
  readSession,
  SESSION_IDLE_MS,
  type AskTurn,
  type Session,
} from "./session.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-session-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const sampleTurn = (i: number): AskTurn => ({
  at: new Date(2026, 4, 1, 12, i).toISOString(),
  question: `Why does payment retry fail in handler ${i}?`,
  topHashes: [`hash${i}a`, `hash${i}b`],
  topFiles: [`src/payment/handler${i}.ts`],
  confidence: "medium",
});

describe("session — round-trip", () => {
  it("appends a turn and reads it back", () => {
    appendTurn(tmpDir, sampleTurn(1));
    const s = readSession(tmpDir);
    expect(s).not.toBeNull();
    expect(s!.turns).toHaveLength(1);
    expect(s!.turns[0]!.question).toContain("payment");
    expect(s!.turns[0]!.topHashes).toEqual(["hash1a", "hash1b"]);
  });

  it("preserves turn order across multiple appends", () => {
    appendTurn(tmpDir, sampleTurn(1));
    appendTurn(tmpDir, sampleTurn(2));
    appendTurn(tmpDir, sampleTurn(3));
    const s = readSession(tmpDir)!;
    expect(s.turns.map((t) => t.topHashes[0])).toEqual(["hash1a", "hash2a", "hash3a"]);
  });
});

describe("session — expiration", () => {
  it("returns null when last activity is older than 1 hour", () => {
    appendTurn(tmpDir, sampleTurn(1));
    // The session was just written. Advance "now" by > 1 hour and read.
    const future = Date.now() + SESSION_IDLE_MS + 60_000;
    expect(readSession(tmpDir, future)).toBeNull();
  });

  it("returns the session when within the idle window", () => {
    appendTurn(tmpDir, sampleTurn(1));
    const future = Date.now() + SESSION_IDLE_MS - 60_000;
    expect(readSession(tmpDir, future)).not.toBeNull();
  });

  it("returns null when file is missing", () => {
    expect(readSession(tmpDir)).toBeNull();
  });

  it("returns null when file is corrupt JSON", () => {
    const path = join(tmpDir, ".mneme", "session.json");
    mkdirSync(join(tmpDir, ".mneme"), { recursive: true });
    writeFileSync(path, "{ not valid json", "utf8");
    expect(readSession(tmpDir)).toBeNull();
  });
});

describe("session — turn cap", () => {
  it("retains only the last 20 turns when 25 are appended", () => {
    for (let i = 1; i <= 25; i++) {
      appendTurn(tmpDir, sampleTurn(i));
    }
    const s = readSession(tmpDir)!;
    expect(s.turns).toHaveLength(20);
    // Oldest 5 dropped — first remaining is turn #6.
    expect(s.turns[0]!.topHashes[0]).toBe("hash6a");
    expect(s.turns[19]!.topHashes[0]).toBe("hash25a");
  });
});

describe("session — context building", () => {
  it("returns an empty context for a null session", () => {
    const ctx = buildSessionContext(null);
    expect(ctx.recentHashes.size).toBe(0);
    expect(ctx.recentFiles.size).toBe(0);
    expect(ctx.recentTopics.size).toBe(0);
  });

  it("aggregates hashes, files, and topics from recent turns", () => {
    appendTurn(tmpDir, {
      at: new Date().toISOString(),
      question: "Why does payment retry fail?",
      topHashes: ["abc", "def"],
      topFiles: ["src/pay.ts"],
      confidence: "high",
    });
    appendTurn(tmpDir, {
      at: new Date().toISOString(),
      question: "How does the payment retry interact with billing?",
      topHashes: ["def", "ghi"],
      topFiles: ["src/bill.ts"],
      confidence: "medium",
    });
    const s = readSession(tmpDir);
    const ctx = buildSessionContext(s);
    // Hashes union'd.
    expect([...ctx.recentHashes].sort()).toEqual(["abc", "def", "ghi"]);
    // Files union'd.
    expect([...ctx.recentFiles].sort()).toEqual(["src/bill.ts", "src/pay.ts"]);
    // "payment" appears in both questions, so its weight should be >= 2.
    expect(ctx.recentTopics.get("payment")).toBeGreaterThanOrEqual(2);
    expect(ctx.recentTopics.get("retry")).toBeGreaterThanOrEqual(2);
    // Stop words must NOT make it into topics.
    expect(ctx.recentTopics.has("the")).toBe(false);
    expect(ctx.recentTopics.has("does")).toBe(false);
  });

  it("only considers the last 5 turns when building topics", () => {
    for (let i = 1; i <= 7; i++) {
      appendTurn(tmpDir, {
        at: new Date(2026, 4, 1, 12, i).toISOString(),
        question: `unique${i}word topic${i}`,
        topHashes: [`h${i}`],
        topFiles: [`f${i}.ts`],
        confidence: "low",
      });
    }
    const ctx = buildSessionContext(readSession(tmpDir));
    // The first two turns' unique tokens should be evicted by the 5-turn window.
    expect(ctx.recentTopics.has("unique1word")).toBe(false);
    expect(ctx.recentTopics.has("unique2word")).toBe(false);
    expect(ctx.recentTopics.has("unique7word")).toBe(true);
  });
});

describe("session — clearSession", () => {
  it("removes the file when present", () => {
    appendTurn(tmpDir, sampleTurn(1));
    expect(existsSync(join(tmpDir, ".mneme", "session.json"))).toBe(true);
    clearSession(tmpDir);
    expect(existsSync(join(tmpDir, ".mneme", "session.json"))).toBe(false);
    expect(readSession(tmpDir)).toBeNull();
  });

  it("is a no-op when no session file exists", () => {
    expect(() => clearSession(tmpDir)).not.toThrow();
  });
});

describe("session — concurrent writes", () => {
  it("never leaves the JSON file in a corrupt state", () => {
    // Fire many appends in quick succession. Atomic-rename pattern guarantees
    // any successful read sees a fully-written JSON document, never a partial one.
    for (let i = 0; i < 30; i++) {
      appendTurn(tmpDir, sampleTurn(i));
    }
    const path = join(tmpDir, ".mneme", "session.json");
    const raw = readFileSync(path, "utf8");
    // Must parse cleanly.
    const parsed = JSON.parse(raw) as Session;
    expect(Array.isArray(parsed.turns)).toBe(true);
    expect(parsed.turns.length).toBeGreaterThan(0);
    expect(parsed.turns.length).toBeLessThanOrEqual(20);
  });
});

describe("session — missing repo dir", () => {
  it("readSession returns null for a non-existent path", () => {
    expect(readSession(join(tmpDir, "does-not-exist"))).toBeNull();
  });

  it("appendTurn creates .mneme dir under an existing repoRoot", () => {
    // The repo root exists (tmpDir) but .mneme does not yet.
    appendTurn(tmpDir, sampleTurn(1));
    expect(existsSync(join(tmpDir, ".mneme", "session.json"))).toBe(true);
  });
});
