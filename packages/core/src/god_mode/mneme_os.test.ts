import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MnemeOS } from "./mneme_os.js";

const isWindows = process.platform === "win32";
const sleepCmd = isWindows
  ? { command: "powershell", args: ["-NoProfile", "-Command", "Start-Sleep", "-Seconds", "30"] }
  : { command: "sleep", args: ["30"] };
const failCmd = isWindows
  ? { command: "cmd", args: ["/c", "exit 1"] }
  : { command: "false", args: [] };

function delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

describe("god_mode/mneme_os · lifecycle", () => {
  let repo: string;
  let os: MnemeOS;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-os-"));
    os = new MnemeOS(repo);
  });
  afterEach(async () => {
    try { await os.stopAll(); } catch { /* */ }
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  it("define + start moves a process into 'running' state", async () => {
    os.define({ name: "p1", ...sleepCmd });
    const r = os.start("p1");
    expect(r.outcome).toBe("started");
    const state = os.list().find((s) => s.name === "p1")!;
    expect(state.status).toBe("running");
    expect(state.pid).not.toBeNull();
  });

  it("starting same process twice returns 'already-running'", () => {
    os.define({ name: "p1", ...sleepCmd });
    os.start("p1");
    expect(os.start("p1").outcome).toBe("already-running");
  });

  it("starting unknown process returns 'no-such-process'", () => {
    expect(os.start("nope").outcome).toBe("no-such-process");
  });

  it("stop returns 'stopped' and clears pid", async () => {
    os.define({ name: "p1", ...sleepCmd });
    os.start("p1");
    const r = await os.stop("p1");
    expect(r.outcome).toBe("stopped");
    const state = os.list().find((s) => s.name === "p1")!;
    expect(state.pid).toBeNull();
  });

  it("stop on a never-started process returns 'not-running'", async () => {
    os.define({ name: "p1", ...sleepCmd });
    expect((await os.stop("p1")).outcome).toBe("not-running");
  });
});

describe("god_mode/mneme_os · dependsOn", () => {
  let repo: string;
  let os: MnemeOS;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-os-"));
    os = new MnemeOS(repo);
  });
  afterEach(async () => {
    try { await os.stopAll(); } catch { /* */ }
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  it("blocks start when a dependency isn't running", () => {
    os.define({ name: "db", ...sleepCmd });
    os.define({ name: "api", ...sleepCmd, dependsOn: ["db"] });
    expect(os.start("api").outcome).toBe("blocked-by-dep");
  });

  it("allows start once dependency is running", () => {
    os.define({ name: "db", ...sleepCmd });
    os.define({ name: "api", ...sleepCmd, dependsOn: ["db"] });
    os.start("db");
    expect(os.start("api").outcome).toBe("started");
  });
});

describe("god_mode/mneme_os · quarantine on crash loop", () => {
  let repo: string;
  let os: MnemeOS;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-os-"));
    os = new MnemeOS(repo);
  });
  afterEach(async () => {
    try { await os.stopAll(); } catch { /* */ }
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  it("3 crashes inside the window → quarantined", async () => {
    os.define({ name: "crashy", ...failCmd, restartPolicy: "on-crash" });
    os.start("crashy");
    // Wait enough for restart loop to hit threshold.
    await delay(800);
    const state = os.list().find((s) => s.name === "crashy")!;
    expect(state.status).toBe("quarantined");
  });

  it("unquarantine clears state back to 'stopped'", async () => {
    os.define({ name: "crashy", ...failCmd, restartPolicy: "on-crash" });
    os.start("crashy");
    await delay(800);
    expect(os.list().find((s) => s.name === "crashy")!.status).toBe("quarantined");
    expect(os.unquarantine("crashy").outcome).toBe("cleared");
    expect(os.list().find((s) => s.name === "crashy")!.status).toBe("stopped");
  });
});
