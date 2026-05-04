/**
 * `mneme blast <commit>` — predict what's at risk if this commit ships.
 *
 * Inverts the `correlate` engine direction: instead of "given an incident,
 * which commits are likely the cause", we ask "given a commit, which past
 * incidents share its file footprint, and what's the historical base-rate
 * of incidents on the same files within the next 48 h?"
 *
 * Useful as a pre-merge gate (CI hook) or as a `git push` advisory.
 */
import kleur from "kleur";
import { git, store, type Commit, type Incident } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";

export interface BlastCommandOptions {
  cwd: string;
  commit: string;
  windowHours?: number;
  json?: boolean;
}

export async function blastCommand(opts: BlastCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  // Resolve commit (accept short or long hash, or HEAD).
  const target = await resolveCommit(opts.cwd, opts.commit);
  if (!target) {
    ui.error(`Could not resolve commit "${opts.commit}".`);
    s.close();
    return 1;
  }
  const commit = s.getCommit(target);
  if (!commit) {
    ui.error(`Commit ${target.slice(0, 8)} is not indexed. Run \`mneme index\`.`);
    s.close();
    return 1;
  }

  // Look up every past incident whose affected_files overlaps with this commit's files.
  const allIncidents = loadAllIncidents(s);
  const commitFiles = new Set(commit.files.map(normalizePath));
  const matches: Array<{ incident: Incident; overlapFiles: string[] }> = [];
  for (const inc of allIncidents) {
    const incFiles = new Set([...(inc.affectedFiles ?? [])].map(normalizePath));
    const overlap = [...commitFiles].filter((f) => incFiles.has(f));
    if (overlap.length > 0) matches.push({ incident: inc, overlapFiles: overlap });
  }

  // Compute base-rate: of all PAST commits touching ANY file this commit touches,
  // what fraction had an incident-correlation within `windowHours`?
  const windowHours = opts.windowHours ?? 48;
  const filesArray = Array.from(commitFiles);
  let totalPriors = 0;
  let triggeringPriors = 0;
  if (filesArray.length > 0) {
    const placeholders = filesArray.map(() => "?").join(",");
    const priorRows = s.db
      .prepare(
        `SELECT DISTINCT commit_hash FROM file_changes WHERE LOWER(REPLACE(path, '\\', '/')) IN (${placeholders})`,
      )
      .all(...filesArray) as Array<{ commit_hash: string }>;
    totalPriors = priorRows.length;
    if (totalPriors > 0) {
      const corrRows = s.db
        .prepare(
          `SELECT DISTINCT from_id FROM correlations
           WHERE from_kind = 'commit' AND to_kind = 'incident' AND from_id IN (${priorRows.map(() => "?").join(",")})`,
        )
        .all(...priorRows.map((r) => r.commit_hash)) as Array<{ from_id: string }>;
      triggeringPriors = corrRows.length;
    }
  }
  const baseRate = totalPriors === 0 ? 0 : triggeringPriors / totalPriors;
  const verdict = baseRate >= 0.3 ? "HIGH" : baseRate >= 0.1 ? "MED" : "LOW";

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          commit: commit.shortHash,
          windowHours,
          baseRate,
          verdict,
          totalPriors,
          triggeringPriors,
          fileMatches: matches,
        },
        null,
        2,
      ) + "\n",
    );
    s.close();
    return 0;
  }

  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Blast radius")}  ${commit.shortHash}  ${kleur.gray(`${commit.subject.slice(0, 60)}`)}\n\n`);
  process.stdout.write(`  ${kleur.bold("files changed")}: ${commit.files.length}\n`);
  process.stdout.write(`  ${kleur.bold("historical base rate")}: ${(baseRate * 100).toFixed(1)}%  ` +
    `${kleur.gray(`(${triggeringPriors} of ${totalPriors} prior commits on these files triggered an incident within ${windowHours}h)`)}\n`);
  const color = verdict === "HIGH" ? kleur.red : verdict === "MED" ? kleur.yellow : kleur.green;
  process.stdout.write(`  ${kleur.bold("verdict")}: ${color(verdict)}\n\n`);

  if (matches.length === 0) {
    ui.success("No past incidents share files with this commit.");
  } else {
    process.stdout.write(`${kleur.bold().magenta("Past incidents on overlapping files")}\n`);
    for (const m of matches.slice(0, 10)) {
      const date = m.incident.occurredAt.slice(0, 10);
      process.stdout.write(
        `  ${kleur.red("●")} ${kleur.bold(m.incident.id)}  ${kleur.gray(`[${date} · ${m.incident.severity}]`)}\n` +
          `    ${kleur.white(m.incident.title)}\n` +
          `    ${kleur.gray(`overlap: ${m.overlapFiles.slice(0, 3).join(", ")}${m.overlapFiles.length > 3 ? " (+more)" : ""}`)}\n`,
      );
    }
    if (matches.length > 10) {
      process.stdout.write(kleur.gray(`  …and ${matches.length - 10} more\n`));
    }
  }
  s.close();
  return 0;
}

async function resolveCommit(cwd: string, ref: string): Promise<string | null> {
  const r = await git.execGit(["rev-parse", ref], { cwd });
  if (r.code !== 0) return null;
  return r.stdout.trim();
}

function loadAllIncidents(s: store.MnemeStore): Incident[] {
  const rows = s.db
    .prepare("SELECT * FROM incidents ORDER BY occurred_at DESC")
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    source: r.source as Incident["source"],
    externalId: r.external_id ? String(r.external_id) : undefined,
    title: String(r.title),
    occurredAt: String(r.occurred_at),
    resolvedAt: r.resolved_at ? String(r.resolved_at) : undefined,
    severity: r.severity as Incident["severity"],
    affectedFiles: r.affected_files ? JSON.parse(String(r.affected_files)) : undefined,
    stackFrames: r.stack_frames ? JSON.parse(String(r.stack_frames)) : undefined,
    url: r.url ? String(r.url) : undefined,
    metadata: r.metadata ? JSON.parse(String(r.metadata)) : undefined,
  }));
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
