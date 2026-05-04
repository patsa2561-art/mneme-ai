import kleur from "kleur";
import { git, store, type Commit, type Incident, type Correlation } from "@mneme-ai/core";
import {
  TemporalCorrelationEngine,
  SentryAdapter,
  ManualJsonAdapter,
} from "@mneme-ai/correlator";
import { dbPath } from "../paths.js";
import { readConfig } from "../config.js";
import { ui } from "../ui.js";

type CorrelateSource = "sentry" | "manual";

export interface CorrelateCommandOptions {
  cwd: string;
  source?: CorrelateSource;
  // Sentry options
  org?: string;
  project?: string;
  baseUrl?: string;
  // Manual options
  file?: string;
  // Common options
  since?: string;
  until?: string;
  windowDays?: number;
  threshold?: number;
  topN?: number;
  json?: boolean;
}

export async function correlateCommand(opts: CorrelateCommandOptions): Promise<number> {
  if (!opts.source) {
    return printPlanned();
  }
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  const meta = await git.getRepoMeta(opts.cwd);
  const cfg = readConfig(meta.rootPath);
  const s = new store.MnemeStore(dbPath(meta.rootPath));

  if (s.countCommits() === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }

  ui.banner();
  process.stdout.write(
    `${kleur.bold().magenta("Correlate")}  ${kleur.gray(`source=${opts.source}`)}\n\n`,
  );

  // 1. Pull commits within the window from the store.
  const sinceMs =
    Date.parse(opts.since ?? "") ||
    Date.now() - (opts.windowDays ?? 90) * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();
  const commits = loadCommitsSince(s, sinceIso);
  ui.step("commits", `${commits.length} loaded since ${sinceIso.slice(0, 10)}`);

  // 2. Fetch incidents from the chosen source.
  let incidents: Incident[] = [];
  if (opts.source === "sentry") {
    if (!opts.org || !opts.project) {
      ui.error("`--source sentry` requires `--org <slug>` and `--project <slug>`.");
      s.close();
      return 1;
    }
    const token = process.env["SENTRY_AUTH_TOKEN"] ?? cfg.incidents?.sentry ? "" : "";
    const apiToken = process.env["SENTRY_AUTH_TOKEN"];
    if (!apiToken) {
      ui.error("Set SENTRY_AUTH_TOKEN in your environment.");
      s.close();
      return 1;
    }
    const adapter = new SentryAdapter({
      orgSlug: opts.org,
      projectSlug: opts.project,
      apiToken,
      baseUrl: opts.baseUrl,
    });
    ui.step("sentry", `fetching issues from ${opts.org}/${opts.project} …`);
    incidents = await adapter.fetch({ since: sinceIso, until: opts.until });
  } else if (opts.source === "manual") {
    if (!opts.file) {
      ui.error("`--source manual` requires `--file <path-to-incidents.json>`.");
      s.close();
      return 1;
    }
    const adapter = new ManualJsonAdapter(opts.file);
    ui.step("manual", `loading from ${opts.file}`);
    incidents = await adapter.fetch({ since: sinceIso, until: opts.until });
  }
  ui.step("incidents", `${incidents.length} loaded`);

  if (incidents.length === 0) {
    ui.warn("No incidents in range. Try widening --since or --window-days.");
    s.close();
    return 0;
  }

  // 3. Run the engine.
  const windowMs = (opts.windowDays ?? 7) * 24 * 60 * 60 * 1000;
  const engine = new TemporalCorrelationEngine();
  const correlations = await engine.correlate({
    commits,
    incidents,
    windowMs,
  });

  // 4. Persist + filter to top-N at threshold.
  s.upsertIncidents(incidents);
  s.upsertCorrelations(correlations);

  const threshold = opts.threshold ?? 0.3;
  const filtered = correlations
    .filter((c) => c.weight >= threshold)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, opts.topN ?? 20);

  if (opts.json) {
    process.stdout.write(JSON.stringify(filtered, null, 2) + "\n");
    s.close();
    return 0;
  }

  printCorrelations(filtered, incidents, commits, meta);
  s.close();
  return 0;
}

function loadCommitsSince(s: store.MnemeStore, sinceIso: string): Commit[] {
  const rows = s.db
    .prepare(
      `SELECT * FROM commits WHERE author_date >= ? ORDER BY author_date ASC`,
    )
    .all(sinceIso) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    hash: String(r.hash),
    shortHash: String(r.short_hash),
    authorName: String(r.author_name),
    authorEmail: String(r.author_email),
    authorDate: String(r.author_date),
    committerDate: String(r.committer_date),
    subject: String(r.subject),
    body: String(r.body),
    parents: String(r.parents).split(/\s+/).filter(Boolean),
    files: filesForCommit(s, String(r.hash)),
    prNumber: typeof r.pr_number === "number" ? r.pr_number : undefined,
    prTitle: r.pr_title ? String(r.pr_title) : undefined,
    prBody: r.pr_body ? String(r.pr_body) : undefined,
    issueRefs: r.issue_refs ? JSON.parse(String(r.issue_refs)) : undefined,
  }));
}

function filesForCommit(s: store.MnemeStore, hash: string): string[] {
  return s.filesForCommit(hash);
}

function printCorrelations(
  rows: Correlation[],
  incidents: Incident[],
  commits: Commit[],
  repo: { host?: string; owner?: string; repo?: string },
): void {
  const incidentById = new Map(incidents.map((i) => [i.id, i]));
  const commitByHash = new Map(commits.map((c) => [c.hash, c]));

  if (rows.length === 0) {
    ui.warn("No correlations above threshold. Try `--threshold 0.15` or widen `--window-days`.");
    return;
  }

  process.stdout.write(`\n${kleur.bold().magenta("Top correlations")} ${kleur.gray(`(${rows.length})`)}\n\n`);
  for (const r of rows) {
    const commit = commitByHash.get(r.fromId);
    const incident = incidentById.get(r.toId);
    if (!commit || !incident) continue;
    const conf = (r.weight * 100).toFixed(0) + "%";
    const date = commit.authorDate.slice(0, 10);
    process.stdout.write(
      `  ${kleur.green("●")} ${kleur.bold(commit.shortHash)} ${kleur.gray(`[${date} · ${commit.authorName}]`)}\n` +
        `    ${kleur.white(commit.subject)}\n` +
        `    ${kleur.cyan("→ incident:")} ${kleur.bold(incident.id)} ${kleur.gray(`[${incident.severity}]`)} ${incident.title}\n` +
        `    ${kleur.yellow("confidence:")} ${conf}  ${kleur.gray(r.reason)}\n\n`,
    );
  }

  process.stdout.write(
    kleur.gray(
      `  Tip: stored ${rows.length} correlation rows in .mneme/mneme.db. Re-run anytime; the engine is deterministic.\n`,
    ),
  );
}

async function printPlanned(): Promise<number> {
  ui.banner();
  process.stdout.write(`${kleur.bold().magenta("Correlate")}  ${kleur.gray("(Phase 3)")}\n\n`);
  process.stdout.write(
    [
      "Pull error/incident data from a source and correlate it with the commits",
      "that likely caused it.",
      "",
      kleur.bold("Sources available now:"),
      "  mneme correlate --source sentry --org <slug> --project <slug>",
      "  mneme correlate --source manual --file ./incidents.json",
      "",
      kleur.bold("Common options:"),
      "  --since <iso>        only consider incidents/commits since this date",
      "  --window-days <n>    correlation window (default 7)",
      "  --threshold <0..1>   minimum confidence (default 0.30)",
      "  --top <n>            top-N rows (default 20)",
      "  --json               machine-readable output",
      "",
      kleur.bold("Auth:"),
      "  Sentry:    set SENTRY_AUTH_TOKEN in your environment",
      "",
      kleur.bold("Output (sample):"),
      "  ● a1b2c3d [2025-09-01 · alice]",
      "    Refactor payment flow",
      "    → incident: SENTRY-1287 [error] Stripe webhook 500",
      "    confidence: 87%  reason: file overlap + temporal proximity",
      "",
      kleur.gray("Track progress in ROADMAP.md → Phase 3."),
    ].join("\n") + "\n",
  );
  return 0;
}
