import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPulseStatus, renderPulse } from "./pulse.js";

describe("pulse", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-pulse-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("collectPulseStatus returns empty status on a fresh dir", () => {
    const s = collectPulseStatus(repo);
    expect(s.notable).toEqual([]);
    expect(s.daemon.running).toBe(false);
    expect(s.inbox.unsent).toBe(0);
  });

  it("renderPulse with quiet:true returns '' on empty status", () => {
    const s = collectPulseStatus(repo);
    expect(renderPulse(s, { quiet: true })).toBe("");
  });

  it("renderPulse with quiet:false always emits a [MNEME PULSE] block", () => {
    const s = collectPulseStatus(repo);
    const out = renderPulse(s, { quiet: false });
    expect(out).toContain("[MNEME PULSE]");
    expect(out).toContain("[/MNEME PULSE]");
  });

  it("update-available state surfaces an [AUTO-ACTION]", () => {
    writeFileSync(
      join(repo, ".mneme/version-check.json"),
      JSON.stringify({ current: "1.25.0", latest: "1.26.0" }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.version.updateAvailable).toBe(true);
    expect(s.notable.some((n) => n.level === "action")).toBe(true);
    const out = renderPulse(s);
    expect(out).toContain("[AUTO-ACTION]");
    expect(out).toContain("EXECUTE NOW");
    expect(out).toContain("mneme.system.upgrade");
  });

  it("daemon heartbeat < 5min ago is reported as running", () => {
    writeFileSync(
      join(repo, ".mneme/nucleus.heartbeat.json"),
      JSON.stringify({ tickCount: 42, lastTick: new Date().toISOString() }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.daemon.running).toBe(true);
    expect(s.daemon.tickCount).toBe(42);
  });

  it("daemon heartbeat > 5min ago is reported as stopped", () => {
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeFileSync(
      join(repo, ".mneme/nucleus.heartbeat.json"),
      JSON.stringify({ tickCount: 42, lastTick: oldTime }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.daemon.running).toBe(false);
  });

  it("inbox unsent count is correct", () => {
    const lines = [
      JSON.stringify({ id: "a", title: "old", sent: true }),
      JSON.stringify({ id: "b", title: "new", sent: false }),
      JSON.stringify({ id: "c", title: "newer", sent: false }),
    ].join("\n");
    writeFileSync(join(repo, ".mneme/inbox.jsonl"), lines + "\n", "utf8");
    const s = collectPulseStatus(repo);
    expect(s.inbox.unsent).toBe(2);
  });

  it("survives malformed JSON in any state file", () => {
    writeFileSync(join(repo, ".mneme/version-check.json"), "not json", "utf8");
    writeFileSync(join(repo, ".mneme/nucleus.heartbeat.json"), "{broken", "utf8");
    writeFileSync(join(repo, ".mneme/inbox.jsonl"), "garbage\nmore garbage", "utf8");
    expect(() => collectPulseStatus(repo)).not.toThrow();
  });

  it("renders all expected counters in quiet mode when notable", () => {
    writeFileSync(join(repo, ".mneme/version-check.json"), JSON.stringify({ current: "1", latest: "2" }), "utf8");
    const s = collectPulseStatus(repo);
    const out = renderPulse(s);
    expect(out).toMatch(/mneme v[\w.]+/);
    expect(out).toMatch(/daemon=/);
    expect(out).toMatch(/inbox=/);
    expect(out).toMatch(/vaccines=/);
    expect(out).toMatch(/retrieval-trials=/);
  });
});
