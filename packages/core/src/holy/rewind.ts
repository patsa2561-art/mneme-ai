/**
 * `mneme rewind <commit>` — time-travel debug.
 *
 * Holy Grail #2 of v0.43. Given a commit hash, materialise the
 * "psychological snapshot" of what the author was likely thinking when
 * they made it. Combines four signals — none individually new, but the
 * combination is:
 *
 *   1. Cognitive-twin voice profile of the author (already exists in
 *      packages/core/src/twin).
 *   2. Surrounding commits (5 before, 5 after) — was this part of a
 *      sustained push or a one-off?
 *   3. Time-of-day + day-of-week fingerprint — late-night Friday is
 *      different from Tuesday-morning.
 *   4. Subject + body tonality — short imperative ("fix bug"), long
 *      explanatory, sandwich-mode ("WIP", "trying to", "fix attempt").
 *
 * Output: a paragraph that's GROUND-TRUTH-derived (every claim cites a
 * commit hash or timestamp) but reads narratively. The user can verify
 * any claim by clicking through.
 *
 * Strict honesty framing — this is not "what Alice was thinking" (we
 * can't know). It's "what an outside observer would reasonably infer
 * about the working context of this commit". The output prefixes every
 * speculative line with ✱.
 */

import { execGitOk } from "../git/exec.js";
import { profileAuthor, type AuthorVoice } from "../twin/profile.js";

export interface RewindOptions {
  cwd: string;
  /** Commit ref (hash, tag, HEAD~3, etc.). */
  ref: string;
  /** Window of surrounding commits to read. Default 5 each side. */
  windowSize?: number;
}

export interface RewindReport {
  commit: {
    hash: string;
    shortHash: string;
    authorName: string;
    authorEmail: string;
    authorDateUtc: string;
    authorTzOffsetMinutes: number;
    subject: string;
    body: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  context: {
    /** Commits BEFORE this one by the same author, oldest-first. */
    before: ContextCommit[];
    /** Commits AFTER this one by the same author, oldest-first. */
    after: ContextCommit[];
    /** True when the immediate next commit by anyone reverted this one. */
    revertedImmediately: boolean;
    /** True when this commit's subject is "WIP", "fix attempt", etc. */
    sandwichMode: boolean;
  };
  voice?: AuthorVoice;
  /** Inferences — every line tagged with ✱ for "speculative". */
  inferences: string[];
}

export interface ContextCommit {
  hash: string;
  shortHash: string;
  authorDate: string;
  subject: string;
  /** Minutes from the target commit (negative = before). */
  deltaMinutes: number;
}

const SANDWICH_PATTERNS = [
  /\b(?:wip|work\s+in\s+progress|fix\s+attempt|trying\s+to|maybe|might|tentative)\b/i,
  /\?$/,
  /\.\.\.$/,
];

export async function rewind(opts: RewindOptions): Promise<RewindReport> {
  const window = opts.windowSize ?? 5;

  // 1. Resolve the commit
  const meta = await execGitOk(
    [
      "log",
      "-1",
      "--no-color",
      `--pretty=format:%H%x09%aI%x09%an%x09%ae%x09%s%x09%b`,
      "--shortstat",
      opts.ref,
    ],
    { cwd: opts.cwd },
  );
  const lines = meta.split("\n");
  const head = (lines[0] ?? "").split("\t");
  if (head.length < 5) throw new Error(`Could not resolve commit: ${opts.ref}`);
  const hash = head[0]!;
  const authorDateRaw = head[1] ?? "";
  const authorName = head[2] ?? "";
  const authorEmail = (head[3] ?? "").toLowerCase();
  const subject = head[4] ?? "";
  const body = head[5] ?? "";

  // shortstat is on a later line: " N files changed, A insertions(+), D deletions(-)"
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  for (const ln of lines) {
    const fc = ln.match(/(\d+)\s+files?\s+changed/);
    if (fc) filesChanged = Number(fc[1]);
    const ins = ln.match(/(\d+)\s+insertions?\(\+\)/);
    if (ins) insertions = Number(ins[1]);
    const del = ln.match(/(\d+)\s+deletions?\(\-\)/);
    if (del) deletions = Number(del[1]);
  }

  // Parse the ISO with offset. ISO format ends with ±HH:MM.
  const tzMatch = authorDateRaw.match(/([+-])(\d{2}):(\d{2})$/);
  const authorTzOffsetMinutes = tzMatch
    ? (tzMatch[1] === "-" ? -1 : 1) * (Number(tzMatch[2]) * 60 + Number(tzMatch[3]))
    : 0;
  const authorDateUtc = new Date(authorDateRaw).toISOString();

  // 2. Surrounding commits by the same author (window each side)
  const before = await loadContext(opts.cwd, authorEmail, authorDateRaw, hash, window, "before");
  const after = await loadContext(opts.cwd, authorEmail, authorDateRaw, hash, window, "after");

  // 3. Was this commit reverted immediately (next commit anywhere by anyone)?
  const revertedImmediately = await wasRevertedImmediately(opts.cwd, hash);

  // 4. Sandwich mode (subject hesitancy)
  const sandwichMode = SANDWICH_PATTERNS.some((re) => re.test(subject) || re.test(body));

  // 5. Voice profile
  const voice = await profileAuthor({ cwd: opts.cwd, email: authorEmail, maxCommits: 200 }) ?? undefined;

  // 6. Inferences
  const inferences = buildInferences({
    subject,
    body,
    authorDateUtc,
    authorTzOffsetMinutes,
    filesChanged,
    insertions,
    deletions,
    before,
    after,
    revertedImmediately,
    sandwichMode,
    voice,
  });

  return {
    commit: {
      hash,
      shortHash: hash.slice(0, 7),
      authorName,
      authorEmail,
      authorDateUtc,
      authorTzOffsetMinutes,
      subject,
      body,
      filesChanged,
      insertions,
      deletions,
    },
    context: { before, after, revertedImmediately, sandwichMode },
    voice,
    inferences,
  };
}

async function loadContext(
  cwd: string,
  email: string,
  date: string,
  excludeHash: string,
  window: number,
  side: "before" | "after",
): Promise<ContextCommit[]> {
  const args =
    side === "before"
      ? ["log", `--author=${email}`, `--until=${date}`, "-n", String(window + 1), "--no-color", "--pretty=format:%H%x09%aI%x09%s"]
      : ["log", `--author=${email}`, `--since=${date}`, "--reverse", "-n", String(window + 1), "--no-color", "--pretty=format:%H%x09%aI%x09%s"];
  let raw: string;
  try {
    raw = await execGitOk(args, { cwd });
  } catch {
    return [];
  }
  const targetMs = Date.parse(date);
  const out: ContextCommit[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [h, d, ...rest] = line.split("\t");
    if (!h || h === excludeHash) continue;
    out.push({
      hash: h,
      shortHash: h.slice(0, 7),
      authorDate: d ?? "",
      subject: rest.join("\t"),
      deltaMinutes: Math.round((Date.parse(d ?? "") - targetMs) / 60000),
    });
  }
  return out.slice(0, window);
}

async function wasRevertedImmediately(cwd: string, hash: string): Promise<boolean> {
  try {
    const out = await execGitOk(
      ["log", `${hash}..HEAD`, "-n", "1", "--no-color", "--pretty=format:%s"],
      { cwd },
    );
    return /^revert\b|^revert:/i.test(out.trim());
  } catch {
    return false;
  }
}

interface InferenceContext {
  subject: string;
  body: string;
  authorDateUtc: string;
  authorTzOffsetMinutes: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  before: ContextCommit[];
  after: ContextCommit[];
  revertedImmediately: boolean;
  sandwichMode: boolean;
  voice?: AuthorVoice;
}

export function buildInferences(c: InferenceContext): string[] {
  const out: string[] = [];

  // Time of day in author's local tz
  const localMs = Date.parse(c.authorDateUtc) + c.authorTzOffsetMinutes * 60 * 1000;
  const localDate = new Date(localMs);
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][localDate.getUTCDay()] ?? "?";
  const localHour = localDate.getUTCHours();

  // Time-of-day inference
  if (localHour < 6 || localHour >= 22) {
    out.push(`✱ committed at ${pad(localHour)}:${pad(localDate.getUTCMinutes())} local on ${dayOfWeek} — outside typical working hours`);
  } else if (dayOfWeek === "Sat" || dayOfWeek === "Sun") {
    out.push(`✱ committed on a ${dayOfWeek} at ${pad(localHour)}:${pad(localDate.getUTCMinutes())} local — weekend work`);
  }

  // Burst vs one-off
  const within2h = c.before.filter((b) => Math.abs(b.deltaMinutes) <= 120).length;
  const after2h = c.after.filter((a) => Math.abs(a.deltaMinutes) <= 120).length;
  if (within2h + after2h >= 3) {
    out.push(`✱ part of a sustained push — ${within2h + after2h + 1} commits by the same author within 2 hours`);
  } else if (c.before.length === 0 && c.after.length === 0) {
    out.push(`✱ no other commits by this author in the surrounding window — looks like a one-off touch`);
  }

  // Reverted immediately
  if (c.revertedImmediately) {
    out.push(`✱ the next commit on HEAD reverted this one — author may have shipped, then thought twice`);
  }

  // Sandwich mode
  if (c.sandwichMode) {
    out.push(`✱ subject/body shows hesitancy markers (WIP / fix attempt / "trying to" / trailing ?…) — author was uncertain about the change`);
  }

  // Size signal
  if (c.filesChanged >= 20 || c.insertions + c.deletions >= 1000) {
    out.push(`✱ large blast radius (${c.filesChanged} files, +${c.insertions}/-${c.deletions} lines) — likely a refactor or vendor drop, not a focused fix`);
  } else if (c.filesChanged === 1 && c.insertions + c.deletions <= 5) {
    out.push(`✱ surgical change — single file, ≤ 5 lines moved`);
  }

  // Voice deviation — does this commit's subject look unusual for this author?
  if (c.voice) {
    const stripped = c.subject.replace(/^[a-z]+(\([^)]+\))?:\s*/i, "");
    const len = stripped.length;
    if (c.voice.subjectLengthAvg > 0) {
      if (len < c.voice.subjectLengthP25) {
        out.push(`✱ subject is shorter than this author's usual (${len} chars vs avg ${c.voice.subjectLengthAvg.toFixed(0)}) — they typically write more`);
      } else if (len > c.voice.subjectLengthP75 * 1.5) {
        out.push(`✱ subject is longer than this author's usual (${len} chars vs avg ${c.voice.subjectLengthAvg.toFixed(0)}) — extra context being captured`);
      }
    }
    // Conv-prefix mismatch
    const prefixMatch = c.subject.match(/^([a-z]+)(\([^)]+\))?:/i);
    if (prefixMatch && c.voice.topPrefixes.length > 0) {
      const prefix = prefixMatch[1]!.toLowerCase();
      const usual = c.voice.topPrefixes[0]!.prefix;
      if (prefix !== usual && c.voice.convCommitPct >= 70 && !c.voice.topPrefixes.some((p) => p.prefix === prefix)) {
        out.push(`✱ uses prefix "${prefix}:" — author normally writes "${usual}:" (${c.voice.topPrefixes[0]!.pct}%)`);
      }
    }
  }

  if (out.length === 0) {
    out.push(`✱ no unusual signals — commit looks like routine work for this author`);
  }
  return out;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
