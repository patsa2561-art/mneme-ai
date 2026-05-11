import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, utimesSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { takeSnapshot, verifyVault, listSnapshots, verifyChain } from "./ransom_vault.js";

function seedVault(repo: string): void {
  mkdirSync(join(repo, ".mneme"), { recursive: true });
  writeFileSync(join(repo, ".mneme/file_a.json"), JSON.stringify({ a: 1 }));
  writeFileSync(join(repo, ".mneme/file_b.jsonl"), "line1\nline2\n");
  mkdirSync(join(repo, ".mneme/sub"), { recursive: true });
  writeFileSync(join(repo, ".mneme/sub/file_c.txt"), "content");
}

describe("teeth/ransom_vault · snapshot + verify", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-vault-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("first snapshot returns canary-OK + correct file count", () => {
    seedVault(repo);
    const s = takeSnapshot(repo);
    expect(s.fileCount).toBe(4); // 3 seeded + 1 canary
    expect(s.canaryOk).toBe(true);
    expect(s.prevRootHash).toBeNull();
    expect(s.rootHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("clean run: takeSnapshot → verifyVault returns 'clean'", () => {
    seedVault(repo);
    takeSnapshot(repo);
    const v = verifyVault(repo);
    expect(v.outcome).toBe("clean");
    expect(v.changed).toEqual([]);
  });

  it("returns 'no-baseline' when verifying without prior snapshot", () => {
    seedVault(repo);
    const v = verifyVault(repo);
    expect(v.outcome).toBe("no-baseline");
    expect(v.baselineRootHash).toBeNull();
  });

  it("detects content modification → 'drift' with correct path", () => {
    seedVault(repo);
    takeSnapshot(repo);
    writeFileSync(join(repo, ".mneme/file_a.json"), JSON.stringify({ a: 999 }));
    const v = verifyVault(repo);
    expect(v.outcome).toBe("drift");
    expect(v.changed.some((c) => c.path.endsWith("file_a.json") && c.reason === "modified")).toBe(true);
  });

  it("detects deletion", () => {
    seedVault(repo);
    takeSnapshot(repo);
    unlinkSync(join(repo, ".mneme/file_b.jsonl"));
    const v = verifyVault(repo);
    expect(v.outcome).toBe("drift");
    expect(v.changed.some((c) => c.path.endsWith("file_b.jsonl") && c.reason === "deleted")).toBe(true);
  });

  it("detects addition", () => {
    seedVault(repo);
    takeSnapshot(repo);
    writeFileSync(join(repo, ".mneme/new_file.json"), "{}");
    const v = verifyVault(repo);
    expect(v.outcome).toBe("drift");
    expect(v.changed.some((c) => c.path.endsWith("new_file.json") && c.reason === "added")).toBe(true);
  });

  it("flags silent encryption (content changed but mtime preserved)", () => {
    seedVault(repo);
    const s = takeSnapshot(repo);
    const targetPath = join(repo, ".mneme/file_a.json");
    const origStat = readFileSync(targetPath);
    void origStat;
    // ransomware-style: encrypt content, then restore mtime
    const origMtime = (require("node:fs") as typeof import("node:fs")).statSync(targetPath).mtime;
    writeFileSync(targetPath, "ENCRYPTED-PAYLOAD");
    utimesSync(targetPath, origMtime, origMtime);
    const v = verifyVault(repo);
    expect(v.outcome).toBe("drift");
    expect(v.silentEncryptionSuspected).toBe(true);
    expect(s.rootHash).not.toBe(v.rootHash);
  });

  it("flags 'tampered' when canary deleted", () => {
    seedVault(repo);
    takeSnapshot(repo);
    unlinkSync(join(repo, ".mneme/.canary-do-not-touch"));
    const v = verifyVault(repo);
    expect(v.canaryOk).toBe(false);
    expect(v.outcome).toBe("tampered");
  });

  it("flags 'tampered' when canary content modified", () => {
    seedVault(repo);
    takeSnapshot(repo);
    writeFileSync(join(repo, ".mneme/.canary-do-not-touch"), "edited by attacker");
    const v = verifyVault(repo);
    expect(v.canaryOk).toBe(false);
    expect(v.outcome).toBe("tampered");
  });

  it("snapshot list grows by 1 per snapshot", () => {
    seedVault(repo);
    takeSnapshot(repo);
    takeSnapshot(repo);
    takeSnapshot(repo);
    expect(listSnapshots(repo)).toHaveLength(3);
  });
});

describe("teeth/ransom_vault · snapshot chain", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-vault-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("intact chain verifies ok", () => {
    seedVault(repo);
    takeSnapshot(repo);
    writeFileSync(join(repo, ".mneme/file_a.json"), JSON.stringify({ a: 2 }));
    takeSnapshot(repo);
    writeFileSync(join(repo, ".mneme/file_a.json"), JSON.stringify({ a: 3 }));
    takeSnapshot(repo);
    const r = verifyChain(repo);
    expect(r.ok).toBe(true);
    expect(r.length).toBe(3);
  });

  it("empty ledger verifies trivially ok", () => {
    expect(verifyChain(repo).ok).toBe(true);
  });

  it("detects broken chain when middle snapshot rewritten", () => {
    seedVault(repo);
    takeSnapshot(repo);
    writeFileSync(join(repo, ".mneme/file_a.json"), JSON.stringify({ a: 2 }));
    takeSnapshot(repo);
    takeSnapshot(repo);
    // attacker rewrites the ledger, dropping the middle snapshot
    const ledgerPath = join(repo, ".mneme/vault-snapshots/ledger.jsonl");
    const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim());
    const tampered = [lines[0], lines[2]].join("\n") + "\n";
    writeFileSync(ledgerPath, tampered);
    const r = verifyChain(repo);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
  });
});
