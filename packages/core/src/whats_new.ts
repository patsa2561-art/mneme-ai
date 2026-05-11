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
