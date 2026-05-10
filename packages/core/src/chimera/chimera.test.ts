import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chimera, parseGitLog } from "./index.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-chimera-")); });
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

function gitInit(repoRoot: string): void {
  spawnSync("git", ["init", "-q"], { cwd: repoRoot });
  spawnSync("git", ["config", "user.email", "alice@example.com"], { cwd: repoRoot });
  spawnSync("git", ["config", "user.name", "alice"], { cwd: repoRoot });
}
function commit(repoRoot: string, msg: string, files: Array<[string, string]>): void {
  for (const [p, body] of files) {
    const full = join(repoRoot, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  spawnSync("git", ["add", "."], { cwd: repoRoot });
  spawnSync("git", ["commit", "-q", "-m", msg], { cwd: repoRoot });
}

describe("parseGitLog", () => {
  it("parses the canonical git-log shape", () => {
    const raw = "abc1|alice@x|2026-05-10T12:00:00Z\nsrc/a.ts\n\ndef2|bob@x|2026-05-09T08:30:00Z\nsrc/b.ts\nsrc/c.ts\n";
    const c = parseGitLog(raw);
    expect(c).toHaveLength(2);
    expect(c[0]!.email).toBe("alice@x");
    expect(c[1]!.files).toEqual(["src/b.ts", "src/c.ts"]);
  });
});

describe("chimera() e2e on a real git repo", () => {
  it("returns sane shape on empty git", () => {
    const r = chimera(repo);
    expect(r.commitsAnalysed).toBe(0);
    expect(r.narrative).toContain("empty");
  });

  it("computes peak hour + day from a single-author repo", () => {
    gitInit(repo);
    commit(repo, "init", [["src/a.ts", "x"]]);
    commit(repo, "more", [["src/b.ts", "y"]]);
    commit(repo, "more again", [["src/c.ts", "z"]]);
    const r = chimera(repo);
    expect(r.commitsAnalysed).toBeGreaterThanOrEqual(3);
    expect(r.timeFingerprint.peakHour).toBeGreaterThanOrEqual(0);
    expect(r.timeFingerprint.peakHour).toBeLessThan(24);
    expect(r.phantomCollaborators.isSolo).toBe(true);
  });

  it("identifies hot directories from file-area distribution", () => {
    gitInit(repo);
    for (let i = 0; i < 5; i++) commit(repo, `auth ${i}`, [[`src/auth/file${i}.ts`, "x"]]);
    for (let i = 0; i < 2; i++) commit(repo, `infra ${i}`, [[`src/infra/file${i}.ts`, "x"]]);
    const r = chimera(repo);
    const top = r.areaDiversity.hotDirs[0];
    expect(top).toBeDefined();
    expect(top!.dir).toBe("src");
    expect(top!.commits).toBeGreaterThan(0);
  });

  it("phantom collaborators surface for solo repo with multiple areas", () => {
    gitInit(repo);
    for (let i = 0; i < 6; i++) commit(repo, `frontend ${i}`, [[`frontend/comp${i}.ts`, "x"]]);
    for (let i = 0; i < 6; i++) commit(repo, `backend ${i}`, [[`backend/handler${i}.ts`, "x"]]);
    for (let i = 0; i < 6; i++) commit(repo, `infra ${i}`, [[`infra/cfg${i}.ts`, "x"]]);
    const r = chimera(repo);
    expect(r.phantomCollaborators.isSolo).toBe(true);
    expect(r.phantomCollaborators.phantoms.length).toBeGreaterThan(0);
    const areas = r.phantomCollaborators.phantoms.map((p) => p.area);
    expect(areas.length).toBeGreaterThan(0);
  });

  it("velocity profile categorises trend", () => {
    gitInit(repo);
    for (let i = 0; i < 10; i++) commit(repo, `c${i}`, [[`src/x.ts`, String(i)]]);
    const r = chimera(repo);
    expect(["accelerating", "steady", "decelerating"]).toContain(r.velocityProfile.trend);
  });

  it("narrative is a non-empty single paragraph", () => {
    gitInit(repo);
    commit(repo, "init", [["src/x.ts", "x"]]);
    const r = chimera(repo);
    expect(r.narrative.length).toBeGreaterThan(20);
    expect(r.narrative.split("\n").length).toBe(1);
  });
});
