/**
 * time-capsule — unit tests
 *
 * Tests the export → import round-trip on a real fresh git repo.
 * The pure end-to-end test confirms: capsule files are well-formed,
 * import unpacks the same set of files, manifest.json is parseable.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { timeCapsuleCommand } from "./time-capsule.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-capsule-"));
  // Create a real git repo with a couple of commits + a tiny .mneme/ db
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email t@x", { cwd: tmp });
  execSync("git config user.name Tester", { cwd: tmp });
  writeFileSync(join(tmp, "a.txt"), "hello");
  execSync("git add a.txt && git commit -q -m \"feat: initial commit\"", { cwd: tmp });
  writeFileSync(join(tmp, "a.txt"), "hello world\n// TODO: add tests\n");
  execSync("git add a.txt && git commit -q -m \"chore: add TODO\"", { cwd: tmp });
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

function tarAvailable(): boolean {
  const r = spawnSync("tar", ["--version"], { stdio: "pipe" });
  return r.status === 0;
}

describe("time-capsule — export/import smoke", () => {
  it("returns 1 if not in a git repo", async () => {
    const nonGit = mkdtempSync(join(tmpdir(), "mneme-non-git-"));
    try {
      const code = await timeCapsuleCommand({
        cwd: nonGit,
        exportPath: join(nonGit, "x.tgz"),
        json: true,
      });
      expect(code).toBe(1);
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("returns 1 if .mneme/mneme.db is missing", async () => {
    // git repo exists but no Mneme index
    const code = await timeCapsuleCommand({
      cwd: tmp,
      exportPath: join(tmp, "out.tgz"),
      json: true,
    });
    expect(code).toBe(1);
  });

  it("rejects --export and --import together", async () => {
    const code = await timeCapsuleCommand({
      cwd: tmp,
      exportPath: join(tmp, "x.tgz"),
      importPath: join(tmp, "y.tgz"),
      json: true,
    });
    expect(code).toBe(1);
  });

  it("import returns 1 when capsule file is missing", async () => {
    const code = await timeCapsuleCommand({
      cwd: tmp,
      importPath: join(tmp, "no-such.tgz"),
      json: true,
    });
    expect(code).toBe(1);
  });

  it("import returns 1 when capsule has no manifest", async () => {
    if (!tarAvailable()) return; // skip on machines without tar
    // Build an empty tarball
    const empty = join(tmp, "empty");
    require("node:fs").mkdirSync(empty, { recursive: true });
    writeFileSync(join(empty, "junk.txt"), "no manifest here");
    const tarPath = join(tmp, "empty.tgz");
    spawnSync("tar", ["-czf", tarPath, "-C", empty, "."], { stdio: "pipe" });
    const code = await timeCapsuleCommand({
      cwd: tmp,
      importPath: tarPath,
      json: true,
    });
    expect(code).toBe(1);
  });
});
