/**
 * `mneme promise` — promise-debt tracker.
 *
 * The thesis: engineers casually write "I'll fix later", "TODO: refactor",
 * "follow-up PR coming" in commit messages and PR descriptions.  These
 * promises live in free-form text and are invisible to query.  Mneme
 * parses them into a structured ledger and verifies which were kept.
 *
 * Honest framing: this is HEURISTIC.  We never claim a promise is
 * "broken" — we say "appears unfulfilled in our window".  The renderer
 * makes that explicit in the `📘 How to read` block.
 *
 * ─── --json shape ─────────────────────────────────────────────────────
 *   See `packages/core/src/people/promise.ts` for the canonical contract.
 *   {
 *     "totals":   { "open": n, "kept": n, "stale": n, "total": n },
 *     "oldestStaleAgeDays": n | null,
 *     "windowDays": n,
 *     "promises": [
 *       { "id": "abc1234:0", "author": "alice@x", "commit": "abc1234",
 *         "date": "...", "excerpt": "TODO: refactor cache",
 *         "scopeHint": "cache", "files": [...],
 *         "status": "open|kept|stale", "ageDays": n,
 *         "patternKind": "todo|will-verb|followup|plan-to",
 *         "fulfilledBy": "ef56789" | null,
 *         "fulfilledAt": "..." | null }
 *     ],
 *     "byAuthor": [
 *       { "author": "...", "open": n, "kept": n, "stale": n, "total": n }
 *     ]
 *   }
 */

import kleur from "kleur";
import { git, store, people, util } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui, pill } from "../ui.js";
import {
  iris,
  readIrisState,
  recordCommandRun,
  shouldShowVerboseGuide,
  type PyramidSection,
} from "../iris/index.js";

export interface PromiseOptions {
  cwd: string;
  authorFilter?: string;
  status?: "open" | "kept" | "stale";
  topN?: number;
  json?: boolean;
  verbose?: boolean;
}

interface PromiseJsonOutput {
  totals: people.PromiseTotals;
  oldestStaleAgeDays: number | null;
  windowDays: number;
  promises: Array<{
    id: string;
    author: string;
    commit: string;
    date: string;
    excerpt: string;
    scopeHint: string | null;
    files: string[];
    status: people.PromiseStatus;
    ageDays: number;
    patternKind: people.PromisePatternKind;
    fulfilledBy: string | null;
    fulfilledAt: string | null;
  }>;
  byAuthor: people.AuthorPromiseStats[];
}

const DEFAULT_KEPT_WINDOW_DAYS = 365;
const DEFAULT_STALE_AFTER_DAYS = 90;

export async function promiseCommand(opts: PromiseOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) {
    ui.error("Memory is empty. Run `mneme index` first.");
    s.close();
    return 1;
  }

  const topN = Math.max(1, opts.topN ?? 10);

  let report: people.PromiseReport;
  try {
    const allCommits = util.loadAllCommits(s);
    report = people.buildPromiseReport(allCommits, {
      keptWindowDays: DEFAULT_KEPT_WINDOW_DAYS,
      staleAfterDays: DEFAULT_STALE_AFTER_DAYS,
      authorFilter: opts.authorFilter,
      statusFilter: opts.status,
    });
  } finally {
    s.close();
  }

  // Cap how many we show; JSON shows the same prefix to keep the contract honest.
  const promisesShown = report.promises.slice(0, topN);

  const json: PromiseJsonOutput = {
    totals: report.totals,
    oldestStaleAgeDays: report.oldestStaleAgeDays,
    windowDays: DEFAULT_KEPT_WINDOW_DAYS,
    promises: promisesShown.map((p) => ({
      id: p.id,
      author: p.author,
      commit: p.commitShort,
      date: p.date,
      excerpt: p.excerpt,
      scopeHint: p.scopeHint,
      files: p.files,
      status: p.status,
      ageDays: p.ageDays,
      patternKind: p.patternKind,
      fulfilledBy: p.fulfilledBy,
      fulfilledAt: p.fulfilledAt,
    })),
    byAuthor: report.byAuthor,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
    return 0;
  }

  renderPromise(report, json, { ...opts, topN, rootPath: meta.rootPath });
  return 0;
}

function renderPromise(
  report: people.PromiseReport,
  json: PromiseJsonOutput,
  opts: PromiseOptions & { topN: number; rootPath: string },
): void {
  const irisState = readIrisState(opts.rootPath);
  const showGuide = shouldShowVerboseGuide(irisState, "promise");

  // ─── Headline ────────────────────────────────────────────────────────
  const totals = report.totals;
  let headline: string;
  if (totals.total === 0) {
    if (opts.authorFilter) {
      headline = `📜 No promises found for ${opts.authorFilter}`;
    } else if (opts.status) {
      headline = `📜 No promises in status '${opts.status}'`;
    } else {
      headline = `📜 No promise text detected — clean ledger`;
    }
  } else {
    const oldestPart =
      report.oldestStaleAgeDays !== null
        ? ` — oldest ${formatAgeMonths(report.oldestStaleAgeDays)}`
        : "";
    if (totals.stale > 0) {
      headline = `📜 ${totals.open} open promise${totals.open === 1 ? "" : "s"} · ${totals.stale} stale${oldestPart}`;
    } else if (totals.open > 0) {
      headline = `📜 ${totals.open} open promise${totals.open === 1 ? "" : "s"} (none yet stale)`;
    } else {
      headline = `📜 ${totals.kept} promise${totals.kept === 1 ? "" : "s"} kept · 0 outstanding`;
    }
  }

  // ─── Sections ─────────────────────────────────────────────────────────
  const sections: PyramidSection[] = [];

  // Lede
  const ledeLines: string[] = [];
  if (totals.total === 0) {
    ledeLines.push(
      `${kleur.green("✓")} ${kleur.gray("No commits or PR descriptions in this repo match the promise patterns.")}`,
    );
    ledeLines.push(
      `${kleur.gray("Patterns scanned:")} ${kleur.cyan("TODO:")} ${kleur.gray("·")} ${kleur.cyan("FIXME:")} ${kleur.gray("·")} ${kleur.cyan("\"I'll fix\"")} ${kleur.gray("·")} ${kleur.cyan("\"in a follow-up\"")} ${kleur.gray("·")} ${kleur.cyan("\"plan to ...\"")}`,
    );
  } else {
    ledeLines.push(
      `${kleur.gray("Total promises:")} ${kleur.bold(String(totals.total))} ${kleur.gray("·")} ${kleur.bold(`${pctOrNa(totals.kept, totals.total)}%`)} ${kleur.gray("kept")} ${kleur.gray("·")} ${kleur.bold(`${pctOrNa(totals.stale, totals.total)}%`)} ${kleur.gray("stale")}`,
    );
    ledeLines.push(
      `${kleur.gray("Look-back window for fulfilment:")} ${kleur.bold(`${json.windowDays} days`)} ${kleur.gray("· stale threshold:")} ${kleur.bold(`${DEFAULT_STALE_AFTER_DAYS} days`)}`,
    );
    ledeLines.push(
      `${pill("HEURISTIC", "warn")} ${kleur.gray("'Open' means")} ${kleur.bold("appears unfulfilled in our window")}${kleur.gray(" — not 'broken'.")}`,
    );
  }
  sections.push({ tier: "lede", lines: ledeLines });

  // Key facts: bucket bar.
  if (totals.total > 0) {
    const factLines: string[] = [];
    const max = Math.max(totals.open, totals.kept, totals.stale, 1);
    factLines.push(meterRow("stale", totals.stale, max, "high"));
    factLines.push(meterRow("open ", totals.open, max, "warn"));
    factLines.push(meterRow("kept ", totals.kept, max, "ok"));
    sections.push({
      tier: "key-facts",
      title: "✦ Status breakdown",
      lines: factLines,
    });
  }

  // Body — top promises.
  if (json.promises.length > 0) {
    const bodyLines: string[] = [];
    for (const p of json.promises) {
      const statusBadge = badgeForStatus(p.status);
      const kindLabel = kleur.gray(`[${p.patternKind}]`);
      const ageStr = formatAgeShort(p.ageDays);
      const fileSuffix =
        p.files.length === 0
          ? kleur.gray("(no files)")
          : kleur.gray(
              `${p.files[0]}${p.files.length > 1 ? ` (+${p.files.length - 1} more)` : ""}`,
            );
      const fulfil =
        p.status === "kept" && p.fulfilledBy
          ? `  ${kleur.green("✓ kept by " + p.fulfilledBy + (p.fulfilledAt ? " on " + p.fulfilledAt.slice(0, 10) : ""))}`
          : "";
      bodyLines.push(
        `${statusBadge} ${kleur.bold(p.commit)} ${kleur.gray(p.date.slice(0, 10))} ${kleur.cyan(shortAuthor(p.author))} ${kindLabel} ${kleur.gray("· " + ageStr + " old")}`,
      );
      bodyLines.push(`   "${kleur.white(p.excerpt)}"${fulfil}`);
      bodyLines.push(`   ${fileSuffix}`);
      bodyLines.push("");
    }
    const titleStatus = opts.status ? ` — status:${opts.status}` : "";
    sections.push({
      tier: "body",
      title: `◆ Promises${titleStatus} (showing ${json.promises.length} of ${totals.total})`,
      lines: bodyLines,
    });
  }

  // Per-author summary.
  if (report.byAuthor.length > 0 && !opts.authorFilter) {
    const ranked = report.byAuthor.slice(0, 5);
    const authorLines: string[] = [];
    for (const a of ranked) {
      authorLines.push(
        `   ${kleur.cyan(shortAuthor(a.author).padEnd(20))} ${kleur.red(`stale:${String(a.stale).padStart(3)}`)} ${kleur.yellow(`open:${String(a.open).padStart(3)}`)} ${kleur.green(`kept:${String(a.kept).padStart(3)}`)} ${kleur.gray("· total " + a.total)}`,
      );
    }
    sections.push({
      tier: "body",
      title: "◆ Per-author promise debt (worst first)",
      lines: authorLines,
    });
  }

  // Sources / how-to-read.
  const sourceLines: string[] = [];
  if (totals.stale > 0 && json.promises.length > 0) {
    const firstStale = json.promises.find((p) => p.status === "stale");
    if (firstStale) {
      sourceLines.push(
        `${kleur.cyan("$")} ${kleur.bold(`mneme why ${firstStale.commit}`)}`,
      );
      sourceLines.push(
        `   ${kleur.gray("Read the original WHY behind that promise.")}`,
      );
    }
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold("mneme promise --status stale")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("List only the promises that look unfulfilled in our window.")}`,
    );
  } else if (totals.total === 0) {
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold("mneme promise --status kept")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Confirm there really are zero promises in any state.")}`,
    );
  } else {
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold("mneme promise --json")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Pipe the ledger into your tracker.")}`,
    );
  }

  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(
      `${kleur.gray("📘 How to read:")} ${kleur.bold("a 'promise'")} ${kleur.gray("is any commit/PR text that matches:")} ${kleur.cyan("TODO:/FIXME:/HACK:/XXX:/FOLLOWUP:")} ${kleur.gray("·")} ${kleur.cyan("\"I'll fix\"")} ${kleur.gray("·")} ${kleur.cyan("\"in a follow-up\"")} ${kleur.gray("·")} ${kleur.cyan("\"plan to ...\"")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Status:")} ${kleur.bold("kept")} ${kleur.gray("= a later commit on a shared file mentioned the same scope or a fix/refactor keyword within 365 days.")}`,
    );
    sourceLines.push(
      `   ${kleur.bold("open")} ${kleur.gray("= recent (≤ 90 days) and not yet matched.")} ${kleur.bold("stale")} ${kleur.gray("= ≥ 90 days unfulfilled in our window.")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Limits:")} ${kleur.gray("\"I'll fix\" might be ironic; a fulfilment commit may use different language.")} ${kleur.gray("Treat this as a")} ${kleur.bold("starting list")}${kleur.gray(", not a verdict.")}`,
    );
  }
  sections.push({ tier: "sources", title: "→ Try next", lines: sourceLines });

  ui.banner();
  process.stdout.write(
    iris.render({
      headline,
      sections,
      verbose: opts.verbose,
    }) + "\n",
  );

  try {
    recordCommandRun(opts.rootPath, "promise");
  } catch {
    /* best-effort */
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

function shortAuthor(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return email.slice(0, at);
}

function badgeForStatus(s: people.PromiseStatus): string {
  if (s === "stale") return kleur.red("[STALE]");
  if (s === "open") return kleur.yellow("[OPEN ]");
  return kleur.green("[KEPT ]");
}

function meterRow(
  label: string,
  n: number,
  max: number,
  level: "ok" | "warn" | "high",
): string {
  const width = 14;
  const v = max > 0 ? n / max : 0;
  const filled = Math.round(v * width);
  const empty = width - filled;
  const bar = "█".repeat(filled);
  const rest = kleur.gray("░".repeat(empty));
  const paint =
    level === "ok"
      ? (s: string) => kleur.green(s)
      : level === "warn"
        ? (s: string) => kleur.yellow(s)
        : (s: string) => kleur.red(s);
  return `   ${kleur.bold(label)}  ${paint(bar)}${rest}  ${kleur.bold(String(n).padStart(4))}`;
}

function formatAgeShort(ageDays: number): string {
  if (ageDays < 1) return "<1d";
  if (ageDays < 60) return `${Math.round(ageDays)}d`;
  const months = ageDays / 30.4;
  if (months < 24) return `${months.toFixed(months < 6 ? 1 : 0)}mo`;
  return `${(months / 12).toFixed(1)}y`;
}

function formatAgeMonths(ageDays: number): string {
  const months = ageDays / 30.4;
  if (months < 1) return `${Math.round(ageDays)}d`;
  if (months < 24) return `${Math.round(months)} months`;
  return `${(months / 12).toFixed(1)} years`;
}

function pctOrNa(n: number, total: number): string {
  if (total === 0) return "0";
  return Math.round((n / total) * 100).toString();
}
