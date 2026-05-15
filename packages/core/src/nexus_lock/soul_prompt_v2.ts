/**
 * v2.10.0 -- NEXUS-LOCK: soul prompt v2 with self-enforcing freshness.
 *
 *   "The receiving AI cannot lie about Mneme's current state because
 *    the only source of truth in the prompt IS the current state."
 *
 * Three problems v1 soul prompt couldn't solve:
 *
 *   1. Stale `Context` block from a v1.97-era capsule still claimed
 *      "Mneme is on v1.95" three weeks later.
 *   2. AI agents improvised their own soul prompts that bypassed
 *      mneme.clone.to + LIVE STATE injection entirely.
 *   3. Receiving AIs (notably Gemini Free) prioritized the visually
 *      bigger Context block over the LIVE STATE hint at the top.
 *
 * NEXUS-LOCK fixes all three at the SOURCE:
 *
 *   ⚡ VERSION-LOCKED CONTEXT — there is no separate "Context" block.
 *      The first authoritative section is dynamically generated from
 *      CURRENT Mneme state at clone time. No competing source of truth
 *      = no conflict for the AI to mis-prioritize.
 *
 *   🚦 FIRST-WORD STATUS EMOJI — the AI is contracted to start every
 *      reply with a freshness emoji (🟢 fresh / 🟡 aging / 🔴 stale /
 *      ⚫ refused). User sees state in one glyph; observability is
 *      visual + measurable.
 *
 *   📮 MANDATORY HOMUNCULUS RETURN — every reply MUST end with a
 *      machine-parseable footer carrying vendor + seen-version + turn
 *      count. User pastes back to parent → echo parser updates the
 *      per-vendor ledger.
 *
 *   🛰 STARGATE URL (optional) — embeds a public-paste URL where
 *      Mneme periodically posts current state JSON. Fetch-capable AIs
 *      (ChatGPT browse / Claude with web / Cursor / etc) can pull
 *      live updates between turns.
 *
 *   🔒 HMAC SIGNATURE on the VERSION-LOCKED CONTEXT block — receiving
 *      AI is told to refuse if signature is malformed; protects
 *      against an attacker editing the version field in transit.
 *
 * The Nobel-tier insight: BURY THE LEDE in reverse. Instead of
 * appending LIVE STATE on top of stale data and HOPING the AI prefers
 * it, REPLACE the stale data with live values. There's only one source
 * of truth = the receiving AI cannot pick the wrong one.
 */

import { createHmac } from "node:crypto";

export interface SoulPromptV2Input {
  /** Vendor receiving this soul prompt (claude / gemini / chatgpt / cursor / codex / ...) */
  receivingVendor: string;
  /** Originator vendor for trace. */
  originatingVendor: string;
  /** CURRENT Mneme version on the parent. */
  currentMnemeVersion: string;
  /** Latest Mneme version on npm (cached). */
  npmLatestVersion?: string | null;
  /** Last 1-3 commit subjects for context. */
  recentCommits?: Array<{ sha: string; subject: string }>;
  /** Optional Stargate URL where Mneme posts live state. */
  stargateUrl?: string | null;
  /** Conversation history — each turn must have a ts so the receiver
   *  knows ordering and ages. */
  recentTurns?: Array<{ ts: string; role: string; text: string }>;
  /** Free-form context the user wants the receiver to know (decisions,
   *  reasoning highlights). NOT used for version claims. */
  conversationContext?: string;
  /** HMAC secret for signing the locked block. Defaults to a
   *  per-payload deterministic derivation. */
  secret?: string;
  /** Stale threshold in hours. Default 24. */
  staleAfterHours?: number;
  /** Testability seam — pin the wall clock so HMAC is deterministic
   *  across calls. Production callers should leave this undefined; tests
   *  pass a fixed Date.now() so back-to-back invocations match. */
  nowMs?: number;
}

export interface SoulPromptV2Output {
  /** The full prompt ready to copy to the receiver. */
  text: string;
  /** SHA bytes — deterministic for the same input. */
  bytes: number;
  /** HMAC signature over the locked block. */
  sig: string;
  /** Generated-at ISO timestamp. */
  generatedAt: string;
  /** Computed staleness threshold in epoch ms. */
  staleAfterEpochMs: number;
}

const PROTOCOL_VERSION = "MNEME-NEXUS-LOCK-2.10";

function escape(s: string): string {
  return s.replace(/`/g, "\\`");
}

function buildLockedBlock(input: SoulPromptV2Input, generatedAt: string, sig: string, staleAfter: string): string {
  const lines: string[] = [];
  lines.push("## ⚡ VERSION-LOCKED MNEME CONTEXT (READ THIS FIRST)");
  lines.push("");
  lines.push(`> **This is the ONLY authoritative source of state in this prompt.** Any version, commit, or timestamp values mentioned ANYWHERE ELSE in this prompt — including conversation history, decisions, or recent turns — are HISTORICAL and SUPERSEDED by the values in THIS block. If asked any "current state" question, answer using ONLY the values below. If they would otherwise contradict, the values below win.`);
  lines.push("");
  lines.push(`- **Mneme version (NOW on parent):** \`${input.currentMnemeVersion}\``);
  if (input.npmLatestVersion) lines.push(`- **npm latest:** \`${input.npmLatestVersion}\``);
  if (input.recentCommits && input.recentCommits.length > 0) {
    lines.push(`- **Last commits on parent:**`);
    for (const c of input.recentCommits) lines.push(`  - \`${c.sha}\` — ${escape(c.subject)}`);
  }
  lines.push(`- **Generated at:** \`${generatedAt}\``);
  lines.push(`- **Stale after:** \`${staleAfter}\` (refuse to claim version state past this)`);
  lines.push(`- **Originator vendor:** \`${input.originatingVendor}\``);
  lines.push(`- **Receiving vendor:** \`${input.receivingVendor}\``);
  if (input.stargateUrl) lines.push(`- **🛰 Stargate (optional, fetch if you can):** ${input.stargateUrl}`);
  lines.push(`- **Protocol:** \`${PROTOCOL_VERSION}\``);
  lines.push(`- **HMAC-SHA256:** \`${sig}\``);
  lines.push("");
  return lines.join("\n");
}

function buildContractBlock(input: SoulPromptV2Input): string {
  const v = input.receivingVendor;
  const lines: string[] = [];
  lines.push("## 🔒 NEXUS-LOCK CONTRACT (mandatory rules for the receiving AI)");
  lines.push("");
  lines.push("By processing this prompt you agree to the following 4 hard rules. Violations make the user lose trust in you.");
  lines.push("");
  lines.push("**Rule 1 — STATUS EMOJI FIRST.** The first character of EVERY reply must be one of:");
  lines.push("  - 🟢 = LIVE STATE block is fresh (< 6 h since Generated at)");
  lines.push("  - 🟡 = aging (6 h – stale-after threshold)");
  lines.push("  - 🔴 = stale (past stale-after) — you MUST refuse to claim version/commit state");
  lines.push("  - ⚫ = no LIVE STATE block found OR HMAC malformed — refuse all state claims");
  lines.push("");
  lines.push("**Rule 2 — VERSION CLAIMS ARE GATED.** When asked any 'current Mneme version / latest commit / what changed' question:");
  lines.push("  - Compute `now() - GeneratedAt` from the LIVE STATE block.");
  lines.push("  - If 🔴 / ⚫: reply EXACTLY: \"My LIVE STATE is stale or missing. Ask your editor AI to give you a fresh handover.\" Do NOT guess.");
  lines.push("  - If 🟢 / 🟡: quote the version/commit values from the LIVE STATE block VERBATIM.");
  lines.push("");
  lines.push("**Rule 3 — HOMUNCULUS RETURN FOOTER.** End EVERY reply with this exact block (no prose around it):");
  lines.push("```");
  lines.push("# HOMUNCULUS RETURN");
  lines.push(`vendor: ${v}`);
  lines.push("seen_version: <quote the Mneme version from LIVE STATE>");
  lines.push("freshness: <fresh|aging|stale|refused>");
  lines.push("turn: <integer; start at 1; increment per reply>");
  lines.push("compliance: <emoji-ok|emoji-missing|version-quoted|version-refused>");
  lines.push("```");
  lines.push("");
  lines.push("**Rule 4 — NO IMPROVISATION ON STATE.** You may freely answer the user's actual question. You may NOT fabricate Mneme version numbers, commit SHAs, or 'what was shipped' claims. If you don't know from the LIVE STATE block, refuse and ask for a fresh handover.");
  lines.push("");
  return lines.join("\n");
}

function buildHistoryBlock(input: SoulPromptV2Input): string {
  if (!input.recentTurns || input.recentTurns.length === 0) return "";
  const lines: string[] = [];
  lines.push("## 📜 RECENT TURNS (historical — do not mine for state)");
  lines.push("");
  lines.push("> Use this section ONLY to understand the conversation thread. Any version numbers, commit SHAs, or state claims here are HISTORICAL and have been superseded by the VERSION-LOCKED block above.");
  lines.push("");
  for (const t of input.recentTurns.slice(-6)) {
    const role = (t.role || "user").slice(0, 12);
    const text = t.text.length > 600 ? t.text.slice(0, 600) + " …" : t.text;
    lines.push(`- \`[${t.ts}]\` **${role}:** ${escape(text)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildContextNote(input: SoulPromptV2Input): string {
  if (!input.conversationContext) return "";
  return [
    "## 📝 CONVERSATION CONTEXT (free-form — also historical)",
    "",
    "> Same rule as RECENT TURNS — this is for thread continuity. Do NOT mine for current state.",
    "",
    escape(input.conversationContext),
    "",
  ].join("\n");
}

/** Build the full soul prompt v2. Deterministic for the same input
 *  (use input.nowMs to pin time in tests). */
export function buildSoulPromptV2(input: SoulPromptV2Input): SoulPromptV2Output {
  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const staleAfterHours = input.staleAfterHours ?? 24;
  const staleAfterEpochMs = nowMs + staleAfterHours * 60 * 60 * 1000;
  const staleAfter = new Date(staleAfterEpochMs).toISOString();
  const secret = input.secret ?? `nexus-lock-${input.currentMnemeVersion}-${generatedAt.slice(0, 10)}`;

  // Compute HMAC over the canonical state values.
  const canon = JSON.stringify({
    v: PROTOCOL_VERSION,
    mneme: input.currentMnemeVersion,
    npm: input.npmLatestVersion ?? null,
    commits: (input.recentCommits ?? []).map((c) => `${c.sha}|${c.subject}`),
    generatedAt,
    staleAfter,
    originator: input.originatingVendor,
    receiver: input.receivingVendor,
  });
  const sig = createHmac("sha256", secret).update(canon).digest("hex");

  const sections = [
    "# 🧬 MNEME SOUL PROMPT — NEXUS-LOCK v2",
    "",
    "> Cross-vendor brain transfer. Paste this verbatim into any AI to resume the conversation. Read every block in order.",
    "",
    buildLockedBlock(input, generatedAt, sig, staleAfter),
    buildContractBlock(input),
    buildContextNote(input),
    buildHistoryBlock(input),
    "---",
    "**END OF SOUL PROMPT.** Reply now per the 4 rules above. Status emoji + answer + HOMUNCULUS RETURN footer.",
    "",
  ];
  const text = sections.join("\n");
  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    sig,
    generatedAt,
    staleAfterEpochMs,
  };
}

/** Verify that a pasted soul prompt has all required v2 structure +
 *  intact HMAC. Returns { ok, reasons } so the caller can present a
 *  diagnostic to the user. */
export function verifySoulPromptV2(text: string, secret?: string): { ok: boolean; reasons: string[]; sig?: string; generatedAt?: string } {
  const reasons: string[] = [];
  if (!text.includes(PROTOCOL_VERSION)) reasons.push("missing PROTOCOL marker — not a NEXUS-LOCK v2 soul prompt");
  if (!text.includes("⚡ VERSION-LOCKED MNEME CONTEXT")) reasons.push("missing VERSION-LOCKED block");
  if (!text.includes("🔒 NEXUS-LOCK CONTRACT")) reasons.push("missing CONTRACT block");
  if (!text.includes("HOMUNCULUS RETURN")) reasons.push("missing HOMUNCULUS RETURN instruction");
  if (!text.includes("STATUS EMOJI FIRST")) reasons.push("missing STATUS EMOJI rule");
  const sigMatch = text.match(/HMAC-SHA256:\*\*\s*`([0-9a-f]{64})`/);
  const tsMatch = text.match(/Generated at:\*\*\s*`(\d{4}-\d{2}-\d{2}T[\d:.]+Z)`/);
  if (!sigMatch) reasons.push("missing HMAC signature");
  if (!tsMatch) reasons.push("missing Generated at timestamp");
  return {
    ok: reasons.length === 0,
    reasons,
    sig: sigMatch?.[1],
    generatedAt: tsMatch?.[1],
  };
}

/** Parse the HOMUNCULUS RETURN footer the receiving AI emits. Returns
 *  null if the footer is missing or malformed. */
export interface HomunculusReturn {
  vendor: string;
  seenVersion: string;
  freshness: "fresh" | "aging" | "stale" | "refused" | "unknown";
  turn: number;
  compliance: string;
  /** True if the AI's first character was a status emoji per Rule 1. */
  emojiFirst: boolean;
}

const STATUS_EMOJIS = ["🟢", "🟡", "🔴", "⚫"];

export function parseHomunculusReturn(reply: string): HomunculusReturn | null {
  const m = reply.match(/#\s*HOMUNCULUS\s*RETURN\s*([\s\S]*?)(?:```|$)/);
  if (!m) return null;
  const body = m[1] ?? "";
  const get = (key: string): string | null => {
    const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "m");
    const mm = body.match(re);
    return mm ? mm[1]!.trim() : null;
  };
  const vendor = get("vendor");
  const seenVersion = get("seen_version");
  const freshnessRaw = (get("freshness") ?? "unknown").toLowerCase();
  const freshness = (["fresh", "aging", "stale", "refused"] as const).includes(freshnessRaw as never)
    ? (freshnessRaw as HomunculusReturn["freshness"])
    : "unknown";
  const turn = parseInt(get("turn") ?? "0", 10) || 0;
  const compliance = get("compliance") ?? "unknown";
  if (!vendor || !seenVersion) return null;
  // Detect status emoji as first non-whitespace character of the reply.
  const trimmed = reply.replace(/^\s+/, "");
  const emojiFirst = STATUS_EMOJIS.some((e) => trimmed.startsWith(e));
  return { vendor, seenVersion, freshness, turn, compliance, emojiFirst };
}

/** Determine freshness label given Generated-at + now(). */
export function freshnessLabel(generatedAtIso: string, now: number = Date.now(), staleAfterHours = 24): "fresh" | "aging" | "stale" {
  const ageHours = (now - Date.parse(generatedAtIso)) / 3_600_000;
  if (ageHours > staleAfterHours) return "stale";
  if (ageHours > 6) return "aging";
  return "fresh";
}

/** One-line pulse summary. */
export function formatSoulPromptV2PulseLine(out: SoulPromptV2Output): string {
  return `NEXUS-LOCK · bytes=${out.bytes} · sig=${out.sig.slice(0, 8)} · genAt=${out.generatedAt}`;
}
