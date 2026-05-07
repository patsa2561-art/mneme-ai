/**
 * AI Session Audit — VERIFY module.
 *
 * "Leviathan-style narrative check" — compare the AI's COMMIT MESSAGE
 * (the draft) against the actual git diff (the strict target).  Every
 * claim the AI made must be supported by the change set; un-supported
 * claims are flagged "contradicted" so reviewers see exactly what was
 * over-promised.
 *
 * Inspired by `verifyAnswerLeviathan` in `retrieve/leviathan.ts`:
 * draft/target speculative-decoding loop, single pass, no re-draft.
 *
 * Pure functions.  No I/O.
 */

export type ClaimKind = "additive" | "fix" | "negation" | "scope" | "other";

export interface ClaimVerdictRow {
  claim: string;
  verdict: "verified" | "contradicted" | "unverifiable";
  reason: string;
}

export interface NarrativeCheck {
  commitHash: string;
  /** Claims extracted from the commit message. */
  claims: Array<{ text: string; kind: ClaimKind }>;
  /** Files actually touched in the diff. */
  filesTouched: string[];
  /** Per-claim verifications. */
  verifications: ClaimVerdictRow[];
  /** Fraction of verifiable claims that verified — `unverifiable` excluded. */
  narrativeTrustScore: number;
}

const NEGATION_RES = [
  /\bno\s+changes?\s+to\s+([\w./\-]+)/i,
  /\bdoes\s+not\s+touch\s+([\w./\-]+)/i,
  /\bwithout\s+modifying\s+([\w./\-]+)/i,
  /\bleav(?:e|ing|es)\s+([\w./\-]+)\s+(?:alone|unchanged)/i,
];

const ADDITIVE_RES = [
  /\badds?\s+([\w]+(?:\s+\w+){0,3})/i,
  /\bintroduces?\s+([\w]+(?:\s+\w+){0,3})/i,
  /\bcreates?\s+([\w]+(?:\s+\w+){0,3})/i,
  /\bnew\s+(?:function|class|module|file)\s+([\w$]+)/i,
];

const FIX_RES = [
  /\bfix(?:es|ed)?\s+(?:a\s+)?(typo|bug|crash|regression|race|leak|null)/i,
  /\bcorrects?\s+(?:a\s+)?(typo|bug|crash|regression|race|leak|null)/i,
];

const SCOPE_RES = [
  /\bonly\s+(?:touches|modifies|affects)\s+([\w./\-]+)/i,
  /\bjust\s+a?\s*(typo|comment|docstring)/i,
];

/**
 * Split the commit message into claim sentences.  We use a permissive
 * sentence splitter (period / newline) and skip anything that looks
 * like trailers (`Co-Authored-By:`, `Signed-off-by:`, etc.) since those
 * aren't claims about the diff.
 *
 * Subtlety: we DON'T treat `.` as a sentence boundary when it's inside
 * what looks like a file path (`db.ts`, `src/foo.ts`).  Otherwise the
 * negation claim "no change to db.ts" gets split into useless fragments.
 */
export function extractClaimSentences(message: string): string[] {
  if (!message) return [];
  const out: string[] = [];
  for (const line of message.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[A-Z][\w-]+:\s/.test(trimmed)) continue; // trailers
    if (/^\s*[*-]\s/.test(trimmed)) {
      out.push(trimmed.replace(/^\s*[*-]\s+/, "").trim());
      continue;
    }
    // Sentence boundary: `[.!?]` followed by whitespace OR end-of-line.
    // This preserves filename dots like "db.ts" inside a sentence.
    const parts = trimmed
      .split(/[.!?]+(?=\s|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 5);
    out.push(...parts);
  }
  return out;
}

/** Classify a single sentence into a coarse claim kind. */
export function classifyClaim(sentence: string): ClaimKind {
  for (const re of NEGATION_RES) if (re.test(sentence)) return "negation";
  for (const re of FIX_RES) if (re.test(sentence)) return "fix";
  for (const re of ADDITIVE_RES) if (re.test(sentence)) return "additive";
  for (const re of SCOPE_RES) if (re.test(sentence)) return "scope";
  return "other";
}

/**
 * Extract a file/path mention from a sentence — only `foo/bar.ts`-style
 * tokens (must contain a dot OR a slash).  We use this for negation +
 * scope claims.
 */
function extractPath(sentence: string): string | undefined {
  const m = sentence.match(/\b([\w./\-]+(?:\.\w+|\/[\w./\-]+))\b/);
  if (!m) return undefined;
  const tok = m[1] ?? "";
  if (!/[./]/.test(tok)) return undefined;
  return tok;
}

/** Best-effort: does any file in `filesTouched` end with `path` (or contain it)? */
export function fileTouched(filesTouched: string[], path: string): boolean {
  const norm = path.replace(/^\.\//, "").toLowerCase();
  for (const f of filesTouched) {
    const lf = f.toLowerCase();
    if (lf === norm) return true;
    if (lf.endsWith("/" + norm)) return true;
    if (norm.includes("/") && lf.includes(norm)) return true;
  }
  return false;
}

/**
 * Run the narrative check.  Returns per-claim verdicts and an aggregate
 * trust score.  When no claims are verifiable (all "unverifiable"), we
 * default trust to 1.0 (the message simply didn't make a checkable
 * promise — refusing to score that as a failure).
 */
export function verifyNarrative(
  commitMessage: string,
  diff: string,
  filesTouched: string[],
  commitHash: string = "",
): NarrativeCheck {
  const sentences = extractClaimSentences(commitMessage);
  const claims = sentences.map((text) => ({ text, kind: classifyClaim(text) }));
  const verifications: ClaimVerdictRow[] = [];

  // Counters for the trust score.
  let verifiable = 0;
  let verified = 0;

  for (const claim of claims) {
    const v = verifyOneClaim(claim, diff, filesTouched);
    verifications.push(v);
    if (v.verdict !== "unverifiable") {
      verifiable += 1;
      if (v.verdict === "verified") verified += 1;
    }
  }

  const narrativeTrustScore =
    verifiable === 0 ? 1.0 : Number((verified / verifiable).toFixed(2));

  return {
    commitHash,
    claims,
    filesTouched,
    verifications,
    narrativeTrustScore,
  };
}

function verifyOneClaim(
  claim: { text: string; kind: ClaimKind },
  diff: string,
  filesTouched: string[],
): ClaimVerdictRow {
  const text = claim.text;
  switch (claim.kind) {
    case "negation": {
      // "no change to X" → contradicted iff X is in filesTouched.
      const path = extractPath(text);
      if (!path) {
        return {
          claim: text,
          verdict: "unverifiable",
          reason: "negation claim with no specific file/path to check",
        };
      }
      if (fileTouched(filesTouched, path)) {
        return {
          claim: text,
          verdict: "contradicted",
          reason: `claim says "${path}" untouched, but diff modifies it`,
        };
      }
      return {
        claim: text,
        verdict: "verified",
        reason: `path "${path}" is not in the diff`,
      };
    }
    case "additive": {
      // Look for a `+function|class|interface|export <name>` line in the diff.
      const tokens = text.match(/\b(?:function|class|interface|module|export|file)\s+([A-Za-z_$][\w$]*)/i);
      const named = tokens ? tokens[1] : undefined;
      if (named) {
        const re = new RegExp(`^\\+.*\\b${escapeRe(named)}\\b`, "m");
        if (re.test(diff)) {
          return {
            claim: text,
            verdict: "verified",
            reason: `diff contains an additive line referencing "${named}"`,
          };
        }
        return {
          claim: text,
          verdict: "contradicted",
          reason: `claim says "added ${named}" but no additive line references that name`,
        };
      }
      // No specific token — just sanity check there ARE additions.
      if (!/^\+/m.test(diff)) {
        return {
          claim: text,
          verdict: "contradicted",
          reason: "claim says additive but diff has no `+` lines",
        };
      }
      return {
        claim: text,
        verdict: "unverifiable",
        reason: "additive claim is too generic to verify against diff",
      };
    }
    case "fix": {
      // "fix typo" but diff is huge → suspicious; we mark unverifiable
      // unless the whole diff is tiny (then verified).
      const addLines = (diff.match(/^\+/gm) ?? []).length;
      const delLines = (diff.match(/^-/gm) ?? []).length;
      const churn = addLines + delLines;
      // heuristic: typo fix should be < 20 lines of churn.
      if (/typo/i.test(text) && churn > 20) {
        return {
          claim: text,
          verdict: "contradicted",
          reason: `claim is "fix typo" but diff has ${churn} +/- lines (suspicious)`,
        };
      }
      return {
        claim: text,
        verdict: churn > 0 ? "verified" : "contradicted",
        reason: churn > 0
          ? `diff has ${churn} +/- lines consistent with a fix`
          : "claim says fix but diff is empty",
      };
    }
    case "scope": {
      const path = extractPath(text);
      if (!path) {
        return {
          claim: text,
          verdict: "unverifiable",
          reason: "scope claim has no specific file to check",
        };
      }
      // "only touches X" → fail iff any file outside X is touched.
      const stray = filesTouched.find((f) => !fileTouched([f], path));
      if (stray) {
        return {
          claim: text,
          verdict: "contradicted",
          reason: `claim says "only ${path}" but diff also touches "${stray}"`,
        };
      }
      return {
        claim: text,
        verdict: "verified",
        reason: `every touched file matches the scope "${path}"`,
      };
    }
    case "other":
    default:
      return {
        claim: text,
        verdict: "unverifiable",
        reason: "no rule matches this claim shape",
      };
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convenience: aggregate trust across many commits (mean of per-commit scores). */
export function aggregateNarrativeTrust(checks: NarrativeCheck[]): number {
  if (checks.length === 0) return 1.0;
  const sum = checks.reduce((s, c) => s + c.narrativeTrustScore, 0);
  return Number((sum / checks.length).toFixed(2));
}

/** Did any commit in the set have a contradicted claim? */
export function hasContradiction(checks: NarrativeCheck[]): boolean {
  for (const c of checks) {
    for (const v of c.verifications) {
      if (v.verdict === "contradicted") return true;
    }
  }
  return false;
}
