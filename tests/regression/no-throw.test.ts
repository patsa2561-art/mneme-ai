// Category 2 — no command throws an unhandled error on an empty git repo.
//
// What this catches: a command that assumes `mneme.db` exists, an unwrapped
// `JSON.parse`, an `await` on undefined — anything that turns the friendly
// "run `mneme init` first" path into a stack trace in the user's face.
//
// Property under test:
//   1. process did not die from a signal (no segfault, no OOM kill)
//   2. exit code is 0, 1, or 2 (graceful) — NOT 134 (abort), 139 (segfault), etc.
//   3. SOMETHING was printed (no silent failures)
//   4. that output does not contain a raw stack trace

import { describe, it, expect, beforeAll } from "vitest";
import {
  ALL_COMMANDS,
  INTERACTIVE_OR_DAEMON,
  REQUIRES_ARGS,
  argvFor,
  distExists,
  mkTempRepo,
  rmTempRepo,
  runCli,
  strip,
} from "./helpers.js";

beforeAll(() => {
  if (!distExists()) {
    throw new Error("dist missing — run `npm run build`");
  }
});

// Commands we test in this category: not interactive, not a daemon.
// We DO include REQUIRES_ARGS commands, but with their smallest-valid argv.
const CANDIDATES = ALL_COMMANDS.filter((c) => !INTERACTIVE_OR_DAEMON.has(c));

const STACK_RE = /^\s+at\s+\S+:\d+/m; // "  at foo (file.ts:12)"

describe("CLI regression — no command throws on an empty repo", () => {
  for (const cmd of CANDIDATES) {
    it(`${cmd} on empty repo: graceful exit + friendly output`, () => {
      const dir = mkTempRepo();
      try {
        // Some commands need a positional arg to even start parsing —
        // give them the smallest valid invocation.
        const argv = REQUIRES_ARGS.has(cmd)
          ? argvFor(cmd)
          : argvFor(cmd);

        // Most commands should finish in well under 10s on an empty repo.
        // If it hangs, the timeout fires and `signal === "SIGTERM"`, which
        // we report as a regression (means the command needs to be added
        // to INTERACTIVE_OR_DAEMON).
        const r = runCli(argv, { cwd: dir, timeoutMs: 15_000 });

        expect(
          r.signal,
          `${cmd} hung or crashed (signal=${r.signal}). If it's a daemon, add to INTERACTIVE_OR_DAEMON.\nstdout: ${r.stdout.slice(0, 300)}\nstderr: ${r.stderr.slice(0, 300)}`,
        ).toBeNull();

        // status null means the OS killed us; status > 2 means we exited
        // with an unfriendly code (e.g. 134 abort, 137 OOM).
        expect(
          r.status,
          `${cmd} exited unfriendly:\n${r.combined.slice(0, 400)}`,
        ).not.toBeNull();
        expect(r.status ?? 99).toBeLessThan(3);

        // Something was said.
        expect(r.combined.length).toBeGreaterThan(0);

        // No raw stack trace leaked through.
        const plain = strip(r.combined);
        expect(
          STACK_RE.test(plain),
          `${cmd} leaked a stack trace:\n${plain.slice(0, 600)}`,
        ).toBe(false);
      } finally {
        rmTempRepo(dir);
      }
    }, 20_000);
  }
});

describe("CLI regression — interactive commands at least respond to --help in temp dir", () => {
  // Even daemon commands should answer --help cleanly. This is a separate
  // check from category 1 because here we run inside a non-Mneme repo —
  // catches "help loads config eagerly and crashes" bugs.
  for (const cmd of [...INTERACTIVE_OR_DAEMON]) {
    it(`${cmd} --help in empty repo`, () => {
      const dir = mkTempRepo();
      try {
        const r = runCli([...argvFor(cmd), "--help"], { cwd: dir, timeoutMs: 10_000 });
        expect(r.signal).toBeNull();
        expect(r.status).toBe(0);
      } finally {
        rmTempRepo(dir);
      }
    });
  }
});
