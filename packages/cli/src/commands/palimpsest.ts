import kleur from "kleur";
import { git, store, palimpsest as palimpsestCore } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui, header, section, divider, nextSteps } from "../ui.js";

export interface PalimpsestCommandOptions {
  cwd: string;
  target: string;
  /** How deep to walk the chain. */
  maxDepth?: number;
  json?: boolean;
  /** Switch to counterfactual mode — walk forward from this line and
   *  show what would have changed if it had been written differently. */
  counterfactual?: boolean;
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
 *     ↑ correlated with incident INC-1287
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

  // Counterfactual mode — runs without the index (pure git-history walk).
  if (opts.counterfactual) {
    const { file, startLine } = parseTarget(opts.target);
    if (!startLine) {
      ui.error("--counterfactual requires file:line (a single line number).");
      return 1;
    }
    let report;
    try {
      report = await palimpsestCore.counterfactualPalimpsest({
        cwd: meta.rootPath,
        file,
        line: startLine,
        maxDownstream: opts.maxDepth ?? 30,
      });
    } catch (err) {
      ui.error(`Counterfactual scan failed: ${(err as Error).message}`);
      return 1;
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return 0;
    }
    renderCounterfactual(report);
    return 0;
  }

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

function renderCounterfactual(r: import("@mneme-ai/core").palimpsest.CounterfactualReport): void {
  ui.banner();
  process.stdout.write(
    header(
      "🌀",
      `Counterfactual — ${r.file}:${r.line}`,
      "what if this line had been written differently?",
      "see what your original choice locked in — downstream commits + a flipped-line sketch",
    ) + "\n\n",
  );

  process.stdout.write(section("Line at HEAD") + "\n");
  process.stdout.write(`  ${kleur.gray("│")} ${kleur.white(r.originalLine || "(empty / file gone)")}\n\n`);

  if (r.origin) {
    process.stdout.write(section("Origin") + "\n");
    process.stdout.write(
      `  ${kleur.green("●")} ${kleur.bold(r.origin.shortHash)}  ${kleur.gray(`[${r.origin.date}]`)}  ${kleur.gray(r.origin.authorName)}\n` +
        `      ${kleur.white(r.origin.subject)}\n\n`,
    );
  }

  // Alt-history flips
  process.stdout.write(section("Alternate-history sketches") + " " + kleur.gray("(speculative — heuristic inversions)") + "\n\n");
  for (const a of r.alts) {
    const conf = a.confidence;
    const dot = conf >= 0.8 ? kleur.green("●") : conf >= 0.5 ? kleur.cyan("●") : kleur.gray("●");
    process.stdout.write(
      `  ${dot} ${kleur.bold(a.rule)}  ${kleur.gray(`(confidence ${(conf * 100).toFixed(0)}%)`)}\n` +
        `      ${kleur.gray("→")} ${kleur.cyan(a.flipped.trim())}\n`,
    );
  }
  process.stdout.write("\n");

  // Downstream commits — ground truth
  process.stdout.write(section("Downstream commits that touched this line") + "\n\n");
  if (r.downstream.length === 0) {
    process.stdout.write("  " + kleur.gray("(no downstream edits — this line has been stable since origin)") + "\n\n");
  } else {
    for (const d of r.downstream) {
      process.stdout.write(
        `  ${kleur.gray("●")} ${kleur.bold(d.shortHash)}  ${kleur.gray(`[${d.date}]`)}  ${kleur.gray(d.authorName)}\n` +
          `      ${kleur.white(d.subject)}\n` +
          `      ${kleur.gray("removed:")} ${kleur.red("- " + (d.removed[0] ?? "").trim().slice(0, 70))}\n` +
          `      ${kleur.gray("added:  ")} ${kleur.green("+ " + (d.added[0] ?? "").trim().slice(0, 70))}\n\n`,
      );
    }
  }

  // Cross-references — files that mention this line's identifier
  if (r.referencingFiles.length > 0) {
    process.stdout.write(section("Files referencing the strongest identifier on this line") + "\n\n");
    for (const f of r.referencingFiles) {
      process.stdout.write(`  ${kleur.cyan(f)}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Origin + downstream commits are GROUND TRUTH — exact git history.\n" +
          "  Alt-history sketches are HEURISTIC inversions (negate ===, flip return true/false, etc.).\n" +
          "  Cross-references use a single-identifier word search — false positives possible.\n" +
          "  Use this to think hard about a line you're about to change. NEVER for blame attribution.",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme palimpsest ${r.file}:${r.line}`, why: "default mode — walk backward to root-cause incident" },
      { cmd: `mneme blast <commit>`, why: "pick a downstream commit and predict its incident risk" },
      { cmd: `mneme why ${r.file}:${r.line}`, why: "the why-does-this-exist version of the same question" },
    ]) + "\n",
  );
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
