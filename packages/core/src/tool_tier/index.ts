/**
 * v2.19.24 — MNEME TOOL TIER (extends v2.19.23 PROPRIOCEPTION)
 *
 *   "เลิก split 67 vs 505. ทุก tool เห็นด้วยกัน + TIER badge — user
 *    เห็น tier ที่เหมาะกับ skill, AI เห็นทั้งหมด"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: v2.19.23 PROPRIOCEPTION unified the catalog but AI agents
 *   still saw 568 tools while users saw ~67 in `mneme --help`. Same
 *   structural drift, different surface. The fix is not to HIDE tools
 *   from AI — it's to STRATIFY them so users see the right slice for
 *   their skill level, and AI still sees the full catalog through MCP.
 *
 *   4 tiers (deterministic classifier; no ML):
 *     ⭐⭐⭐ STARTER       — curated essentials; first-time users
 *     ⭐⭐  EXPLORER      — v2.18+ pentads + power-user families
 *     ⭐   DEEP          — orchestration / system / advanced
 *     🔬  EXPERIMENTAL  — edge cases / one-off experiments
 *
 *   Pure-function classifier; HMAC-signed budget report; CLI surfaces
 *   `mneme tools` with `--tier T` filter. AI agents always see the
 *   superset via MCP; "the catalog the AI sees ⊇ the catalog the user
 *   sees" — info drift goes to zero structurally.
 *
 * Honest scope:
 *   - 3 explicit family sets (STARTER_FAMILIES / STARTER_WHITELIST /
 *     EXPERIMENTAL_FAMILIES). The "v2.18+ pentads" tier (EXPLORER) is
 *     derived from a canonical V218_PLUS_FAMILIES set already used in
 *     v2.19.21 GAP CLOSER. Everything else falls to DEEP.
 *   - Tier is a HINT to the user, not a security boundary. AI agents
 *     can call ANY tier via MCP; the surface choice is presentation-only.
 *   - Composes onto v2.19.23 PROPRIOCEPTION (UnifiedCatalogEntry shape)
 *     + v2.19.21 KNOWN_LEGACY_TOP_LEVEL (CLI mount surface).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type Tier = "starter" | "explorer" | "deep" | "experimental";

/**
 * Curated essentials — first-time users meet Mneme through these.
 * Hand-picked; small enough that beginners aren't overwhelmed.
 */
// v2.19.33 B3 fix: expanded STARTER from 13 visible (2.2% of 594) → ~35
// (~5.5% of 647) so first-time users see ONE representative tool per
// major capability category, not a cherry-picked dozen. Each addition is
// the "ask the AI to do X" entry point users actually need on day 1.
export const STARTER_WHITELIST: ReadonlySet<string> = new Set([
  // Core memory + retrieval
  "mneme.status",
  "mneme.ask",
  "mneme.why",
  "mneme.who_knows",
  "mneme.index",
  // Install + upgrade lifecycle
  "mneme.system.upgrade",
  "mneme.system.health",
  "mneme.upgrade",
  "mneme.doctor",
  "mneme.init",
  // Pulse + identity
  "mneme.welcome",
  "mneme.capabilities",
  "mneme.intent.execute",
  // What's new + smart dispatch
  "mneme.whats_new",
  "mneme.smart_do",
  // Embedder + tier health
  "mneme.embeddings.status",
  "mneme.embeddings.upgrade",
  // Antivirus (highest-impact daily-use tools)
  "mneme.antivirus.scan",
  "mneme.antivirus.cure",
  // LIMBIC organism health
  "mneme.limbic.health",
  "mneme.breath.stats",
  // People diagnostics
  "mneme.atrophy",
  // Premortem (the answer to "is this safe to ship?")
  "mneme.premortem",
  // Tier discovery + B3 NEW discoverability commands
  "mneme.tier.classify",
  "mneme.tier.list_by_tier",
  "mneme.browse",         // v2.19.33 B3: interactive catalog tour
  "mneme.suggest",        // v2.19.33 B3: repo-aware tool recommendations
  // v2.19.31 truth + contradictions (the "is this real?" entry point)
  "mneme.truth.forensic",
  "mneme.truth.contradictions",
  "mneme.truth.init",     // v2.19.33 B2: zero-config sensor stack
  // v2.19.32 cross-device handoff (headline of the release)
  "mneme.handoff.snapshot",
  "mneme.handoff.pair_generate",
  // v2.19.31 cross-device sync (the brain unification entry point)
  "mneme.synapse.sync_export",
  // Bug prophet — "what could go wrong if I ship this?"
  "mneme.guard",
  // Reflex — auto-cache (one of the v2.19.22 flagship features)
  "mneme.reflex.observe",
]);

/**
 * Families that ALWAYS land in EXPLORER (v2.18+ pentads + organs).
 * These are the "power-user / agent-integration" surface. Same set
 * the v2.19.21 GAP CLOSER audited.
 */
export const EXPLORER_FAMILIES: ReadonlySet<string> = new Set([
  "arena", "badge", "oracle", "nexus",
  "confessional", "ghost", "trinity", "insurance", "boomerang",
  "evolution", "soul", "mcp_drift", "embedder",
  "inverse", "intent", "dna", "chronostasis", "agreement",
  "dream", "colony", "honey", "retroactive", "genetic",
  "jackpot", "genome", "proof", "suggest",
  "mortal", "muscle", "dialect", "brain", "chrysalis",
  "snn", "negev", "dreams", "chimera", "consequence",
  "truth", "federated", "reachability",
  "caption", "inpaint", "rci", "provenance", "textron",
  // v2.19.21+
  "cli",
  // v2.19.22
  "reflex", "catalog",
  // v2.19.23 LIMBIC organs
  "breath", "thalamus", "proprioception", "spinal", "hippocampus", "hormonal", "limbic",
  // v2.19.24
  "tier", "event",
]);

/**
 * EXPERIMENTAL — research / edge-case / opinionated tools. Often
 * vendor-specific or single-purpose. Defaulted hidden from the
 * starter view; AI can still call them.
 */
export const EXPERIMENTAL_FAMILIES: ReadonlySet<string> = new Set([
  "alien", "cf", "adversary", "mesh", "aletheia", "honeypot",
  "court", "tribunal", "diaspora", "telepathy",
  "abyss", "lattice", "neuron", "conduit", "synapse",
  "osmosis", "aura", "relay", "chameleon", "anchor", "rainbow",
  "permeate", "seamless", "ascension", "hyperscan", "precog", "sentinel",
  "wormhole", "metron", "beacon", "nexus_lock",
]);

export interface TierClassification {
  v: typeof PROTOCOL_VERSION;
  toolName: string;
  tier: Tier;
  reason: string;
}

/**
 * Classify a single tool name into one of 4 tiers. Deterministic.
 *
 * Rules (priority order):
 *   1. STARTER_WHITELIST hit → starter
 *   2. EXPERIMENTAL_FAMILIES hit → experimental
 *   3. EXPLORER_FAMILIES hit → explorer
 *   4. fallback → deep
 *
 * The fallback is deliberate: anything we haven't explicitly classified
 * is treated as DEEP (advanced; not for first-time users). That way new
 * tools default to advanced visibility, not noise.
 */
export function classifyTier(toolName: string): TierClassification {
  let tier: Tier;
  let reason: string;
  if (STARTER_WHITELIST.has(toolName)) {
    tier = "starter";
    reason = "starter_whitelist hit (curated for first-time users)";
  } else {
    const parts = toolName.split(".");
    const family = parts[1] ?? parts[0] ?? "";
    if (EXPERIMENTAL_FAMILIES.has(family)) {
      tier = "experimental";
      reason = `family '${family}' in experimental set (research / edge-case)`;
    } else if (EXPLORER_FAMILIES.has(family)) {
      tier = "explorer";
      reason = `family '${family}' in explorer set (v2.18+ pentads + organs)`;
    } else {
      tier = "deep";
      reason = `family '${family}' not classified explicitly → DEEP fallback (advanced)`;
    }
  }
  return { v: PROTOCOL_VERSION, toolName, tier, reason };
}

export interface TierBudget {
  v: typeof PROTOCOL_VERSION;
  totalTools: number;
  starter: number;
  explorer: number;
  deep: number;
  experimental: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_TIER_SECRET"] || `mneme-tool-tier-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Compute a HMAC-signed budget across all tools. Caller passes the
 * full tool name list; we classify each and tally.
 */
export function computeTierBudget(input: { toolNames: string[]; secret?: string }): TierBudget {
  let starter = 0, explorer = 0, deep = 0, experimental = 0;
  for (const n of input.toolNames) {
    const c = classifyTier(n);
    if (c.tier === "starter") starter++;
    else if (c.tier === "explorer") explorer++;
    else if (c.tier === "deep") deep++;
    else experimental++;
  }
  const body: Omit<TierBudget, "sig"> = {
    v: PROTOCOL_VERSION,
    totalTools: input.toolNames.length,
    starter,
    explorer,
    deep,
    experimental,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyBudget(b: TierBudget, secret?: string): boolean {
  const { sig, ...body } = b;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

/** Filter tool names by tier; preserves input order. */
export function listByTier(input: { toolNames: string[]; tier: Tier }): string[] {
  return input.toolNames.filter((n) => classifyTier(n).tier === input.tier);
}

export const TIER_BADGE: Record<Tier, string> = {
  starter: "⭐⭐⭐",
  explorer: "⭐⭐",
  deep: "⭐",
  experimental: "🔬",
};

export const TIER_LABEL: Record<Tier, string> = {
  starter: "STARTER",
  explorer: "EXPLORER",
  deep: "DEEP",
  experimental: "EXPERIMENTAL",
};

export function formatBudgetLine(b: TierBudget): string {
  return `🪞 TIER · ${b.totalTools} total · ⭐⭐⭐${b.starter} · ⭐⭐${b.explorer} · ⭐${b.deep} · 🔬${b.experimental}`;
}
