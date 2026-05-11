/**
 * Replay Traces — unit tests for the HMAC-chained log + verifier.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordReplay, verifyChain, readReplay } from "./_replay.js";

describe("recordReplay + verifyChain", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-replay-"));
  });
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("verifyChain on an empty/missing log returns intact=true with EMPTY root", () => {
    const s = verifyChain(repo);
    expect(s.intact).toBe(true);
    expect(s.total).toBe(0);
    expect(s.root).toBe("EMPTY");
  });

  it("records entries with chain-linked hashes", () => {
    recordReplay(repo, "mneme.memory.ask", { question: "why?" }, { data: { ok: true } });
    recordReplay(repo, "mneme.audit.certify", { strict: true }, { data: { verdict: "PASS" } });
    const entries = readReplay(repo);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.prevHash).toBe("GENESIS");
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash);
  });

  it("verifyChain returns intact=true after legitimate appends", () => {
    recordReplay(repo, "tool.a", {}, { data: {} });
    recordReplay(repo, "tool.b", {}, { data: {} });
    recordReplay(repo, "tool.c", {}, { data: {} });
    const s = verifyChain(repo);
    expect(s.intact).toBe(true);
    expect(s.total).toBe(3);
    expect(s.root).not.toBe("EMPTY");
    expect(s.root).toMatch(/^[0-9a-f]+$/);
  });

  it("verifyChain detects tampering in the middle of the log", () => {
    recordReplay(repo, "tool.a", {}, { data: {} });
    recordReplay(repo, "tool.b", {}, { data: {} });
    recordReplay(repo, "tool.c", {}, { data: {} });
    // Tamper: rewrite the second line with a different tool name.
    const path = join(repo, ".mneme", "replay.jsonl");
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    const tampered = lines.map((l, i) => {
      if (i === 1) {
        const e = JSON.parse(l);
        e.tool = "tool.evil";
        return JSON.stringify(e);
      }
      return l;
    });
    writeFileSync(path, tampered.join("\n") + "\n", "utf8");
    const s = verifyChain(repo);
    expect(s.intact).toBe(false);
    expect(s.brokenAt).toBe(1);
    expect(["TAMPERED", "BROKEN", "INVALID"]).toContain(s.root);
  });

  it("verdict is captured when present in response.data.verdict", () => {
    recordReplay(repo, "mneme.audit.certify", {}, { data: { verdict: "WARN" } });
    const entries = readReplay(repo);
    expect(entries[0]!.verdict).toBe("WARN");
  });

  it("recordReplay never throws on bad input", () => {
    // Pass a circular reference — JSON.stringify throws, recorder should swallow.
    const circ: Record<string, unknown> = {};
    circ["self"] = circ;
    expect(() => recordReplay(repo, "tool.bad", circ, { data: {} })).not.toThrow();
  });

  it("readReplay respects the limit parameter (most-recent N)", () => {
    for (let i = 0; i < 10; i++) recordReplay(repo, `tool.${i}`, {}, { data: {} });
    const last3 = readReplay(repo, 3);
    expect(last3).toHaveLength(3);
    expect(last3[0]!.tool).toBe("tool.7");
    expect(last3[2]!.tool).toBe("tool.9");
  });

  it("creates the .mneme dir + secret on first record", () => {
    recordReplay(repo, "tool.a", {}, {});
    expect(existsSync(join(repo, ".mneme", "replay-secret.bin"))).toBe(true);
    expect(existsSync(join(repo, ".mneme", "replay.jsonl"))).toBe(true);
  });
});

// v1.42.2 (#19 fix) — replay file rotates at 256 KB. The HMAC chain
// must survive rotation: the first entry written AFTER a rotation must
// reference (via prevHash) the LAST entry of the rotated file.
describe("recordReplay · rotation (v1.42.2)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-replay-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("rotates the active file when it exceeds 256 KB", () => {
    // Pre-fill the replay file with > 256 KB of bogus lines so the next
    // append + rotation check trips the threshold.
    require("node:fs").mkdirSync(join(repo, ".mneme"), { recursive: true });
    const bigLine = JSON.stringify({ ts: "x", tool: "y", argHash: "a".repeat(16), responseHash: "b".repeat(16), prevHash: "GENESIS", hash: "c".repeat(32) }) + "\n";
    let blob = "";
    while (blob.length < 260 * 1024) blob += bigLine;
    writeFileSync(join(repo, ".mneme", "replay.jsonl"), blob, "utf8");
    recordReplay(repo, "tool.trigger", {}, {});
    // After the call: the active file should have been renamed to a
    // .rotated-<ts> sibling. The active file may or may not exist again
    // (depends on whether a fresh write follows the rotation in the
    // same call). We assert that AT LEAST one rotated file was created.
    const fs = require("node:fs");
    const dir = join(repo, ".mneme");
    const rotated = fs.readdirSync(dir).filter((f: string) => f.startsWith("replay.jsonl.rotated-"));
    expect(rotated.length).toBeGreaterThanOrEqual(1);
  });

  it("post-rotation chain links to the rotated file's last hash", () => {
    // Seed: write 2 valid entries to build a real chain.
    recordReplay(repo, "tool.a", {}, {});
    recordReplay(repo, "tool.b", {}, {});
    const beforeEntries = readReplay(repo);
    const lastHashBefore = beforeEntries[beforeEntries.length - 1]!.hash;
    // Force-rotate by renaming the active file (simulating the rotation
    // that would have happened at 256 KB).
    const fs = require("node:fs");
    const active = join(repo, ".mneme", "replay.jsonl");
    fs.renameSync(active, active + ".rotated-" + Date.now());
    // Now record one more entry. The new entry's prevHash MUST equal the
    // last hash of the rotated file — chain continuity across rotation.
    recordReplay(repo, "tool.c", {}, {});
    const afterEntries = readReplay(repo);
    expect(afterEntries.length).toBe(1);
    expect(afterEntries[0]!.prevHash).toBe(lastHashBefore);
  });
});
