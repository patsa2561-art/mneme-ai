/**
 * SCAR MINING — derive the scar corpus from the repo's OWN history, so the vaccine carries the
 * organisation's real pain, not hard-coded classics. This is what closes the data flywheel: the longer
 * Mneme runs against a codebase, the more of its actual scars it knows — a moat a code generator can't have.
 *
 * The deterministic signal a "scar" leaves in git: a mistake commit, then a FIX/REVERT/HOTFIX commit that
 * touches the same files. From that pair we induce a scar the vaccine can use:
 *   • triggers   — the identifiers the MISTAKE commit added (the shape that reintroduces the bug)
 *   • antibodies — the identifiers the FIX commit added that the mistake didn't have (the learned fix-pattern)
 *   • files      — the files both touched
 *   • lesson     — the fix commit's message (the hard-won "why")
 * The vaccine's asymmetry then does the rest: fire when the mistake-shape returns WITHOUT the fix-pattern.
 *
 * This module owns the pure induction (history → Scar[]); the CLI/MCP gather the git history (messages +
 * touched files + added identifier tokens) and write the result to `.mneme/scars.json` for the architect
 * to REVIEW — exactly like `invariants --mine`: mine → review → use, never auto-trusted.
 *
 * ★HONEST (DIAKRISIS): a mined scar is a CORRELATION in git (a fix followed a change to the same files) —
 * a strong candidate worth reviewing, NOT proven causation; the fix-commit may have been unrelated. The
 * tokens are lexical. That's why the output is written for review, the asymmetry suppresses the common
 * case, and a human curates `.mneme/scars.json`. The value is that the corpus is the customer's OWN.
 */
import { type Scar } from "../scar_vaccine/index.js";

export interface MineCommit { sha: string; message: string; files: string[]; added: string[] }
const FIX_RE = /\b(fix(es|ed)?|hotfix|bug(fix)?|revert(s|ed)?|regression|incident|patch|broke|broken)\b/i;
const HI_RE = /\b(hotfix|revert|incident|outage|prod|critical|security|leak|data ?loss)\b/i;
const COMMON = new Set(["const", "let", "var", "function", "return", "this", "true", "false", "null", "undefined", "async", "await", "import", "export", "from", "class", "type", "interface", "void", "string", "number", "boolean", "value", "data", "result", "error", "props", "state", "name", "index", "item", "args"]);
const sharePath = (a: string, b: string) => { const an = a.toLowerCase(), bn = b.toLowerCase(); return an === bn; };
const baseFrag = (p: string) => { const parts = String(p).split(/[\\/]/); return (parts[parts.length - 1] || p).replace(/\.[a-z]+$/i, "").toLowerCase(); };

/** Induce scar candidates from an ordered (oldest→newest) commit history. */
export function mineScars(history: ReadonlyArray<MineCommit>, opts?: { lookback?: number; max?: number }): Scar[] {
  const h = (history ?? []).filter((c) => c && Array.isArray(c.files));
  if (h.length < 2) return [];
  const lookback = opts?.lookback ?? 15;
  const out: Scar[] = []; const seenKey = new Set<string>();
  for (let i = 1; i < h.length; i++) {
    const fix = h[i];
    if (!FIX_RE.test(fix.message || "")) continue;
    // find the most recent earlier commit sharing a file — the suspected mistake
    let mistake: MineCommit | null = null; let shared: string[] = [];
    for (let j = i - 1; j >= Math.max(0, i - lookback); j--) {
      const sh = (h[j].files || []).filter((f) => (fix.files || []).some((g) => sharePath(f, g)));
      if (sh.length) { mistake = h[j]; shared = sh; break; }
    }
    if (!mistake) continue;
    const clean = (toks: string[]) => [...new Set((toks || []).map((t) => t.trim()).filter((t) => t.length >= 4 && !COMMON.has(t.toLowerCase())))];
    const mistakeToks = clean(mistake.added);
    const fixToks = clean(fix.added);
    const triggers = mistakeToks.slice(0, 4);
    const antibodies = fixToks.filter((t) => !mistakeToks.includes(t)).slice(0, 4);
    if (!triggers.length || !antibodies.length) continue;           // need BOTH the shape and the fix for the asymmetry
    const key = triggers.join(",") + "|" + antibodies.join(",");
    if (seenKey.has(key)) continue; seenKey.add(key);
    const severity: Scar["severity"] = HI_RE.test(fix.message) ? "critical" : "high";
    out.push({
      id: "SCAR-" + (fix.sha || "").slice(0, 8),
      severity, title: (fix.message || "").split("\n")[0].slice(0, 120),
      files: [...new Set(shared.map(baseFrag))].slice(0, 4),
      triggers, antibodies,
      lesson: `A fix touching ${[...new Set(shared.map(baseFrag))].join(", ")} introduced ${antibodies.join(", ")}. When the shape (${triggers.join(", ")}) returns without it, the same class of bug can recur. (from commit ${(fix.sha || "").slice(0, 8)}: "${(fix.message || "").split("\n")[0].slice(0, 80)}")`,
    });
  }
  return typeof opts?.max === "number" ? out.slice(-opts.max) : out;
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ScarMiningGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function scarMiningGauntlet(): ScarMiningGauntlet {
  const history: MineCommit[] = [
    { sha: "aaaa1111", message: "add retry wrapper around charge", files: ["payments/retry.ts"], added: ["chargeWithRetry", "retry", "charge"] },
    { sha: "bbbb2222", message: "fix: retry around charge double-charged — add idempotency key", files: ["payments/retry.ts"], added: ["idempotencyKey", "chargeWithRetry"] },
    { sha: "cccc3333", message: "chore: unrelated docs", files: ["README.md"], added: ["documentation"] },
  ];
  const scars = mineScars(history);
  const s = scars.find((x) => x.files.some((f) => /retry|payments/.test(f)));
  const minesPair = !!s && s.triggers.some((t) => /retry|charge/i.test(t)) && s.antibodies.some((a) => /idempotency/i.test(a));
  // the mined scar must be vaccine-compatible (triggers + antibodies + lesson) AND high/critical here
  const wellFormed = !!s && s.triggers.length >= 1 && s.antibodies.length >= 1 && !!s.lesson && (s.severity === "high" || s.severity === "critical");
  // no fix commit → no scar; <2 commits → none
  const noFix = mineScars([{ sha: "x", message: "feat: thing", files: ["a.ts"], added: ["thing"] }, { sha: "y", message: "feat: more", files: ["a.ts"], added: ["more"] }]).length === 0;
  const tiny = mineScars([{ sha: "x", message: "fix: y", files: ["a.ts"], added: ["z"] }]).length === 0;
  // a fix with no shared-file ancestor → no scar
  const noAncestor = mineScars([{ sha: "a", message: "feat", files: ["a.ts"], added: ["alpha"] }, { sha: "b", message: "fix: b", files: ["b.ts"], added: ["beta"] }]).length === 0;
  const total = (() => { try { mineScars(null as never); mineScars([]); mineScars([{ sha: "", message: "", files: [], added: [] }]); return true; } catch { return false; } })();
  const checks = [
    { name: "MINES-FIX-PAIR", pass: minesPair, detail: "a mistake commit + a fix touching the same file → a scar (trigger=retry/charge, antibody=idempotencyKey)" },
    { name: "VACCINE-COMPATIBLE", pass: wellFormed, detail: "the mined scar has triggers + antibodies + a lesson + a severity (drop-in for the vaccine)" },
    { name: "NO-FIX-NO-SCAR", pass: noFix, detail: "history with no fix/revert commit yields no scars" },
    { name: "NEEDS-SHARED-FILE", pass: noAncestor && tiny, detail: "a fix with no same-file ancestor (or <2 commits) yields no scar" },
    { name: "TOTAL", pass: total, detail: "null/empty/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
