import { execGitOk } from "./exec.js";
import type { Commit, FileChange } from "../types.js";

const SEP_FIELD = "\x1f"; // unit separator
const SEP_RECORD = "\x1e"; // record separator

// Each record begins with SEP_RECORD so we can split unambiguously even when
// %b (body) contains newlines. The fields are joined by SEP_FIELD; %b is its
// own field, which keeps multi-line bodies intact.
const PRETTY = SEP_RECORD + [
  "%H",
  "%h",
  "%an",
  "%ae",
  "%aI",
  "%cI",
  "%s",
  "%b",
  "%P",
].join(SEP_FIELD);

const PR_PATTERN = /\(#(\d+)\)\s*$|Merge pull request #(\d+)/;
const ISSUE_PATTERN = /(?:#|GH-)(\d+)|([A-Z]+-\d+)/g;

export interface LogOptions {
  cwd: string;
  since?: string;
  until?: string;
  maxCount?: number;
  paths?: string[];
}

export async function readCommits(opts: LogOptions): Promise<Commit[]> {
  const args = [
    "log",
    `--pretty=format:${PRETTY}`,
    "--name-only",
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  if (opts.maxCount) args.push(`--max-count=${opts.maxCount}`);
  if (opts.paths?.length) {
    args.push("--");
    args.push(...opts.paths);
  }

  const stdout = await execGitOk(args, { cwd: opts.cwd });
  return parseLog(stdout);
}

function parseLog(raw: string): Commit[] {
  // Each record starts with SEP_RECORD, so the first split element is empty.
  const records = raw.split(SEP_RECORD).filter((r) => r.length > 0);
  const commits: Commit[] = [];
  for (const record of records) {
    // Record shape: <H>\x1f<h>\x1f<an>\x1f<ae>\x1f<ad>\x1f<cd>\x1f<subject>\x1f<body>\x1f<parents>\n<file>\n<file>...
    // %b can contain newlines but cannot contain \x1f, so splitting by SEP_FIELD is safe.
    const parts = record.split(SEP_FIELD);
    if (parts.length < 9) continue;
    const [hash, shortHash, an, ae, ad, cd, subject, body] = parts;
    const tail = parts.slice(8).join(SEP_FIELD); // <parents>\n<files...>
    const firstNewline = tail.indexOf("\n");
    const parentsStr = firstNewline >= 0 ? tail.slice(0, firstNewline) : tail;
    const fileBlock = firstNewline >= 0 ? tail.slice(firstNewline + 1) : "";

    if (!hash) continue;

    const files = fileBlock
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const prMatch = (subject ?? "").match(PR_PATTERN);
    const prNumber = prMatch ? Number(prMatch[1] ?? prMatch[2]) : undefined;

    const issueRefs = new Set<string>();
    const haystack = `${subject ?? ""}\n${body ?? ""}`;
    for (const m of haystack.matchAll(ISSUE_PATTERN)) {
      const ref = m[1] ?? m[2];
      if (ref) issueRefs.add(ref);
    }

    commits.push({
      hash: hash.trim(),
      shortHash: (shortHash ?? "").trim(),
      authorName: an ?? "",
      authorEmail: ae ?? "",
      authorDate: ad ?? "",
      committerDate: cd ?? "",
      subject: (subject ?? "").trim(),
      body: (body ?? "").trim(),
      files,
      parents: parentsStr.trim().split(/\s+/).filter(Boolean),
      prNumber,
      issueRefs: Array.from(issueRefs),
    });
  }
  return commits;
}

export async function readFileChanges(
  cwd: string,
  commitHash: string,
): Promise<FileChange[]> {
  const stdout = await execGitOk(
    ["show", "--no-renames", "--numstat", "--format=", commitHash],
    { cwd },
  );
  const out: FileChange[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const [insStr, delStr, ...rest] = parts;
    const path = rest.join(" ");
    out.push({
      commitHash,
      path,
      changeKind: "M",
      insertions: insStr === "-" ? 0 : Number(insStr) || 0,
      deletions: delStr === "-" ? 0 : Number(delStr) || 0,
    });
  }
  return out;
}
