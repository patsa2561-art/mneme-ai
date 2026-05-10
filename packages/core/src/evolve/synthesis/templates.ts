/**
 * Phase 3 template library.
 *
 * Each template is a NAMED, DETERMINISTIC transformation. Given the
 * same source + signal evidence, you get the same patch out every
 * time. No LLM. No randomness. No "creative" rewriting.
 *
 * To add a new template:
 *   1. Add an id to TemplateId (../types.ts)
 *   2. Add a `match(source, signal)` function that returns a
 *      TemplateMatch | null
 *   3. Register it in ALL_TEMPLATES below
 *   4. Add tests covering the matched + non-matched cases
 *
 * Template growth is the moat. Today: 1 template (warn-to-skip on
 * missing-file). Six months out: dozens, all proven by the gate
 * pipeline + HMAC-signed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { EvolveSignal } from "../types.js";
import type { TemplateMatch } from "./types.js";

/**
 * Template 1: warn -> skip when the gating file doesn't exist.
 *
 * Pattern: a selfcheck FAIL/WARN whose evidence reads "no <file>"
 * AND whose source has the shape:
 *
 *     if (!existsSync(<path>)) {
 *       return v(start, {
 *         name: "<name>", description: "<desc>",
 *         status: "warn",
 *         evidence: "no <file>",
 *         fixHint: "...",
 *       });
 *     }
 *
 * The user almost never wants this to be a "warn" -- it's a
 * "feature not used yet" state. Transform `status: "warn"` to
 * `status: "skip"` in this exact branch.
 */
function matchSelfcheckWarnToSkipOnMissingFile(
  repoRoot: string,
  signal: EvolveSignal,
): TemplateMatch | null {
  // Only apply to selfcheck signals whose pattern indicates a "warn"
  // verdict (we'd be more cautious about "fail" -- that may be
  // load-bearing).
  const selfcheckMatch = /^selfcheck:([^:]+):warn$/.exec(signal.pattern);
  if (!selfcheckMatch) return null;
  const checkName = selfcheckMatch[1]!;

  const filePath = "packages/core/src/selfcheck/checks.ts";
  const fullPath = join(repoRoot, filePath);
  if (!existsSync(fullPath)) return null;

  const source = readFileSync(fullPath, "utf8");

  // Locate the warn-on-missing branch for this specific check name.
  // We look for the canonical shape:
  //   name: "<checkName>"  ...  status: "warn"  ...  evidence: "no <file>"
  // within the same braces.
  // Build a regex that captures the WHOLE return v(start, { ... });
  // block where name matches AND status:"warn" AND evidence:"no ..."
  // appear inside.
  const escapedName = checkName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Find the name: "<checkName>" anchor, then look forward for the
  // surrounding return v(start, { ... }) block.
  const anchorRe = new RegExp(
    `(return\\s+v\\(start,\\s*\\{\\s*\\n?\\s*name:\\s*"${escapedName}"[^}]*?status:\\s*)"warn"([^}]*?evidence:\\s*"no\\s)`,
    "s",
  );
  const m = anchorRe.exec(source);
  if (!m) return null;

  // BUG FIX (v1.27.2): the original implementation extracted just the
  // single `status: "warn",` line as the template's before/after pair.
  // String.replace then replaced the FIRST file-wide occurrence -- which
  // is whichever check appears earliest in the file, NOT the one our
  // proposal cited. (Reported by AI-agent reviewer 2026-05-10: a
  // proposal for `antivirus-ready` patched `pulse-hook-installed`
  // because pulse-hook-installed's warn-line came first in the file.)
  //
  // The fix: anchor the before/after to the FULL matched span. The
  // span starts with `name: "${checkName}"` which is unique in file
  // (only one AuditCheck object owns each check name). We construct
  // before/after by replacing the status:"warn" inside the span and
  // returning the entire span on both sides, so String.replace can
  // only land on the right block.
  const matchedSpan = m[0];
  // The matched span starts at `return v(start, { ... name: "<unique>"`
  // and runs through exactly ONE `status: "warn"` (the warn we want to
  // demote to skip). Inside this span, "warn" appears in `status: "warn"`
  // only (other occurrences would require crossing a `}` which the
  // anchor regex's [^}]*? forbids). So a plain replace of `"warn"` ->
  // `"skip"` inside the span is safe AND tolerant of CRLF / extra
  // whitespace from Windows checkouts.
  if (!matchedSpan.includes('"warn"')) return null;
  const before = matchedSpan;
  const after = matchedSpan.replace('"warn"', '"skip"');
  if (before === after) return null;

  return {
    templateId: "selfcheck-warn-to-skip-on-missing-file",
    filePath,
    description: `selfcheck "${checkName}" returns warn when the gating file is missing -- demote to skip (feature not in use is not a warning).`,
    before,
    after,
  };
}

/** Registry of every template. Order matters -- first match wins. */
export const ALL_TEMPLATES: Array<(repoRoot: string, signal: EvolveSignal) => TemplateMatch | null> = [
  matchSelfcheckWarnToSkipOnMissingFile,
];

/**
 * Try every template against a signal. Returns the first match, or
 * null if no template applies.
 */
export function matchTemplate(repoRoot: string, signal: EvolveSignal): TemplateMatch | null {
  for (const t of ALL_TEMPLATES) {
    try {
      const m = t(repoRoot, signal);
      if (m) return m;
    } catch {
      // a buggy template should never block other templates
    }
  }
  return null;
}
