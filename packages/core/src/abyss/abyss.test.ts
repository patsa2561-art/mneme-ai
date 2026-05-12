import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, statSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneCapsules, scheduledPrune } from "./scythe.js";
import { archiveSoul, listSouls, replaySoul, markUsed } from "./revenant.js";
import { renderHomunculusRequest, parseHomunculusReturn, summarizeHomunculusReturn } from "./homunculus.js";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-abyss-"));
}

function writeCapsule(repoRoot: string, name: string, ageMs: number, payload: object = {}): string {
  const dir = join(repoRoot, ".mneme/capsules");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
  const past = (Date.now() - ageMs) / 1000;
  utimesSync(p, past, past);
  return p;
}

// ─── SCYTHE ──────────────────────────────────────────────────────────

describe("v1.76 ABYSS · Scythe (capsule TTL + auto-prune)", () => {
  let repo: string;
  beforeEach(() => {
    repo = tmpRepo();
  });

  it("returns empty report when capsule dir doesn't exist", () => {
    const r = pruneCapsules(repo);
    expect(r.scannedCount).toBe(0);
    expect(r.prunedCount).toBe(0);
  });

  it("prunes capsules older than TTL", () => {
    writeCapsule(repo, "old.capsule", 40 * 24 * 60 * 60 * 1000); // 40 days
    writeCapsule(repo, "young.capsule", 1 * 24 * 60 * 60 * 1000); // 1 day
    const r = pruneCapsules(repo);
    expect(r.scannedCount).toBe(2);
    expect(r.prunedCount).toBe(1);
    expect(r.pruned[0]!.file).toBe("old.capsule");
    expect(r.pruned[0]!.reason).toBe("ttl-exceeded");
  });

  it("respects maxCount cap (newest first wins)", () => {
    for (let i = 0; i < 10; i++) writeCapsule(repo, `c${i}.capsule`, i * 60_000); // each 1 min older
    const r = pruneCapsules(repo, { maxCount: 5, ttlMs: 365 * 24 * 60 * 60 * 1000 });
    expect(r.scannedCount).toBe(10);
    expect(r.prunedCount).toBe(5);
    for (const p of r.pruned) {
      expect(p.reason === "count-cap-exceeded" || p.reason === "both").toBe(true);
    }
  });

  it("immune entries (`keep: true`) survive pruning", () => {
    writeCapsule(repo, "old-but-kept.capsule", 40 * 24 * 60 * 60 * 1000, { keep: true });
    writeCapsule(repo, "old.capsule", 40 * 24 * 60 * 60 * 1000);
    const r = pruneCapsules(repo);
    expect(r.prunedCount).toBe(1);
    expect(r.pruned[0]!.file).toBe("old.capsule");
    expect(r.keptCount).toBe(1);
    // Kept file still on disk.
    expect(existsSync(join(repo, ".mneme/capsules/old-but-kept.capsule"))).toBe(true);
  });

  it("dryRun reports without deleting", () => {
    const p = writeCapsule(repo, "ancient.capsule", 100 * 24 * 60 * 60 * 1000);
    const r = pruneCapsules(repo, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.prunedCount).toBe(1);
    expect(existsSync(p)).toBe(true);
  });

  it("writes audit log to .mneme/abyss/scythe.jsonl", () => {
    writeCapsule(repo, "old.capsule", 40 * 24 * 60 * 60 * 1000);
    pruneCapsules(repo);
    const auditPath = join(repo, ".mneme/abyss/scythe.jsonl");
    expect(existsSync(auditPath)).toBe(true);
    const log = readFileSync(auditPath, "utf8");
    expect(log).toContain("old.capsule");
    expect(log).toContain("pruned");
  });

  it("scheduledPrune is a shortcut for default opts", () => {
    writeCapsule(repo, "old.capsule", 40 * 24 * 60 * 60 * 1000);
    const r = scheduledPrune(repo);
    expect(r.prunedCount).toBe(1);
  });

  it("bytes reclaimed is non-zero when files are deleted", () => {
    writeCapsule(repo, "old.capsule", 40 * 24 * 60 * 60 * 1000, { padding: "x".repeat(500) });
    const r = pruneCapsules(repo);
    expect(r.bytesReclaimed).toBeGreaterThan(100);
  });
});

// ─── REVENANT ────────────────────────────────────────────────────────

describe("v1.76 ABYSS · Revenant (soul archive)", () => {
  let repo: string;
  beforeEach(() => {
    repo = tmpRepo();
  });

  it("archives a soul and assigns a stable id", () => {
    const entry = archiveSoul(repo, { text: "# 🧬 MNEME SOUL PROMPT\nbody", vendor: "claude", fingerprint: "abc" });
    expect(entry.id).toMatch(/^[a-f0-9]{16}$/);
    expect(entry.used).toBe(false);
    const replayed = replaySoul(repo, entry.id);
    expect(replayed).not.toBeNull();
    expect(replayed!.text).toContain("MNEME SOUL PROMPT");
  });

  it("listSouls returns newest first", async () => {
    archiveSoul(repo, { text: "soul1", vendor: "claude", fingerprint: "x" });
    await new Promise((r) => setTimeout(r, 5));
    archiveSoul(repo, { text: "soul2", vendor: "claude", fingerprint: "x" });
    const list = listSouls(repo);
    expect(list.length).toBe(2);
    expect(list[0]!.createdAt >= list[1]!.createdAt).toBe(true);
  });

  it("filter by vendor works", () => {
    archiveSoul(repo, { text: "a", vendor: "claude", fingerprint: "x" });
    archiveSoul(repo, { text: "b", vendor: "gemini", fingerprint: "x" });
    expect(listSouls(repo, { vendor: "claude" }).length).toBe(1);
    expect(listSouls(repo, { vendor: "gemini" }).length).toBe(1);
  });

  it("markUsed flips the flag + records timestamp", () => {
    const e = archiveSoul(repo, { text: "soul", vendor: "claude", fingerprint: "x" });
    const ok = markUsed(repo, e.id, "chatgpt");
    expect(ok).toBe(true);
    const replayed = replaySoul(repo, e.id);
    expect(replayed!.used).toBe(true);
    expect(replayed!.destinationVendor).toBe("chatgpt");
    expect(replayed!.usedAt).toBeDefined();
  });

  it("markUsed on missing id returns false", () => {
    expect(markUsed(repo, "nope-0000000000")).toBe(false);
  });

  it("usedOnly / unusedOnly filters", () => {
    const a = archiveSoul(repo, { text: "a", vendor: "claude", fingerprint: "x" });
    archiveSoul(repo, { text: "b", vendor: "claude", fingerprint: "x" });
    markUsed(repo, a.id);
    expect(listSouls(repo, { usedOnly: true }).length).toBe(1);
    expect(listSouls(repo, { unusedOnly: true }).length).toBe(1);
  });
});

// ─── HOMUNCULUS ──────────────────────────────────────────────────────

describe("v1.76 ABYSS · Homunculus (receiver write-back)", () => {
  it("renderHomunculusRequest produces a contract block", () => {
    const md = renderHomunculusRequest({ originatorVendor: "claude-opus-4-7" });
    expect(md).toContain("Homunculus request");
    expect(md).toContain("HOMUNCULUS RETURN");
    expect(md).toContain("originator: claude-opus-4-7");
  });

  it("parseHomunculusReturn round-trips a structured return", () => {
    const text = [
      "Some preamble",
      "",
      "# HOMUNCULUS RETURN",
      "originator: claude-opus-4-7",
      "returning_from: gpt-5",
      "decisions: |",
      "  - prefer Gist over clipboard",
      "  - revisit telepathy v2 next session",
      "reasoning: |",
      "  - npm latest is the single source of truth",
      "next_actions: |",
      "  - ship abyss",
      "",
    ].join("\n");
    const parsed = parseHomunculusReturn(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.originator).toBe("claude-opus-4-7");
    expect(parsed!.returningFrom).toBe("gpt-5");
    expect(parsed!.decisions.length).toBe(2);
    expect(parsed!.reasoning.length).toBe(1);
    expect(parsed!.nextActions.length).toBe(1);
    expect(parsed!.vaccines.length).toBe(0);
  });

  it("parseHomunculusReturn returns null when block is missing", () => {
    expect(parseHomunculusReturn("just some chat output")).toBeNull();
  });

  it("parseHomunculusReturn returns null when required fields are missing", () => {
    const text = "# HOMUNCULUS RETURN\norigin: missing";
    expect(parseHomunculusReturn(text)).toBeNull();
  });

  it("summarizeHomunculusReturn is a one-line digest", () => {
    const r = {
      originator: "claude-opus-4-7",
      returningFrom: "gpt-5",
      decisions: ["a", "b"],
      reasoning: ["r"],
      vaccines: [],
      nextActions: ["n"],
    };
    const s = summarizeHomunculusReturn(r);
    expect(s).toContain("Homunculus return");
    expect(s).toContain("Decisions: 2");
    expect(s).toContain("Reasoning highlights: 1");
    expect(s).not.toContain("vaccines");
  });
});
