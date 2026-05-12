import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeEnvironment, readSporeOptIn, extractRepoOwner } from "./env_probe.js";
import { sporeGate, writeSporeOptIn, revokeSporeOptIn } from "./spore_gate.js";
import { selectTransport } from "./transport_select.js";

function makeRepo(opts: { origin?: string; user?: string; withCi?: boolean; withCodeowners?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "mneme-chameleon-"));
  try {
    execSync("git init -q", { cwd: dir });
    if (opts.user) execSync(`git config user.name "${opts.user}"`, { cwd: dir });
    if (opts.origin) execSync(`git remote add origin "${opts.origin}"`, { cwd: dir });
  } catch {
    // git may be unavailable in the sandbox; tests guard for that
  }
  if (opts.withCi) {
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: ci\non: push");
  }
  if (opts.withCodeowners) {
    mkdirSync(join(dir, ".github"), { recursive: true });
    writeFileSync(join(dir, ".github", "CODEOWNERS"), "* @teamA");
  }
  return dir;
}

describe("v1.86 CHAMELEON · env_probe", () => {
  it("extractRepoOwner handles https + ssh + .git suffix", () => {
    expect(extractRepoOwner("https://github.com/alice/repo.git")).toBe("alice");
    expect(extractRepoOwner("git@github.com:bob/proj.git")).toBe("bob");
    expect(extractRepoOwner("https://gitlab.com/carol/x")).toBe("carol");
  });

  it("personal repo with no CI/CODEOWNERS is push-safe", () => {
    const dir = makeRepo({ origin: "https://github.com/alice/repo.git", user: "alice" });
    const env = probeEnvironment(dir);
    if (env.hasGit && env.hasOrigin) {
      expect(env.isUserOwned).toBe(true);
      expect(env.hasCi).toBe(false);
      expect(env.hasCodeowners).toBe(false);
      expect(env.pushRisky).toBe(false);
    }
  });

  it("repo with CI is flagged risky", () => {
    const dir = makeRepo({ origin: "https://github.com/alice/repo.git", user: "alice", withCi: true });
    const env = probeEnvironment(dir);
    if (env.hasGit) {
      expect(env.hasCi).toBe(true);
      expect(env.pushRisky).toBe(true);
      expect(env.ciSurfaces).toContain("github-actions");
    }
  });

  it("fork (owner != user) is flagged risky", () => {
    const dir = makeRepo({ origin: "https://github.com/anthropic/claude.git", user: "alice" });
    const env = probeEnvironment(dir);
    if (env.hasGit && env.hasOrigin) {
      expect(env.isUserOwned).toBe(false);
      expect(env.pushRisky).toBe(true);
    }
  });

  it("CODEOWNERS triggers risk", () => {
    const dir = makeRepo({ origin: "https://github.com/alice/repo.git", user: "alice", withCodeowners: true });
    const env = probeEnvironment(dir);
    if (env.hasGit) {
      expect(env.hasCodeowners).toBe(true);
      expect(env.pushRisky).toBe(true);
    }
  });
});

describe("v1.86 CHAMELEON · sporeGate (explicit opt-in)", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeRepo({ origin: "https://github.com/alice/repo.git", user: "alice" });
  });

  it("REFUSES push without OPT_IN file", () => {
    const d = sporeGate(dir);
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("OPT-OUT");
    expect(d.howToOptIn).toBeDefined();
  });

  it("ALLOWS push once OPT_IN written", () => {
    writeSporeOptIn(dir, "I acknowledge spore can push to my origin");
    const d = sporeGate(dir);
    if (d.env.hasGit && d.env.hasOrigin) {
      expect(d.allow).toBe(true);
      expect(d.optInState.optedIn).toBe(true);
    }
  });

  it("revokeSporeOptIn flips back to refused", () => {
    writeSporeOptIn(dir, "ack");
    revokeSporeOptIn(dir);
    const d = sporeGate(dir);
    expect(d.allow).toBe(false);
  });

  it("readSporeOptIn handles missing file gracefully", () => {
    const r = readSporeOptIn(dir);
    expect(r.optedIn).toBe(false);
  });

  it("readSporeOptIn strips BOM (Windows Notepad regression)", () => {
    mkdirSync(join(dir, ".mneme/spore"), { recursive: true });
    writeFileSync(join(dir, ".mneme/spore/OPT_IN"), "﻿acknowledged\n", "utf8");
    const r = readSporeOptIn(dir);
    expect(r.optedIn).toBe(true);
  });
});

describe("v1.86 CHAMELEON · transport_select", () => {
  it("phone destination → relay-paste (no git needed)", () => {
    const env = probeEnvironment(mkdtempSync(join(tmpdir(), "mneme-no-git-")));
    const r = selectTransport("phone-or-mobile-app", env);
    expect(r.primary).toBe("relay-paste");
  });

  it("offline destination → wanderer-mwt", () => {
    const env = probeEnvironment(mkdtempSync(join(tmpdir(), "mneme-x-")));
    const r = selectTransport("offline-usb", env);
    expect(r.primary).toBe("wanderer-mwt");
  });

  it("continuous-sync on risky repo refuses spore", () => {
    const dir = makeRepo({ origin: "https://github.com/anthropic/claude.git", user: "alice", withCi: true });
    const env = probeEnvironment(dir);
    const r = selectTransport("continuous-sync", env);
    if (env.hasGit) {
      expect(r.primary).toBe("relay-paste");
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  it("continuous-sync on clean personal repo allows spore", () => {
    const dir = makeRepo({ origin: "https://github.com/alice/repo.git", user: "alice" });
    const env = probeEnvironment(dir);
    const r = selectTransport("continuous-sync", env);
    if (env.hasGit && env.isUserOwned === true) {
      expect(r.primary).toBe("spore-git");
    }
  });

  it("same-pc-other-ai → clipboard", () => {
    const env = probeEnvironment(mkdtempSync(join(tmpdir(), "mneme-y-")));
    const r = selectTransport("same-pc-other-ai", env);
    expect(r.primary).toBe("clipboard");
  });
});
