/**
 * MNEME TRUST CALIBRATOR (v1.31.0).
 *
 * Direct response to a tester critique: "อย่า trust score ask ที่ < 70%".
 * The user couldn't tell which Mneme subsystem was honest about its
 * own accuracy. Without per-subsystem calibration, the headline pulse
 * said "Healthy 88/100" while `forensics vulns` was throwing 80% FPs.
 *
 * THIS MODULE: per-subsystem benchmarks + calibration grades. Each
 * subsystem ships with a small curated test set (TP / FP samples).
 * `gradeSubsystem(name)` runs the benchmark + computes precision /
 * recall / F1 + a calibration band (excellent / acceptable / weak /
 * untrusted). The grade is persisted to `.mneme/trust-grades.json`.
 *
 * KILLER IDEA -- SELF-DOWNGRADE:
 *   When a subsystem's grade falls into "untrusted" band, every
 *   future output from that subsystem gets a `[CALIBRATION:LOW]`
 *   annotation appended. The AI agent reading the output sees the
 *   warning + can choose to use a competitor (Semgrep / Cursor) for
 *   that workflow until calibration recovers.
 *
 * Honest by design. The opposite of theatrical "trust score" UIs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SubsystemId = "forensics_vulns" | "ask_semantic" | "antivirus_scan" | "atrophy" | "premortem";

export interface BenchmarkCase<I = unknown> {
  /** Short label for the case. */
  label: string;
  /** The input the subsystem will be asked to evaluate. */
  input: I;
  /** Ground truth -- did the subsystem fire correctly? */
  expected: boolean;
}

export interface CalibrationGrade {
  subsystem: SubsystemId;
  ranAt: string;
  totalCases: number;
  tp: number; tn: number; fp: number; fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  band: "excellent" | "acceptable" | "weak" | "untrusted" | "unknown";
  /** Honest one-line verdict for surfacing to the user. */
  verdict: string;
  /** When SELF-DOWNGRADE is on, this annotation is appended to every
   *  subsystem output until calibration recovers. */
  outputAnnotation: string | null;
}

const GRADES_FILENAME = "trust-grades.json";

function gradesPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", GRADES_FILENAME);
}

/** Read the persisted grade for a subsystem (null if never graded). */
export function readGrade(repoRoot: string, subsystem: SubsystemId): CalibrationGrade | null {
  try {
    const path = gradesPath(repoRoot);
    if (!existsSync(path)) return null;
    const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, CalibrationGrade>;
    return all[subsystem] ?? null;
  } catch { return null; }
}

/** Read every persisted grade (for the `mneme trust grade` CLI). */
export function readAllGrades(repoRoot: string): Record<string, CalibrationGrade> {
  try {
    const path = gradesPath(repoRoot);
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, CalibrationGrade>;
  } catch { return {}; }
}

function persistGrade(repoRoot: string, grade: CalibrationGrade): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const all = readAllGrades(repoRoot);
    all[grade.subsystem] = grade;
    writeFileSync(gradesPath(repoRoot), JSON.stringify(all, null, 2), "utf8");
  } catch { /* best-effort */ }
}

function bandFor(precision: number | null, recall: number | null, f1: number | null): CalibrationGrade["band"] {
  if (precision == null || recall == null || f1 == null) return "unknown";
  if (precision >= 0.90 && recall >= 0.85) return "excellent";
  if (precision >= 0.75 && recall >= 0.70) return "acceptable";
  if (precision >= 0.50 || recall >= 0.50) return "weak";
  return "untrusted";
}

function verdictFor(band: CalibrationGrade["band"], precision: number | null, recall: number | null): string {
  switch (band) {
    case "excellent": return `Excellent calibration (precision ${(precision! * 100).toFixed(0)}%, recall ${(recall! * 100).toFixed(0)}%) -- safe to trust.`;
    case "acceptable": return `Acceptable calibration (P=${(precision! * 100).toFixed(0)}%, R=${(recall! * 100).toFixed(0)}%) -- usable but verify edge cases.`;
    case "weak": return `WEAK calibration (P=${precision == null ? "n/a" : (precision * 100).toFixed(0) + "%"}, R=${recall == null ? "n/a" : (recall * 100).toFixed(0) + "%"}) -- triage tool only; use Semgrep / Claude Code for production gating.`;
    case "untrusted": return `UNTRUSTED -- subsystem failed both precision and recall thresholds. SELF-DOWNGRADE active.`;
    case "unknown": return `Calibration unknown -- run \`mneme trust grade <subsystem>\` to benchmark.`;
  }
}

function annotationFor(band: CalibrationGrade["band"]): string | null {
  if (band === "untrusted" || band === "weak") {
    return `[CALIBRATION:${band.toUpperCase()}] Subsystem self-downgrade active. ` +
      `For production-critical decisions, cross-check with a mature tool. ` +
      `Run \`mneme trust grade <subsystem>\` for the full report.`;
  }
  return null;
}

/** Run a benchmark + persist the grade. Generic over the input shape so
 *  every subsystem can plug its own probe + cases. */
export async function gradeSubsystem<I>(
  repoRoot: string,
  subsystem: SubsystemId,
  cases: BenchmarkCase<I>[],
  probe: (input: I) => Promise<boolean> | boolean,
): Promise<CalibrationGrade> {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const c of cases) {
    let fired = false;
    try { fired = !!(await probe(c.input)); } catch { fired = false; }
    if (c.expected && fired) tp++;
    else if (!c.expected && !fired) tn++;
    else if (!c.expected && fired) fp++;
    else fn++;
  }
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision != null && recall != null && precision + recall > 0
    ? 2 * (precision * recall) / (precision + recall) : null;
  const band = bandFor(precision, recall, f1);
  const grade: CalibrationGrade = {
    subsystem,
    ranAt: new Date().toISOString(),
    totalCases: cases.length,
    tp, tn, fp, fn,
    precision, recall, f1,
    band,
    verdict: verdictFor(band, precision, recall),
    outputAnnotation: annotationFor(band),
  };
  persistGrade(repoRoot, grade);
  return grade;
}

/** Get the SELF-DOWNGRADE annotation for a subsystem (or null if not
 *  in weak/untrusted band). Used by subsystem callers to append the
 *  warning to their output. Falls back to null when no grade exists. */
export function selfDowngradeAnnotation(repoRoot: string, subsystem: SubsystemId): string | null {
  const grade = readGrade(repoRoot, subsystem);
  if (!grade) return null;
  return grade.outputAnnotation;
}

// ─── built-in benchmarks ─────────────────────────────────────────────────
//
// Each subsystem ships a small curated test set so the grade is
// reproducible across machines + reflects honest performance on cases
// the maintainers vetted (not user-specific repo state).
//
// To keep this module self-contained + testable, we ONLY define the
// benchmark cases here. The actual probes that consume them are wired
// in the subsystem-specific call sites + the CLI (`mneme trust grade`).

export const FORENSICS_VULNS_BENCHMARK: BenchmarkCase<{ codeSnippet: string }>[] = [
  // True positives -- patterns that are real vulnerabilities.
  { label: "command injection via concat",  input: { codeSnippet: `exec("rm " + userInput)` },           expected: true },
  { label: "SQL injection via concat",      input: { codeSnippet: `db.query("SELECT * FROM u WHERE id = " + req.params.id)` }, expected: true },
  { label: "hardcoded password",            input: { codeSnippet: `const password = "Adm1n@2024!";` },  expected: true },
  { label: "AES-ECB cipher",                input: { codeSnippet: `crypto.createCipheriv("aes-128-ecb", k, iv)` }, expected: true },
  { label: "eval of req body",              input: { codeSnippet: `eval(req.body.script)` },             expected: true },
  // True negatives -- patterns that LOOK suspicious but are safe.
  { label: "exec with const arg",           input: { codeSnippet: `exec("ls -la /tmp")` },              expected: false },
  { label: "parameterized SQL",             input: { codeSnippet: `db.query("SELECT * FROM u WHERE id = ?", [id])` }, expected: false },
  { label: "password var name in test",     input: { codeSnippet: `it("password rejection", () => {})` }, expected: false },
  { label: "AES-GCM (safe mode)",           input: { codeSnippet: `crypto.createCipheriv("aes-256-gcm", k, iv)` }, expected: false },
  { label: "string 'eval' as literal",      input: { codeSnippet: `const msg = "use eval at your own risk";` }, expected: false },
];

export const ASK_SEMANTIC_BENCHMARK: BenchmarkCase<{ query: string; doc: string }>[] = [
  // Pairs where doc DOES answer query.
  { label: "auth flow / login retrieval",   input: { query: "how does authentication work?", doc: "The login function validates credentials against the user database and issues a JWT." }, expected: true },
  { label: "test invocation",               input: { query: "how do I run the tests?",       doc: "Run npm test to execute the vitest suite." }, expected: true },
  { label: "config field semantic",         input: { query: "where is the API endpoint set?", doc: "BASE_URL is configured in src/config.ts." }, expected: true },
  // Pairs where doc DOES NOT answer query.
  { label: "off-topic auth / unrelated",    input: { query: "how does authentication work?", doc: "We use TypeScript strict mode for type safety." }, expected: false },
  { label: "off-topic test / styling",      input: { query: "how do I run the tests?",       doc: "Components use TailwindCSS for styling." }, expected: false },
];
