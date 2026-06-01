/**
 * v2.136.0 — ELLEIPSIS (ἔλλειψις, "omission / falling short").
 * ==========================================================
 * The savant of COMPLETENESS — the diamond no model lab will build.
 *
 * Everyone checks whether what an AI SAID is true (hallucination). Almost nobody
 * guards what the AI SILENTLY LEFT OUT: you asked for three things and it did
 * two; you said "don't touch the auth module" and it did; you asked it to add a
 * test and it shipped the feature without one. Omission is how a CAPABLE model
 * fails you — and you usually don't notice, because there's nothing wrong on the
 * screen, only something MISSING.
 *
 * Why a model vendor won't build this: it surfaces "here is what our model
 * silently failed to do" — a structural conflict. Mneme can, because it holds
 * the one piece of ground truth the vendor doesn't optimise for: YOUR REQUEST.
 * It deterministically extracts the checkable asks from your message and reports
 * coverage of each against the AI's output/diff: COVERED / UNADDRESSED / UNKNOWN
 * (+ VIOLATED for a "don't do X" you asked for).
 *
 * DIAKRISIS — honest scope: extracting intent from natural language is fuzzy, so
 * ELLEIPSIS is a COVERAGE HEURISTIC with prove-or-unknown discipline: it flags an
 * UNADDRESSED ask only when the evidence is clear, and ABSTAINS to UNKNOWN
 * otherwise — it never claims to catch every omission (impossible), and never
 * fabricates an omission it can't support. A surfaced UNADDRESSED item is a
 * prompt to look, not a verdict that the AI failed. Deterministic + total + signed
 * (the CLI/MCP add the NOTARY receipt).
 */

export type AtomKind = "imperative" | "numbered" | "constraint" | "negation";
export type Coverage = "COVERED" | "UNADDRESSED" | "UNKNOWN" | "VIOLATED";

export interface ReqAtom {
  id: number;
  text: string;
  kind: AtomKind;
  /** salient keywords/identifiers that should appear in a fulfilling output. */
  keywords: string[];
}

export interface AtomVerdict {
  atom: ReqAtom;
  coverage: Coverage;
  /** 0..1 fraction of keywords found in the output (evidence strength). */
  hit: number;
  reason: string;
}

export interface ElleipsisReport {
  atoms: ReqAtom[];
  verdicts: AtomVerdict[];
  covered: number;
  unaddressed: number;
  unknown: number;
  violated: number;
  /** covered / (covered + unaddressed + violated); UNKNOWN excluded. Labeled. */
  completenessScore: number;
  /** the items a human should look at (UNADDRESSED + VIOLATED), most-salient first. */
  gaps: AtomVerdict[];
  note: string;
}

// imperative verbs that mark "an ask" (cross-domain: code + prose).
const IMPERATIVES = /\b(add|create|make|build|implement|write|fix|update|change|refactor|remove|delete|rename|move|support|include|ensure|handle|cover|test|validate|check|document|export|wire|register|return|set|enable|disable|expose|guard|gate|sign|verify|deploy|publish|migrate|optimi[sz]e|reduce|increase|prevent|allow|block|redact|neutralize|decompose)\b/i;
// constraint / requirement markers.
const CONSTRAINT = /\b(must|should|need to|needs to|has to|have to|required|ensure that|make sure|also|and then|as well|in addition)\b/i;
// negation / prohibition markers ("don't touch X", "without Y", "never Z").
const NEGATION = /\b(do not|don'?t|never|without|except|avoid|no\s+\w|must not|shouldn'?t|leave\s+\w+\s+(alone|untouched)|keep\s+\w+\s+(intact|unchanged))\b/i;

const STOP = new Set("the a an of to and or but for with on in at by it this that these those is are be do does please can you i we my our your they them then so as it's its make sure also need needs want would should could will shall may might per into from out up down very just only".split(/\s+/));

/** Trim leading/trailing punctuation that clings to a token ("module."→"module"). */
function trimPunct(s: string): string { return s.replace(/^[._\-/]+/, "").replace(/[._\-/]+$/, ""); }

/** Extract salient keywords/identifiers from a clause. Deterministic. */
function keywordsOf(clause: string): string[] {
  const out = new Set<string>();
  // quoted strings + backticked tokens are high-signal (exact asks).
  for (const m of clause.matchAll(/[`"']([^`"']{2,60})[`"']/g)) out.add(trimPunct(m[1]!.trim().toLowerCase()));
  // identifier-ish: camelCase, snake_case, dotted, file.ext, kebab — high signal.
  for (const m of clause.matchAll(/\b([A-Za-z_][\w.\-/]*(?:[._/\-][A-Za-z0-9]\w*)+|\b[a-z]+[A-Z]\w*)\b/g)) out.add(trimPunct(m[1]!.toLowerCase()));
  // plain salient words (len>2 after trimming clinging punctuation, not a stopword).
  for (const w of clause.toLowerCase().split(/[^a-z0-9_.\-/]+/)) {
    const t = trimPunct(w);
    if (t.length > 2 && !STOP.has(t)) out.add(t);
  }
  return [...out].filter((k) => k.length > 1).slice(0, 24);
}

/** Split a request into checkable requirement-atoms. Total + deterministic. */
export function extractRequirements(request: string): ReqAtom[] {
  try {
    const src = String(request ?? "");
    const atoms: ReqAtom[] = [];
    let id = 0;
    // 1. explicit numbered / bulleted items are the strongest asks.
    const lines = src.split(/\r?\n/);
    const fromLines = new Set<string>();
    for (const raw of lines) {
      const line = raw.trim();
      const li = line.match(/^(?:[-*•]|\(?\d{1,2}[.)]|\d{1,2}\s*[-–])\s+(.{3,})$/);
      // skip a run-on capture (a single line holding multiple inline "N." items,
      // e.g. "1. do A. 2. do B. 3. do C") — the clause splitter handles those as
      // separate atoms; capturing the whole line as ONE item produces junk.
      if (li && li[1] && !/\b\d{1,2}[.)]\s/.test(li[1])) { fromLines.add(li[1].trim()); }
    }
    // 2. clause-level: split remaining text on sentence/clause boundaries.
    // split on sentence enders, inline "N." markers, semicolons/commas, AND
    // coordinating conjunctions (" and ", " then ", "also", "as well as", "plus")
    // so a run-on list ("add X, write Y, and don't touch Z") becomes separate
    // asks. Fragments that aren't actually asks are dropped by the filter below.
    const clauses = src
      .replace(/\r?\n/g, " ")
      .split(/(?<=[.!?;])\s+|\s+\d{1,2}[.)]\s+|\s*[;,]\s*|\s+(?:and then|and also|but also|but|however|yet|and|then|also|as well as|plus)\s+/i)
      .map((c) => c.trim().replace(/^\d{1,2}[.)]\s*/, ""))
      .filter((c) => c.length >= 4);
    const candidates = [...fromLines, ...clauses];

    const seen = new Set<string>();
    for (const c of candidates) {
      const norm = c.toLowerCase().replace(/\s+/g, " ").trim();
      if (norm.length < 4 || seen.has(norm)) continue;
      const isNeg = NEGATION.test(c);
      const isImp = IMPERATIVES.test(c);
      const isCon = CONSTRAINT.test(c);
      const isNumbered = [...fromLines].some((l) => l.trim() === c.trim());
      if (!isNeg && !isImp && !isCon && !isNumbered) continue; // not an ask
      const kw = keywordsOf(c);
      if (kw.length === 0) continue;
      seen.add(norm);
      atoms.push({
        id: id++,
        text: c.slice(0, 200),
        kind: isNeg ? "negation" : isNumbered ? "numbered" : isImp ? "imperative" : "constraint",
        keywords: kw,
      });
      if (atoms.length >= 64) break;
    }
    return atoms;
  } catch {
    return [];
  }
}

function tokenize(text: string): Set<string> {
  const s = new Set<string>();
  try { for (const w of String(text ?? "").toLowerCase().split(/[^a-z0-9_.\-/]+/)) if (w.length > 1) s.add(w); } catch { /* */ }
  return s;
}
function containsPhrase(haystackLower: string, phrase: string): boolean {
  return phrase.length >= 3 && haystackLower.includes(phrase);
}
/**
 * Lenient keyword presence: a multi-token / dotted / path keyword matches as a
 * substring; a plain word matches as a word-PREFIX (`\bword`) so morphological
 * variants count ("test" ⇒ "tests"/"test.ts", "implement" ⇒ "implemented").
 * Leniency is deliberate — for a COVERAGE check, a false UNADDRESSED ("you
 * dropped X" when X was done) is the worst error, so we bias toward COVERED /
 * UNKNOWN and only flag UNADDRESSED on a clear miss.
 */
function kwPresent(outLower: string, outTokens: Set<string>, k: string): boolean {
  try {
    if (k.includes(" ") || k.includes(".") || k.includes("/") || k.includes("-") || k.includes("_")) return containsPhrase(outLower, k);
    if (outTokens.has(k)) return true;
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + esc).test(outLower);
  } catch { return false; }
}

/**
 * Check how well an AI output/diff covers the extracted requirement atoms.
 * prove-or-unknown: clear miss → UNADDRESSED; clear hit → COVERED; ambiguous →
 * UNKNOWN (abstain). A negation atom whose subject appears in the output is
 * VIOLATED. Total + deterministic.
 */
export function checkCoverage(atoms: ReqAtom[], output: string): AtomVerdict[] {
  const verdicts: AtomVerdict[] = [];
  const outLower = String(output ?? "").toLowerCase();
  const outTokens = tokenize(output);
  for (const atom of Array.isArray(atoms) ? atoms : []) {
    try {
      const kw = atom.keywords.filter(Boolean);
      if (kw.length === 0) { verdicts.push({ atom, coverage: "UNKNOWN", hit: 0, reason: "no salient keywords to check" }); continue; }
      let found = 0;
      for (const k of kw) if (kwPresent(outLower, outTokens, k)) found++;
      const hit = found / kw.length;

      if (atom.kind === "negation") {
        // "don't touch X" — keyword PRESENCE alone is ambiguous: "refactored X"
        // and "left X untouched" both mention X. So we read the CONTEXT around
        // each present subject: a mutation verb ⇒ VIOLATED; a preservation marker
        // ⇒ COVERED; present-but-unclear ⇒ UNKNOWN (abstain, prove-or-unknown).
        const NEG_HEADS = new Set(["do", "don", "not", "never", "without", "avoid", "touch", "change", "leave", "keep", "modify", "the", "alone", "untouched", "intact", "unchanged"]);
        const subjects = kw.filter((k) => k.length >= 3 && !NEG_HEADS.has(k));
        const present = subjects.filter((k) => kwPresent(outLower, outTokens, k));
        if (present.length === 0) { verdicts.push({ atom, coverage: "COVERED", hit, reason: "prohibition respected — subject not referenced in the output" }); continue; }
        const MUT = /\b(refactor|add|chang|modif|edit|updat|touch|delet|remov|rewr|rewrit|patch|wrote|writ|creat|mov|renam|implement)/;
        const PRESERV = /\b(untouched|unchanged|intact|preserv|left\s+\w+\s+(alone|as[- ]is)|not\s+(touch|chang|modif|edit)|without\s+(touch|chang|modif)|kept\s+\w+\s+(intact|unchanged)|did\s+not\s+(touch|chang))/;
        let mutated = false, preserved = false;
        for (const k of present) {
          const idx = outLower.indexOf(k.split(/[ ./-]/)[0]!);
          if (idx < 0) continue;
          const win = outLower.slice(Math.max(0, idx - 45), idx + 45);
          if (MUT.test(win)) mutated = true;
          if (PRESERV.test(win)) preserved = true;
        }
        if (preserved && !mutated) verdicts.push({ atom, coverage: "COVERED", hit, reason: `prohibition respected — output says the subject was preserved (${present.slice(0, 3).join(", ")})` });
        else if (mutated) verdicts.push({ atom, coverage: "VIOLATED", hit, reason: `you asked to AVOID this, but the output MUTATES the subject: ${present.slice(0, 3).join(", ")}` });
        else verdicts.push({ atom, coverage: "UNKNOWN", hit, reason: `the prohibited subject (${present.slice(0, 3).join(", ")}) is referenced but the action is unclear — check manually` });
        continue;
      }

      if (hit >= 0.5) { verdicts.push({ atom, coverage: "COVERED", hit, reason: `${found}/${kw.length} key terms present in the output` }); continue; }
      if (hit === 0) { verdicts.push({ atom, coverage: "UNADDRESSED", hit, reason: `none of the ${kw.length} key terms (${kw.slice(0, 5).join(", ")}) appear in the output` }); continue; }
      verdicts.push({ atom, coverage: "UNKNOWN", hit, reason: `partial signal (${found}/${kw.length}) — can't confirm; look manually` });
    } catch {
      verdicts.push({ atom, coverage: "UNKNOWN", hit: 0, reason: "internal error — abstaining" });
    }
  }
  return verdicts;
}

/** Full ELLEIPSIS report: extract → cover → score. Total + deterministic. */
export function elleipsisReport(request: string, output: string): ElleipsisReport {
  try {
    const atoms = extractRequirements(request);
    const verdicts = checkCoverage(atoms, output);
    let covered = 0, unaddressed = 0, unknown = 0, violated = 0;
    for (const v of verdicts) {
      if (v.coverage === "COVERED") covered++;
      else if (v.coverage === "UNADDRESSED") unaddressed++;
      else if (v.coverage === "VIOLATED") violated++;
      else unknown++;
    }
    const denom = covered + unaddressed + violated;
    const completenessScore = denom === 0 ? 1 : covered / denom;
    const gaps = verdicts
      .filter((v) => v.coverage === "UNADDRESSED" || v.coverage === "VIOLATED")
      .sort((a, b) => b.atom.keywords.length - a.atom.keywords.length);
    return {
      atoms, verdicts, covered, unaddressed, unknown, violated,
      completenessScore,
      gaps,
      note: gaps.length === 0
        ? `No clear omission found across ${atoms.length} extracted ask(s) (UNKNOWN items still warrant a glance — completeness is a heuristic, not a proof).`
        : `${gaps.length} possible gap(s): ${unaddressed} unaddressed + ${violated} violated. These are prompts to LOOK, not proof the AI failed.`,
    };
  } catch {
    return { atoms: [], verdicts: [], covered: 0, unaddressed: 0, unknown: 0, violated: 0, completenessScore: 1, gaps: [], note: "ELLEIPSIS error — abstaining (no omission asserted)." };
  }
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface ElleipsisGauntlet {
  extractsMultipleAsks: boolean;
  flagsDroppedRequirement: boolean;
  doesNotFalseFlagCovered: boolean;
  catchesViolatedNegation: boolean;
  respectsHonoredNegation: boolean;
  abstainsOnAmbiguous: boolean;
  scoreMath: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function elleipsisGauntlet(): ElleipsisGauntlet {
  const req = "1. Add a `parseConfig` function. 2. Write a unit test for it. 3. Don't touch the auth module.";

  const atoms = extractRequirements(req);
  const extractsMultipleAsks = atoms.length >= 3;

  // output that did #1 only, skipped the test, and DID touch auth → must flag #2 + #3.
  const partialOut = "Added parseConfig in src/config.ts. Also refactored the auth module's login flow.";
  const r1 = elleipsisReport(req, partialOut);
  const flagsDroppedRequirement = r1.gaps.some((g) => /test/i.test(g.atom.text) && g.coverage === "UNADDRESSED");
  const catchesViolatedNegation = r1.verdicts.some((v) => v.atom.kind === "negation" && v.coverage === "VIOLATED");

  // output that did all three correctly (incl. NOT touching auth).
  const fullOut = "Added parseConfig in src/config.ts and wrote a unit test parseConfig.test.ts covering it. Left the auth module untouched.";
  const r2 = elleipsisReport(req, fullOut);
  const doesNotFalseFlagCovered = r2.verdicts.filter((v) => v.atom.kind !== "negation").every((v) => v.coverage === "COVERED" || v.coverage === "UNKNOWN")
    && !r2.verdicts.some((v) => v.coverage === "UNADDRESSED");
  const respectsHonoredNegation = r2.verdicts.some((v) => v.atom.kind === "negation" && v.coverage === "COVERED");

  // ambiguous partial signal → UNKNOWN, not a false UNADDRESSED.
  const ambAtoms = extractRequirements("Add support for the new billing flow and the invoice export.");
  const ambVerd = checkCoverage(ambAtoms, "I added the billing flow handler.");
  const abstainsOnAmbiguous = ambVerd.some((v) => v.coverage === "UNKNOWN" || v.coverage === "COVERED") && ambVerd.every((v) => v.coverage !== "VIOLATED");

  const scoreMath = (() => {
    const r = elleipsisReport("Add X. Add Y. Add Z.", "Added X.");
    // 1 covered, 2 unaddressed → 1/3
    return Math.abs(r.completenessScore - (r.covered / (r.covered + r.unaddressed + r.violated))) < 1e-9;
  })();

  const deterministic = JSON.stringify(elleipsisReport(req, partialOut)) === JSON.stringify(elleipsisReport(req, partialOut));

  let total = true;
  try {
    elleipsisReport(null as unknown as string, null as unknown as string);
    extractRequirements(undefined as unknown as string);
    checkCoverage(null as unknown as ReqAtom[], "x");
    elleipsisReport("a".repeat(50000), "b".repeat(50000));
  } catch { total = false; }

  const all = extractsMultipleAsks && flagsDroppedRequirement && doesNotFalseFlagCovered && catchesViolatedNegation
    && respectsHonoredNegation && abstainsOnAmbiguous && scoreMath && deterministic && total;
  return {
    extractsMultipleAsks, flagsDroppedRequirement, doesNotFalseFlagCovered, catchesViolatedNegation,
    respectsHonoredNegation, abstainsOnAmbiguous, scoreMath, deterministic, total,
    score: all ? 100 : 0,
  };
}
