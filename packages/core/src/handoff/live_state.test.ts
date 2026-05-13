import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLiveState, injectLiveState, stripExistingLiveState, verifyLiveState, formatLiveStatePulseLine } from "./live_state.js";

function fakeRepo(version = "2.9.1"): string {
  const root = mkdtempSync(join(tmpdir(), "mneme-livestate-test-"));
  mkdirSync(join(root, "packages", "cli"), { recursive: true });
  writeFileSync(join(root, "packages", "cli", "package.json"), JSON.stringify({ version }));
  mkdirSync(join(root, ".mneme", "telepathy"), { recursive: true });
  writeFileSync(join(root, ".mneme", "telepathy", "npm-cache.json"), JSON.stringify({ version: "2.9.0", savedAt: Date.now() }));
  return root;
}

describe("v2.9.1 LIVE STATE injector", () => {
  it("reads the local version from packages/cli/package.json", () => {
    const r = fakeRepo("9.9.9");
    const live = buildLiveState({ repoRoot: r });
    expect(live.state.localVersion).toBe("9.9.9");
  });

  it("reads npm-latest from telepathy cache", () => {
    const r = fakeRepo();
    const live = buildLiveState({ repoRoot: r });
    expect(live.state.npmLatest).toBe("2.9.0");
  });

  it("renders a SUPERSEDES directive in the block", () => {
    const r = fakeRepo();
    const live = buildLiveState({ repoRoot: r });
    expect(live.block).toContain("SUPERSEDES OLDER VERSION");
    expect(live.block).toContain("MNEME LIVE STATE");
    expect(live.block).toContain("Trust THIS block");
  });

  it("injectLiveState prepends to a stale soul prompt", () => {
    const r = fakeRepo("2.9.1");
    const stale = "## Context\nMneme v1.95 — 27/29 findings fixed.";
    const { combined } = injectLiveState(stale, { repoRoot: r });
    expect(combined.indexOf("MNEME LIVE STATE")).toBeLessThan(combined.indexOf("Mneme v1.95"));
    expect(combined).toContain("2.9.1");
    expect(combined).toContain("v1.95"); // stale text preserved BUT below the LIVE STATE override
  });

  it("stripExistingLiveState removes a previously-injected block", () => {
    const r = fakeRepo();
    const stale = "## Context\nstuff";
    const { combined } = injectLiveState(stale, { repoRoot: r });
    const stripped = stripExistingLiveState(combined);
    expect(stripped).not.toContain("MNEME LIVE STATE");
    expect(stripped).toContain("## Context");
  });

  it("re-injecting doesn't accumulate blocks", () => {
    const r = fakeRepo();
    const a = injectLiveState("payload", { repoRoot: r }).combined;
    const b = injectLiveState(a, { repoRoot: r }).combined;
    const count = (b.match(/MNEME LIVE STATE START/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("verifyLiveState passes for an untampered block", () => {
    const r = fakeRepo();
    const live = buildLiveState({ repoRoot: r, secret: "x" });
    const v = verifyLiveState(live.block, "x");
    expect(v.ok).toBe(true);
  });

  it("verifyLiveState catches a tampered version field", () => {
    const r = fakeRepo("2.9.1");
    const live = buildLiveState({ repoRoot: r, secret: "x" });
    const tampered = live.block.replace("2.9.1", "9.9.9");
    const v = verifyLiveState(tampered, "x");
    expect(v.ok).toBe(false);
  });

  it("verifyLiveState catches the wrong secret", () => {
    const r = fakeRepo();
    const live = buildLiveState({ repoRoot: r, secret: "right" });
    const v = verifyLiveState(live.block, "wrong");
    expect(v.ok).toBe(false);
  });

  it("formatLiveStatePulseLine emits a compact summary", () => {
    const r = fakeRepo();
    const live = buildLiveState({ repoRoot: r });
    const line = formatLiveStatePulseLine(live);
    expect(line).toContain("LIVE-STATE");
    expect(line).toContain("v=");
    expect(line).toContain("sig=");
  });
});
