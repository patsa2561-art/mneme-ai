/**
 * v2.19.63 PHOENIX HARDENING — PREINSTALL TRAIL deep tests.
 *
 * Tests cover HMAC chain semantics: tamper detection, genesis handling,
 * step-name validation, complete-install detection, summarize shape.
 *
 * We isolate via HOME override per-test so we don't touch the real
 * ~/.mneme-global trail.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntry,
  readTrail,
  verifyTrail,
  recentInstall,
  summarize,
  lastSig,
  PROTOCOL_VERSION,
  trailPath,
} from "./index.js";

let savedHome: string | undefined;
let sandboxHome: string;

function setSandboxHome() {
  sandboxHome = mkdtempSync(join(tmpdir(), "mneme-trail-test-"));
  savedHome = process.env["HOME"] ?? process.env["USERPROFILE"];
  process.env["HOME"] = sandboxHome;
  process.env["USERPROFILE"] = sandboxHome;
}

function restoreHome() {
  try { rmSync(sandboxHome, { recursive: true, force: true }); } catch { /* */ }
  if (savedHome !== undefined) {
    process.env["HOME"] = savedHome;
    process.env["USERPROFILE"] = savedHome;
  } else {
    delete process.env["HOME"];
    delete process.env["USERPROFILE"];
  }
}

describe("v2.19.63 preinstall_trail PROTOCOL_VERSION", () => {
  it("is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe("v2.19.63 preinstall_trail append + read", () => {
  beforeEach(() => setSandboxHome());
  afterEach(() => restoreHome());

  it("appendEntry writes a valid entry that survives roundtrip", () => {
    const e = appendEntry("preinstall-start", true, { version: "2.19.63" });
    expect(e).not.toBeNull();
    expect(e!.step).toBe("preinstall-start");
    expect(e!.ok).toBe(true);
    expect(e!.version).toBe("2.19.63");
    expect(typeof e!.sig).toBe("string");
    expect(e!.prevSig).toBe("genesis"); // First entry chains to genesis
  });

  it("trail file is created at predictable path", () => {
    appendEntry("preinstall-start", true);
    expect(existsSync(trailPath())).toBe(true);
  });

  it("readTrail returns appended entries in order", () => {
    appendEntry("preinstall-start", true);
    appendEntry("flag-written", true);
    appendEntry("preinstall-end", true);
    const entries = readTrail();
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.step)).toEqual(["preinstall-start", "flag-written", "preinstall-end"]);
  });

  it("lastSig returns previous entry's sig after append", () => {
    expect(lastSig()).toBe("genesis");
    const e1 = appendEntry("preinstall-start", true);
    expect(lastSig()).toBe(e1!.sig);
  });

  it("readTrail returns [] on missing trail file", () => {
    expect(readTrail()).toEqual([]);
  });

  it("malformed lines are skipped without breaking the rest", () => {
    appendEntry("preinstall-start", true);
    // Inject a garbage line
    writeFileSync(trailPath(), readFileSync(trailPath(), "utf8") + "not-json-at-all\n", "utf8");
    appendEntry("preinstall-end", true);
    const entries = readTrail();
    expect(entries.length).toBe(2); // garbage skipped
    expect(entries[1]!.step).toBe("preinstall-end");
  });
});

describe("v2.19.63 preinstall_trail HMAC chain verify", () => {
  beforeEach(() => setSandboxHome());
  afterEach(() => restoreHome());

  it("verifyTrail returns chainOk=true on clean trail", () => {
    appendEntry("preinstall-start", true);
    appendEntry("flag-written", true);
    appendEntry("preinstall-end", true);
    const v = verifyTrail();
    expect(v.chainOk).toBe(true);
    expect(v.totalEntries).toBe(3);
    expect(v.brokenAtIndex).toBeUndefined();
  });

  it("verifyTrail returns chainOk=true on empty trail", () => {
    const v = verifyTrail();
    expect(v.chainOk).toBe(true);
    expect(v.totalEntries).toBe(0);
    expect(v.lastTs).toBeNull();
  });

  it("detects tampered ok field", () => {
    appendEntry("preinstall-start", true);
    appendEntry("flag-written", true);
    // Tamper with the second entry's ok field
    const lines = readFileSync(trailPath(), "utf8").trim().split("\n");
    const e2 = JSON.parse(lines[1]!);
    e2.ok = false; // Tamper
    lines[1] = JSON.stringify(e2);
    writeFileSync(trailPath(), lines.join("\n") + "\n", "utf8");
    const v = verifyTrail();
    expect(v.chainOk).toBe(false);
    expect(v.brokenAtIndex).toBe(1);
    expect(v.brokenReason).toContain("sig mismatch");
  });

  it("detects broken prevSig chain", () => {
    appendEntry("preinstall-start", true);
    appendEntry("flag-written", true);
    appendEntry("preinstall-end", true);
    // Tamper with the third entry's prevSig
    const lines = readFileSync(trailPath(), "utf8").trim().split("\n");
    const e3 = JSON.parse(lines[2]!);
    e3.prevSig = "fake-prev-sig";
    lines[2] = JSON.stringify(e3);
    writeFileSync(trailPath(), lines.join("\n") + "\n", "utf8");
    const v = verifyTrail();
    expect(v.chainOk).toBe(false);
    expect(v.brokenAtIndex).toBe(2);
    expect(v.brokenReason).toContain("prevSig mismatch");
  });

  it("hasCompleteInstall true only when start AND end present", () => {
    appendEntry("preinstall-start", true);
    expect(verifyTrail().hasCompleteInstall).toBe(false);
    appendEntry("flag-written", true);
    expect(verifyTrail().hasCompleteInstall).toBe(false);
    appendEntry("preinstall-end", true);
    expect(verifyTrail().hasCompleteInstall).toBe(true);
  });
});

describe("v2.19.63 preinstall_trail recentInstall", () => {
  beforeEach(() => setSandboxHome());
  afterEach(() => restoreHome());

  it("returns empty on empty trail", () => {
    expect(recentInstall()).toEqual([]);
  });

  it("returns the most-recent block from last preinstall-start", () => {
    // Install attempt 1 (complete)
    appendEntry("preinstall-start", true, { version: "2.19.61" });
    appendEntry("flag-written", true);
    appendEntry("preinstall-end", true);
    // Install attempt 2 (in progress)
    appendEntry("preinstall-start", true, { version: "2.19.63" });
    appendEntry("flag-written", true);
    const recent = recentInstall();
    expect(recent.length).toBe(2);
    expect(recent[0]!.step).toBe("preinstall-start");
    expect(recent[0]!.version).toBe("2.19.63");
  });

  it("returns tail of last 10 if no preinstall-start present", () => {
    // (Synthetic case: trail has entries but no start — orphan entries)
    appendEntry("dll-renamed-sideways", true);
    appendEntry("staging-swept", true);
    const recent = recentInstall();
    expect(recent.length).toBe(2);
  });
});

describe("v2.19.63 preinstall_trail summarize", () => {
  beforeEach(() => setSandboxHome());
  afterEach(() => restoreHome());

  it("counts attempts vs completions", () => {
    appendEntry("preinstall-start", true, { version: "a" });
    appendEntry("preinstall-end", true, { version: "a" });
    appendEntry("preinstall-start", true, { version: "b" });
    // Note: no preinstall-end for "b" — incomplete
    const s = summarize();
    expect(s.installAttempts).toBe(2);
    expect(s.completedInstalls).toBe(1);
    expect(s.chainOk).toBe(true);
  });

  it("reports last install's version + ok", () => {
    appendEntry("preinstall-start", true, { version: "2.19.62" });
    appendEntry("preinstall-end", true, { version: "2.19.62" });
    const s = summarize();
    expect(s.lastInstallVersion).toBe("2.19.62");
    expect(s.lastInstallOk).toBe(true);
    expect(s.lastInstallTs).not.toBeNull();
  });

  it("returns shape with null fields on empty trail", () => {
    const s = summarize();
    expect(s.installAttempts).toBe(0);
    expect(s.completedInstalls).toBe(0);
    expect(s.lastInstallVersion).toBeNull();
    expect(s.chainOk).toBe(true);
  });
});

describe("v2.19.63 preinstall_trail roundtrip with real preinstall script", () => {
  it("entries written by the inline preinstall script verify cleanly via direct file read", async () => {
    // We can't use HOME-override here because on Windows os.homedir() may
    // cache or fall back to OS profile API. Instead we run the subprocess
    // with HOME=sandbox, then directly inspect the trail file at the
    // sandbox path (bypassing trailPath()'s homedir() lookup).
    const { execSync } = await import("node:child_process");
    const { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createHmac } = await import("node:crypto");
    const sandbox = mkdtempSync(join(tmpdir(), "mneme-trail-rt-"));
    try {
      const pkg = JSON.parse(readFileSync("packages/cli/package.json", "utf8"));
      const preinstall = pkg.scripts.preinstall as string;
      const m = preinstall.match(/^node -e (.*)$/s);
      expect(m).not.toBeNull();
      const script = JSON.parse(m![1]!);
      const env = { ...process.env, HOME: sandbox, USERPROFILE: sandbox, HOMEDRIVE: "", HOMEPATH: "", npm_package_version: "2.19.63-rt" };
      // Write script to temp file (avoids shell escape mangling of \n on Windows cmd.exe)
      const scriptFile = join(sandbox, "preinstall-script.js");
      writeFileSync(scriptFile, script, "utf8");
      execSync(`node "${scriptFile}"`, { env, stdio: "pipe", timeout: 30000 });
      // Read the trail at the sandbox path directly
      const trailFile = join(sandbox, ".mneme-global", "preinstall-trail.jsonl");
      expect(existsSync(trailFile)).toBe(true);
      const lines = readFileSync(trailFile, "utf8").trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      // Verify HMAC chain matches our module's algorithm
      let prevSig = "genesis";
      const secret = "mneme-preinstall-trail-v1"; // Default secret used by inline script
      for (let i = 0; i < lines.length; i++) {
        const e = JSON.parse(lines[i]!);
        expect(e.prevSig).toBe(prevSig);
        const { sig, ...body } = e;
        const expected = createHmac("sha256", secret).update(prevSig + "::" + JSON.stringify(body)).digest("hex");
        expect(sig).toBe(expected);
        prevSig = sig;
      }
      // Check we have a complete install (start → end)
      const steps = lines.map((l) => JSON.parse(l).step);
      expect(steps).toContain("preinstall-start");
      expect(steps).toContain("preinstall-end");
    } finally {
      try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* */ }
    }
  });
});
