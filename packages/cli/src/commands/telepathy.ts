/**
 * `mneme telepathy` — latent collaboration network.
 *
 * Surfaces pairs of authors who never co-author a commit but whose work
 * is behaviorally coupled (Alice edits one part of a topic; Bob edits
 * the other within hours; pattern repeats).
 *
 * --json shape (stable):
 *   {
 *     "pairs": Array<{
 *       "authorA": { "name": string, "email": string },
 *       "authorB": { "name": string, "email": string },
 *       "events": number,
 *       "opportunities": number,
 *       "score": number,                // 0..3-ish (events/opportunities × log(1+events))
 *       "topTopic": { "topic": string, "count": number },
 *       "recentEvents": Array<{
 *         "earlierHash": string, "laterHash": string,
 *         "earlierAt": string,  "laterAt": string,
 *         "gapHours": number, "topic": string
 *       }>,
 *       "lastSeenAt": string
 *     }>,
 *     "stats": {
 *       "authorCount": number, "commitCount": number,
 *       "pairsEvaluated": number, "windowHours": number
 *     }
 *   }
 */

import kleur from "kleur";
import { git, store, people } from "@mneme-ai/core";
import { dbPath } from "../paths.js";
import { ui, header, emptyState, pill } from "../ui.js";
import {
  iris,
  readIrisState,
  recordCommandRun,
  shouldShowVerboseGuide,
  type PyramidSection,
} from "../iris/index.js";

const COMMAND_ID = "telepathy";

export interface TelepathyOptions {
  cwd: string;
  windowHours?: number;
  topN?: number;
  authorEmail?: string;
  minEvents?: number;
  json?: boolean;
}

export async function telepathyCommand(opts: TelepathyOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) {
    s.close();
    ui.error("Memory is empty. Run `mneme index` first.");
    return 1;
  }

  let result: people.TelepathyResult;
  try {
    result = people.telepathy(s, {
      windowHours: opts.windowHours,
      topN: opts.topN,
      authorEmail: opts.authorEmail,
      minEvents: opts.minEvents,
    });
  } finally {
    s.close();
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  return renderTelepathy(result, opts, meta.rootPath);
}

function renderTelepathy(
  result: people.TelepathyResult,
  opts: TelepathyOptions,
  repoRoot: string,
): number {
  const { pairs, stats } = result;
  const minEvents = opts.minEvents ?? 3;

  // ─── Adaptive verbosity ─────────────────────────────────────────────
  const irisState = (() => {
    try {
      return readIrisState(repoRoot);
    } catch {
      return null;
    }
  })();
  const showGuide = irisState ? shouldShowVerboseGuide(irisState, COMMAND_ID) : true;

  // ─── Headline ────────────────────────────────────────────────────────
  let headline: string;
  if (pairs.length === 0) {
    headline = "📰 Telepathy · no invisible teams found";
  } else if (pairs.length === 1) {
    const p = pairs[0]!;
    headline = `📰 1 invisible team — ${shortName(p.authorA)} + ${shortName(p.authorB)}`;
  } else {
    const top = pairs[0]!;
    headline = `📰 ${pairs.length} invisible teams found — ${shortName(top.authorA)} + ${shortName(top.authorB)} lead the pack`;
  }

  // ─── Honest disclaimer if data is sparse ────────────────────────────
  const dataPills: string[] = [];
  if (stats.authorCount < 2) {
    dataPills.push(pill("HEADS UP", "warn") + " " + kleur.gray("only 1 author in repo — telepathy needs ≥2 distinct authors to find pairs."));
  } else if (stats.commitCount < 50) {
    dataPills.push(pill("HEADS UP", "warn") + " " + kleur.gray(`only ${stats.commitCount} commits — telepathy works best on repos with 100+ commits and steady activity.`));
  }

  // ─── Lede — top pair plain-English ──────────────────────────────────
  const ledeLines: string[] = [];
  if (pairs.length > 0) {
    const top = pairs[0]!;
    const ratio = top.opportunities > 0 ? Math.round((top.events / top.opportunities) * 100) : 0;
    const strength = strengthLabel(top.score);
    ledeLines.push(
      `  ${kleur.bold(top.authorA.name)} ${kleur.gray("<" + top.authorA.email + ">")}  ${kleur.gray("⟷")}  ${kleur.bold(top.authorB.name)} ${kleur.gray("<" + top.authorB.email + ">")}`,
    );
    ledeLines.push(
      `  ${kleur.gray("score:")} ${kleur.bold(top.score.toFixed(2))} ${kleur.gray(`(${strength})`)}  ${kleur.gray("·")}  ${kleur.bold(String(top.events))} ${kleur.gray("events out of")} ${kleur.bold(String(top.opportunities))} ${kleur.gray(`window-overlaps (${ratio}% rhyme rate)`)}`,
    );
    ledeLines.push(
      `  ${kleur.gray("top shared topic:")} ${kleur.cyan(top.topTopic.topic)} ${kleur.gray(`(${top.topTopic.count} of ${top.events} events)`)}`,
    );
    if (top.lastSeenAt) {
      ledeLines.push(`  ${kleur.gray("last seen:")} ${formatDate(top.lastSeenAt)}`);
    }
  } else {
    ledeLines.push(`  ${kleur.gray("Scanned")} ${kleur.bold(String(stats.commitCount))} ${kleur.gray(`commits across ${stats.authorCount} authors with a ${stats.windowHours}h window.`)}`);
    if (stats.pairsEvaluated > 0) {
      ledeLines.push(`  ${kleur.gray(`Evaluated ${stats.pairsEvaluated} pair(s) — none cleared the ≥${minEvents}-events threshold.`)}`);
    }
  }

  // ─── Body — ranked table of pairs ───────────────────────────────────
  const bodyLines: string[] = [];
  if (pairs.length > 1) {
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i]!;
      const rankStr = String(i + 1).padStart(2, " ");
      const strength = strengthLabel(p.score);
      bodyLines.push(
        `    ${kleur.gray(rankStr + ".")}  ${kleur.bold(shortName(p.authorA))} ${kleur.gray("+")} ${kleur.bold(shortName(p.authorB))}  ${kleur.gray(`score ${p.score.toFixed(2)} (${strength})  ·  ${p.events} events  ·  topic ${p.topTopic.topic}`)}`,
      );
      if (p.lastSeenAt) {
        bodyLines.push(`        ${kleur.gray("last seen:")} ${kleur.gray(formatDate(p.lastSeenAt))}`);
      }
    }
  }

  // ─── Sources / "→ Try next" ─────────────────────────────────────────
  const sourceLines: string[] = [];
  if (pairs.length > 0) {
    const top = pairs[0]!;
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold(`mneme telepathy --author ${top.authorA.email}`)} ${kleur.gray("(every invisible team this person is on)")}`,
    );
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold("mneme network")} ${kleur.gray("(the visible side — explicit collaboration graph)")}`,
    );
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold("mneme bus-factor")} ${kleur.gray("(which files depend on a single owner — pair them with their telepath)")}`,
    );
  } else {
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold("mneme telepathy --window 168 --min-events 1")} ${kleur.gray("(loosen — wider 1-week window, surface borderline pairs)")}`,
    );
    sourceLines.push(
      `    ${kleur.cyan("$")} ${kleur.bold("mneme network")} ${kleur.gray("(see the explicit collaboration graph — who actually co-authors)")}`,
    );
  }

  // ─── How-to-read guide (adaptive) ───────────────────────────────────
  if (showGuide) {
    sourceLines.push("");
    sourceLines.push(
      `    ${kleur.gray("📘 How to read:")} ${kleur.bold("telepathy")} ${kleur.gray(`= two authors who never co-author a commit, but whose work rhymes — within ${stats.windowHours}h, on the same dir, repeatedly.`)}`,
    );
    sourceLines.push(
      `    ${kleur.gray("•")} ${kleur.bold("score")} ${kleur.gray("blends rhyme rate × event count. ")}${kleur.green(">1.0")} ${kleur.gray("= strong latent team. ")}${kleur.yellow("0.5–1.0")} ${kleur.gray("= regular rhyme. ")}${kleur.gray("<0.5 = occasional.")}`,
    );
    sourceLines.push(
      `    ${kleur.gray("•")} ${kleur.bold("events")} ${kleur.gray("count overlapping commits on a shared topic — ≥")}${kleur.bold(String(minEvents))} ${kleur.gray("filters noise.")}`,
    );
    sourceLines.push(
      `    ${kleur.gray("• Co-authored commits are EXCLUDED — that would be EXPLICIT collaboration, not telepathy.")}`,
    );
  }

  // ─── Compose ────────────────────────────────────────────────────────
  const sections: PyramidSection[] = [];
  if (dataPills.length > 0) {
    sections.push({ tier: "lede", title: undefined, lines: dataPills.map((l) => `  ${l}`) });
  }
  sections.push({
    tier: "lede",
    title: pairs.length > 0 ? "✦ Top pair" : "✦ Scan summary",
    lines: ledeLines,
  });
  if (bodyLines.length > 0) {
    sections.push({
      tier: "body",
      title: `◆ Ranked invisible teams (top ${pairs.length})`,
      lines: bodyLines,
    });
  }
  if (sourceLines.length > 0) {
    sections.push({ tier: "sources", title: "→ Try next", lines: sourceLines });
  }

  ui.banner();
  if (pairs.length === 0 && stats.authorCount >= 2) {
    process.stdout.write(
      header(
        "📰",
        "Telepathy — invisible collaboration network",
        `0 invisible teams · scanned ${stats.commitCount} commits · ${stats.authorCount} authors`,
        `Find pairs that work the same area silently — useful before re-orgs and pair-programming assignments.`,
      ) + "\n\n",
    );
    process.stdout.write(
      emptyState(
        "No telepathic pairs cleared the threshold.",
        [
          `Loosen with --window 168 (a full week) or --min-events 1 to see borderline pairs.`,
          `Run \`mneme network\` to see the explicit collaboration graph instead.`,
        ],
      ),
    );
    return 0;
  }
  process.stdout.write(iris.render({ headline, sections }) + "\n");

  // Best-effort: increment run count for adaptive verbosity.
  try {
    recordCommandRun(repoRoot, COMMAND_ID);
  } catch {
    /* best effort */
  }
  return 0;
}

// ─── helpers ──────────────────────────────────────────────────────────

function shortName(a: { name: string; email: string }): string {
  if (a.name && a.name.trim().length > 0) return a.name;
  return a.email;
}

function strengthLabel(score: number): string {
  if (score >= 1.0) return "strong latent team";
  if (score >= 0.5) return "regular rhyme";
  if (score >= 0.2) return "occasional overlap";
  return "borderline";
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
