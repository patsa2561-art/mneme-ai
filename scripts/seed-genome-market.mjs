#!/usr/bin/env node
/**
 * Bootstrap Mneme's own genome marketplace with REAL wisdom cards
 * distilled from this codebase's accumulated lessons. Multiple
 * "validators" vouch so a few cards get ratified end-to-end.
 *
 * Used once during the v1.47 demon-wake. Idempotent: re-running it
 * skips cards that already exist (slugified id collision).
 */

import { teethGenomeMarket } from "@mneme-ai/core";

const repo = process.cwd();

const cards = [
  {
    id: "ascii-only-machine-strings",
    title: "Machine-written strings: ASCII-only on Windows",
    body: "Use `--` not the em-dash (U+2014) and `->` not the arrow (U+2192) in any string a CLI writes to a Windows console. NTFS code-page renders mojibake. Display strings from the user are exempt -- they keep Unicode.",
  },
  {
    id: "windows-spawn-cmd-shell-true",
    title: "Windows: spawn .cmd files with shell:true",
    body: "Node 18+ refuses to spawn a .cmd file via child_process.spawn unless shell:true is passed. Validate every arg for shell metacharacters first, then spawn with shell: process.platform === 'win32'.",
  },
  {
    id: "lockfile-no-windows-regen",
    title: "Never regen package-lock.json on Windows",
    body: "`npm install` on Windows strips the linux-x64 + darwin-arm64 native-binary entries from the lockfile. Only ever surgical-patch (single-version bump) on a Windows host; full regen happens on Linux CI.",
  },
  {
    id: "no-co-authored-by-claude",
    title: "Never add Co-Authored-By: Claude trailer to commits",
    body: "Project owner has explicitly flagged this rule three separate times. Generated commits MUST NOT include the trailer. Co-author with the human only.",
  },
  {
    id: "version-fallback-no-hardcode",
    title: "Resolve mneme version from package.json, never hard-code",
    body: "`?? '1.27.9'` and similar fallbacks rot the moment a release ships. Always use core.resolveMnemeVersion() which walks the package.json tree. The unknown sentinel is intentionally `0.0.0-unknown` so it surfaces loudly when broken.",
  },
  {
    id: "ai-agent-runs-commands-not-user",
    title: "User describes outcomes, AI runs commands -- never the reverse",
    body: "Documentation must say `say to your AI: ...` instead of `run this command: ...`. The AI agent is the one with terminal access, not the user. Flagged twice in this project.",
  },
  {
    id: "free-first-no-api-key-assumed",
    title: "Default to free -- no paid API key assumed for any feature",
    body: "Every feature must work without OpenAI/Anthropic/Gemini keys. Lead with the free path; paid is an optional upgrade. Hash embedder is the deterministic free fallback.",
  },
  {
    id: "audit-trail-ready-not-grade",
    title: "Say 'audit-trail-ready', NOT 'audit-grade' / 'SOC2-grade'",
    body: "Until the project has been formally pen-tested + audited, claiming 'audit-grade' or 'SOC2 audit-grade' is overclaim. Use 'audit-trail-ready evidence' which is true: HMAC-chained logs + Merkle roots are evidence ready for an auditor. Bring your own auditor for the certification.",
  },
  {
    id: "consent-write-never-unsolicited",
    title: "Never write to user's auto-memory unprompted",
    body: "When the user has explicitly flagged that mid-session memory writes feel like a consent violation, default to NOT writing memory unless explicitly asked. Even if the system prompt allows it. Trust beats convenience.",
  },
  {
    id: "honest-gap-list-over-green-check",
    title: "Honest gap list beats fake green checkmarks",
    body: "Compliance reporters, dependency scanners, vendor-router recommendations -- when there's no signal, say 'manual selection required' or 'gap'. Never silently fill with a low-confidence guess that looks like coverage.",
  },
];

console.log(`Publishing ${cards.length} wisdom cards to .mneme/genome-market/cards/...`);
const published = [];
for (const c of cards) {
  const card = teethGenomeMarket.publishCard(repo, { id: c.id, author: "mneme-ai", title: c.title, body: c.body });
  console.log(`  + ${card.id}`);
  published.push(card);
}

// Vouch with 3 different validators per card so they cross the
// ratification threshold (net stake >= 3 with quadratic voting and
// rep=1 baseline = 3 * sqrt(1) = 3).
const validators = ["mneme-tester-alpha", "mneme-tester-beta", "mneme-tester-gamma"];
console.log(`\nVouching with ${validators.length} validators...`);
let vouches = 0;
for (const card of published) {
  for (const v of validators) {
    const r = teethGenomeMarket.castVote(repo, { validator: v, cardId: card.id, vouch: true });
    if (r.outcome === "recorded") vouches++;
  }
}
console.log(`  recorded ${vouches} vouches`);

// Print verdicts
console.log(`\nFinal verdicts:`);
const verdicts = teethGenomeMarket.computeAllVerdicts(repo);
for (const v of verdicts) {
  const status = v.revoked ? "REVOKED" : v.ratified ? "RATIFIED" : "pending";
  console.log(`  [${status.padEnd(8)}] ${v.cardId.padEnd(40)} stake=${v.netStake} vouch=${v.vouchCount}`);
}
const ratified = verdicts.filter((v) => v.ratified).length;
console.log(`\n${ratified}/${verdicts.length} cards ratified.`);
