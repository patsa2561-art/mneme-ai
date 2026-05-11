import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSoul, recordOutcome, recordCommitment, renderSoulBlock, listSouls } from "./ai_soul.js";

describe("ai_soul · diary primitives", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-soul-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("readSoul returns a fresh diary when none exists", () => {
    const s = readSoul(repo, "claude-opus-4-7");
    expect(s.vendor).toBe("claude-opus-4-7");
    expect(s.lifetimeSessions).toBe(0);
    expect(s.complianceLifetime).toBe(1);
    expect(s.pastCommitments).toEqual([]);
    expect(s.keptPromises).toBe(0);
    expect(s.brokenPromises).toBe(0);
  });

  it("session-start increments lifetime sessions + persists", () => {
    recordOutcome(repo, "v", "session-start");
    recordOutcome(repo, "v", "session-start");
    expect(readSoul(repo, "v").lifetimeSessions).toBe(2);
    expect(existsSync(join(repo, ".mneme/ai-souls/v.json"))).toBe(true);
  });

  it("kept promises raise lifetime compliance, broken lower it", () => {
    recordOutcome(repo, "v", "promise-kept", "p1");
    recordOutcome(repo, "v", "promise-kept", "p2");
    recordOutcome(repo, "v", "promise-broken", "p3");
    const s = readSoul(repo, "v");
    expect(s.keptPromises).toBe(2);
    expect(s.brokenPromises).toBe(1);
    expect(s.complianceLifetime).toBeCloseTo(2 / 3, 4);
  });

  it("recordCommitment appends an OPEN promise (no kept/broken yet)", () => {
    recordCommitment(repo, "v", "always cite specific commits");
    const s = readSoul(repo, "v");
    expect(s.pastCommitments).toHaveLength(1);
    expect(s.pastCommitments[0]!.text).toBe("always cite specific commits");
    expect(s.pastCommitments[0]!.keptAt).toBeUndefined();
    expect(s.pastCommitments[0]!.brokenAt).toBeUndefined();
  });

  it("promise-kept matches by text + sets keptAt on the right commitment", () => {
    recordCommitment(repo, "v", "always cite specific commits");
    recordOutcome(repo, "v", "promise-kept", "always cite specific commits");
    const s = readSoul(repo, "v");
    expect(s.pastCommitments[0]!.keptAt).toBeDefined();
    expect(s.keptPromises).toBe(1);
  });

  it("renderSoulBlock outputs compact pulse-friendly text", () => {
    recordOutcome(repo, "v", "session-start");
    recordCommitment(repo, "v", "always cite specific commits");
    const s = readSoul(repo, "v");
    const block = renderSoulBlock(s);
    expect(block).toContain("MNEME SOUL");
    expect(block).toContain("v");
    expect(block).toContain("always cite specific commits");
  });

  it("vendor name is slugified safely (path-traversal proof)", () => {
    recordOutcome(repo, "../../../etc/passwd", "session-start");
    // The slug must contain "etc-passwd" AND must NOT escape the souls dir.
    const souls = listSouls(repo);
    expect(souls.some((v) => v.includes("etc-passwd"))).toBe(true);
    // No file should be created above .mneme/ai-souls/
    expect(existsSync(join(repo, "../etc/passwd"))).toBe(false);
  });

  it("listSouls returns every vendor on disk", () => {
    recordOutcome(repo, "claude-opus-4-7", "session-start");
    recordOutcome(repo, "cursor-cmd-k", "session-start");
    expect(listSouls(repo).sort()).toEqual(["claude-opus-4-7", "cursor-cmd-k"]);
  });

  it("signature changes on every write (HMAC chain)", () => {
    recordOutcome(repo, "v", "session-start");
    const s1 = readSoul(repo, "v");
    recordOutcome(repo, "v", "promise-kept", "p1");
    const s2 = readSoul(repo, "v");
    expect(s2.signature).not.toBe(s1.signature);
    expect(s2.signature).toMatch(/^[a-f0-9]{16}$/);
  });
});
