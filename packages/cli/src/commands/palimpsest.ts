import kleur from "kleur";
import { git, store } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";

export interface PalimpsestCommandOptions {
  cwd: string;
  target: string;
  /** How deep to walk the chain. */
  maxDepth?: number;
  json?: boolean;
}

interface ChainStep {
  kind: "commit" | "incident";
  id: string;
  label: string;
  date: string;
  detail?: string;
  via?: string;
}

/**
 * `mneme palimpsest <file>:<line>` — render the full causal ancestry of a single
 * line of code:
 *
 *   line 47 of payment.ts
 *     ↑ added by    a1b2c3d (PR #482, fix Stripe BigInt)
 *     ↑ correlated with incident SENTRY-1287
 *     ↑ which followed commit f8e7d6c (introduce idempotency)
 *     ↑ approved by alice + bob
 *
 * The chain alternates between commits and incidents, walking edges from the
 * `correlations` table. Cycles are guarded by a visited set.
 */
export async function palimpsestCommand(opts: PalimpsestCommandOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  const { file, startLine, endLine } = parseTarget(opts.target);

  // Step 1: blame to find the originating commit(s) for the target line range.
  const blamed = await git.blame(meta.rootPath, file, startLine, endLine);
  if (!blamed.length) {
    ui.error(`No blame data for ${file}${startLine ? `:${startLine}` : ""}. File may be untracked.`);
    s.close();
    return 1;
  }
  // Pick the most-recent originating commit by author time.
  const sorted = [...blamed].sort((a, b) => b.authorTime - a.authorTime);
  const seedHash = sorted[0]!.commitHash;

  // Step 2: walk the chain.
  const chain = walkChain(s, seedHash, opts.maxDepth ?? 8);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ target: opts.target, chain }, null, 2) + "\n");
    s.close();
    return 0;
  }

  printChain(opts.target, chain);
  s.close();
  return 0;
}

function walkChain(s: store.MnemeStore, seedHash: string, maxDepth: number): ChainStep[] {
  const visited = new Set<string>();
  const chain: ChainStep[] = [];

  let cursor: { kind: "commit" | "incident"; id: string } = { kind: "commit", id: seedHash };
  for (let depth = 0; depth < maxDepth; depth++) {
    const cursorKey = `${cursor.kind}:${cursor.id}`;
    if (visited.has(cursorKey)) break;
    visited.add(cursorKey);

    if (cursor.kind === "commit") {
      const commit = s.getCommit(cursor.id);
      if (!commit) break;
      chain.push({
        kind: "commit",
        id: commit.shortHash || commit.hash.slice(0, 8),
        label: commit.subject,
        date: commit.authorDate.slice(0, 10),
        detail: `${commit.authorName}${commit.prNumber ? ` · PR #${commit.prNumber}` : ""}`,
      });
      // Find correlations FROM this commit to incidents (this commit may have caused them).
      const next = nextEdgeFrom(s, "commit", commit.hash);
      if (!next) break;
      cursor = { kind: next.kind, id: next.id };
      chain[chain.length - 1]!.via = next.reason;
    } else {
      // cursor is incident
      const inc = loadIncident(s, cursor.id);
      if (!inc) break;
      chain.push({
        kind: "incident",
        id: inc.id,
        label: inc.title,
        date: inc.occurredAt.slice(0, 10),
        detail: `severity ${inc.severity}${inc.url ? ` · ${inc.url}` : ""}`,
      });
      // From an incident, walk to commits that are likely the cause (highest weight).
      const next = causesOfIncident(s, inc.id);
      if (!next) break;
      cursor = { kind: "commit", id: next.id };
      chain[chain.length - 1]!.via = next.reason;
    }
  }

  return chain;
}

function nextEdgeFrom(
  s: store.MnemeStore,
  kind: "commit" | "incident",
  id: string,
): { kind: "commit" | "incident"; id: string; weight: number; reason: string } | null {
  const row = s.db
    .prepare(
      `SELECT to_kind, to_id, weight, reason FROM correlations
       WHERE from_kind = ? AND from_id = ? ORDER BY weight DESC LIMIT 1`,
    )
    .get(kind, id) as { to_kind: string; to_id: string; weight: number; reason: string } | undefined;
  if (!row) return null;
  return {
    kind: row.to_kind as "commit" | "incident",
    id: row.to_id,
    weight: row.weight,
    reason: row.reason,
  };
}

function causesOfIncident(
  s: store.MnemeStore,
  incidentId: string,
): { id: string; weight: number; reason: string } | null {
  const row = s.db
    .prepare(
      `SELECT from_id, weight, reason FROM correlations
       WHERE to_kind = 'incident' AND to_id = ?
       ORDER BY weight DESC LIMIT 1`,
    )
    .get(incidentId) as { from_id: string; weight: number; reason: string } | undefined;
  if (!row) return null;
  return { id: row.from_id, weight: row.weight, reason: row.reason };
}

function loadIncident(
  s: store.MnemeStore,
  id: string,
): { id: string; title: string; occurredAt: string; severity: string; url?: string } | null {
  const row = s.db
    .prepare("SELECT id, title, occurred_at, severity, url FROM incidents WHERE id = ?")
    .get(id) as
    | { id: string; title: string; occurred_at: string; severity: string; url: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    occurredAt: row.occurred_at,
    severity: row.severity,
    url: row.url ?? undefined,
  };
}

function parseTarget(s: string): { file: string; startLine?: number; endLine?: number } {
  const m = s.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!m) return { file: s };
  return {
    file: m[1]!,
    startLine: m[2] ? Number(m[2]) : undefined,
    endLine: m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : undefined,
  };
}

function printChain(target: string, chain: ChainStep[]): void {
  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("Palimpsest")}  ${target}\n\n`);
  if (chain.length === 0) {
    ui.warn("No causal chain found. Try indexing more (and run `mneme correlate` to wire incidents).");
    return;
  }
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]!;
    const arrow = i === 0 ? "  " : "  ↑ ";
    const dot = step.kind === "commit" ? kleur.green("●") : kleur.red("●");
    process.stdout.write(
      `${arrow}${dot} ${kleur.bold(step.id)}  ${kleur.gray(`[${step.date}]`)}\n` +
        `    ${kleur.white(step.label)}\n` +
        (step.detail ? `    ${kleur.gray(step.detail)}\n` : "") +
        (step.via ? `    ${kleur.cyan("via:")} ${kleur.gray(step.via)}\n` : ""),
    );
  }
  process.stdout.write(
    "\n" +
      kleur.gray(
        "  Tip: pair this with `mneme web` to see the same chain rendered as a graph.",
      ) +
      "\n",
  );
}
