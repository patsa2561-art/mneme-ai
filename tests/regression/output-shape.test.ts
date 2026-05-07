// Category 3 — output shape properties.
//
// Properties we assert on every visible command's output:
//   1. < 1 MB stdout (catches infinite loops / wrong-table dumps)
//   2. no raw `[object Object]`     (Promise / serialization bug)
//   3. no bare `undefined` token    (missing fallback)
//   4. no raw stack traces          (`Error:` + `  at file:line`)
//   5. ANSI escapes are well-formed (every \x1b[ closes with `m`)
//
// We run from REPO_ROOT so commands have real data — this is the highest-
// signal place to catch regressions because it's the same data the user
// sees.

import { describe, it, expect, beforeAll } from "vitest";
import { runCli, strip, distExists, REPO_ROOT } from "./helpers.js";

beforeAll(() => {
  if (!distExists()) {
    throw new Error("dist missing — run `npm run build`");
  }
});

// Commands we hit with real data. Each tuple is [argv, label].
// We pick light, fast, deterministic ones (no LLM calls, --no-llm where we can).
const TARGETS: Array<{ argv: string[]; label: string; needsIndex?: boolean }> = [
  { argv: ["status"], label: "status" },
  { argv: ["doctor"], label: "doctor" },
  { argv: ["wisdom"], label: "wisdom" },
  { argv: ["wisdom", "-n", "1"], label: "wisdom -n 1" },
  { argv: ["manifesto"], label: "manifesto" },
  { argv: ["advanced"], label: "advanced" },
  { argv: ["--help"], label: "top-level help" },
  { argv: ["ask", "--help"], label: "ask --help" },
  { argv: ["forensics", "anomaly", "--help"], label: "forensics anomaly --help" },
  { argv: ["htc-stats", "--help"], label: "htc-stats --help" },
  { argv: ["do", "what does this repo do?"], label: "do question (rejection or routing path)" },
];

const STACK_RE = /^\s+at\s+\S+(?::\d+|\(\S+:\d+)/m;
// Well-formed ANSI: every ESC[ ends with a letter (most commonly `m`).
// Bad: ESC[ followed by digits/semicolons but no terminator before the next ESC or EOL.
const BAD_ANSI = /\x1b\[[0-9;]*(?=[^0-9;a-zA-Z]|$)/;

describe("CLI regression — output shape", () => {
  for (const t of TARGETS) {
    it(`${t.label} produces well-formed output`, () => {
      const r = runCli(t.argv, { cwd: REPO_ROOT, timeoutMs: 30_000 });
      const out = r.combined;

      // 1. size cap
      expect(out.length, `output >1MB for ${t.label}`).toBeLessThan(1_000_000);

      // 2. [object Object]
      expect(out, `[object Object] in ${t.label}`).not.toContain("[object Object]");

      // 3. bare undefined (we strip ANSI first so we don't false-match
      //    on color codes; we use \b to avoid matching "undefined" inside
      //    larger words like "redefined")
      const plain = strip(out);
      // Allow it to appear ONLY as part of error helper messages like
      // "value is undefined". Strict mode: if it shows up at all, fail.
      expect(/\bundefined\b/.test(plain), `bare 'undefined' in ${t.label}:\n${plain.slice(0, 400)}`).toBe(false);

      // 4. no raw stack trace
      expect(STACK_RE.test(plain), `stack trace leaked in ${t.label}:\n${plain.slice(0, 600)}`).toBe(false);

      // 5. ANSI well-formedness — strip should match `out` length minus
      //    valid sequences. If there's a malformed sequence, NO_COLOR mode
      //    would have suppressed it anyway, so this is more of a sanity
      //    check on the env-var path.
      // We run with NO_COLOR=1, so this should be trivially true: no ESC[
      // bytes in stripped output should equal "ESC was paired with `m`".
      // Practical check: original out shouldn't contain a bare ESC byte
      // that strip() failed to remove.
      const remaining = strip(out);
      expect(remaining.includes("\x1b["), `unstripped ANSI in ${t.label}`).toBe(false);
      expect(BAD_ANSI.test(remaining)).toBe(false);
    }, 35_000);
  }
});

describe("CLI regression — JSON paths emit valid JSON", () => {
  // Every command with --json should produce parseable JSON or empty stdout.
  const JSON_TARGETS: Array<{ argv: string[]; label: string; allowEmpty?: boolean }> = [
    { argv: ["status", "--json"], label: "status --json", allowEmpty: true },
    { argv: ["doctor", "--json"], label: "doctor --json" },
    { argv: ["wisdom", "--json"], label: "wisdom --json" },
    { argv: ["manifesto", "--json"], label: "manifesto --json" },
    { argv: ["htc-stats", "--json"], label: "htc-stats --json", allowEmpty: true },
  ];

  for (const t of JSON_TARGETS) {
    it(`${t.label} → parseable`, () => {
      const r = runCli(t.argv, { cwd: REPO_ROOT, timeoutMs: 20_000 });
      // The `status` / `htc-stats --json` paths fall back to "no index yet"
      // text on a fresh repo. We only enforce JSON-ness when stdout looks
      // like JSON (starts with { or [).
      const trimmed = r.stdout.trim();
      if (!trimmed) {
        if (t.allowEmpty) return;
        throw new Error(`${t.label} produced no stdout`);
      }
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        expect(() => JSON.parse(trimmed)).not.toThrow();
      } else if (!t.allowEmpty) {
        throw new Error(`${t.label} did not emit JSON:\n${trimmed.slice(0, 300)}`);
      }
    }, 25_000);
  }
});
