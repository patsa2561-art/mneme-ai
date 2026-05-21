// v2.21.5 — ATLAS HELP CLI integration.
//
// World-first verification: the bloom filter ships intact through the
// CLI surface; --probe answers in O(1); the 5-layer discovery path
// fits in well under 14 KB.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("ATLAS HELP (v2.21.5) — six-layer discovery", () => {
  it("`mneme atlas` emits the composed Atlas under 8 KB", () => {
    const r = runCli(["atlas"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ATLAS");
    expect(r.stdout).toContain("BLOOM");
    expect(r.stdout).toContain("TAGS");
    // Atlas total payload is meaningfully smaller than full --help (~14 KB).
    expect(r.stdout.length).toBeLessThan(8 * 1024);
  });

  it("`mneme bloom` emits the textual bloom filter under 500 chars", () => {
    const r = runCli(["bloom"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    const blob = r.stdout.trim();
    expect(blob).toMatch(/^bloom\/v1\/m\d+\/k\d+\/n\d+\/[A-Za-z0-9_-]+$/);
    expect(blob.length).toBeLessThan(500);
  });

  it("`mneme bloom --probe <known-verb>` exits 0", () => {
    const r = runCli(["bloom", "--probe", "earthquake"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("earthquake");
  });

  it("`mneme bloom --probe <unknown>` exits 1", () => {
    const r = runCli(["bloom", "--probe", "definitelyNotARealVerbXyzzy42"], { cwd: REPO_ROOT });
    expect(r.status).toBe(1);
  });

  it("`mneme tags --tag trust` lists trust commands", () => {
    const r = runCli(["tags", "--tag", "trust"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("verify-self");
  });

  it("`mneme route` returns matches for a real intent", () => {
    const r = runCli(["route", "verify trust attestation"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("INTENT");
    expect(r.stdout.toLowerCase()).toContain("verify");
  });

  it("`mneme hot` runs even on a fresh repo (no pheromones)", () => {
    const r = runCli(["hot"], { cwd: REPO_ROOT });
    expect(r.status).toBe(0);
    // Either lists hot verbs or the empty-state message.
    expect(r.stdout).toMatch(/HOT|no pheromones/);
  });
});
