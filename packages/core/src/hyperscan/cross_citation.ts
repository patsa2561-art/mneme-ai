/**
 * v1.69.0 -- HYPERSCAN H2: CROSS-CITATION GROUND.
 *
 * Wild idea: every behavior-attribution in a claim ("X handles Y", "we
 * use Z for Q") implies a citation should EXIST. We can't trust prose
 * naming a thing; we can verify whether the thing is reachable in the
 * codebase under the claimed role.
 *
 * Algorithm:
 *   1. Parse claim into (subject, verb, object) triples using a tiny
 *      verb-anchored grammar.
 *   2. For each triple, search:
 *        a. Files matching subject as filename / module-name
 *        b. Imports of subject as module
 *        c. Comment/docstring mentions of subject co-occurring with object
 *   3. Citation density = (sources-with-evidence / sources-checked).
 *      Below threshold -> citation-gap suspect.
 *
 * Output: per-triple citation report.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BEHAVIOR_VERBS = [
  "handles?", "implements?", "uses?", "calls?", "covers?", "supports?",
  "tests?", "validates?", "enforces?", "verifies?", "caches?", "stores?",
  "manages?", "powers?", "drives?", "controls?", "integrates with",
  "depends on", "is used by", "is integrated for",
];

const VERB_RE = new RegExp(`\\b(\\S+(?:\\s+\\S+)?)\\s+(${BEHAVIOR_VERBS.join("|")})\\s+(.+?)(?:[.,;!?]|$)`, "gi");

export interface ClaimTriple {
  subject: string;
  verb: string;
  object: string;
}

export interface CitationCheck {
  triple: ClaimTriple;
  /** Sources where evidence was found. */
  evidence: string[];
  /** Sources we checked. */
  checked: number;
  /** evidence.length / checked. */
  density: number;
  /** Whether the citation gap is significant. */
  isGap: boolean;
  detail: string;
}

export interface CrossCitationReport {
  triples: ClaimTriple[];
  checks: CitationCheck[];
  /** Triples with density < threshold. */
  gaps: number;
  /** Overall ground score 0..1. */
  groundScore: number;
  ms: number;
}

export function parseTriples(claim: string): ClaimTriple[] {
  const out: ClaimTriple[] = [];
  const seen = new Set<string>();
  for (const m of claim.matchAll(VERB_RE)) {
    const subject = (m[1] ?? "").trim();
    const verb = (m[2] ?? "").trim();
    const object = (m[3] ?? "").trim().split(/\s+/).slice(0, 5).join(" "); // cap noun phrase
    if (subject.length < 2 || object.length < 2) continue;
    const key = `${subject.toLowerCase()}|${verb}|${object.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ subject, verb, object });
  }
  return out;
}

function walkSourceFiles(repoRoot: string, max = 200): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".mneme", "coverage"]);
  const walk = (dir: string) => {
    if (out.length >= max) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (skip.has(e)) continue;
      const p = join(dir, e);
      try {
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs|cjs|md)$/.test(e)) {
          try { out.push({ path: p, content: readFileSync(p, "utf8") }); } catch { /* */ }
        }
      } catch { /* */ }
    }
  };
  walk(repoRoot);
  return out;
}

function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 3));
}

function searchEvidence(triple: ClaimTriple, files: Array<{ path: string; content: string }>): string[] {
  const evidence: string[] = [];
  const subjTokens = tokens(triple.subject);
  const objTokens = tokens(triple.object);
  if (subjTokens.size === 0 || objTokens.size === 0) return evidence;
  for (const f of files) {
    const fileName = f.path.split(/[\\/]/).pop()!.toLowerCase();
    const contentLower = f.content.toLowerCase();
    // Filename match for subject
    if ([...subjTokens].some((t) => fileName.includes(t))) {
      evidence.push(`filename:${fileName}`);
      if (evidence.length >= 5) return evidence;
      continue;
    }
    // Subject + object co-occurrence in file
    if ([...subjTokens].some((t) => contentLower.includes(t)) &&
        [...objTokens].some((t) => contentLower.includes(t))) {
      evidence.push(`cooccur:${fileName}`);
      if (evidence.length >= 5) return evidence;
    }
  }
  return evidence;
}

export function crossCitationGround(repoRoot: string, claim: string, opts?: { gapThreshold?: number }): CrossCitationReport {
  const t0 = Date.now();
  const gapThreshold = opts?.gapThreshold ?? 0.3;
  const triples = parseTriples(claim);
  const files = walkSourceFiles(repoRoot);
  const checks: CitationCheck[] = [];
  let gaps = 0;
  let totalDensity = 0;
  for (const triple of triples) {
    const evidence = searchEvidence(triple, files);
    const checked = Math.min(files.length, 50);
    const density = checked === 0 ? 0 : evidence.length / Math.max(1, Math.min(5, checked));
    const isGap = density < gapThreshold;
    if (isGap) gaps += 1;
    totalDensity += density;
    checks.push({
      triple,
      evidence,
      checked,
      density,
      isGap,
      detail: isGap
        ? `Citation gap: "${triple.subject} ${triple.verb} ${triple.object}" -- ${evidence.length}/${checked} sources confirm.`
        : `Grounded: ${evidence.length} citation(s) found for "${triple.subject} ${triple.verb} ...".`,
    });
  }
  const groundScore = triples.length === 0 ? 1 : 1 - (gaps / triples.length);
  return { triples, checks, gaps, groundScore, ms: Date.now() - t0 };
}
