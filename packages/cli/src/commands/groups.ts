/**
 * `mneme groups` — discoverability index for the 40+ commands.
 *
 * Customer feedback (v0.36): "หลาย command ผมก็ไม่รู้ว่าใช้ทำอะไร
 * (telepathy? atrophy? passport?)". The flat `mneme --help` listed 30+
 * commands with no thematic structure.
 *
 * Non-breaking design: this command is purely informational. It does NOT
 * change the canonical flat namespace — every command keeps its existing
 * name + MCP wiring. `mneme groups` just renders the catalog *grouped by
 * intent* so a new user can browse.
 *
 * Five groups:
 *   security  — what an attacker would find (vulns, audit, suppress, show, deps)
 *   people    — what GitHub can't see (atrophy, telepathy, influence, etc.)
 *   history   — narrative + archaeology (time-machine, chronicle, palimpsest, why)
 *   memory    — Q&A + retrieval over the codebase (ask, status, doctor, htc-*)
 *   originals — v0.36 world-firsts (karma, repo-mri, cognitive-twin, etc.)
 */
import kleur from "kleur";
import { ui, header, section } from "../ui.js";

interface GroupEntry {
  cmd: string;
  hint: string;
}
interface Group {
  id: string;
  title: string;
  blurb: string;
  entries: GroupEntry[];
}

const GROUPS: Group[] = [
  {
    id: "security",
    title: "🛡  Security",
    blurb: "Find what an attacker would find — code-level + dep-level + claim-drift.",
    entries: [
      { cmd: "forensics vulns",    hint: "scan history for security patterns (Bayesian-filtered, SARIF-ready)" },
      { cmd: "deps audit",         hint: "OSV.dev / CVE / GHSA cross-reference for installed deps" },
      { cmd: "show <id>",          hint: "full one-finding deep-dive (commit + diff + auto-fix)" },
      { cmd: "suppress <id>",      hint: "manage .mneme/suppressions.json — false-positive ignores" },
      { cmd: "audit --certify",    hint: "5-axis trust certificate for AI-driven commits" },
      { cmd: "audit --verify-head",hint: "claim drift — flag 'remove X' commits where X is still in HEAD" },
      { cmd: "guard --install",    hint: "pre-commit hook (anomaly + vuln + secret-redaction)" },
      { cmd: "guardian",           hint: "24/7 self-healing daemon — diagnose + auto-fix safe actions" },
      { cmd: "forensics anomaly",  hint: "insider-threat / credential-compromise detector" },
      { cmd: "adversarial",        hint: "meta-evaluate any AI client against repo memory" },
    ],
  },
  {
    id: "people",
    title: "👥 People analytics",
    blurb: "What GitHub's contributor graph cannot see.",
    entries: [
      { cmd: "atrophy",         hint: "knowledge half-life clock (Ebbinghaus over author×file)" },
      { cmd: "telepathy",       hint: "latent collaboration — pairs whose changes rhyme without co-authoring" },
      { cmd: "influence",       hint: "cultural-alpha ranking — who writes patterns everyone copies" },
      { cmd: "lineage <target>",hint: "semantic ownership of a file/function over time" },
      { cmd: "nemesis",         hint: "engineering-friction pairs (revert/rewrite of each other)" },
      { cmd: "passport [author]",hint:"engineer dossier — DNA + influence + telepathic teammates" },
      { cmd: "dna [author]",    hint: "exportable contributor fingerprint (style/hours/affinity)" },
      { cmd: "bus-factor",      hint: "files where one author owns ≥75% — fragility map" },
      { cmd: "nervous-system",  hint: "the flagship people-analytics dossier (HTML / PDF)" },
      { cmd: "counterfactual <email>", hint: "Bayesian what-if: drop this author + recompute" },
    ],
  },
  {
    id: "history",
    title: "📜 History + archaeology",
    blurb: "Narrative views of git history that git itself doesn't surface.",
    entries: [
      { cmd: "time-machine <file>", hint: "narrate a file's evolution as eras (birth/rewrite/firefight)" },
      { cmd: "chronicle",        hint: "auto-generate a chaptered narrative documentary" },
      { cmd: "drift",            hint: "topical drift — features → refactors → firefights → polish" },
      { cmd: "ghost",            hint: "half-finished features, stale TODOs, born-and-forgotten files" },
      { cmd: "fossil",           hint: "files deleted from HEAD but alive in history" },
      { cmd: "rumor",            hint: "tribal phrases mentioned but never documented" },
      { cmd: "runaway",          hint: "files growing silently across many commits" },
      { cmd: "palimpsest <file>:<line>", hint: "causal chain (commit → incident → cause)" },
      { cmd: "palimpsest --counterfactual <file>:<line>", hint: "what did this single line lock in downstream?" },
      { cmd: "why <target>",     hint: "DDTree-routed best-first search — why does this exist?" },
      { cmd: "blast <commit>",   hint: "predict incidents likely to follow shipping a commit" },
      { cmd: "premortem <intent>",hint:"regret risk grounded in your repo's failure history" },
    ],
  },
  {
    id: "memory",
    title: "📦 Memory layer (Q&A + retrieval)",
    blurb: "The core memory primitives — what AI tools call through MCP.",
    entries: [
      { cmd: "ask <q>",     hint: "natural-language search over commits + PRs (with citations)" },
      { cmd: "status",      hint: "memory + repo health snapshot" },
      { cmd: "doctor",      hint: "probe environment + recommend the best embedder" },
      { cmd: "init",        hint: "initialise Mneme in the current repo" },
      { cmd: "index",       hint: "(re)index commits + PRs + embeddings" },
      { cmd: "htc-build",   hint: "compress 50k commits into LLM-ready cache" },
      { cmd: "htc-stats",   hint: "inspect HTC coverage + compression ratio" },
      { cmd: "watch",       hint: "24/7 daemon: re-index on commit, calibrate hourly" },
      { cmd: "mcp",         hint: "run as an MCP server (any AI tool that supports MCP)" },
      { cmd: "do <query>",  hint: "smart dispatcher — describe intent, Mneme picks tools" },
      { cmd: "genius <q>",  hint: "LLM-orchestrated multi-step agent over Mneme commands" },
    ],
  },
  {
    id: "originals",
    title: "🆕 The Originals (v0.36 world-firsts)",
    blurb: "Five capabilities that no maintained, open-source, local-first tool ships today.",
    entries: [
      { cmd: "karma",                   hint: "TODO debt as accumulating per-author flow ledger" },
      { cmd: "repo-mri",                hint: "20-axis health diagnostic with z-scores vs typical OSS" },
      { cmd: "palimpsest --counterfactual", hint: "forward-walk + heuristic flipped-line sketches" },
      { cmd: "cognitive-twin <email>",  hint: "stylometric voice fingerprint + --rewrite '<subject>'" },
      { cmd: "conscience --dual-jury",  hint: "prosecution + defense + verdict from real history" },
    ],
  },
];

export interface GroupsOptions {
  /** Filter to a single group id (security / people / history / memory / originals). */
  only?: string;
  json?: boolean;
}

export async function groupsCommand(opts: GroupsOptions): Promise<number> {
  const wanted = opts.only ? opts.only.toLowerCase() : undefined;
  const groups = wanted ? GROUPS.filter((g) => g.id === wanted) : GROUPS;
  if (wanted && groups.length === 0) {
    ui.error(`Unknown group: ${opts.only}. Try one of: ${GROUPS.map((g) => g.id).join(", ")}.`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ groups }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(
    header(
      "🗂",
      "Mneme — command groups",
      "the 40+ commands grouped by intent (every command keeps its flat name; this is just for browsing)",
      "Pick a group, then run any command's --help for full options.",
    ) + "\n",
  );

  for (const g of groups) {
    process.stdout.write("\n" + section(g.title, g.blurb) + "\n\n");
    const widest = Math.max(...g.entries.map((e) => e.cmd.length));
    for (const e of g.entries) {
      process.stdout.write(
        `    ${kleur.cyan(`mneme ${e.cmd}`.padEnd(widest + 7))}  ${kleur.gray(e.hint)}\n`,
      );
    }
  }
  process.stdout.write(
    "\n" +
      kleur.gray(
        "  Run `mneme groups --only <id>` to focus one group, or `mneme <cmd> --help` for any command.\n",
      ),
  );

  return 0;
}
