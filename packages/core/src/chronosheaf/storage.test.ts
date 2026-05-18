import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureStorageDir, persist, readStored, verifyChain, storageStats, chainHead, chainLength,
} from "./storage.js";

const SECRET = "chronosheaf-storage-test-secret-77";

let tmpRepo: string;

beforeEach(() => {
  tmpRepo = mkdtempSync(join(tmpdir(), "chronosheaf-storage-"));
});

afterEach(() => {
  try { rmSync(tmpRepo, { recursive: true, force: true }); } catch { /* */ }
});

describe("v2.19.49 CHRONOSHEAF STORAGE · directory creation", () => {
  it("ensureStorageDir creates .mneme/chronosheaf path idempotently", () => {
    const dir = ensureStorageDir(tmpRepo);
    expect(existsSync(dir)).toBe(true);
    // Re-run is idempotent.
    ensureStorageDir(tmpRepo);
    expect(existsSync(dir)).toBe(true);
  });
  it("storageStats reports empty state on fresh repo", () => {
    const s = storageStats(tmpRepo);
    expect(s.chainEntries).toBe(0);
    expect(s.chainHeadSig).toBe("");
    expect(s.filesPresent).toEqual([]);
  });
});

describe("v2.19.49 CHRONOSHEAF STORAGE · persist + read round trip", () => {
  it("persist writes file + chain entry", () => {
    const r = persist(tmpRepo, { kind: "cover", payload: { sites: ["A", "B"] }, secret: SECRET });
    expect(existsSync(r.path)).toBe(true);
    expect(r.entry.seq).toBe(0);
    expect(r.entry.prevSig).toBe("");
    expect(r.chainLength).toBe(1);
  });
  it("readStored round-trips the same payload", () => {
    const payload = { sites: ["X", "Y"], extra: 42 };
    persist(tmpRepo, { kind: "cover", payload, secret: SECRET });
    const r = readStored<typeof payload>(tmpRepo, "cover");
    expect(r).toEqual(payload);
  });
  it("readStored returns null on missing file", () => {
    expect(readStored(tmpRepo, "nonexistent")).toBeNull();
  });
});

describe("v2.19.49 CHRONOSHEAF STORAGE · HMAC chain integrity", () => {
  it("chain links each entry's prevSig to previous sig", () => {
    const e1 = persist(tmpRepo, { kind: "cover", payload: { v: 1 }, secret: SECRET });
    const e2 = persist(tmpRepo, { kind: "cech", payload: { v: 2 }, secret: SECRET });
    expect(e2.entry.prevSig).toBe(e1.entry.sig);
    expect(e2.entry.seq).toBe(1);
    expect(chainHead(tmpRepo)).toBe(e2.entry.sig);
    expect(chainLength(tmpRepo)).toBe(2);
  });
  it("verifyChain succeeds on clean chain", () => {
    persist(tmpRepo, { kind: "cover", payload: { v: 1 }, secret: SECRET });
    persist(tmpRepo, { kind: "cech", payload: { v: 2 }, secret: SECRET });
    persist(tmpRepo, { kind: "rg_fixed_points", payload: { v: 3 }, secret: SECRET });
    const r = verifyChain(tmpRepo, SECRET);
    expect(r.ok).toBe(true);
    expect(r.entries).toBe(3);
  });
  it("verifyChain detects tamper (manual file edit)", () => {
    persist(tmpRepo, { kind: "cover", payload: { v: 1 }, secret: SECRET });
    persist(tmpRepo, { kind: "cech", payload: { v: 2 }, secret: SECRET });
    // Tamper: corrupt the chain entry directly.
    const chainPath = join(tmpRepo, ".mneme/chronosheaf/chain.jsonl");
    const txt = readFileSync(chainPath, "utf8");
    const tampered = txt.replace(/"seq":1/, '"seq":99');
    require("node:fs").writeFileSync(chainPath, tampered);
    const r = verifyChain(tmpRepo, SECRET);
    expect(r.ok).toBe(false);
  });
  it("verifyChain returns ok on missing chain", () => {
    const r = verifyChain(tmpRepo, SECRET);
    expect(r.ok).toBe(true);
    expect(r.entries).toBe(0);
  });
});

describe("v2.19.49 CHRONOSHEAF STORAGE · resilience", () => {
  it("persist with massive payload still works (1MB JSON)", () => {
    const payload = { big: "x".repeat(1_000_000) };
    const r = persist(tmpRepo, { kind: "state", payload, secret: SECRET });
    expect(r.chainLength).toBe(1);
    const back = readStored<typeof payload>(tmpRepo, "state");
    expect(back?.big.length).toBe(1_000_000);
  });
  it("persistence kind is append-only (jsonl)", () => {
    persist(tmpRepo, { kind: "persistence", payload: { snap: 1 }, secret: SECRET });
    persist(tmpRepo, { kind: "persistence", payload: { snap: 2 }, secret: SECRET });
    persist(tmpRepo, { kind: "persistence", payload: { snap: 3 }, secret: SECRET });
    const path = join(tmpRepo, ".mneme/chronosheaf/persistence.jsonl");
    const txt = readFileSync(path, "utf8");
    const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(3);
  });
});
