import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VERBOSE_GUIDE_THRESHOLD,
  clearIrisState,
  readIrisState,
  recordCommandRun,
  shouldShowVerboseGuide,
  writeIrisState,
} from "./adaptive.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-iris-state-test-"));
});
afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe("readIrisState", () => {
  it("returns clean default when no state file exists", () => {
    const s = readIrisState(tmpDir);
    expect(s.commandsRun).toEqual({});
    expect(s.lastSeen).toEqual({});
    expect(s.preferTerse).toBe(false);
  });

  it("returns clean default when JSON is corrupt", () => {
    mkdirSync(join(tmpDir, ".mneme"), { recursive: true });
    writeFileSync(join(tmpDir, ".mneme", "iris-state.json"), "{not json", "utf8");
    const s = readIrisState(tmpDir);
    expect(s.commandsRun).toEqual({});
  });

  it("ignores malformed counts (negative / non-number)", () => {
    mkdirSync(join(tmpDir, ".mneme"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".mneme", "iris-state.json"),
      JSON.stringify({
        commandsRun: { good: 3, bad: "string", negative: -1 },
        lastSeen: {},
        preferTerse: false,
      }),
      "utf8",
    );
    const s = readIrisState(tmpDir);
    expect(s.commandsRun).toEqual({ good: 3 });
  });
});

describe("recordCommandRun", () => {
  it("increments count + writes timestamp", () => {
    recordCommandRun(tmpDir, "ask");
    let s = readIrisState(tmpDir);
    expect(s.commandsRun.ask).toBe(1);
    expect(s.lastSeen.ask).toBeTruthy();

    recordCommandRun(tmpDir, "ask");
    s = readIrisState(tmpDir);
    expect(s.commandsRun.ask).toBe(2);
  });

  it("maintains separate counts per command", () => {
    recordCommandRun(tmpDir, "ask");
    recordCommandRun(tmpDir, "forensics");
    recordCommandRun(tmpDir, "forensics");
    const s = readIrisState(tmpDir);
    expect(s.commandsRun.ask).toBe(1);
    expect(s.commandsRun.forensics).toBe(2);
  });

  it("flips preferTerse to true once threshold is crossed", () => {
    for (let i = 0; i < VERBOSE_GUIDE_THRESHOLD; i++) {
      recordCommandRun(tmpDir, "ask");
    }
    const s = readIrisState(tmpDir);
    expect(s.preferTerse).toBe(true);
  });

  it("preferTerse stays false until threshold", () => {
    for (let i = 0; i < VERBOSE_GUIDE_THRESHOLD - 1; i++) {
      recordCommandRun(tmpDir, "ask");
    }
    const s = readIrisState(tmpDir);
    expect(s.preferTerse).toBe(false);
  });
});

describe("shouldShowVerboseGuide", () => {
  it("true for first-time users", () => {
    const s = readIrisState(tmpDir);
    expect(shouldShowVerboseGuide(s, "ask")).toBe(true);
  });

  it("true while count < threshold", () => {
    const s = { commandsRun: { ask: 4 }, preferTerse: false, lastSeen: {} };
    expect(shouldShowVerboseGuide(s, "ask")).toBe(true);
  });

  it("false when count ≥ threshold", () => {
    const s = { commandsRun: { ask: 5 }, preferTerse: true, lastSeen: {} };
    expect(shouldShowVerboseGuide(s, "ask")).toBe(false);
  });

  it("tracks per-command (other commands keep verbose)", () => {
    const s = { commandsRun: { ask: 10 }, preferTerse: true, lastSeen: {} };
    expect(shouldShowVerboseGuide(s, "ask")).toBe(false);
    expect(shouldShowVerboseGuide(s, "forensics")).toBe(true);
  });
});

describe("round-trip read/write", () => {
  it("survives write+read roundtrip", () => {
    const state = {
      commandsRun: { a: 3, b: 7 },
      lastSeen: { a: "2024-01-01T00:00:00Z", b: "2024-01-02T00:00:00Z" },
      preferTerse: true,
    };
    writeIrisState(tmpDir, state);
    const back = readIrisState(tmpDir);
    expect(back).toEqual(state);
  });
});

describe("clearIrisState", () => {
  it("removes the state file", () => {
    recordCommandRun(tmpDir, "ask");
    expect(existsSync(join(tmpDir, ".mneme", "iris-state.json"))).toBe(true);
    clearIrisState(tmpDir);
    expect(existsSync(join(tmpDir, ".mneme", "iris-state.json"))).toBe(false);
  });

  it("is a no-op when no state file exists", () => {
    expect(() => clearIrisState(tmpDir)).not.toThrow();
  });
});
