/**
 * `mneme conscience` — review co-pilot powered by your repo's own history.
 *
 * Given a set of files about to change (typed in, fed via stdin, or extracted
 * from a unified diff file), Mneme finds:
 *
 *   1. Past commits that touched the same files
 *   2. Whether those commits were correlated with incidents
 *   3. A risk score = f(incident count, recency, files-overlap depth)
 *
 * The reviewer reads:
 *
 *   ●  PR #98  (3 of 4 files match)  RISK: 0.78
 *      "introduce idempotency"
 *      → 1 incident within 48h: INC-1287
 *
 * Phase-2 hook: when entity-level diffs are available, similarity becomes
 * semantic instead of file-overlap. The contract here doesn't change.
 */
import { readFileSync } from "node:fs";
import kleur from "kleur";
import { git, store, util, type Commit } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";

export interface ConscienceCommandOptions {
  cwd: string;
  /** Explicit file list (relative to repo root). */
  files?: string[];
  /** Path to a unified diff file (e.g. exported PR). */
  diffFile?: string;
  /** "-" reads diff from stdin. */
  stdin?: boolean;
  /** How recent past commits must be to count, in days. */
  recencyDays?: number;
  topN?: number;
  json?: boolean;
  /** Switch to dual-jury mode — show prosecution + defense views from real history. */
  dualJury?: boolean;
}

interface RelatedCommit {
  commit: Commit;
  fileOverlap: number;
  fileOverlapRatio: number;
  recencyScore: number;
  incidentIds: string[];
  incidentCount: number;
  riskScore: number;
}

export async function conscienceCommand(opts: ConscienceCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  // 1. Resolve the set of files this PR is changing.
  const files = await resolveFileSet(opts);
  if (files.length === 0) {
    ui.error(
      "No files supplied. Pass file paths as args, --diff-file <path>, or pipe a diff via --stdin.",
    );
    s.close();
    return 1;
  }

  // 2. Load all commits, score each by:
  //    - file overlap (Jaccard against the changed set)
  //    - recency (within `recencyDays`)
  //    - incident correlations (any commit→incident edge in store)
  const all = util.loadAllCommits(s);
  const recencyDays = opts.recencyDays ?? 365;
  const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;

  const fileSet = new Set(files.map(normalizePath));
  const related: RelatedCommit[] = [];

  for (const c of all) {
    const t = Date.parse(c.authorDate);
    if (!Number.isFinite(t) || t < cutoff) continue;

    const commitFiles = new Set(c.files.map(normalizePath));
    const overlap = countOverlap(commitFiles, fileSet);
    if (overlap === 0) continue;

    const overlapRatio = overlap / fileSet.size;
    const recencyScore = Math.max(
      0,
      1 - (Date.now() - t) / (recencyDays * 24 * 60 * 60 * 1000),
    );

    const incidents = findCorrelatedIncidents(s, c.hash);
    const incidentScore = Math.min(1, incidents.length * 0.4);

    // Composite risk: overlap matters most, incidents next, recency last.
    const risk = clamp01(0.5 * overlapRatio + 0.35 * incidentScore + 0.15 * recencyScore);

    related.push({
      commit: c,
      fileOverlap: overlap,
      fileOverlapRatio: overlapRatio,
      recencyScore,
      incidentIds: incidents.map((i) => i.id),
      incidentCount: incidents.length,
      riskScore: risk,
    });
  }

  related.sort((a, b) => b.riskScore - a.riskScore);
  const top = related.slice(0, opts.topN ?? 8);

  if (opts.dualJury) {
    const jury = buildDualJury(related);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ files, jury }, null, 2) + "\n");
      s.close();
      return 0;
    }
    printDualJury(files, jury);
    s.close();
    return 0;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ files, top }, null, 2) + "\n");
    s.close();
    return 0;
  }

  printConscience(files, top, s);
  s.close();
  return 0;
}

interface DualJury {
  prosecution: RelatedCommit[];
  defense: RelatedCommit[];
  /** Net verdict: prosecution_strength - defense_strength, normalized to [-1, 1]. */
  verdictScore: number;
  /** Verbal verdict: "block" | "caution" | "clear". */
  verdict: "block" | "caution" | "clear";
  /** Total commits considered. */
  totalCommits: number;
}

function buildDualJury(related: RelatedCommit[]): DualJury {
  // Prosecution: commits with the same files that DID cause incidents.
  const prosecution = related
    .filter((r) => r.incidentCount > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3);
  // Defense: commits with the same files that did NOT cause incidents.
  const defense = related
    .filter((r) => r.incidentCount === 0)
    .sort((a, b) => b.fileOverlapRatio - a.fileOverlapRatio)
    .slice(0, 3);

  const prosStrength = prosecution.reduce((s, r) => s + r.riskScore, 0);
  const defStrength = defense.reduce((s, r) => s + r.fileOverlapRatio, 0);
  const total = prosStrength + defStrength;
  const verdictScore = total > 0 ? (prosStrength - defStrength) / total : 0;

  let verdict: DualJury["verdict"];
  if (verdictScore > 0.4) verdict = "block";
  else if (verdictScore > -0.1) verdict = "caution";
  else verdict = "clear";

  return {
    prosecution,
    defense,
    verdictScore,
    verdict,
    totalCommits: related.length,
  };
}

function printDualJury(files: string[], jury: DualJury): void {
  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("⚖  Conscience — dual jury")}  ${kleur.gray(`(${files.length} file${files.length === 1 ? "" : "s"} changing)`)}\n`);
  process.stdout.write(`  ${kleur.gray("Two arguments from your repo's REAL history. The verdict is yours.")}\n\n`);

  // Prosecution
  process.stdout.write(`  ${kleur.red().bold("✗ Prosecution")}  ${kleur.gray("— precedents where similar changes caused incidents")}\n\n`);
  if (jury.prosecution.length === 0) {
    process.stdout.write(`    ${kleur.gray("(none — no similar change has caused a tracked incident)")}\n\n`);
  } else {
    for (const r of jury.prosecution) {
      const c = r.commit;
      process.stdout.write(
        `    ${kleur.red("●")} ${kleur.bold((c.shortHash || c.hash.slice(0, 7)).slice(0, 7))}  ${kleur.gray(`[${c.authorDate.slice(0, 10)}]`)}\n` +
          `        ${kleur.white(c.subject)}\n` +
          `        ${kleur.red(`→ ${r.incidentCount} incident${r.incidentCount === 1 ? "" : "s"} followed: ${r.incidentIds.join(", ")}`)}\n` +
          `        ${kleur.gray(`overlap ${(r.fileOverlapRatio * 100).toFixed(0)}% · risk ${r.riskScore.toFixed(2)}`)}\n\n`,
      );
    }
  }

  // Defense
  process.stdout.write(`  ${kleur.green().bold("✓ Defense")}  ${kleur.gray("— precedents where the same files shipped without incident")}\n\n`);
  if (jury.defense.length === 0) {
    process.stdout.write(`    ${kleur.gray("(none — no clean precedent in the recency window)")}\n\n`);
  } else {
    for (const r of jury.defense) {
      const c = r.commit;
      process.stdout.write(
        `    ${kleur.green("●")} ${kleur.bold((c.shortHash || c.hash.slice(0, 7)).slice(0, 7))}  ${kleur.gray(`[${c.authorDate.slice(0, 10)}]`)}\n` +
          `        ${kleur.white(c.subject)}\n` +
          `        ${kleur.green(`→ shipped clean — no incidents traced back`)}\n` +
          `        ${kleur.gray(`overlap ${(r.fileOverlapRatio * 100).toFixed(0)}%`)}\n\n`,
      );
    }
  }

  // Verdict
  const verdictColor =
    jury.verdict === "block" ? kleur.red().bold : jury.verdict === "caution" ? kleur.yellow().bold : kleur.green().bold;
  const verdictWord =
    jury.verdict === "block" ? "BLOCK" : jury.verdict === "caution" ? "CAUTION" : "CLEAR";
  process.stdout.write(`  ${kleur.bold().magenta("⚖  Verdict")}  ${verdictColor(`[${verdictWord}]`)}\n`);
  process.stdout.write(
    `    ${kleur.gray(
      `prosecution strength: ${jury.prosecution.length} cases · defense strength: ${jury.defense.length} cases · ` +
        `weighted score: ${jury.verdictScore >= 0 ? "+" : ""}${jury.verdictScore.toFixed(2)}`,
    )}\n\n`,
  );

  // How to read
  process.stdout.write(
    `  ${kleur.gray("─".repeat(64))}\n` +
      `  ${kleur.gray(
        "📘 How to read: prosecution and defense are pulled from REAL history — every\n" +
          "  precedent shown actually shipped. Verdict is heuristic; you are the final judge.\n" +
          "  CLEAR ≠ safe; BLOCK ≠ veto. Use this as the strongest counter-argument check.",
      )}\n`,
  );
}

function findCorrelatedIncidents(
  s: store.MnemeStore,
  commitHash: string,
): Array<{ id: string; title: string }> {
  const rows = s.db
    .prepare(
      `SELECT i.id AS id, i.title AS title FROM correlations c
       JOIN incidents i ON i.id = c.to_id
       WHERE c.from_kind = 'commit' AND c.from_id = ?`,
    )
    .all(commitHash) as Array<{ id: string; title: string }>;
  return rows;
}

async function resolveFileSet(opts: ConscienceCommandOptions): Promise<string[]> {
  if (opts.files && opts.files.length > 0) return opts.files;
  if (opts.diffFile) {
    const text = readFileSync(opts.diffFile, "utf8");
    return parseDiffFiles(text);
  }
  if (opts.stdin) {
    const text = await readStdin();
    return parseDiffFiles(text);
  }
  return [];
}

function parseDiffFiles(diff: string): string[] {
  const out = new Set<string>();
  for (const line of diff.split("\n")) {
    // Match "diff --git a/path b/path" and "+++ b/path".
    const m1 = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m1) {
      out.add(m1[2]!);
      continue;
    }
    const m2 = line.match(/^\+\+\+ b\/(.+)$/);
    if (m2) out.add(m2[1]!);
  }
  return Array.from(out);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function riskColor(risk: number): (s: string) => string {
  if (risk >= 0.7) return kleur.red;
  if (risk >= 0.4) return kleur.yellow;
  return kleur.green;
}

function riskLabel(risk: number): string {
  if (risk >= 0.7) return "HIGH";
  if (risk >= 0.4) return "MED";
  return "LOW";
}

function printConscience(
  files: string[],
  top: RelatedCommit[],
  s: store.MnemeStore,
): void {
  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Conscience")}  ${kleur.gray("PR risk co-pilot")}\n\n`);
  process.stdout.write(`  ${kleur.bold("changing")} ${files.length} file(s):\n`);
  for (const f of files.slice(0, 12)) {
    process.stdout.write(`    ${kleur.gray("·")} ${f}\n`);
  }
  if (files.length > 12) process.stdout.write(`    ${kleur.gray(`…and ${files.length - 12} more`)}\n`);
  process.stdout.write("\n");

  if (top.length === 0) {
    ui.success("No historically related commits in the recency window. Looks safe.");
    return;
  }

  process.stdout.write(`${kleur.bold().magenta("Past commits that touched the same files")}\n\n`);
  for (const r of top) {
    const c = r.commit;
    const color = riskColor(r.riskScore);
    const date = c.authorDate.slice(0, 10);
    const ref = c.prNumber ? `PR #${c.prNumber}` : c.shortHash;
    process.stdout.write(
      `  ${color("●")} ${kleur.bold(ref)}  ${kleur.gray(`[${date} · ${c.authorName}]`)}  ` +
        `${color(`RISK ${riskLabel(r.riskScore)}`)} ${kleur.gray(`(${r.riskScore.toFixed(2)})`)}\n` +
        `    ${kleur.white(c.subject)}\n` +
        `    ${kleur.gray(`${r.fileOverlap}/${files.length} files match`)}` +
        (r.incidentCount > 0
          ? `   ${kleur.red(`⚠ ${r.incidentCount} incident(s) correlated`)}`
          : "") +
        "\n",
    );
    if (r.incidentCount > 0) {
      for (const id of r.incidentIds.slice(0, 3)) {
        const inc = s.db
          .prepare("SELECT title, severity FROM incidents WHERE id = ?")
          .get(id) as { title: string; severity: string } | undefined;
        if (inc) {
          process.stdout.write(
            `      ${kleur.gray("→")} ${kleur.bold(id)} ${kleur.gray(`[${inc.severity}]`)} ${inc.title}\n`,
          );
        }
      }
    }
    process.stdout.write("\n");
  }

  const high = top.filter((r) => r.riskScore >= 0.7).length;
  if (high > 0) {
    process.stdout.write(
      kleur.red(
        `  ${high} HIGH-RISK historical match${high === 1 ? "" : "es"} — recommend a careful review pass before merge.\n`,
      ),
    );
  } else {
    process.stdout.write(
      kleur.gray(
        `  No HIGH risk found. Consider this an advisory: review with normal rigor.\n`,
      ),
    );
  }
}
