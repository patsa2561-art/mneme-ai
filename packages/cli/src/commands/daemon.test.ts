/**
 * daemon — unit tests for non-running paths.
 *
 * The full start-loop is hard to test from inside vitest (it spawns a
 * detached child + watches files), so we test:
 *   - status when no daemon running
 *   - stop when no daemon running
 *   - logs when no log file exists
 *   - stale-PID cleanup
 *   - PID file format + parsing
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { daemonCommand } from "./daemon.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-daemon-"));
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email t@x", { cwd: tmp });
  execSync("git config user.name T", { cwd: tmp });
  writeFileSync(join(tmp, "a.txt"), "hi");
  execSync("git add a.txt && git commit -q -m initial", { cwd: tmp });
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("daemon — status / stop / logs (no daemon running)", () => {
  it("status reports running:false when no PID file exists", async () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array) => {
      chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      await daemonCommand({ cwd: tmp, action: "status", json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    const json = JSON.parse(chunks.join(""));
    expect(json.running).toBe(false);
  });

  it("stop reports stopped:false reason no-daemon-running", async () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array) => {
      chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      await daemonCommand({ cwd: tmp, action: "stop", json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    const json = JSON.parse(chunks.join(""));
    expect(json.stopped).toBe(false);
    expect(json.reason).toBe("no-daemon-running");
  });

  it("logs returns empty array when no log file", async () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array) => {
      chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      await daemonCommand({ cwd: tmp, action: "logs", json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    const json = JSON.parse(chunks.join(""));
    expect(json.logs).toEqual([]);
  });
});

describe("daemon — stale PID cleanup", () => {
  it("stop with stale PID file returns reason stale-pid-cleaned + removes the file", async () => {
    const dir = join(tmp, ".mneme");
    mkdirSync(dir, { recursive: true });
    // Use a PID that's almost certainly not alive
    const stalePid = 999_999_999;
    writeFileSync(join(dir, "daemon.pid"), String(stalePid));

    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array) => {
      chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      await daemonCommand({ cwd: tmp, action: "stop", json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    const json = JSON.parse(chunks.join(""));
    expect(json.stopped).toBe(true);
    expect(json.reason).toBe("stale-pid-cleaned");
    expect(existsSync(join(dir, "daemon.pid"))).toBe(false);
  });

  it("status with stale PID reports running:false but echoes pid", async () => {
    const dir = join(tmp, ".mneme");
    mkdirSync(dir, { recursive: true });
    const stalePid = 999_999_999;
    writeFileSync(join(dir, "daemon.pid"), String(stalePid));

    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array) => {
      chunks.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      await daemonCommand({ cwd: tmp, action: "status", json: true });
    } finally {
      process.stdout.write = origWrite;
    }
    const json = JSON.parse(chunks.join(""));
    expect(json.running).toBe(false);
    expect(json.pid).toBe(stalePid);
  });
});

describe("daemon — error path", () => {
  it("start outside a git repo returns 1", async () => {
    const nonGit = mkdtempSync(join(tmpdir(), "mneme-non-git-"));
    try {
      const code = await daemonCommand({ cwd: nonGit, action: "start", json: true });
      expect(code).toBe(1);
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });
});
