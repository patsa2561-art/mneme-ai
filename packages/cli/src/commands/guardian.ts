/**
 * `mneme guardian` — the 24/7 self-healing engine.
 *
 *   while (true) {
 *     diagnose();
 *     fix();
 *     learn();
 *     sleep(intervalMs);
 *   }
 *
 * Modes:
 *   --once       run a single diagnose pass and exit
 *   --watch      run forever (default), polling every --interval seconds
 *   --apply      apply auto-policy findings (otherwise just observe)
 *   --json       structured output
 *
 * Safe by default: without --apply, the daemon only DIAGNOSES; it logs
 * everything it WOULD do but applies nothing. Pass --apply to enable the
 * auto-fix loop.
 */
import kleur from "kleur";
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  git,
  store,
  guardian,
  indexer,
  util,
  type CommitChunk,
} from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui } from "../ui.js";

export interface GuardianCommandOptions {
  cwd: string;
  watch?: boolean;
  intervalSeconds?: number;
  apply?: boolean;
  json?: boolean;
  /** Stop after N iterations (testing / cron-style runs). */
  maxIterations?: number;
}

export async function guardianCommand(
  opts: GuardianCommandOptions,
): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }

  const meta = await git.getRepoMeta(opts.cwd);
  const intervalMs = (opts.intervalSeconds ?? 300) * 1000;
  const watch = opts.watch ?? false;
  const apply = opts.apply ?? false;
  const maxIter = opts.maxIterations ?? (watch ? Infinity : 1);

  if (!opts.json) {
    ui.banner();
    process.stdout.write(`\n  ${kleur.bold().cyan("🛡  Guardian — 24/7 self-healing daemon")}\n`);
    process.stdout.write(`  ${kleur.gray("─".repeat(64))}\n\n`);
    process.stdout.write(`  ${kleur.gray("mode    ")}  ${watch ? kleur.green("watch") : kleur.cyan("once")}\n`);
    process.stdout.write(`  ${kleur.gray("apply   ")}  ${apply ? kleur.green("yes (auto-fix enabled)") : kleur.yellow("no (observe-only)")}\n`);
    if (watch) {
      process.stdout.write(`  ${kleur.gray("interval")}  ${opts.intervalSeconds ?? 300}s\n`);
    }
    process.stdout.write("\n");
  }

  let iteration = 0;
  let lastQualityScore: number | null = null;

  while (iteration < maxIter) {
    iteration += 1;
    const tickStart = Date.now();

    const input = await collectInput(opts.cwd, meta.rootPath, lastQualityScore);
    const report = guardian.diagnose(input);
    if (input.quality) lastQualityScore = input.quality.overallScore;

    appendLog(meta.rootPath, {
      ts: report.generatedAt,
      iteration,
      summary: report.summary,
      findings: report.findings.map((f) => ({
        kind: f.kind,
        severity: f.severity,
        policy: f.policy,
        message: f.message,
        action: f.suggestedAction,
      })),
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify({ iteration, report }, null, 2) + "\n");
    } else {
      renderTick(iteration, report);
    }

    // Auto-apply phase
    if (apply) {
      const actions = guardian.selectAutoActions(report);
      for (const action of actions) {
        if (!action.suggestedAction) continue;
        if (!opts.json) {
          process.stdout.write(`    ${kleur.cyan("→")} applying: ${kleur.bold(action.suggestedAction)}\n`);
        }
        const ok = await runShell(action.suggestedAction, opts.cwd);
        appendLog(meta.rootPath, {
          ts: new Date().toISOString(),
          iteration,
          appliedAction: action.suggestedAction,
          ok,
          finding: action.kind,
        });
      }
    }

    if (!watch || iteration >= maxIter) break;

    const elapsed = Date.now() - tickStart;
    const sleepMs = Math.max(0, intervalMs - elapsed);
    if (!opts.json) {
      process.stdout.write(`    ${kleur.gray(`sleeping ${Math.round(sleepMs / 1000)}s until next tick…`)}\n\n`);
    }
    await sleep(sleepMs);
  }

  return 0;
}

async function collectInput(
  cwd: string,
  rootPath: string,
  lastQualityScore: number | null,
): Promise<import("@mneme-ai/core").guardian.GuardianInput> {
  // ── Head commits via git ─────────────────────────────────────────
  let headCommits: import("@mneme-ai/core").Commit[] = [];
  try {
    const raw = await git.execGitOk(
      ["log", "--no-color", "-n", "200", "--pretty=format:%H%x09%aI%x09%an%x09%s"],
      { cwd },
    );
    for (const line of raw.trim().split("\n")) {
      const [hash, date, author, ...subjectParts] = line.split("\t");
      if (!hash) continue;
      headCommits.push({
        hash,
        shortHash: hash.slice(0, 7),
        authorName: author || "",
        authorEmail: "",
        authorDate: date || "",
        committerDate: date || "",
        subject: subjectParts.join("\t") || "",
        body: "",
        files: [],
        parents: [],
      });
    }
  } catch {
    // git may fail in shallow / detached state — proceed with empty head
  }

  // ── Indexed commits + chunks via store ───────────────────────────
  let indexedCommits: import("@mneme-ai/core").Commit[] = [];
  let chunks: CommitChunk[] = [];
  let storeSchemaVersion = 0;
  let feedbackEventsSinceCalibrate = 0;
  let quality: import("@mneme-ai/core").indexer.IndexQualityReport | null = null;

  if (existsSync(dbPath(rootPath))) {
    const s = new store.MnemeStore(dbPath(rootPath));
    try {
      indexedCommits = util.loadAllCommits(s);
      const rows = s.db
        .prepare("SELECT id, commit_hash, text, kind, embedding FROM chunks")
        .all() as Array<Record<string, unknown>>;
      chunks = rows.map((r) => ({
        id: String(r.id),
        commitHash: String(r.commit_hash),
        text: String(r.text ?? ""),
        kind: r.kind as
          | "subject"
          | "body"
          | "pr_title"
          | "pr_body"
          | "diff_hunk"
          | "synthesized",
        embedding:
          r.embedding instanceof Buffer && r.embedding.length > 0
            ? new Float32Array(
                r.embedding.buffer,
                r.embedding.byteOffset,
                r.embedding.byteLength / 4,
              )
            : undefined,
      }));
      storeSchemaVersion = Number(s.getMeta("schema_version") ?? 3);
      feedbackEventsSinceCalibrate = Number(
        s.getMeta("feedback_since_calibrate") ?? 0,
      );
      quality = indexer.analyzeIndexQuality(indexedCommits, chunks);
    } finally {
      s.close();
    }
  }

  return {
    headCommits,
    indexedCommits,
    quality,
    lastQualityScore,
    storeSchemaVersion,
    expectedSchemaVersion: 3,
    feedbackEventsSinceCalibrate,
  };
}

function renderTick(iteration: number, report: import("@mneme-ai/core").guardian.GuardianReport): void {
  const ts = report.generatedAt.replace("T", " ").slice(0, 19);
  process.stdout.write(`  ${kleur.gray("┄┄┄ tick #" + iteration + " · " + ts)}\n`);

  if (report.findings.length === 0) {
    process.stdout.write(`    ${kleur.green("✓")} ${kleur.gray("all systems healthy — no findings")}\n`);
    return;
  }

  for (const f of report.findings) {
    const sev = severityColor(f.severity);
    const policy = policyLabel(f.policy);
    process.stdout.write(`    ${sev}  ${policy}  ${f.message}\n`);
    if (f.suggestedAction) {
      process.stdout.write(`        ${kleur.gray("→")} ${kleur.cyan(f.suggestedAction)}\n`);
    }
  }
  process.stdout.write(
    `    ${kleur.gray(`(${report.summary.findings} findings · ${report.summary.autoActions} auto · ${report.summary.recommendations} suggested)`)}\n`,
  );
}

function severityColor(sev: string): string {
  switch (sev) {
    case "critical":
      return kleur.red().bold("CRIT");
    case "high":
      return kleur.red("HIGH");
    case "medium":
      return kleur.yellow("MED ");
    case "low":
      return kleur.cyan("LOW ");
    default:
      return kleur.gray(sev);
  }
}

function policyLabel(policy: string): string {
  switch (policy) {
    case "auto":
      return kleur.green().bold("[AUTO]   ");
    case "recommended":
      return kleur.cyan().bold("[SUGGEST]");
    case "observe":
      return kleur.gray("[OBSERVE]");
    default:
      return kleur.gray(`[${policy}]`);
  }
}

function appendLog(rootPath: string, entry: unknown): void {
  const logDir = `${rootPath}/.mneme`;
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = `${logDir}/guardian.jsonl`;
  appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runShell(cmd: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Run via the same node binary + dist entry to avoid PATH issues during a long-lived daemon.
    const parts = cmd.split(/\s+/);
    if (parts[0] !== "mneme") {
      // Only auto-apply mneme commands. Anything else is observed only.
      resolve(false);
      return;
    }
    const args = parts.slice(1);
    const proc = spawn("node", ["packages/cli/bin/mneme.js", ...args], {
      cwd,
      stdio: "ignore",
      shell: false,
    });
    proc.on("exit", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

// Make sure unused imports aren't tree-shaken away if a future version needs them.
void writeFileSync;
void readFileSync;
void dirname;
