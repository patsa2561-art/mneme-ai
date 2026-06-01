import { describe, it, expect, vi } from "vitest";
import { clearInstallLocks, formatInstallGuardPulseLine } from "./install_guard.js";

// v2.121 — these tests exercise the kill LOGIC through the DI seam so they are
// deterministic and NEVER enumerate or kill REAL processes. (Previously they
// called the real clearInstallLocks(), which spawns ps/wmic and kills any
// process whose cmdline contains "mneme" — under a parallel test suite that
// could starve on process-spawn AND kill sibling workers / a live mneme bridge,
// producing variable cross-file failures.) Fast sleeps via the sleepMs seam.
const fastSleep = () => 0;

describe("v2.9.2 INSTALL GUARD", () => {
  it("returns OK when there are no Mneme orphans (no-op happy path)", async () => {
    const r = await clearInstallLocks({ enumerate: () => [], sleepMs: fastSleep });
    expect(r.ok).toBe(true);
    expect(typeof r.summary).toBe("string");
    expect(r.orphans).toEqual([]);
    expect(r.killed).toEqual([]);
    expect(r.resisted).toEqual([]);
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(r.platform).toBe(process.platform);
  });

  it("kills a found orphan and reports it", async () => {
    const killed: number[] = [];
    const r = await clearInstallLocks({
      enumerate: () => [{ pid: 999001, commandLine: "node mneme bridge" }],
      kill: (pid) => killed.push(pid),
      alive: () => false, // it died after the polite kill
      sleepMs: fastSleep,
    });
    expect(killed).toContain(999001);
    expect(r.killed).toContain(999001);
    expect(r.ok).toBe(true);
  });

  it("reports a process that resisted SIGKILL", async () => {
    const r = await clearInstallLocks({
      enumerate: () => [{ pid: 999002, commandLine: "node mneme daemon" }],
      kill: () => { /* pretend the kill had no effect */ },
      alive: () => true, // never dies
      sleepMs: fastSleep,
    });
    expect(r.resisted).toContain(999002);
    expect(r.ok).toBe(false);
  });

  it("never throws — even when enumeration throws (ps/wmic slow or missing)", async () => {
    const r = await clearInstallLocks({
      enumerate: () => { throw new Error("ps timed out"); },
      sleepMs: fastSleep,
    });
    expect(r.ok).toBe(true); // total: degrades to a safe, non-fatal result
    expect(r.summary).toMatch(/non-fatal/);
  });

  it("SELF-GUARD: NEVER kills its own pid even if enumeration returns it", async () => {
    const killSpy = vi.fn();
    const r = await clearInstallLocks({
      enumerate: () => [{ pid: process.pid, commandLine: "node mneme (this very test runner)" }],
      kill: killSpy,
      alive: () => true,
      sleepMs: fastSleep,
    });
    expect(killSpy).not.toHaveBeenCalled();       // the kill primitive was never invoked on us
    expect(r.killed).not.toContain(process.pid);
    expect(r.orphans).toEqual([]);                 // filtered out before any kill phase
    expect(process.pid).toBeGreaterThan(0);        // we survived
  });

  it("formatInstallGuardPulseLine emits a compact summary", async () => {
    const r = await clearInstallLocks({ enumerate: () => [], sleepMs: fastSleep });
    const line = formatInstallGuardPulseLine(r);
    expect(line).toContain("INSTALL-GUARD");
    expect(line).toMatch(/OK|RESIST/);
    expect(line).toContain("orphans=");
  });
});
