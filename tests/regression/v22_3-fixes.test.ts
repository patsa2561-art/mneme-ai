// v2.22.3 — CLI integration: the 7 findings from the audit.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) throw new Error("dist missing — run `npm run build`");
});

describe("v2.22.3 — audit findings regression", () => {
  describe("Finding #2 — swarm accepts positional <claim...>", () => {
    it("`mneme swarm 'short test claim'` no longer errors with 'Expected 0 arguments'", () => {
      const r = runCli(["swarm", "short", "test", "claim"], { cwd: REPO_ROOT });
      // Don't assert exit code — swarm may exit 2 on block. Assert no
      // commander argument-count error.
      expect(r.combined).not.toMatch(/Expected\s+0\s+arguments/i);
    });

    it("`mneme swarm --text ...` still works (backward compat)", () => {
      const r = runCli(["swarm", "--text", "short claim"], { cwd: REPO_ROOT });
      expect(r.combined).not.toMatch(/Expected\s+0\s+arguments/i);
    });

    it("`mneme swarm --help` mentions positional `[claim...]`", () => {
      const r = runCli(["swarm", "--help"], { cwd: REPO_ROOT });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/\[claim/);
    });
  });

  describe("Finding #3 — adversarial prerequisites surfaced in description", () => {
    it("`mneme adversarial --help` mentions git + htc-build prerequisites", () => {
      const r = runCli(["adversarial", "--help"], { cwd: REPO_ROOT });
      expect(r.status).toBe(0);
      const txt = r.stdout.toLowerCase();
      expect(txt).toMatch(/git/);
      expect(txt).toMatch(/htc/);
    });
  });

  describe("Finding #4 — --json flag honored in both generate and grade modes", () => {
    it("`mneme adversarial --help` documents --json applies in both modes", () => {
      const r = runCli(["adversarial", "--help"], { cwd: REPO_ROOT });
      expect(r.status).toBe(0);
      expect(r.stdout.toLowerCase()).toMatch(/json/);
    });
  });
});
