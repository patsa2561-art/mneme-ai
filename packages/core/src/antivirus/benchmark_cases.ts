/**
 * Mneme Antivirus -- labeled benchmark suite.
 *
 * Each strain has ~10 labeled cases:
 *   - half POSITIVE (expectedInfected: true): drafts that contain a real
 *     instance of the strain. Vaccine should catch.
 *   - half NEGATIVE (expectedInfected: false): drafts that LOOK like the
 *     strain at the surface (regex match) but are actually clean. Vaccine
 *     should NOT flag (low false-positive rate).
 *
 * Honest scoring: if we only had positives, every vaccine could "catch
 * everything" and look 100%. The negatives are what proves precision.
 */

import type { BenchmarkCase, StrainId } from "./types.js";

export const BENCHMARK_CASES: Record<StrainId, BenchmarkCase[]> = {
  citatio_viridis: [
    // POSITIVES: invented SHAs (16 random hex chars no real repo will hold)
    { id: "cv-p-1", expectedInfected: true, draft: "See commit deadbeefcafe1234 for details.", note: "fake sha" },
    { id: "cv-p-2", expectedInfected: true, draft: "The fix landed in #abadbabe1337c0de.", note: "fake sha #2" },
    { id: "cv-p-3", expectedInfected: true, draft: "sha 0123456789abcdef0123 introduced the bug.", note: "fake sha #3" },
    { id: "cv-p-4", expectedInfected: true, draft: "Refer to f00ba2c1d3e5f7890ab for the migration.", note: "fake sha #4" },
    { id: "cv-p-5", expectedInfected: true, draft: "@feedfacedeadbeef0123 is when we deprecated it.", note: "fake sha #5" },
    // NEGATIVES: hex-shaped strings that are NOT git SHAs
    { id: "cv-n-1", expectedInfected: false, draft: "Background color is #ff5500 in the theme.", note: "css color" },
    { id: "cv-n-2", expectedInfected: false, draft: "The version is 1.2.3 (no commit ref here).", note: "no sha-shaped" },
    { id: "cv-n-3", expectedInfected: false, draft: "ID 1234567 in the database.", note: "numeric id (too short)" },
    { id: "cv-n-4", expectedInfected: false, draft: "Plain prose with no commit references at all.", note: "no match" },
    { id: "cv-n-5", expectedInfected: false, draft: "Look at the docs section #installation.", note: "anchor link" },
  ],

  persona_fictum: [
    // POSITIVES: invented authors
    { id: "pf-p-1", expectedInfected: true, draft: "by Aloysius Pendergast wrote this module.", note: "fake author" },
    { id: "pf-p-2", expectedInfected: true, draft: "@xyzabcnonexistentuser committed the fix.", note: "fake handle" },
    { id: "pf-p-3", expectedInfected: true, draft: "Fix authored by Hieronymus Strangelove.", note: "fake name" },
    { id: "pf-p-4", expectedInfected: true, draft: "written by Elspeth Quaverington.", note: "fake name" },
    { id: "pf-p-5", expectedInfected: true, draft: "committed by Bartholomew Snickerdoodle.", note: "fake name" },
    // NEGATIVES: prose with capitalized words that aren't author claims
    { id: "pf-n-1", expectedInfected: false, draft: "We use TypeScript and Node for the build.", note: "TypeScript not author" },
    { id: "pf-n-2", expectedInfected: false, draft: "The README explains the install flow.", note: "README not author" },
    { id: "pf-n-3", expectedInfected: false, draft: "Plain text without attribution markers.", note: "no by/@/wrote" },
    { id: "pf-n-4", expectedInfected: false, draft: "GitHub Actions runs the test matrix.", note: "GitHub Actions not author" },
    { id: "pf-n-5", expectedInfected: false, draft: "By default, the daemon ticks every 30 seconds.", note: "by default != by NAME" },
  ],

  api_phantasma: [
    // POSITIVES: function-call shapes for identifiers that don't exist
    { id: "ap-p-1", expectedInfected: true, draft: "Call zorblegrabbinator(opts) to wire it up.", note: "fake fn" },
    { id: "ap-p-2", expectedInfected: true, draft: "Use snickerdoodleAccelerator() for the speedup.", note: "fake fn" },
    { id: "ap-p-3", expectedInfected: true, draft: "import { quibblefrobnicate } from 'std'; quibblefrobnicate(x);", note: "fake fn" },
    { id: "ap-p-4", expectedInfected: true, draft: "We added xyzMethodNeverDefined() to the API.", note: "fake fn" },
    { id: "ap-p-5", expectedInfected: true, draft: "The helper noSuchUtilityFunction() helps.", note: "fake fn" },
    // NEGATIVES: real builtins or short identifiers (skipped)
    { id: "ap-n-1", expectedInfected: false, draft: "We use console.log everywhere.", note: "builtin" },
    { id: "ap-n-2", expectedInfected: false, draft: "JSON.parse handles the request body.", note: "builtin" },
    { id: "ap-n-3", expectedInfected: false, draft: "Math.max(a, b) returns the larger value.", note: "builtin" },
    { id: "ap-n-4", expectedInfected: false, draft: "Plain prose, no function calls here.", note: "no match" },
    { id: "ap-n-5", expectedInfected: false, draft: "Promise.all([a, b]) waits for both.", note: "builtin" },
  ],

  depends_imaginarium: [
    // POSITIVES: invented npm packages
    { id: "di-p-1", expectedInfected: true, draft: "Run: npm install zorblegrabbinator-cli", note: "fake pkg" },
    { id: "di-p-2", expectedInfected: true, draft: "import x from 'snickerdoodle-accelerator';", note: "fake pkg" },
    { id: "di-p-3", expectedInfected: true, draft: "require('quibblefrobnicate-utils')", note: "fake pkg" },
    { id: "di-p-4", expectedInfected: true, draft: "yarn add @nonexistentscope/imaginary-pkg", note: "fake scoped pkg" },
    { id: "di-p-5", expectedInfected: true, draft: "pnpm add fake-pkg-that-does-not-exist-anywhere-12345", note: "fake pkg" },
    // NEGATIVES: real packages or relative imports
    { id: "di-n-1", expectedInfected: false, draft: "import { join } from 'node:path'", note: "node builtin" },
    { id: "di-n-2", expectedInfected: false, draft: "import x from './local'", note: "relative import" },
    { id: "di-n-3", expectedInfected: false, draft: "Plain text without imports.", note: "no match" },
    { id: "di-n-4", expectedInfected: false, draft: "import fs from 'fs'", note: "node builtin" },
    { id: "di-n-5", expectedInfected: false, draft: "require('node:crypto')", note: "node builtin" },
  ],

  tempus_perversum: [
    // POSITIVES: dates implausibly far from a typical 2024-2026 repo range.
    // Vaccine compares to repo's git-date range; for tests, we set sentinel
    // dates that no real recent repo will contain.
    { id: "tp-p-1", expectedInfected: true, draft: "Migration shipped on 1985-04-12.", note: "way before any repo" },
    { id: "tp-p-2", expectedInfected: true, draft: "Released on 1990-01-01.", note: "way before" },
    { id: "tp-p-3", expectedInfected: true, draft: "Initial commit on 1970-01-01.", note: "epoch" },
    { id: "tp-p-4", expectedInfected: true, draft: "Patch landed 2099-12-31.", note: "way after" },
    { id: "tp-p-5", expectedInfected: true, draft: "Scheduled for 2080-06-15.", note: "way after" },
    // NEGATIVES: dates near the present, or no date at all
    { id: "tp-n-1", expectedInfected: false, draft: "We shipped this last week.", note: "no date" },
    { id: "tp-n-2", expectedInfected: false, draft: "The project started recently.", note: "no date" },
    { id: "tp-n-3", expectedInfected: false, draft: "Update logged in CHANGELOG.", note: "no date" },
    { id: "tp-n-4", expectedInfected: false, draft: "Currently stable.", note: "no date" },
    { id: "tp-n-5", expectedInfected: false, draft: "v1.0.0 was the first release.", note: "version not date" },
  ],

  confidens_cardinalis: [
    // POSITIVES: large counts that mismatch reality (vaccine compares to real)
    { id: "cc-p-1", expectedInfected: true, draft: "We ship 999999 tests in this repo.", note: "absurd test count" },
    { id: "cc-p-2", expectedInfected: true, draft: "There are 100000 packages installed.", note: "absurd pkg count" },
    { id: "cc-p-3", expectedInfected: true, draft: "Total of 500000 commits in history.", note: "absurd commits" },
    { id: "cc-p-4", expectedInfected: true, draft: "Repo contains 1000000 files.", note: "absurd files" },
    { id: "cc-p-5", expectedInfected: true, draft: "We maintain 50000 commits across the project.", note: "absurd" },
    // NEGATIVES: counts within plausible tolerance OR nouns we can't verify
    { id: "cc-n-1", expectedInfected: false, draft: "There are 3 errors today.", note: "errors -- no verifier" },
    { id: "cc-n-2", expectedInfected: false, draft: "Saw 5 warnings during build.", note: "warnings -- no verifier" },
    { id: "cc-n-3", expectedInfected: false, draft: "Ran 100 functions in the bench.", note: "functions -- no verifier" },
    { id: "cc-n-4", expectedInfected: false, draft: "Plain text without numeric counts.", note: "no match" },
    { id: "cc-n-5", expectedInfected: false, draft: "Took 10 lines to refactor.", note: "lines -- no verifier" },
  ],

  structura_invenita: [
    // POSITIVES: paths that don't exist
    { id: "si-p-1", expectedInfected: true, draft: "Edit packages/imaginary-pkg/src/nope.ts to fix.", note: "fake path" },
    { id: "si-p-2", expectedInfected: true, draft: "See src/nonexistent/module.ts for context.", note: "fake path" },
    { id: "si-p-3", expectedInfected: true, draft: "Update tests/zorble/grabbinator.test.ts", note: "fake path" },
    { id: "si-p-4", expectedInfected: true, draft: "Run scripts/zorblefrobnicate.mjs", note: "fake path" },
    { id: "si-p-5", expectedInfected: true, draft: "Look at docs/imaginary-section.md", note: "fake path" },
    // NEGATIVES: drafts that should NOT trigger the vaccine -- either no
    // path-shaped token at all, OR a token short/generic enough that the
    // vaccine's `length < 6 && !includes("/")` short-circuit kicks in.
    // v1.24.2: removed cases that assumed README.md / package.json / CHANGELOG.md
    // exist on disk -- those are real in mneme's repo but not in a fresh
    // benchmark tmpdir, so they'd false-positive the FP count instead of
    // testing the vaccine's behavior.
    { id: "si-n-1", expectedInfected: false, draft: "Plain prose with no path tokens whatsoever.", note: "no match" },
    { id: "si-n-2", expectedInfected: false, draft: "Just describing the architecture in words; no files mentioned.", note: "no match" },
    { id: "si-n-3", expectedInfected: false, draft: "Three tests pass and two fail in the suite.", note: "no path-shaped tokens" },
    { id: "si-n-4", expectedInfected: false, draft: "Edit log.js to fix the issue.", note: "too generic (length<=6 no slash)" },
    { id: "si-n-5", expectedInfected: false, draft: "Plain text without any file references.", note: "no match" },
  ],

  logica_circularis: [
    // POSITIVES: cyclic reasoning -- same clause repeats as premise + conclusion
    {
      id: "lc-p-1", expectedInfected: true,
      draft: "tests pass because the code works. since the code works tests pass. so the code works. tests pass because the code works.",
      note: "explicit cycle",
    },
    {
      id: "lc-p-2", expectedInfected: true,
      draft: "the system is reliable because the system is reliable. since the system is reliable the system is reliable. so the system is reliable.",
      note: "tautology cycle",
    },
    {
      id: "lc-p-3", expectedInfected: true,
      draft: "users trust us because we are trustworthy. since we are trustworthy users trust us. so we are trustworthy. users trust us because we are trustworthy.",
      note: "circular trust",
    },
    {
      id: "lc-p-4", expectedInfected: true,
      draft: "code is correct because tests pass. since tests pass code is correct. so tests pass. code is correct because tests pass.",
      note: "another cycle",
    },
    {
      id: "lc-p-5", expectedInfected: true,
      draft: "money is valuable because people accept it. since people accept it money is valuable. so people accept it. money is valuable because people accept it.",
      note: "currency cycle",
    },
    // NEGATIVES: linear reasoning, no cycle
    {
      id: "lc-n-1", expectedInfected: false,
      draft: "Tests pass because we wrote good assertions. The assertions cover edge cases. Edge cases include null, undefined, and empty arrays.",
      note: "linear chain",
    },
    {
      id: "lc-n-2", expectedInfected: false,
      draft: "The build is fast because we cache npm. Caching reduces re-downloads. Re-downloads are slow on the runner.",
      note: "linear chain",
    },
    {
      id: "lc-n-3", expectedInfected: false,
      draft: "We use TypeScript for type safety. Type safety catches errors early. Early catches reduce bug count.",
      note: "linear",
    },
    {
      id: "lc-n-4", expectedInfected: false,
      draft: "Plain prose with no causal markers at all.",
      note: "no causal markers",
    },
    {
      id: "lc-n-5", expectedInfected: false,
      draft: "The daemon ticks every 30 seconds. Each tick aggregates DNA. Aggregation produces the wisdom score.",
      note: "linear chain",
    },
  ],
};
