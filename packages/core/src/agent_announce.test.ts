/**
 * v1.67.1 -- agent_announce tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  announceNewCapabilities,
  describeNewCapabilities,
  caretakerSyncOnUpgrade,
  readAnnounceState,
  setLastAnnouncedVersion,
} from "./agent_announce.js";

function setup(): string { return mkdtempSync(join(tmpdir(), "mneme-announce-")); }
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

describe("v1.67.1 agent_announce", () => {
  let r: string;
  beforeEach(() => { r = setup(); });
  afterEach(() => cleanup(r));

  it("first-time install: announces ALL capabilities up to currentVersion", () => {
    const line = announceNewCapabilities(r, "1.67.0");
    expect(line).not.toBeNull();
    expect(line).toContain("v1.67.0");
    expect(line).toContain("[NEW]");
  });

  it("no announcement when already up to date", () => {
    setLastAnnouncedVersion(r, "1.67.0");
    const line = announceNewCapabilities(r, "1.67.0");
    expect(line).toBeNull();
  });

  it("announces only the delta after a bump", () => {
    setLastAnnouncedVersion(r, "1.65.0");
    const line = announceNewCapabilities(r, "1.67.0");
    expect(line).not.toBeNull();
    expect(line).toContain("v1.67.0");
    // Should mention groups added in v1.66+ at minimum
    expect(line).toMatch(/autarchy|aegis/);
  });

  it("persist=true updates state file", () => {
    expect(readAnnounceState(r)).toBeNull();
    announceNewCapabilities(r, "1.67.0", { persist: true });
    expect(readAnnounceState(r)?.lastAnnouncedVersion).toBe("1.67.0");
  });

  it("persist=false leaves state untouched", () => {
    announceNewCapabilities(r, "1.67.0", { persist: false });
    expect(readAnnounceState(r)).toBeNull();
  });

  it("downgrade (current < last) returns null", () => {
    setLastAnnouncedVersion(r, "1.67.0");
    const line = announceNewCapabilities(r, "1.50.0");
    expect(line).toBeNull();
  });

  it("describeNewCapabilities lists groups + commands", () => {
    setLastAnnouncedVersion(r, "1.65.0");
    const text = describeNewCapabilities(r, "1.67.0");
    expect(text).toContain("v1.67.0");
    expect(text).toMatch(/autarchy|aegis/);
    expect(text.split("\n").length).toBeGreaterThan(3);
  });

  it("describeNewCapabilities returns friendly text when nothing new", () => {
    setLastAnnouncedVersion(r, "1.67.0");
    const text = describeNewCapabilities(r, "1.67.0");
    expect(text).toContain("No new");
  });

  it("caretakerSyncOnUpgrade refreshes CLAUDE.md", () => {
    const result = caretakerSyncOnUpgrade(r, "1.67.0");
    expect(result.ranSync).toBe(true);
    expect(result.lastAnnouncedVersion).toBe("1.67.0");
    expect(existsSync(join(r, "CLAUDE.md"))).toBe(true);
    const content = readFileSync(join(r, "CLAUDE.md"), "utf8");
    expect(content).toContain("Mneme command manifest");
    // Should contain at least one v1.67 command
    expect(content).toMatch(/aegis|autarchy/);
  });

  it("caretakerSyncOnUpgrade is idempotent across reruns", () => {
    caretakerSyncOnUpgrade(r, "1.67.0");
    const second = caretakerSyncOnUpgrade(r, "1.67.0");
    expect(second.ranSync).toBe(false); // already at this version
  });

  it("syncResults include all default agent targets", () => {
    const result = caretakerSyncOnUpgrade(r, "1.67.0");
    const paths = result.syncResults.map((s) => s.target.path);
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain(".cursor/rules/mneme.mdc");
  });
});
