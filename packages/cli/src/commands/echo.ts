import kleur from "kleur";
import { git, store, util, type Incident } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";

export interface EchoCommandOptions {
  cwd: string;
  /** Look up by stored incident id (e.g. "sentry:12345"). */
  id?: string;
  /** Or freeform — describe the incident in words. */
  query?: string;
  topK?: number;
  json?: boolean;
}

/**
 * `mneme echo` — given an incident (id or freeform), find the most similar
 * past incidents in the store. Helps on-call answer "have we seen this before?"
 * before they spend an hour reinventing the postmortem.
 */
export async function echoCommand(opts: EchoCommandOptions): Promise<number> {
  if (!opts.id && !opts.query) {
    return printUsage();
  }
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  const all = loadAllIncidents(s);
  if (all.length === 0) {
    ui.error(
      "No incidents indexed yet. Run `mneme correlate --source sentry --org X --project Y` first, or import from JSON.",
    );
    s.close();
    return 1;
  }

  let target: { title: string; description: string; sourceIncident?: Incident };
  if (opts.id) {
    const found = all.find((i) => i.id === opts.id);
    if (!found) {
      ui.error(`No incident with id "${opts.id}". Try \`mneme echo --query "..."\` instead.`);
      s.close();
      return 1;
    }
    target = {
      title: found.title,
      description: combineIncidentText(found),
      sourceIncident: found,
    };
  } else {
    target = { title: opts.query!, description: opts.query! };
  }

  // Lexical similarity via Jaccard token overlap. Cheap, deterministic, no
  // embedding dependency — good first version. Phase 2 will swap in cosine
  // when incidents have embeddings.
  const targetTokens = tokenize(target.description);
  const scored = all
    .filter((i) => !target.sourceIncident || i.id !== target.sourceIncident.id)
    .map((i) => {
      const tokens = tokenize(combineIncidentText(i));
      return { incident: i, similarity: jaccard(targetTokens, tokens) };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, opts.topK ?? 5);

  if (opts.json) {
    process.stdout.write(JSON.stringify(scored, null, 2) + "\n");
    s.close();
    return 0;
  }

  printResults(target, scored, s);
  s.close();
  return 0;
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

function combineIncidentText(i: Incident): string {
  const parts = [i.title];
  if (i.affectedFiles?.length) parts.push(...i.affectedFiles);
  if (i.stackFrames?.length) {
    for (const f of i.stackFrames) {
      parts.push(`${f.file}:${f.line}`);
      if (f.function) parts.push(f.function);
    }
  }
  if (i.metadata) parts.push(JSON.stringify(i.metadata));
  return parts.join(" ");
}

const STOP = new Set([
  "the", "and", "for", "are", "with", "this", "that", "from", "have", "has",
  "was", "were", "but", "not", "you", "your", "but", "into", "out",
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9_/.]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOP.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function printResults(
  target: { title: string },
  scored: Array<{ incident: Incident; similarity: number }>,
  s: store.MnemeStore,
): void {
  ui.banner();
  process.stdout.write(`${kleur.bold().cyan("echo")}  ${target.title}\n\n`);

  if (scored.length === 0) {
    ui.warn("No similar incidents found.");
    return;
  }

  // Look up correlations for each result so we can surface the resolution commits.
  for (const { incident, similarity } of scored) {
    const pct = (similarity * 100).toFixed(0) + "%";
    const date = incident.occurredAt.slice(0, 10);
    process.stdout.write(
      `  ${kleur.green("●")} ${kleur.bold(incident.id)}  ${kleur.gray(`[${date} · ${incident.severity}]`)}  ${kleur.yellow(`${pct} similar`)}\n` +
        `    ${kleur.white(incident.title)}\n`,
    );
    // Resolution commits if we have them.
    const corr = s.db
      .prepare(
        `SELECT from_id, weight, reason FROM correlations
         WHERE to_kind = 'incident' AND to_id = ?
         ORDER BY weight DESC LIMIT 3`,
      )
      .all(incident.id) as Array<{ from_id: string; weight: number; reason: string }>;
    if (corr.length > 0) {
      process.stdout.write(`    ${kleur.cyan("→ resolved/triggered by:")}\n`);
      for (const c of corr) {
        const c2 = s.getCommit(c.from_id);
        if (c2) {
          process.stdout.write(
            `      ${kleur.gray("·")} ${c2.shortHash} ${kleur.gray("·")} ${c2.subject.slice(0, 60)}\n`,
          );
        }
      }
    }
    if (incident.url) process.stdout.write(`    ${kleur.gray(incident.url)}\n`);
    process.stdout.write("\n");
  }
  // util import is reserved for cosine fallback when incidents get embeddings;
  // suppress unused-import lint.
  void util;
}

function printUsage(): number {
  ui.banner();
  process.stdout.write(`${kleur.bold().magenta("echo")}  ${kleur.gray("(WILD #2)")}\n\n`);
  process.stdout.write(
    [
      `Find past incidents that resemble a current one.`,
      ``,
      kleur.bold(`Usage:`),
      `  mneme echo --id <stored-incident-id>`,
      `  mneme echo --query "Stripe webhook 500 on bigint amount"`,
      ``,
      kleur.bold(`Options:`),
      `  --id <id>          stored incident id (e.g. "sentry:12345")`,
      `  --query <text>     freeform incident description`,
      `  --top <n>          top-N most similar (default 5)`,
      `  --json             machine-readable output`,
      ``,
      kleur.gray(
        `Echo first runs Jaccard similarity on tokenized titles, files, and stack frames.`,
      ),
      kleur.gray(
        `When incidents have embeddings (Phase 3.5), it switches to cosine for semantic match.`,
      ),
    ].join("\n") + "\n",
  );
  return 0;
}
