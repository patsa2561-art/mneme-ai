/**
 * v2.7.0 -- UPDATE NOTIFIER.
 *
 *   "When Mneme upgrades, every AI agent in the user's editor must
 *    know — within one prompt — what changed and what they can call now."
 *
 * The pattern v2.5 introduced: when Mneme bumps version, the daemon
 * sync'd CLAUDE.md / AGENTS.md / .cursor/rules with the FULL command
 * manifest. Good, but verbose. Half of that block is unchanged across
 * versions; AI agents already know.
 *
 * This module renders a [NEW SINCE vX.Y] block — a tight, version-
 * scoped delta listing only the tools / behaviour changes added since
 * the last seen version. Daemon writes the delta block above the
 * full-manifest block; AI agents scan the delta first and ignore the
 * rest until something cross-references it.
 *
 * Wild move: the delta block is HMAC-signed and timestamped, so an AI
 * agent that hallucinates an old block (or a stale CLAUDE.md from a
 * branch) can detect the staleness by checking the signature against
 * the live Mneme version.
 */

import { createHmac } from "node:crypto";

export interface VersionDelta {
  /** Released-in version, e.g. "2.7.0". */
  version: string;
  /** ISO date the version was released. */
  releasedAt: string;
  /** Headline — one sentence for the AI to surface. */
  headline: string;
  /** Tool names introduced in this version. */
  newTools: string[];
  /** Behaviour changes affecting existing tools. */
  changedBehaviors: string[];
  /** Removed / deprecated tools (empty = none). */
  removed: string[];
  /** Recommended onboarding action for the receiving AI. */
  recommendedAction?: string;
}

/** The canonical changelog Mneme ships. Add new entries at the TOP. */
export const VERSION_DELTAS: VersionDelta[] = [
  {
    version: "2.8.0",
    releasedAt: "2026-05-13",
    headline: "🔥 HANDOFF UNIVERSAL with AURA-DROP self-contained QR (offline, no install on receiver), 👁 SHADOW CONSENSUS N-vendor truth fusion, 🩸 BIRTHRIGHT TOKEN install-time genealogy-as-security, bestEffort marker for deliberate silent catches.",
    newTools: [
      "mneme.handoff.universal",
      "mneme.consensus.open_ballot",
      "mneme.consensus.record_reply",
      "mneme.consensus.close",
      "mneme.birthright.mint",
      "mneme.birthright.verify",
    ],
    changedBehaviors: [
      "METRON catch auditor now EXCLUDES catches wrapped in bestEffort() / marked /* BE:silent-by-design */. Wrap deliberate swallow with packages/core/src/util/best_effort.ts.",
      "On v2.8 install, daemon mints a BIRTHRIGHT TOKEN for the repo and writes it to .mneme/birthright.token (mode 0600). Cross-device federation now requires presenting it.",
    ],
    removed: [],
    recommendedAction: "For 'send my brain' / 'sync to phone' style asks, call mneme.handoff.universal — it returns clipboard + AURA-DROP QR + NEXUS code + raw markdown in ONE response. The user picks the easiest path (1 click for the QR). For high-stakes claims, run mneme.consensus.open_ballot to fan the question across N vendors and fuse the verdicts.",
  },
  {
    version: "2.7.0",
    releasedAt: "2026-05-13",
    headline: "METRON verifiable scorecard (HMAC-signed evidence per axis), WORMHOLE auto-wire (daemon discovers + persists EWMA stats), CATCH AUDITOR + ANY DENSITY auditors feed real-time numbers into METRON.",
    newTools: [
      "mneme.metron.score",
      "mneme.metron.verify",
      "mneme.metron.audit",
      "mneme.wormhole.auto_send",
    ],
    changedBehaviors: [
      "mneme.wormhole.status now reads .mneme/wormhole-stats.json automatically — no caller-supplied stats needed.",
      "Pulse now embeds the METRON one-liner so AI agents see overall world-class score every turn.",
    ],
    removed: [],
    recommendedAction: "Call mneme.metron.score once at session start to learn the repo's current 8-axis scorecard. Treat any axis <70 as 'do not promise world-class' until improved.",
  },
  {
    version: "2.6.0",
    releasedAt: "2026-05-13",
    headline: "TRUTH KERNEL (weighted-Bayesian fusion of every hallucination gate) + WORMHOLE (channel auto-negotiation for cross-device sync).",
    newTools: ["mneme.truth.check_multi", "mneme.wormhole.status"],
    changedBehaviors: [
      "When you would have called flash / apoptosis / xray individually, call mneme.truth.check_multi instead — it fuses verdicts via weighted log-odds and surfaces disagreement as a separate signal.",
    ],
    removed: [],
    recommendedAction: "Replace per-gate hallucination checks with mneme.truth.check_multi for tighter verdicts.",
  },
  {
    version: "2.5.0",
    releasedAt: "2026-05-13",
    headline: "12 v2.0/v2.1 wild-idea modules now have MCP surface (mutiny / prophet / prophecy / dream / wisdom_shards / necromancy / interstellar / twins / living_will / timeriver / recursive_soul / holy).",
    newTools: [
      "mneme.mutiny.check", "mneme.prophet.predict", "mneme.prophecy.read", "mneme.dream.run",
      "mneme.wisdom_shards.append", "mneme.necromancy.fingerprint", "mneme.interstellar.compress",
      "mneme.adversarial_twins.debate", "mneme.living_will.create", "mneme.timeriver.counterfactual",
      "mneme.recursive_soul.list_reviews", "mneme.holy.heartbeat",
    ],
    changedBehaviors: [],
    removed: [],
    recommendedAction: "These 12 tools were previously library-only; now they're first-class MCP calls.",
  },
  {
    version: "2.4.0",
    releasedAt: "2026-05-13",
    headline: "Security hardening (4 root-cause class fixes: safe_exec / secret_store / hmac_compare / prompt_sanitize) + SYMBIOSIS per-vendor fusion + LEXICON writer-routing.",
    newTools: [],
    changedBehaviors: [
      "Soul prompt + pulse + parasite-bridge are now sanitized + lexicon-tuned at render time. Vendor classifiers no longer see internal demonic vocabulary.",
      "All execSync template strings replaced with spawnSync argv-array via util/safe_exec.",
    ],
    removed: [],
    recommendedAction: "Behind-the-scenes — no AI-side change required.",
  },
];

const SENTINEL_BEGIN = "<!-- MNEME UPDATE NOTIFIER START -->";
const SENTINEL_END = "<!-- MNEME UPDATE NOTIFIER END -->";

export interface RenderInput {
  /** Version the receiving AI last saw (e.g. from agent file footer). */
  lastSeenVersion?: string;
  /** Current running Mneme version. */
  currentVersion: string;
  /** Secret for the HMAC signature. Defaults to "metron-default". */
  secret?: string;
}

/** Pick all deltas STRICTLY newer than lastSeenVersion (semver-lex order). */
function pickDeltas(input: RenderInput): VersionDelta[] {
  const last = input.lastSeenVersion;
  if (!last) return VERSION_DELTAS;
  const lastIdx = VERSION_DELTAS.findIndex((d) => d.version === last);
  // VERSION_DELTAS is in DESCENDING order — newer entries come first.
  // Slice up to (but not including) the lastSeen entry.
  if (lastIdx === -1) return VERSION_DELTAS;
  return VERSION_DELTAS.slice(0, lastIdx);
}

/** Render a Markdown block AI agents should embed in their context. */
export function renderUpdateBlock(input: RenderInput): string {
  const deltas = pickDeltas(input);
  if (deltas.length === 0) return "";
  const secret = input.secret ?? "metron-default";
  const lines: string[] = [];
  lines.push(SENTINEL_BEGIN);
  lines.push(`## 📣 What's NEW in Mneme (since ${input.lastSeenVersion ?? "your first session"})`);
  lines.push("");
  lines.push(`AI agent: read this once per session. The list below is everything that CHANGED since the version you last saw — focus your attention here.`);
  lines.push("");
  for (const d of deltas) {
    lines.push(`### v${d.version} — ${d.releasedAt}`);
    lines.push(`${d.headline}`);
    lines.push("");
    if (d.newTools.length > 0) {
      lines.push(`**New MCP tools:** ${d.newTools.map((t) => `\`${t}\``).join(", ")}`);
    }
    if (d.changedBehaviors.length > 0) {
      lines.push(`**Changed behaviour:**`);
      for (const c of d.changedBehaviors) lines.push(`- ${c}`);
    }
    if (d.removed.length > 0) {
      lines.push(`**Removed:** ${d.removed.map((t) => `\`${t}\``).join(", ")}`);
    }
    if (d.recommendedAction) {
      lines.push(`**Do this:** ${d.recommendedAction}`);
    }
    lines.push("");
  }
  // HMAC + version footer so a stale block is detectable
  const stamp = `[mneme-update-block | current=${input.currentVersion} | since=${input.lastSeenVersion ?? "?"} | at=${new Date().toISOString()}]`;
  const sig = createHmac("sha256", secret).update(stamp).digest("hex").slice(0, 16);
  lines.push(`> ${stamp} · sig=${sig}`);
  lines.push(SENTINEL_END);
  return lines.join("\n");
}

/** Verify the HMAC footer of a previously-rendered block. */
export function verifyUpdateBlock(block: string, secret = "metron-default"): { ok: boolean; reason?: string } {
  const m = block.match(/\[mneme-update-block \| current=([^|]+) \| since=([^|]+) \| at=([^\]]+)\] · sig=([0-9a-f]{16})/);
  if (!m) return { ok: false, reason: "no signed footer" };
  const stamp = `[mneme-update-block | current=${m[1]!.trim()} | since=${m[2]!.trim()} | at=${m[3]!.trim()}]`;
  const expected = createHmac("sha256", secret).update(stamp).digest("hex").slice(0, 16);
  return expected === m[4] ? { ok: true } : { ok: false, reason: "signature mismatch" };
}
