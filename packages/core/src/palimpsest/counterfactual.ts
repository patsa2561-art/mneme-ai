/**
 * Palimpsest counterfactual — "what if this line had been written differently?"
 *
 * The default `mneme palimpsest <file>:<line>` walks the *backward* causal
 * chain (incidents → root-cause commits). The counterfactual variant walks
 * *forward*: starting at file:line, find every downstream commit that
 * touched this exact line region, and synthesize what the consequence
 * surface looks like.
 *
 * Output: a list of downstream commits + the diff each one applied + a
 * heuristic "alternate-history" sketch (negate operator / flip return /
 * change literal) so the user can see what their original choice locked in.
 *
 * Strictly heuristic. The renderer is honest — labels every alt-history
 * line as "speculative" and grounds every step in a real commit hash.
 */
import { execGitOk } from "../git/exec.js";

export interface CounterfactualOptions {
  cwd: string;
  file: string;
  line: number;
  /** Walk at most N downstream commits. */
  maxDownstream?: number;
}

export interface DownstreamHit {
  commit: string;
  shortHash: string;
  authorEmail: string;
  authorName: string;
  date: string;       // YYYY-MM-DD
  subject: string;
  /** The diff hunk that touched the target line. */
  hunk: string;
  /** Lines added in this hunk. */
  added: string[];
  /** Lines removed in this hunk. */
  removed: string[];
}

export interface AltHistory {
  /** The line being counterfactually flipped. */
  originalLine: string;
  /** The "what if it had been" speculation, computed by inversion heuristics. */
  flipped: string;
  /** Which inversion rule fired (e.g. "negate-equality", "flip-return-bool"). */
  rule: string;
  /** Confidence 0..1 — how cleanly the rule applied. */
  confidence: number;
}

export interface CounterfactualReport {
  file: string;
  line: number;
  /** The line text at HEAD (or "" if file is gone). */
  originalLine: string;
  /** Originating commit (when this line first appeared). */
  origin?: { commit: string; shortHash: string; date: string; authorName: string; subject: string };
  /** Forward chain of commits that touched this line. */
  downstream: DownstreamHit[];
  /** Alt-history flips of the original line. */
  alts: AltHistory[];
  /** Files that import or reference the symbol on this line, if heuristically detectable. */
  referencingFiles: string[];
}

export async function counterfactualPalimpsest(
  opts: CounterfactualOptions,
): Promise<CounterfactualReport> {
  const cwd = opts.cwd;
  const max = opts.maxDownstream ?? 30;

  // 1. Read the line at HEAD
  const originalLine = await readLine(cwd, opts.file, opts.line);

  // 2. blame for origin
  const origin = await blameOrigin(cwd, opts.file, opts.line);

  // 3. git log -L for downstream commits that touched this single line range
  const downstream = await downstreamHits(cwd, opts.file, opts.line, max);

  // 4. Heuristic flip
  const alts = generateAltHistories(originalLine);

  // 5. Reference scan — grep the repo for the strongest identifier on this line
  const referencingFiles = await findReferencers(cwd, originalLine, opts.file);

  return {
    file: opts.file,
    line: opts.line,
    originalLine,
    origin,
    downstream,
    alts,
    referencingFiles,
  };
}

async function readLine(cwd: string, file: string, line: number): Promise<string> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const content = await fs.readFile(path.join(cwd, file), "utf8");
    const lines = content.split("\n");
    return lines[line - 1] ?? "";
  } catch {
    return "";
  }
}

async function blameOrigin(
  cwd: string,
  file: string,
  line: number,
): Promise<CounterfactualReport["origin"]> {
  try {
    const out = await execGitOk(
      ["blame", "-L", `${line},${line}`, "--porcelain", "--", file],
      { cwd },
    );
    const lines = out.split("\n");
    if (lines.length === 0 || !lines[0]) return undefined;
    const hash = lines[0]!.split(" ")[0]!;
    if (!hash || hash === "0000000000000000000000000000000000000000") return undefined;
    let authorName = "";
    let date = "";
    let subject = "";
    for (const ln of lines) {
      if (ln.startsWith("author ")) authorName = ln.slice(7);
      else if (ln.startsWith("author-time ")) {
        const ts = Number(ln.slice(12));
        if (Number.isFinite(ts)) date = new Date(ts * 1000).toISOString().slice(0, 10);
      } else if (ln.startsWith("summary ")) subject = ln.slice(8);
    }
    return {
      commit: hash,
      shortHash: hash.slice(0, 7),
      date,
      authorName,
      subject,
    };
  } catch {
    return undefined;
  }
}

async function downstreamHits(
  cwd: string,
  file: string,
  line: number,
  max: number,
): Promise<DownstreamHit[]> {
  // git log -L<line>,<line>:<file> walks backwards through every commit
  // that *modified* this line range. We get them oldest-first by reversing.
  let raw = "";
  try {
    raw = await execGitOk(
      [
        "log",
        `-L${line},${line}:${file}`,
        "--no-merges",
        "--pretty=format:--C--%H%x09%ae%x09%an%x09%at%x09%s",
        "-n",
        String(max),
      ],
      { cwd },
    );
  } catch {
    // -L only works if the file exists in HEAD AND the line range is parseable.
    return [];
  }
  const blocks = raw.split("--C--").filter((b) => b.trim().length > 0);
  const out: DownstreamHit[] = [];
  for (const block of blocks) {
    const idx = block.indexOf("\n");
    if (idx < 0) continue;
    const headerLine = block.slice(0, idx);
    const body = block.slice(idx + 1);
    const parts = headerLine.split("\t");
    if (parts.length < 5) continue;
    const ts = Number(parts[3]) || 0;
    const date = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
    const hunkLines = body.split("\n");
    const added: string[] = [];
    const removed: string[] = [];
    let inHunk = false;
    for (const hl of hunkLines) {
      if (hl.startsWith("@@")) {
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;
      if (hl.startsWith("+") && !hl.startsWith("+++")) added.push(hl.slice(1));
      else if (hl.startsWith("-") && !hl.startsWith("---")) removed.push(hl.slice(1));
    }
    out.push({
      commit: parts[0]!,
      shortHash: parts[0]!.slice(0, 7),
      authorEmail: parts[1]!.toLowerCase(),
      authorName: parts[2]!,
      date,
      subject: parts[4]!,
      hunk: body,
      added,
      removed,
    });
  }
  // git log returns newest-first; reverse for chronological flow
  return out.reverse();
}

/**
 * Apply a small library of inversion rules to the source line. These are
 * heuristic — they catch the common shapes (===, !==, return true/false,
 * if/else flips) but make no claim of compiler correctness.
 *
 * Each rule runs independently; the highest-confidence result is preferred.
 */
export function generateAltHistories(originalLine: string): AltHistory[] {
  const trimmed = originalLine.trim();
  if (!trimmed) return [];
  const out: AltHistory[] = [];

  // Equality / inequality flips
  const eqRules: Array<{ from: RegExp; to: string; rule: string; confidence: number }> = [
    { from: /===/g, to: "!==", rule: "negate-equality (=== → !==)", confidence: 0.9 },
    { from: /!==/g, to: "===", rule: "negate-equality (!== → ===)", confidence: 0.9 },
    { from: / == /g, to: " != ", rule: "negate-equality (== → !=)", confidence: 0.8 },
    { from: / != /g, to: " == ", rule: "negate-equality (!= → ==)", confidence: 0.8 },
    { from: / >= /g, to: " < ", rule: "flip-comparison (>= → <)", confidence: 0.8 },
    { from: / <= /g, to: " > ", rule: "flip-comparison (<= → >)", confidence: 0.8 },
    { from: / > /g, to: " <= ", rule: "flip-comparison (> → <=)", confidence: 0.8 },
    { from: / < /g, to: " >= ", rule: "flip-comparison (< → >=)", confidence: 0.8 },
  ];
  for (const r of eqRules) {
    if (r.from.test(originalLine)) {
      const flipped = originalLine.replace(r.from, r.to);
      out.push({ originalLine, flipped, rule: r.rule, confidence: r.confidence });
    }
  }
  // Boolean return / literal flips
  if (/\breturn\s+true\b/.test(originalLine)) {
    out.push({
      originalLine,
      flipped: originalLine.replace(/\breturn\s+true\b/, "return false"),
      rule: "flip-return-bool (true → false)",
      confidence: 0.95,
    });
  }
  if (/\breturn\s+false\b/.test(originalLine)) {
    out.push({
      originalLine,
      flipped: originalLine.replace(/\breturn\s+false\b/, "return true"),
      rule: "flip-return-bool (false → true)",
      confidence: 0.95,
    });
  }
  // Negated condition prefix
  if (/^\s*if\s*\(/.test(originalLine)) {
    const m = originalLine.match(/^(\s*if\s*\()(.*?)(\)\s*\{?\s*)$/);
    if (m) {
      out.push({
        originalLine,
        flipped: `${m[1]}!(${m[2]})${m[3]}`,
        rule: "negate-if-condition",
        confidence: 0.7,
      });
    }
  }
  // String literal swap (single value)
  const strRule = /"([^"\\]*)"/.exec(originalLine);
  if (strRule && strRule[1] !== "" && out.length === 0) {
    out.push({
      originalLine,
      flipped: originalLine.replace(strRule[0], `"!" + "${strRule[1]}"`),
      rule: "negate-string-literal",
      confidence: 0.4,
    });
  }
  // Nothing fired — generic placeholder
  if (out.length === 0) {
    out.push({
      originalLine,
      flipped: `// (no clean inversion — line shape doesn't fit any rule)`,
      rule: "no-rule-applied",
      confidence: 0.0,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 4);
}

async function findReferencers(
  cwd: string,
  originalLine: string,
  selfFile: string,
): Promise<string[]> {
  // Pull the strongest identifier from the line (longest camelCase or snake_case word).
  const ids = (originalLine.match(/[A-Za-z_$][A-Za-z0-9_$]{4,}/g) ?? [])
    .filter((id) => !["return", "function", "const", "import", "export", "let", "this", "true", "false"].includes(id))
    .sort((a, b) => b.length - a.length);
  if (ids.length === 0) return [];
  const target = ids[0]!;

  try {
    // git grep is the fastest cross-file lookup; we tolerate a missing match.
    const out = await execGitOk(
      ["grep", "-l", "-w", target],
      { cwd },
    );
    const files = out.split("\n").map((s) => s.trim()).filter((f) => f && f !== selfFile);
    // Cap to keep the report compact
    return files.slice(0, 12);
  } catch {
    return [];
  }
}
