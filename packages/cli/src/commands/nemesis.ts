/**
 * `mneme nemesis` — engineering friction detector.
 *
 * The thesis: GitHub shows merges (success). Mneme surfaces friction
 * archaeology — pairs of authors who consistently revert / rewrite
 * each other's work. Useful for team formation:
 * "don't put nemeses on the same sub-team".
 *
 * Defamation guardrail: results are labelled as ENGINEERING friction
 * (style/architecture disagreement), NOT personal conflict.  This is
 * loud in the output and should stay that way.
 *
 * ─── --json shape ─────────────────────────────────────────────────────
 *   See `packages/core/src/people/nemesis.ts` for the canonical contract.
 *   {
 *     "totalEvents": n, "uniquePairs": n, "windowDays": n,
 *     "pairs": [
 *       { "a": "...", "b": "...", "total": n,
 *         "aWroteBRewrote": n, "bWroteARewrote": n,
 *         "topFile": "...", "lastClashAt": "...",
 *         "examples": [ { "shipped": shortHash, "rewrote": shortHash,
 *                         "kind": "revert|overlap|fix-keyword",
 *                         "subject": "...", "filePath": "...",
 *                         "shippedBy": "...", "rewroteBy": "...",
 *                         "atIso": "..." } ]
 *       }
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

export interface NemesisOptions {
  cwd: string;
  topN?: number;
  windowDays?: number;
  authorFilter?: string;
  json?: boolean;
  verbose?: boolean;
}

interface NemesisJsonExample {
  shipped: string;
  rewrote: string;
  kind: "revert" | "overlap" | "fix-keyword";
  subject: string;
  filePath: string;
  shippedBy: string;
  rewroteBy: string;
  atIso: string;
}

interface NemesisJsonPair {
  a: string;
  b: string;
  total: number;
  aWroteBRewrote: number;
  bWroteARewrote: number;
  topFile: string | null;
  lastClashAt: string;
  examples: NemesisJsonExample[];
}

interface NemesisJsonOutput {
  totalEvents: number;
  uniquePairs: number;
  windowDays: number;
  pairs: NemesisJsonPair[];
}

export async function nemesisCommand(opts: NemesisOptions): Promise<number> {
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

  const windowDays = Math.max(1, opts.windowDays ?? 365);
  const topN = Math.max(1, opts.topN ?? 5);

  let report: people.NemesisReport;
  try {
    const cutoffMs = Date.now() - windowDays * 86_400_000;
    const allCommits = util.loadAllCommits(s);
    const inWindow = allCommits.filter(
      (c) => new Date(c.authorDate).getTime() >= cutoffMs,
    );
    report = people.buildNemesisReport(inWindow, {
      windowDays,
      minTotal: 3,
      authorFilter: opts.authorFilter,
      examplesPerPair: 2,
    });
  } finally {
    s.close();
  }

  const json: NemesisJsonOutput = {
    totalEvents: report.totalEvents,
    uniquePairs: report.uniquePairs,
    windowDays,
    pairs: report.pairs.slice(0, topN).map((p) => ({
      a: p.a,
      b: p.b,
      total: p.total,
      aWroteBRewrote: p.aWroteBRewrote,
      bWroteARewrote: p.bWroteARewrote,
      topFile: p.topFile,
      lastClashAt: p.lastClashAt,
      examples: p.examples.map((e) => ({
        shipped: e.shipped.shortHash,
        rewrote: e.rewrote.shortHash,
        kind: e.kind,
        subject: e.rewrote.subject,
        filePath: e.filePath,
        shippedBy: e.shipped.authorEmail.toLowerCase(),
        rewroteBy: e.rewrote.authorEmail.toLowerCase(),
        atIso: e.atIso,
      })),
    })),
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(json, null, 2) + "\n");
    return 0;
  }

  renderNemesis(report, json, { ...opts, windowDays, topN, rootPath: meta.rootPath });
  return 0;
}

function renderNemesis(
  report: people.NemesisReport,
  json: NemesisJsonOutput,
  opts: NemesisOptions & { windowDays: number; topN: number; rootPath: string },
): void {
  const irisState = readIrisState(opts.rootPath);
  const showGuide = shouldShowVerboseGuide(irisState, "nemesis");

  // ─── Headline ────────────────────────────────────────────────────────
  let headline: string;
  if (json.pairs.length === 0) {
    if (report.totalEvents === 0) {
      headline = `⚔ No engineering friction found in the last ${opts.windowDays} days`;
    } else {
      headline = `⚔ ${report.totalEvents} friction event${report.totalEvents === 1 ? "" : "s"} detected, but no pair crossed the 3-event threshold`;
    }
  } else {
    const top = json.pairs[0]!;
    const months = Math.max(1, Math.round(opts.windowDays / 30));
    headline = `⚔ Top friction pair: ${shortAuthor(top.a)} + ${shortAuthor(top.b)} — ${top.total} rewrite${top.total === 1 ? "" : "s"} in ${months} month${months === 1 ? "" : "s"}`;
  }

  // ─── Sections ─────────────────────────────────────────────────────────
  const sections: PyramidSection[] = [];

  // Lede — 1-3 line summary that tells the reader what this means.
  const ledeLines: string[] = [];
  if (json.pairs.length === 0) {
    ledeLines.push(
      `${kleur.green("✓")} ${kleur.gray("Scanned the last")} ${kleur.bold(String(opts.windowDays))} ${kleur.gray("days · no author pair has rewritten each other ≥ 3 times.")}`,
    );
    if (report.totalEvents > 0) {
      ledeLines.push(
        `${kleur.gray("Found")} ${kleur.bold(String(report.totalEvents))} ${kleur.gray("isolated friction event" + (report.totalEvents === 1 ? "" : "s") + " — below the threshold.")}`,
      );
    }
    ledeLines.push(
      `${kleur.gray("Nothing to action — your team is shipping forward, not undoing each other.")}`,
    );
  } else {
    ledeLines.push(
      `${kleur.gray("Pairs found:")} ${kleur.bold(String(report.uniquePairs))} ${kleur.gray("· total events:")} ${kleur.bold(String(report.totalEvents))} ${kleur.gray("· window:")} ${kleur.bold(`${opts.windowDays}d`)}`,
    );
    ledeLines.push(
      `${pill("FRAMING", "low")} ${kleur.gray("This is")} ${kleur.bold("engineering friction")}${kleur.gray(" — style or architecture disagreement, NOT personal conflict.")}`,
    );
  }
  sections.push({ tier: "lede", lines: ledeLines });

  // Body — ranked table of pairs.
  if (json.pairs.length > 0) {
    const bodyLines: string[] = [];
    for (let i = 0; i < json.pairs.length; i++) {
      const p = json.pairs[i]!;
      const rank = `${i + 1}.`.padStart(2);
      bodyLines.push(
        `${kleur.bold(rank)} ${kleur.cyan(shortAuthor(p.a))} ${kleur.gray("⇄")} ${kleur.cyan(shortAuthor(p.b))} ${kleur.gray("·")} ${kleur.bold(String(p.total))} ${kleur.gray("rewrites")} ${kleur.gray("(" + p.aWroteBRewrote + " " + arrowGlyph(p.a, p.b) + " " + p.bWroteARewrote + ")")}`,
      );
      if (p.topFile) {
        bodyLines.push(
          `   ${kleur.gray("most-contested:")} ${kleur.bold(p.topFile)}`,
        );
      }
      bodyLines.push(
        `   ${kleur.gray("last clash:")} ${kleur.bold(p.lastClashAt.slice(0, 10))}`,
      );
      for (const ex of p.examples) {
        const kindBadge = badgeForKind(ex.kind);
        const subj = truncate(ex.subject, 64);
        bodyLines.push(
          `     ${kindBadge} ${kleur.bold(ex.shipped)} ${kleur.gray("→")} ${kleur.bold(ex.rewrote)} ${kleur.gray("· " + ex.filePath)}`,
        );
        bodyLines.push(
          `        ${kleur.gray('"' + subj + '"')}`,
        );
      }
      bodyLines.push("");
    }
    sections.push({
      tier: "body",
      title: `◆ Friction pairs (top ${json.pairs.length})`,
      lines: bodyLines,
    });
  }

  // Sources / how-to-read.
  const sourceLines: string[] = [];
  if (json.pairs.length > 0) {
    const top = json.pairs[0]!;
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold(`mneme nemesis --author ${top.a} --json`)}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Drill into one engineer's friction pairs.")}`,
    );
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold(`mneme why ${top.topFile ?? "<file>"}`)}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Read the WHY behind the contested file.")}`,
    );
  } else {
    sourceLines.push(
      `${kleur.cyan("$")} ${kleur.bold("mneme nemesis --window 730")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Widen the window to 2 years.")}`,
    );
  }

  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(
      `${kleur.gray("📘 How to read:")} ${kleur.bold("rewrite count")} ${kleur.gray("= how many times one author's work was reverted, overlapped, or fix-keyworded by the other.")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("This describes")} ${kleur.bold("engineering friction")}${kleur.gray(" only — disagreement on style, scope, or architecture.")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("It is")} ${kleur.bold("not")} ${kleur.gray("a measure of personal conflict, hostility, or performance.")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Use it for team formation (don't seat nemeses adjacent), code-review pairings, or roadmap clarity — never as evidence in HR conversations.")}`,
    );
    sourceLines.push(
      `   ${kleur.gray("Heuristics:")} ${kleur.cyan("revert")} ${kleur.gray("(strongest) ·")} ${kleur.cyan("overlap")} ${kleur.gray("(≥50% of files match a prior author's commit) ·")} ${kleur.cyan("fix-keyword")} ${kleur.gray("(weakest).")}`,
    );
  }
  sections.push({ tier: "sources", title: "→ Try next", lines: sourceLines });

  ui.banner();
  process.stdout.write(
    iris.render({ headline, sections, verbose: opts.verbose }) + "\n",
  );

  try {
    recordCommandRun(opts.rootPath, "nemesis");
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

function arrowGlyph(_a: string, _b: string): string {
  return "→";
}

function badgeForKind(kind: NemesisJsonExample["kind"]): string {
  if (kind === "revert") return kleur.red("[revert  ]");
  if (kind === "overlap") return kleur.yellow("[overlap ]");
  return kleur.cyan("[keyword ]");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
