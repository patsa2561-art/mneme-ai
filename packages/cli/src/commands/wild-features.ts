/**
 * Bundle of mid-sized "wild" features — kept in one file because each one is
 * small and they share helpers. Split into separate files when any of them
 * crosses ~250 lines or grows non-trivial dependencies.
 *
 *   • mneme runaway  — entities that have grown silently over time
 *   • mneme mirror   — onboarding dossier (5 PRs, 3 people, 2 incidents)
 *   • mneme rumor    — tribal knowledge in commit text that should be docs
 *   • mneme fossil   — files deleted from HEAD but still in git history
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import kleur from "kleur";
import { git, store, util, type Commit } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";

/* ─────────────────────  mneme runaway  ───────────────────── */

export interface RunawayCommandOptions {
  cwd: string;
  topN?: number;
  json?: boolean;
}

export async function runawayCommand(opts: RunawayCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  // Score: a file's "runaway" score = number of distinct commits touching it
  // weighted by how many of those commits ADDED lines. We approximate growth.
  const rows = s.db
    .prepare(
      `SELECT path,
              COUNT(*) AS commits,
              SUM(insertions) AS adds,
              SUM(deletions) AS dels,
              SUM(insertions) - SUM(deletions) AS net
       FROM file_changes
       GROUP BY path
       HAVING commits >= 3
       ORDER BY net DESC, commits DESC
       LIMIT ?`,
    )
    .all(opts.topN ?? 15) as Array<{
    path: string;
    commits: number;
    adds: number;
    dels: number;
    net: number;
  }>;

  if (opts.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    s.close();
    return 0;
  }

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Runaway abstractions")}\n`);
  process.stdout.write(
    kleur.gray(`  Files that grew silently over many commits — candidates for refactor.\n\n`),
  );
  if (rows.length === 0) {
    ui.warn("No runaway files. Either repo is small or every file is well-bounded.");
    s.close();
    return 0;
  }
  process.stdout.write(
    `  ${"path".padEnd(50)} ${"commits".padStart(8)} ${"net+lines".padStart(11)}\n`,
  );
  process.stdout.write(`  ${"-".repeat(50)} ${"-".repeat(8)} ${"-".repeat(11)}\n`);
  for (const r of rows) {
    const sign = r.net >= 0 ? "+" : "";
    process.stdout.write(
      `  ${r.path.padEnd(50).slice(0, 50)} ${String(r.commits).padStart(8)} ${(sign + r.net).padStart(11)}\n`,
    );
  }
  process.stdout.write(
    "\n" +
      kleur.gray(
        "  Tip: run `mneme why <file>` on the top runaway to learn the WHY before refactoring.",
      ) +
      "\n",
  );
  s.close();
  return 0;
}

/* ─────────────────────  mneme mirror  ───────────────────── */

export interface MirrorCommandOptions {
  cwd: string;
  topPrs?: number;
  topPeople?: number;
  topIncidents?: number;
  json?: boolean;
}

export async function mirrorCommand(opts: MirrorCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  const all = util.loadAllCommits(s);

  if (all.length === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }

  // Top PRs by impact (file count × body richness).
  const prs = all
    .filter((c) => c.prNumber)
    .map((c) => ({
      number: c.prNumber!,
      hash: c.shortHash,
      author: c.authorName,
      date: c.authorDate.slice(0, 10),
      subject: c.subject,
      bodyLen: (c.body || "").length + (c.prBody || "").length,
      fileCount: c.files.length,
      score: c.files.length * 10 + Math.min(500, (c.body || "").length + (c.prBody || "").length),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topPrs ?? 5);

  // Top people by author + co-occurrence.
  const counts = new Map<string, { name: string; commits: number; files: Set<string> }>();
  for (const c of all) {
    const cur =
      counts.get(c.authorEmail) ??
      { name: c.authorName, commits: 0, files: new Set<string>() };
    cur.commits++;
    for (const f of c.files) cur.files.add(f);
    counts.set(c.authorEmail, cur);
  }
  const people = Array.from(counts.entries())
    .map(([email, v]) => ({
      email,
      name: v.name,
      commits: v.commits,
      filesTouched: v.files.size,
      score: v.commits + v.files.size * 0.5,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topPeople ?? 3);

  // Top incidents by stored severity + recency.
  const incidents = s.db
    .prepare(
      `SELECT id, title, occurred_at, severity FROM incidents
       ORDER BY (CASE severity WHEN 'critical' THEN 4 WHEN 'error' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END) DESC, occurred_at DESC
       LIMIT ?`,
    )
    .all(opts.topIncidents ?? 2) as Array<{
    id: string;
    title: string;
    occurred_at: string;
    severity: string;
  }>;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ prs, people, incidents }, null, 2) + "\n");
    s.close();
    return 0;
  }

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Onboarding dossier")}  ${kleur.gray(meta.rootPath)}\n\n`);
  process.stdout.write(`${kleur.bold().magenta("📖 PRs to read first")}\n`);
  if (!prs.length) process.stdout.write(`  ${kleur.gray("(no PRs detected — likely a personal/solo repo)")}\n`);
  for (const p of prs) {
    process.stdout.write(
      `  ${kleur.green("●")} PR #${p.number}  ${kleur.gray(`[${p.date} · ${p.author}]`)}\n` +
        `    ${kleur.white(p.subject)}\n` +
        `    ${kleur.gray(`${p.fileCount} files · ${p.bodyLen} body chars`)}\n`,
    );
  }
  process.stdout.write(`\n${kleur.bold().magenta("👥 People to talk to")}\n`);
  for (const p of people) {
    process.stdout.write(
      `  ${kleur.cyan("◆")} ${kleur.bold(p.name)}  ${kleur.gray(`<${p.email}>`)}\n` +
        `    ${kleur.gray(`${p.commits} commits · ${p.filesTouched} files touched`)}\n`,
    );
  }
  process.stdout.write(`\n${kleur.bold().magenta("⚠️  Incidents to know about")}\n`);
  if (!incidents.length) process.stdout.write(`  ${kleur.gray("(none indexed — run `mneme correlate` to import)")}\n`);
  for (const i of incidents) {
    process.stdout.write(
      `  ${kleur.red("●")} ${kleur.bold(i.id)}  ${kleur.gray(`[${i.occurred_at.slice(0, 10)} · ${i.severity}]`)}\n` +
        `    ${kleur.white(i.title)}\n`,
    );
  }
  process.stdout.write("\n");
  s.close();
  return 0;
}

/* ─────────────────────  mneme rumor  ───────────────────── */

export interface RumorCommandOptions {
  cwd: string;
  minMentions?: number;
  json?: boolean;
}

export async function rumorCommand(opts: RumorCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  const all = util.loadAllCommits(s);

  // Extract candidate "tribal" phrases from commits + PRs:
  // capitalized noun-ish n-grams that appear in N+ commits but never in docs.
  const minMentions = opts.minMentions ?? 4;
  const phraseHits = new Map<string, { count: number; samples: string[] }>();

  for (const c of all) {
    const text = `${c.subject}\n${c.body}\n${c.prBody ?? ""}`;
    for (const phrase of extractPhrases(text)) {
      const cur = phraseHits.get(phrase) ?? { count: 0, samples: [] };
      cur.count++;
      if (cur.samples.length < 3) cur.samples.push(c.shortHash);
      phraseHits.set(phrase, cur);
    }
  }

  // Skip phrases already documented.
  const docsCorpus = readDocsCorpus(meta.rootPath);
  const candidates = Array.from(phraseHits.entries())
    .filter(([phrase, v]) => v.count >= minMentions)
    .filter(([phrase]) => !docsCorpus.toLowerCase().includes(phrase.toLowerCase()))
    .map(([phrase, v]) => ({ phrase, count: v.count, samples: v.samples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  if (opts.json) {
    process.stdout.write(JSON.stringify(candidates, null, 2) + "\n");
    s.close();
    return 0;
  }

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Rumor")}  ${kleur.gray("tribal phrases that no doc explains")}\n\n`);
  if (candidates.length === 0) {
    ui.success("No undocumented tribal phrases detected. Either the docs are great or the corpus is small.");
    s.close();
    return 0;
  }
  for (const c of candidates) {
    process.stdout.write(
      `  ${kleur.yellow("●")} ${kleur.bold(c.phrase)}  ${kleur.gray(`(${c.count} commits)`)}\n` +
        `    ${kleur.gray(`samples: ${c.samples.join(", ")}`)}\n` +
        `    ${kleur.cyan("suggest:")} create docs/${slug(c.phrase)}.md\n`,
    );
  }
  process.stdout.write("\n");
  s.close();
  return 0;
}

const PHRASE_RE = /\b([A-Z][A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+){0,3})\b/g;
const COMMON = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "github", "gitlab", "merge", "fix", "fixed", "fixes", "feat", "feature",
  "wip", "update", "updates", "updated", "chore", "docs", "test", "tests",
  "refactor", "initial", "first", "i", "it", "this", "that", "main", "master",
  "src", "app", "lib", "node", "node_modules", "package", "packages",
]);

function extractPhrases(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(PHRASE_RE)) {
    const p = m[1]!;
    if (p.length < 4 || p.length > 40) continue;
    if (COMMON.has(p.toLowerCase())) continue;
    if (/^\d+$/.test(p)) continue;
    out.add(p);
  }
  return out;
}

function readDocsCorpus(repoRoot: string): string {
  const dirs = ["docs", "doc", "documentation"];
  const parts: string[] = [];
  for (const d of dirs) {
    const dirPath = join(repoRoot, d);
    if (existsSync(dirPath)) walkText(dirPath, parts);
  }
  // Top-level README / ARCHITECTURE / etc.
  for (const f of ["README.md", "ARCHITECTURE.md", "ROADMAP.md", "CONTRIBUTING.md"]) {
    const p = join(repoRoot, f);
    if (existsSync(p)) {
      try {
        parts.push(readFileSync(p, "utf8"));
      } catch {
        // ignore
      }
    }
  }
  return parts.join("\n");
}

function walkText(dir: string, out: string[], depth = 0): void {
  if (depth > 4) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkText(p, out, depth + 1);
    else if (st.isFile() && [".md", ".mdx", ".txt", ".rst"].includes(extname(e).toLowerCase())) {
      try {
        out.push(readFileSync(p, "utf8"));
      } catch {
        // ignore
      }
    }
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ─────────────────────  mneme fossil  ───────────────────── */

export interface FossilCommandOptions {
  cwd: string;
  topN?: number;
  json?: boolean;
}

export async function fossilCommand(opts: FossilCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  // Find files deleted in repo history that are still in `git log` but absent from HEAD.
  // Simpler signal: query file_changes for files where the latest event is a deletion.
  // But we don't track change_kind reliably yet — fall back to spawning git directly.
  const r = await git.execGit(
    [
      "log",
      "--all",
      "--diff-filter=D",
      "--name-only",
      "--pretty=format:::commit::%H::%aI::%an::%s",
    ],
    { cwd: meta.rootPath },
  );
  if (r.code !== 0) {
    ui.error(`git log failed: ${r.stderr.trim()}`);
    return 1;
  }

  const fossils: Array<{
    path: string;
    deletedInCommit: string;
    deletedAt: string;
    deletedBy: string;
    subject: string;
  }> = [];
  let cur: { hash: string; date: string; author: string; subject: string } | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("::commit::")) {
      const parts = line.split("::");
      cur = {
        hash: parts[3] ?? "",
        date: parts[4] ?? "",
        author: parts[5] ?? "",
        subject: parts.slice(6).join("::"),
      };
    } else if (line.trim() && cur) {
      fossils.push({
        path: line.trim(),
        deletedInCommit: cur.hash.slice(0, 8),
        deletedAt: cur.date.slice(0, 10),
        deletedBy: cur.author,
        subject: cur.subject,
      });
    }
  }

  // Dedup: keep first deletion event per path.
  const seen = new Set<string>();
  const dedup = fossils.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
  const top = dedup.slice(0, opts.topN ?? 20);

  if (opts.json) {
    process.stdout.write(JSON.stringify(top, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(
    `${kleur.bold().cyan("Fossil")}  ${kleur.gray("files deleted from HEAD that still live in history")}\n\n`,
  );
  if (top.length === 0) {
    ui.success("No deleted files found in history.");
    return 0;
  }
  for (const f of top) {
    process.stdout.write(
      `  ${kleur.gray("●")} ${kleur.bold(f.path)}\n` +
        `    ${kleur.gray(`deleted ${f.deletedAt} by ${f.deletedBy} in ${f.deletedInCommit}`)}\n` +
        `    ${kleur.white(f.subject)}\n`,
    );
  }
  process.stdout.write(
    "\n" +
      kleur.gray(
        "  Tip: `git show <commit>:<path>` to see the file's last state.",
      ) +
      "\n",
  );
  return 0;
}

/* ─────────────────────  mneme ledger  ───────────────────── */

export interface LedgerCommandOptions {
  cwd: string;
  since?: string;
  until?: string;
  format?: "json" | "csv";
  out?: string;
}

interface LedgerEntry {
  seq: number;
  commitHash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  subject: string;
  body: string;
  prNumber?: number;
  prTitle?: string;
  issueRefs?: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  prevHash: string;
  /** SHA-256 of (prevHash + canonical-fields) — tamper-evidence chain. */
  entryHash: string;
}

/**
 * `mneme ledger` — tamper-evident audit log derived from git history.
 *
 * For regulated industries (banks, exchanges, healthcare): every commit + author
 * + linked ticket gets a hash-chained entry. Tampering with any entry breaks
 * the chain — auditors can verify integrity in seconds.
 */
export async function ledgerCommand(opts: LedgerCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  const commits = util.loadCommitsBetween(s, opts.since, opts.until);
  if (commits.length === 0) {
    ui.error("No commits in range.");
    s.close();
    return 1;
  }

  const entries: LedgerEntry[] = [];
  let prevHash = "0".repeat(64);
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i]!;
    const stats = fileStats(s, c);
    const canonical = [
      String(i + 1),
      c.hash,
      c.authorName,
      c.authorEmail,
      c.authorDate,
      c.committerDate,
      c.subject,
      c.body,
      String(c.prNumber ?? ""),
      JSON.stringify(c.issueRefs ?? []),
      String(stats.filesChanged),
      String(stats.insertions),
      String(stats.deletions),
    ].join("");
    const entryHash = await util.sha256Hex(prevHash, canonical);
    entries.push({
      seq: i + 1,
      commitHash: c.hash,
      shortHash: c.shortHash,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      authoredAt: c.authorDate,
      committedAt: c.committerDate,
      subject: c.subject,
      body: c.body,
      prNumber: c.prNumber,
      prTitle: c.prTitle,
      issueRefs: c.issueRefs,
      filesChanged: stats.filesChanged,
      insertions: stats.insertions,
      deletions: stats.deletions,
      prevHash,
      entryHash,
    });
    prevHash = entryHash;
  }

  const format = opts.format ?? "json";
  let payload: string;
  if (format === "json") {
    payload = JSON.stringify(
      {
        ledgerVersion: 1,
        repo: { rootPath: meta.rootPath, remote: meta.remoteUrl },
        generatedAt: new Date().toISOString(),
        range: { since: opts.since ?? null, until: opts.until ?? null },
        entryCount: entries.length,
        finalHash: prevHash,
        entries,
      },
      null,
      2,
    );
  } else {
    const header = [
      "seq",
      "commit_hash",
      "author_name",
      "author_email",
      "authored_at",
      "subject",
      "pr_number",
      "files_changed",
      "insertions",
      "deletions",
      "prev_hash",
      "entry_hash",
    ].join(",");
    const rows = entries.map((e) =>
      [
        e.seq,
        e.commitHash,
        csv(e.authorName),
        e.authorEmail,
        e.authoredAt,
        csv(e.subject),
        e.prNumber ?? "",
        e.filesChanged,
        e.insertions,
        e.deletions,
        e.prevHash,
        e.entryHash,
      ].join(","),
    );
    payload = [header, ...rows].join("\n");
  }

  if (opts.out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(opts.out, payload, "utf8");
    ui.success(`Wrote ${entries.length} entries to ${opts.out} (${format})`);
    ui.dim(`Final hash: ${prevHash}`);
  } else {
    process.stdout.write(payload + "\n");
  }

  s.close();
  return 0;
}

function fileStats(
  s: store.MnemeStore,
  c: Commit,
): { filesChanged: number; insertions: number; deletions: number } {
  const rows = s.db
    .prepare(
      `SELECT SUM(insertions) AS ins, SUM(deletions) AS del, COUNT(*) AS n
       FROM file_changes WHERE commit_hash = ?`,
    )
    .get(c.hash) as { ins: number | null; del: number | null; n: number };
  return {
    filesChanged: rows.n ?? 0,
    insertions: rows.ins ?? 0,
    deletions: rows.del ?? 0,
  };
}

function csv(s: string): string {
  return `"${s.replace(/"/g, '""').replace(/\n/g, " ")}"`;
}
