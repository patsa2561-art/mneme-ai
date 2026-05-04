/**
 * Stub CLI commands for the rest of the WILD ideas. Each prints a thoughtful
 * design overview so users see the roadmap shape — not a "coming soon" lorem.
 *
 *   • mneme oracle      — historical risk analysis on a snippet
 *   • mneme conscience  — review co-pilot from history
 *   • mneme genome      — codebase fingerprint + ancestry
 *   • mneme dialogue    — conversational chat over your repo
 *   • mneme tribute     — "your codebase as a movie"
 */
import kleur from "kleur";
import { ui } from "../ui.js";

export async function oracleCommand(): Promise<number> {
  return printPlan(
    "oracle",
    "Historical risk analysis on a code snippet",
    [
      "Paste any function or commit diff. Mneme finds:",
      "  • Past incidents in this codebase rooted in similar patterns",
      "  • Commits whose diff fingerprint matches and what they triggered",
      "  • A risk score for shipping this exact change",
      "",
      "Example output:",
      `  ${kleur.gray("This `db.query(${user_input})` pattern caused SQLi-2023-04.")}`,
      `  ${kleur.gray("Three other PRs that shipped this pattern were reverted within 24h.")}`,
      "",
      "Implementation requires:",
      "  • An incident corpus (run `mneme correlate --source sentry` first)",
      "  • Pattern fingerprinting (AST-shape hashes — uses tree-sitter)",
      "  • Risk scoring model (regression on your own history)",
    ],
    "WILD #4 · pessimism 3/5 · 2-week sprint when prioritized",
  );
}

export async function conscienceCommand(): Promise<number> {
  return printPlan(
    "conscience",
    "PR review co-pilot powered by your repo's own history",
    [
      "When reviewing a PR, Mneme finds the historically most-similar PRs and",
      "reports their fate. The reviewer sees:",
      "",
      `  ${kleur.gray("This PR changes 4 of the same files as PR #98 (reverted within 48h")}`,
      `  ${kleur.gray("after SENTRY-1287). 87% file overlap. Recommend caution.")}`,
      "",
      "Two surfaces planned:",
      "  • mneme conscience <pr-url>      — CLI",
      "  • GitHub Action check            — runs on every PR open",
      "  • Cursor side-panel              — when MCP exposes it",
      "",
      "Hard part: the similarity must be more than file-overlap. Phase 2",
      "embeddings on entity-level diffs are the right substrate.",
    ],
    "WILD #6 · pessimism 2/5 · ships after Phase 2 multi-language parsing",
  );
}

export async function genomeCommand(): Promise<number> {
  return printPlan(
    "genome",
    "Codebase fingerprint + ancestry detection",
    [
      "A cryptographic signature derived from code + history. Detects:",
      "  • Forks of public repos (M&A due diligence)",
      "  • Plagiarism / license violations",
      "  • Abandoned ancestor branches",
      "",
      "Example output:",
      `  ${kleur.gray("This proprietary repo shares 87% genome with public repo `acme/foo`.")}`,
      `  ${kleur.gray("Likely forked at commit a1b2c3d on 2023-09-12.")}`,
      "",
      "How: locality-sensitive hash of entity embeddings + commit-graph shape.",
      "Two genomes are compared in O(genome_size), not O(repo_size).",
      "",
      "Privacy: only the genome hash leaves the machine. Source code never does.",
    ],
    "WILD #9 · pessimism 4/5 · needs Phase 2 entity embeddings + LSH",
  );
}

export async function dialogueCommand(): Promise<number> {
  return printPlan(
    "dialogue",
    "Conversational memory — multi-turn chat over your repo",
    [
      "A persistent REPL that holds state across queries. Existing `mneme ask`",
      "is one-shot; this one remembers context.",
      "",
      "Example session:",
      `  ${kleur.cyan(">")} what broke last quarter?`,
      `    3 incidents: SENTRY-1287, INC-2025-04, GH-Actions-failure-03`,
      `  ${kleur.cyan(">")} show me the rollbacks`,
      `    2 reverts: PR #501, PR #523. Both within 36h of incident.`,
      `  ${kleur.cyan(">")} who reviewed those?`,
      `    alice@ approved both. Consider asking her about Q4 patterns.`,
      "",
      "Implementation: thin wrapper over MCP with conversation memory.",
      "The hard part is UX — when to forget, what to summarize, how to cite.",
    ],
    "WILD #11 · pessimism 2/5 · 1-week sprint when Phase 3 is mature",
  );
}

export async function tributeCommand(): Promise<number> {
  return printPlan(
    "tribute",
    "Your codebase as a 60-second movie",
    [
      "Auto-generated D3 animation of a repo's life — designed to be shared on",
      "Twitter when an engineer leaves, when a project crosses 5 years, when a",
      "startup gets acquired.",
      "",
      "Frames:",
      `  ${kleur.gray("• initial commit          (a single dot)")}`,
      `  ${kleur.gray("• first module emerges    (cluster)")}`,
      `  ${kleur.gray("• first incident          (red flash)")}`,
      `  ${kleur.gray("• big redesign            (cluster reorganizes)")}`,
      `  ${kleur.gray("• bus-factor moment       (single contributor leaves)")}`,
      `  ${kleur.gray("• current state           (full graph)")}`,
      "",
      "Output: an MP4 / GIF / HTML embed. Free marketing for Mneme; real",
      "emotional value for the team it's about.",
      "",
      "Builds on the Phase 4 graph viz — already shipped as `mneme web`.",
    ],
    "WILD #15 · pessimism 3/5 · ships as `mneme web --tribute --out movie.mp4`",
  );
}

function printPlan(name: string, tagline: string, body: string[], footer: string): Promise<number> {
  ui.banner();
  process.stdout.write(`${kleur.bold().magenta(`mneme ${name}`)}  ${kleur.gray("(planned)")}\n`);
  process.stdout.write(`${kleur.italic().cyan(tagline)}\n\n`);
  for (const line of body) process.stdout.write(`  ${line}\n`);
  process.stdout.write("\n");
  process.stdout.write(`  ${kleur.gray(footer)}\n`);
  process.stdout.write(
    `  ${kleur.gray("See WILD_IDEAS.md for the full catalog.")}\n`,
  );
  return Promise.resolve(0);
}
