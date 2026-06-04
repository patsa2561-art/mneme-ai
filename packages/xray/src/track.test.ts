import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportDelta, remoteRef, listRemoteBranches, trackerTick, trackGauntlet } from "./track.js";
import { buildXRay } from "./engine.js";

function gitInit(dir: string): void {
  const run = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "t@t.dev"]);
  run(["config", "user.name", "Tester"]);
}
function commit(dir: string, msg: string): void {
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", msg], { cwd: dir, encoding: "utf8" });
}

describe("X-RAY tracking engine — drift detection + realtime change-detect", () => {
  it("trackGauntlet scores 100 (detect-leak · improved · stable · destructive · baseline · ls-remote · noop · total)", () => {
    const g = trackGauntlet();
    expect(g.score).toBe(100);
    expect(g.checks.every((c) => c.pass)).toBe(true);
  });

  // THE REAL-TIME PROOF: a real local git repo. A commit changes the SHA;
  // remoteRef detects it (no clone); a re-scan's drift surfaces a NEW secret leak.
  it("E2E: a git change is detected via ls-remote and the analysis changes (new secret → degraded)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xray-track-"));
    try {
      gitInit(dir);
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "app.js"), "export const f = () => 1;\n");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
      commit(dir, "initial clean commit");

      const sha1 = remoteRef(dir);                       // ls-remote on a LOCAL repo
      expect(sha1).toMatch(/^[0-9a-f]{7,40}$/);
      const report1 = await buildXRay({ repoPath: dir, now: 1_700_000_000_000 });
      expect(report1.subject.commitHash).not.toBe("unknown");

      // an AI/teammate pushes a change that introduces a hardcoded AWS key
      writeFileSync(join(dir, "src", "leak.js"), 'const k = "AKIAIOSFODNN7EXAMPLE";\nconst s = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";\n');
      commit(dir, "feat: add integration (oops, hardcoded key)");

      const sha2 = remoteRef(dir);
      expect(sha2).not.toBe(sha1);                       // change DETECTED with no clone

      // the autonomous tick re-scans and computes the drift
      const tick = await trackerTick(
        { target: dir, lastSha: sha1, prevReport: report1 },
        ({ target }) => buildXRay({ repoPath: target, now: 1_700_000_100_000 }),
      );
      expect(tick.changed).toBe(true);
      expect(tick.sha).toBe(sha2);
      expect(tick.delta!.newSecretLeaks).toBeGreaterThan(0);  // the new leak surfaced
      expect(tick.delta!.drift).toBe("degraded");
      expect(tick.delta!.highlights[0]).toMatch(/secret leak/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("E2E: an unchanged repo → tick is a cheap no-op (no wasteful re-scan)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xray-track2-"));
    try {
      gitInit(dir);
      writeFileSync(join(dir, "a.js"), "export const a = 1;\n");
      commit(dir, "c1");
      const sha = remoteRef(dir);
      let built = 0;
      const tick = await trackerTick(
        { target: dir, lastSha: sha, prevReport: null },
        async ({ target }) => { built++; return buildXRay({ repoPath: target }); },
      );
      expect(tick.changed).toBe(false);
      expect(built).toBe(0); // build fn never invoked when the SHA is unchanged
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("listRemoteBranches enumerates branches on a local repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "xray-track3-"));
    try {
      gitInit(dir);
      writeFileSync(join(dir, "a.js"), "1\n");
      commit(dir, "c1");
      spawnSync("git", ["branch", "develop"], { cwd: dir });
      spawnSync("git", ["branch", "feature/x"], { cwd: dir });
      const names = listRemoteBranches(dir).map((b) => b.name).sort();
      expect(names).toContain("main");
      expect(names).toContain("develop");
      expect(names).toContain("feature/x");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
