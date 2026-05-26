/**
 * v2.61.0 — PASSPORT policy: risk tier → required trust threshold.
 *
 * Each MCP tool call is classified into a risk tier. Tiers map to a
 * minimum trust score the requesting agent must clear AND a TTL for
 * the issued passport. Stricter tiers = shorter TTL.
 *
 * Default policy is conservative; users override via `mneme passport
 * policy --set tier=value` or `.mneme/passport/policy.json`.
 */

export type RiskTier = "safe" | "read" | "write" | "network" | "destructive";

export interface TierConfig {
  /** Required trust score 0..1 to grant passport. */
  minTrust: number;
  /** Passport TTL in milliseconds. */
  ttlMs: number;
  /** Human-readable description. */
  description: string;
  /** When true, single-agent trust is insufficient — needs multi-party. */
  requiresMultiParty?: boolean;
}

export const DEFAULT_POLICY: Record<RiskTier, TierConfig> = {
  safe: {
    minTrust: 0.0,
    ttlMs: 60 * 60 * 1000, // 1 hour
    description: "Read-only metadata (catalog, status, version). No state mutation possible.",
  },
  read: {
    minTrust: 0.30,
    ttlMs: 30 * 60 * 1000, // 30 min
    description: "Read user data / files / db (could exfiltrate secrets).",
  },
  write: {
    minTrust: 0.60,
    ttlMs: 10 * 60 * 1000, // 10 min
    description: "Mutate user data / files / db (scoped writes).",
  },
  network: {
    minTrust: 0.70,
    ttlMs: 5 * 60 * 1000, // 5 min
    description: "Outbound network call (could exfiltrate / SSRF).",
  },
  destructive: {
    minTrust: 0.85,
    ttlMs: 5 * 60 * 1000, // 5 min
    description: "Irreversible operation (rm -rf, DROP TABLE, git push --force, terminate instance).",
    requiresMultiParty: false, // Set true in production policy via override.
  },
};

/**
 * Classify a tool name into a risk tier using lightweight heuristics.
 * Used when the caller does not specify a tier.
 *
 * Order matters: most-specific first.
 */
export function classifyTier(toolName: string): RiskTier {
  const lower = toolName.toLowerCase();
  // Destructive (anything that can execute arbitrary code, delete data, irreversibly mutate).
  if (/shell|exec|spawn|bash|cmd[_.]|process[_.]|rm[_-]?(rf|fr)?|drop[_-]?(table|database)|truncate|delete[_-]?all|force[_-]?push|terminate|destroy|wipe|format/.test(lower)) return "destructive";
  // Network
  if (/fetch|http|request|post|put|delete[_-]?http|webhook|publish|broadcast|email|sms/.test(lower)) return "network";
  // Write
  if (/write|create|insert|update|patch|edit|mutate|append|set|commit|push|publish/.test(lower)) return "write";
  // Read
  if (/read|cat|fetch[_-]?file|stat|find|search|query|select|list|show/.test(lower)) return "read";
  // Safe default
  return "safe";
}

/**
 * Resolve a tier config, applying an optional user override.
 */
export function resolveTier(tier: RiskTier, overrides?: Partial<Record<RiskTier, Partial<TierConfig>>>): TierConfig {
  const base = DEFAULT_POLICY[tier];
  const override = overrides?.[tier] ?? {};
  return {
    minTrust: override.minTrust ?? base.minTrust,
    ttlMs: override.ttlMs ?? base.ttlMs,
    description: override.description ?? base.description,
    requiresMultiParty: override.requiresMultiParty ?? base.requiresMultiParty,
  };
}
