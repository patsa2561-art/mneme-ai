// Category — package-lock.json MUST stay in sync with every workspace
// package.json version.
//
// ROOT CAUSE this guards (v2.110, the chronic github-pages red-X): every
// release bumped package.json versions but the committed package-lock.json
// lagged a version, so CI `npm ci` (which hard-fails on ANY package.json↔lock
// mismatch) failed on every deploy — and heal-lockfile.mjs only repairs
// registry INTEGRITY drift, never WORKSPACE-VERSION drift, so the self-heal
// couldn't recover.
//
// This test fails LOUDLY in local `npm test` the moment a version bump forgets
// to sync the lockfile — long before it can red-X a deploy. Pure file reads,
// no spawn, deterministic.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./helpers.js";

interface LockPkg { version?: string; link?: boolean; dependencies?: Record<string, string> }
interface Lock { version?: string; packages?: Record<string, LockPkg> }

function readJson<T>(p: string): T { return JSON.parse(readFileSync(p, "utf8")) as T; }

describe("package-lock.json ↔ package.json version sync (guards the chronic Pages red-X)", () => {
  const lockPath = join(REPO_ROOT, "package-lock.json");
  const rootPkgPath = join(REPO_ROOT, "package.json");

  it("lockfile exists", () => {
    expect(existsSync(lockPath)).toBe(true);
  });

  const lock = existsSync(lockPath) ? readJson<Lock>(lockPath) : { packages: {} };
  const rootPkg = readJson<{ version: string }>(rootPkgPath);

  it("root version matches the lockfile's top-level + packages[\"\"] entries", () => {
    expect(lock.version).toBe(rootPkg.version);
    expect(lock.packages?.[""]?.version).toBe(rootPkg.version);
  });

  // discover every workspace package the lockfile tracks (packages/<name>)
  const wsKeys = Object.keys(lock.packages ?? {}).filter(
    (k) => /^packages\/[^/]+$/.test(k) && lock.packages![k]!.link !== true,
  );

  it("tracks at least the 7 publishable workspaces + 2 private", () => {
    expect(wsKeys.length).toBeGreaterThanOrEqual(7);
  });

  for (const key of wsKeys) {
    const pkgJsonPath = join(REPO_ROOT, key, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = readJson<{ version: string; name?: string; dependencies?: Record<string, string> }>(pkgJsonPath);

    it(`${key} version matches the lockfile`, () => {
      expect(lock.packages![key]!.version).toBe(pkg.version);
    });

    // every internal @mneme-ai/* dep pin inside this workspace entry must match
    const lockDeps = lock.packages![key]!.dependencies ?? {};
    const pkgDeps = pkg.dependencies ?? {};
    for (const d of Object.keys(lockDeps)) {
      if (!d.startsWith("@mneme-ai/")) continue;
      if (!(d in pkgDeps)) continue;
      it(`${key} dep ${d} pin matches package.json`, () => {
        expect(lockDeps[d]).toBe(pkgDeps[d]);
      });
    }
  }
});
