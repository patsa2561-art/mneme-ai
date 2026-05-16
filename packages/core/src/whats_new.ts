/**
 * Mneme What's New -- proactively teach the AI agent about every new
 * feature in the running version.
 *
 * Two surfaces:
 *   1. Programmatic: parse CHANGELOG.md sections to produce a structured
 *      digest the AI can quote to the user.
 *   2. Curated highlights: a hand-picked list of "you should KNOW about
 *      these" features per minor/patch release. Lives in this file so
 *      we control the wording (CHANGELOG is for engineers; this is for
 *      "tell my user something useful in 2 sentences").
 *
 * The AI calls `mneme.whats_new` automatically on every welcome (per
 * AGENT_INSTRUCTIONS.md) and surfaces the highlights to the user.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface WhatsNewHighlight {
  /** Semver of the release. */
  version: string;
  /** ISO date or YYYY-MM-DD. */
  date: string;
  /** Headline (≤ 80 chars). */
  headline: string;
  /** 2-3 sentence body, written FOR a non-technical user. ASCII-safe. */
  body: string;
  /** Suggested follow-up action the AI should offer. */
  suggestedAction?: string;
  /** Tags for client-side filtering (e.g., "antivirus", "auto-update"). */
  tags: string[];
}

/** Curated highlights. Newest first. Add an entry per release that ships
 *  user-visible behavior. Keep `body` plain English so the AI can quote
 *  it verbatim to non-engineers. */
export const HIGHLIGHTS: WhatsNewHighlight[] = [
  {
    version: "2.19.1",
    date: "2026-05-16",
    headline: "REINCARNATION RITUAL -- release gate that proves the npm install actually works",
    body:
      "Built `scripts/reincarnation-ritual.mjs`: a discrete-step release gate that npm-installs Mneme into a clean tmp dir, runs every headline command (mneme tools / whats-new / doctor), measures the count of v2.18+v2.19 MCP tools per family, verifies dist/index.js + dist/commands/init.js + bin/mneme.js all exist, and blocks publish on any failure. Caught (and fixed) a stale whats-new curator + the missing dist-file check class. The new rule: tests-pass-in-CI is NOT enough; a real npm install in a clean dir must pass too. Future releases run this BEFORE npm publish.",
    suggestedAction: "Tell the AI: 'before publishing, run the reincarnation ritual'. The AI will run `node scripts/reincarnation-ritual.mjs` and refuse to publish if any check fails.",
    tags: ["release-gate", "ritual", "honesty", "no-more-bugs"],
  },
  {
    version: "2.19.0",
    date: "2026-05-16",
    headline: "VENDOR-SYNCRETIC PENTAD -- every AI vendor wins (vendor-agnostic)",
    body:
      "5 vendor-agnostic primitives + 9 MCP tools, works with Claude / ChatGPT / Gemini / Cursor / Copilot / Codex / Grok / Perplexity / Llama / Mistral / Qwen / DeepSeek. 🛐 CONFESSIONAL -- pre-merge peer audit (any vendor's diff graded vs peer panel). 👻 VENDOR GHOST -- local stylometric distillation; jailbreaks vendor lock-in; honest no-match. 🎯 TRINITY VOTE -- consensus + LAZY tiebreaker; ~85% tiebreaker cost saved. 💰 INSURANCE MARKET -- Lloyd's of AI; per-vendor premium multiplier clamped [0.5, 3.0]. 📡 VENDOR BOOMERANG -- cross-vendor activity ledger; the brain no single vendor has. AURELIAN SHIP for all 5. +56 tests.",
    suggestedAction: "Tell the AI: 'audit this Grok diff before I merge' or 'what would Claude say' or 'quote Grok's insurance premium'. The AI calls the right MCP tool.",
    tags: ["vendor-syncretic", "pentad", "confessional", "ghost", "trinity", "insurance", "boomerang"],
  },
  {
    version: "2.18.0",
    date: "2026-05-15",
    headline: "REVENUE-PRIMITIVE PENTAD -- ARENA + BADGE + ORACLE + NEXUS (Reverse-MCP)",
    body:
      "4 modules + 12 MCP tools + AURELIAN SHIP. 🏆 ARENA -- public AI vendor showdown; HMAC-signed match verdicts + daily leaderboard. 🛡 VERIFIED BADGE -- 'Energy Star of AI'; 5 tiers PLATINUM→FAIL; 90-day cert; $500-$50K/yr. 🔬 ORACLE LIABILITY -- signed AI insurance; refuses if risk≥0.5 or SOUL=BLOCK; 5 coverage tiers $1K-$10M/incident. 📡 NEXUS PROACTIVE -- FIRST Reverse-MCP primitive; server-side queue + ACK ledger; closes the stale-claim hallucination class. Honest scope: real WebSocket push violates MCP contract; built closest legal equivalent.",
    suggestedAction: "Tell the AI: 'run ARENA on these vendor responses', 'issue Claude a Verified Badge', 'quote me a team-tier insurance certificate', or 'subscribe NEXUS to this fact'.",
    tags: ["revenue-primitive", "arena", "badge", "oracle", "nexus", "reverse-mcp"],
  },
  {
    version: "2.17.1",
    date: "2026-05-15",
    headline: "Landing Linear/Stripe redesign + Dashboard TH/EN + Cosmic JACKPOT community leaderboard",
    body:
      "Landing page rebuilt in Linear/Stripe style (orange→pink gradient, near-black bg, Inter font). Dashboard gets EN/TH toggle. Cosmic JACKPOT leaderboard endpoint live at cosmic.mneme-ai.space -- opt-in publish your daily JACKPOT headline, see the community board. 15s tweet-friendly video script in docs/LAUNCH_VIDEO_15S.md.",
    suggestedAction: "Tell the AI: 'publish my JACKPOT to the community board' to share today's insight.",
    tags: ["landing", "redesign", "jackpot-community", "video-script"],
  },
  {
    version: "2.17.0",
    date: "2026-05-15",
    headline: "MNEME JACKPOT -- daily personalised lottery-jackpot insight engine",
    body:
      "Open Mneme each morning, draw ONE personalised insight from your repo + Mneme corpora that feels like winning the lottery. Deterministic seed (same day = same draw). 8 insight kinds (scar_drift / vendor_arb / stale_observation / hive_gold / replica_streak / dead_dep / soul_gap / test_gap). HMAC-signed for shareable bragging.",
    suggestedAction: "Tell the AI: 'what's my Mneme jackpot today?' (first thing each morning).",
    tags: ["jackpot", "daily-ritual", "personalised"],
  },
  {
    version: "2.16.0",
    date: "2026-05-15",
    headline: "REVOLUTIONARY PENTAD -- PERSONA + ANTI-COLLUSION + ALPHA + PUBLIC AUDIT + LIVING MODEL + OBELISK",
    body:
      "🧬 PERSONA -- package your decision history + soul rules into a portable HMAC-signed bundle teammates subscribe to. 🕵 ANTI-COLLUSION -- behavioural fraud detection for AI agent chains. 📈 ALPHA -- HONEST financial-AI layer (refuses to promise prediction accuracy; ships anti-hallucination instead). 🌐 PUBLIC AUDIT -- AURELIAN-grades the whole npm. 🧬 LIVING MODEL -- anti-entropy + causal inference primitives for federated inference. 🪨 OBELISK -- federated AI trust graph (W3C-style).",
    suggestedAction: "Tell the AI: 'export my persona for the team' or 'audit this npm package's quality'.",
    tags: ["revolutionary-pentad", "persona", "anti-collusion", "alpha", "obelisk"],
  },
  {
    version: "2.15.1",
    date: "2026-05-15",
    headline: "BUG PROPHET (5th hypercar) -- predict regression risk BEFORE shipping",
    body:
      "MNEME BUG PROPHET fuses 5 distinct evidence sources into a 0-1 regression risk score: PROJECT SOUL scars (paid-for lessons), REPLICA bad outcomes (your past decisions), HIVE pattern history (cross-user outcome rates), BOUNTY vendor trust (per-vendor falseRate), and a complexity heuristic. Pure inference, no LLM call -- ~5ms. Returns HMAC-signed verdict + targeted mitigations. The fifth hypercar that completes the v2.15 pentad. Plus: landing page got a TH/EN toggle + HYPERCAR section + prominent demo CTA. Plus: AI-agent install mandate now reinforced at top of AI_AGENT_CONTRACT.md (user never types CLI commands; AI executes everything).",
    suggestedAction: "Tell the AI: 'check this change with bug prophet before applying'. The AI will call mneme.bug_prophet.prophesy and refuse high-risk changes.",
    tags: ["bug-prophet", "pre-deploy", "regression-prediction", "hypercar"],
  },
  {
    version: "2.15.0",
    date: "2026-05-15",
    headline: "HYPERCAR PENTAD: 4 distribution wedges that make Mneme indispensable",
    body:
      "MNEME GENESIS reads your repo, detects the stack + frameworks + CI + age, and seeds protective starter rules in <60 seconds (no config questions asked). MNEME HIVE is the privacy-preserving pattern marketplace: every Mneme user contributes hashed patterns + outcomes; you query the hive instead of asking AI to invent a solution. MNEME VIBE is the beginner-friendly safety wrapper for vibe-coders (Bolt / Lovable / Replit / v0) -- runs every gate after every AI change, translates findings into plain English. MNEME ARBITRAGE is the meta-AI router: pick the cheapest vendor that meets your quality bar, learning from BOUNTY's measured per-vendor falseRate over time. 10 new MCP tools.",
    suggestedAction: "Run `npx mneme genesis` in any repo to cold-bootstrap. Run `mneme vibe check` after every AI change. Run `mneme arbitrage choose --task code_review` before sending a prompt.",
    tags: ["hypercar", "distribution", "vibe-coder", "marketplace", "arbitrage"],
  },
  {
    version: "2.14.0",
    date: "2026-05-15",
    headline: "5 nuclear-useful modules every Mneme user wins from",
    body:
      "PROJECT SOUL signs your project's hard-won values; AI changes are gated against them (HMAC-signed, tamper-evident). MNEMOSYNE BOUNTY records every AI claim and produces a vendor trust leaderboard ranked by measured falseRate. MNEME REPLICA is a non-LLM oracle distilled from your past decisions -- answers in ~100ms, survives any vendor outage. KILL SWITCH PROTOCOL gives CISOs an AI off-switch + 9-pattern DLP + court-admissible audit chain. INFRA AS AI turns each host into an AI agent with HMAC-signed memory and P2P gossip -- Datadog functionality without a central server.",
    suggestedAction: "Run `mneme upgrade --force` to install v2.14, then `mneme soul init` to gate your project.",
    tags: ["pentad", "killer-features", "gate", "ledger", "oracle", "compliance", "infra"],
  },
  {
    version: "2.13.1",
    date: "2026-05-15",
    headline: "Zero-config cosmic -- cosmic.mneme-ai.space is the new default",
    body:
      "mintSession() now needs no serverUrl -- defaults to the shared cosmic.mneme-ai.space (Cloudflare-edge, Let's Encrypt). New mintDefaultChoirSession() returns a 2-seat CELESTIAL CHOIR with the brand domain primary + nip.io fallback. Instant N-1 fault tolerance with zero provisioning.",
    suggestedAction: "Just call `mneme.cosmic.mint` with no args -- works zero-config.",
    tags: ["cosmic", "default-server"],
  },
  {
    version: "2.13.0",
    date: "2026-05-15",
    headline: "AURELIAN AUDITOR + 8 measurable cosmic upgrades",
    body:
      "Every cosmic v2.13 change shipped under the AURELIAN AUDITOR -- an HMAC-signed scorecard that grades features on delta / world-class / wisdom / wildness axes (≥80 to SHIP, 60-79 = LOOP_BACK, <60 = REJECT). The 8 upgrades: JSON Patch incremental publish (10x payload reduction); ETag conditional read (95%+ poll bandwidth saved); Brotli edge compression; NONCE-WINDOW HMAC (replay defense); inbox per-fingerprint rate-limit; DEAD MAN'S HAND auto-rescue zombie sessions to dpaste; CELESTIAL CHOIR multi-server quorum; ECHO-FROM-COMMITS HMAC-signed git note for offline recovery.",
    suggestedAction: "Use `mneme.cosmic.audit` to grade your own changes the same way.",
    tags: ["cosmic", "perf", "security", "fallback", "auditor"],
  },
  {
    version: "1.24.1",
    date: "2026-05-09",
    headline: "AI agents now learn what's new automatically",
    body:
      "Every welcome call returns a What's New digest of recent features. The AI surfaces them to you without you having to ask. Plus an idle nudge: if your AI tool sits quietly with unread Mneme messages, the MCP server pings the client.",
    suggestedAction: "Ask the AI: 'what's new in Mneme?'",
    tags: ["ux", "auto-discovery"],
  },
  {
    version: "1.24.0",
    date: "2026-05-09",
    headline: "Mneme Antivirus -- the world's first hallucination antiviral",
    body:
      "8 hallucination strains catalogued (phantom commits, ghost functions, fake packages, invented authors, etc.). Each strain has a real assay vaccine that shells out to git/npm/fs to confirm infection. HMAC-signed efficacy benchmarks (no inflated scores). Vaccines inherit Lamarckian-style through MneMeiosis chromosomes -- next session boots already immunized.",
    suggestedAction: "Try: `mneme antivirus scan \"<your draft>\"` or open the Antivirus Lab tab on the dashboard.",
    tags: ["antivirus", "vaccine-lab", "lamarckian"],
  },
  {
    version: "1.23.5",
    date: "2026-05-09",
    headline: "Caretaker Bot + AUTO-ACTION protocol",
    body:
      "Mneme acts as the AI tool's persistent context provider. When the AI sees an [AUTO-ACTION] mandate (version drift, lockfile drift, etc.) Mneme -- via the v1.41 pulse pre-executor -- runs the safe ones automatically before the AI's turn even starts. Self-modifying ones are queued for the daemon's safe window. Plus a Caretaker Bot pass every 15 minutes inside the nucleus daemon.",
    suggestedAction: "No action needed -- it works automatically.",
    tags: ["auto-action", "caretaker", "ux"],
  },
  {
    version: "1.23.4",
    date: "2026-05-09",
    headline: "Cross-platform robustness for Windows + macOS + Linux",
    body:
      "Pure-JS PATH walker (replaces brittle `which -a` on macOS). windowsHide on detached daemon spawn (no stray console window on Windows). Platform-aware error messages (Windows file-lock vs POSIX sudo).",
    tags: ["cross-platform", "robustness"],
  },
  {
    version: "1.23.0",
    date: "2026-05-09",
    headline: "RLHF Force-Push Inbox -- Mneme talks to you mid-conversation",
    body:
      "Mneme can now message you WITHOUT you typing anything Mneme-related. The daemon writes to .mneme/inbox.jsonl when something noteworthy happens; every MCP tool dispatch surfaces unsent messages via the wisdom field. Works with every MCP client (no client-specific notification UX needed).",
    suggestedAction: "Try: `mneme inbox list` or `mneme inbox push \"hello\"`",
    tags: ["inbox", "force-push"],
  },
];

export interface WhatsNewDigest {
  /** Currently-running version. */
  currentVersion: string;
  /** All highlights newer than (or equal to) `sinceVersion` if provided;
   *  otherwise the latest 3. */
  highlights: WhatsNewHighlight[];
  /** Total count across all stored highlights (for client UI). */
  totalAvailable: number;
  /** A short formatted message the AI can quote verbatim. */
  oneLineSummary: string;
  /** ISO timestamp this digest was built. */
  builtAt: string;
}

/** Parse a semver into [major, minor, patch] for ordering. Pre-release
 *  suffixes are ignored for digest purposes. */
function semverParse(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim().replace(/^v/, ""));
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

function semverGte(a: string, b: string): boolean {
  const pa = semverParse(a), pb = semverParse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return true;
    if (pa[i]! < pb[i]!) return false;
  }
  return true; // equal
}

/** Build the digest. Defaults to "latest 3 highlights" when no
 *  sinceVersion is provided (the common case for a fresh session). */
export function buildDigest(opts: { currentVersion: string; sinceVersion?: string; limit?: number } = { currentVersion: "" }): WhatsNewDigest {
  const limit = Math.max(1, Math.min(20, opts.limit ?? 3));
  let chosen: WhatsNewHighlight[];
  if (opts.sinceVersion) {
    chosen = HIGHLIGHTS.filter((h) => semverGte(h.version, opts.sinceVersion!)).slice(0, limit);
  } else {
    chosen = HIGHLIGHTS.slice(0, limit);
  }
  const oneLineSummary = chosen.length === 0
    ? `Up to date -- no highlights since v${opts.sinceVersion ?? "your last session"}.`
    : `${chosen.length} highlight${chosen.length === 1 ? "" : "s"}: ${chosen.map((h) => `v${h.version} ${h.headline}`).join(" | ")}`;
  return {
    currentVersion: opts.currentVersion,
    highlights: chosen,
    totalAvailable: HIGHLIGHTS.length,
    oneLineSummary,
    builtAt: new Date().toISOString(),
  };
}

/** Best-effort: read the raw CHANGELOG.md from the package root for
 *  agents that want the engineer-grade detail (vs. the curated body). */
export function readChangelogTopSection(packageRoot?: string): string | null {
  const root = packageRoot ?? findPackageRoot();
  if (!root) return null;
  const path = join(root, "CHANGELOG.md");
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    // Return everything from "## [Unreleased]" to the second "## [" header.
    const lines = text.split("\n");
    const out: string[] = [];
    let inSection = false;
    let sectionsSeen = 0;
    for (const line of lines) {
      if (/^## \[/.test(line)) {
        sectionsSeen += 1;
        if (sectionsSeen >= 3) break; // [Unreleased] + first real version + stop at second
        inSection = true;
      }
      if (inSection) out.push(line);
    }
    return out.join("\n").trim();
  } catch {
    return null;
  }
}

function findPackageRoot(): string | null {
  // Walk up from this module's file location looking for the repo's CHANGELOG.md.
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "CHANGELOG.md"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* ignore */ }
  return null;
}
