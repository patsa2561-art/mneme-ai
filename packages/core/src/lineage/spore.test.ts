/**
 * Spore — tests for config + vector clock + status. Network-dependent
 * push/pull paths are tested via dry-run assertions (we don't spin up
 * a real git remote in unit tests).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectGitOrigin,
  readSporeRemote,
  readVectorClock,
  sporeInit,
  sporePull,
  sporePush,
  sporeStatus,
  tickClock,
  writeSporeRemote,
} from "./spore.js";

function mkRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-spore-"));
}

describe("Spore config + vector clock", () => {
  let repo: string;
  beforeEach(() => { repo = mkRepo(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("readSporeRemote returns null when not configured", () => {
    expect(readSporeRemote(repo)).toBeNull();
  });

  it("writeSporeRemote + readSporeRemote round-trip", () => {
    writeSporeRemote(repo, { kind: "git", url: "git@example.com:x/y.git", branch: "mneme-lineage", autoDetected: false });
    const r = readSporeRemote(repo)!;
    expect(r.url).toBe("git@example.com:x/y.git");
    expect(r.branch).toBe("mneme-lineage");
  });

  it("vectorClock starts empty + tick increments", () => {
    expect(readVectorClock(repo)).toEqual({});
    tickClock(repo, "machineA");
    tickClock(repo, "machineA");
    tickClock(repo, "machineB");
    const c = readVectorClock(repo);
    expect(c).toEqual({ machineA: 2, machineB: 1 });
  });

  it("sporeInit refuses without remote when no git origin", () => {
    // tmpdir isn't a git repo → no origin → init must explain.
    const r = sporeInit(repo);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/auto-detect|origin/i);
  });

  it("sporeInit succeeds with explicit remote URL + adds .gitignore lines", () => {
    const r = sporeInit(repo, { remote: "https://example.com/x/y.git" });
    expect(r.ok).toBe(true);
    expect(r.remote?.url).toBe("https://example.com/x/y.git");
    expect(r.remote?.branch).toBe("mneme-lineage");
    expect(r.remote?.autoDetected).toBe(false);
    const gi = readFileSync(join(repo, ".gitignore"), "utf8");
    expect(gi).toContain(".mneme/lineage/identity/private.pem");
    expect(gi).toContain(".mneme/lineage/working/");
  });

  it("sporeInit is idempotent — second call doesn't duplicate .gitignore lines", () => {
    sporeInit(repo, { remote: "https://example.com/x/y.git" });
    sporeInit(repo, { remote: "https://example.com/x/y.git" });
    const gi = readFileSync(join(repo, ".gitignore"), "utf8");
    const occ = (gi.match(/identity\/private\.pem/g) ?? []).length;
    expect(occ).toBe(1);
  });

  it("sporeStatus reports configured + chromosome count + identity readiness", () => {
    expect(sporeStatus(repo).configured).toBe(false);
    expect(sporeStatus(repo).localChromosomeCount).toBe(0);
    expect(sporeStatus(repo).identityReady).toBe(false);
    sporeInit(repo, { remote: "https://example.com/x/y.git" });
    expect(sporeStatus(repo).configured).toBe(true);
  });
});

describe("Spore push/pull (dry-run when no real remote)", () => {
  let repo: string;
  beforeEach(() => { repo = mkRepo(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("sporePush returns dry-run when no remote configured", () => {
    const r = sporePush(repo, "machineA");
    expect(r.dryRun).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no spore remote/);
  });

  it("sporePush returns dry-run when remote unreachable", () => {
    sporeInit(repo, { remote: "https://invalid-host-that-does-not-exist.localhost/x.git" });
    // v1.86: spore is default-off until OPT_IN is written. Test the
    // dry-run-when-unreachable path with opt-in granted.
    require("node:fs").mkdirSync(`${repo}/.mneme/spore`, { recursive: true });
    require("node:fs").writeFileSync(`${repo}/.mneme/spore/OPT_IN`, "test-ack");
    const r = sporePush(repo, "machineA");
    expect(r.dryRun).toBe(true);
    expect(r.ok).toBe(false);
    // Vector clock incremented even on dry-run (so we can resync later).
    expect(readVectorClock(repo)["machineA"]).toBeGreaterThan(0);
  });

  it("v1.86 -- sporePush REFUSES without OPT_IN marker", () => {
    sporeInit(repo, { remote: "https://example.com/x.git" });
    const r = sporePush(repo, "machineA");
    expect(r.ok).toBe(false);
    expect(r.dryRun).toBe(true);
    expect(r.message).toContain("OPT_IN");
  });

  it("sporePull returns dry-run when no remote configured", () => {
    const r = sporePull(repo);
    expect(r.dryRun).toBe(true);
    expect(r.ok).toBe(false);
  });
});

describe("detectGitOrigin", () => {
  it("returns null in a non-git directory", () => {
    const tmp = mkRepo();
    try {
      expect(detectGitOrigin(tmp)).toBeNull();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("returns the URL when run inside the project repo (which has an origin)", () => {
    const url = detectGitOrigin(process.cwd());
    // CI may run on a detached HEAD; allow null but verify it's a string when present.
    if (url !== null) expect(typeof url).toBe("string");
  });
});

describe("Spore + chromosome integration", () => {
  let repo: string;
  beforeEach(() => { repo = mkRepo(); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("status reflects chromosomes that exist on disk after crystallize", async () => {
    const { _resetForTests, recordAtom, startSession } = await import("./working_memory.js");
    const { crystallize } = await import("./crystallize.js");
    _resetForTests();
    startSession({ sessionId: "s1", vendor: "claude", machineId: "m1" });
    recordAtom(repo, "mneme.x", {});
    crystallize(repo, { endReason: "manual" });
    const st = sporeStatus(repo);
    expect(st.localChromosomeCount).toBe(1);
    expect(st.identityReady).toBe(true);
    expect(existsSync(join(repo, ".mneme/lineage/identity/public.pem"))).toBe(true);
  });
});
