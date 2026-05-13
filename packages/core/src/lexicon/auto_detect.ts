/**
 * v2.3.0 -- LEXICON · Phase B · Auto-detect classifier fallback.
 *
 * Wrap any vendor request in `attemptWithFallback`. If the request
 * fails with a recognizable "AUP / cyber / safety" error, automatically
 * retry with the next-stricter profile. Cache the per-vendor decision
 * so subsequent requests skip the initial fail.
 *
 * Pure function on the decision logic; side-effects are the actual
 * network call (caller-supplied).
 */

import { profileByName, type LexiconProfile } from "./mappings.js";

export type ClassifierVerdict = "ok" | "blocked-aup" | "blocked-safety" | "rate-limit" | "auth" | "network" | "unknown";

/** Classify an error message as one of the known blocking categories. */
export function classifyError(err: unknown): ClassifierVerdict {
  if (!err) return "ok";
  const msg = (typeof err === "string" ? err : ((err as Error).message ?? String(err))).toLowerCase();

  // Anthropic AUP signature
  if (msg.includes("usage policy") || msg.includes("anthropic.com/legal/aup") || msg.includes("violative cyber") || msg.includes("cyber-use-case")) {
    return "blocked-aup";
  }
  // OpenAI moderation signature
  if (msg.includes("content_policy") || msg.includes("policy_violation") || msg.includes("openai moderation") || msg.includes("flagged by our moderation")) {
    return "blocked-safety";
  }
  // Google AI safety
  if (msg.includes("safety_settings") || msg.includes("blocked_reasons") || msg.includes("prohibited_content") || msg.includes("safety attributes")) {
    return "blocked-safety";
  }
  // Generic safety patterns
  if (msg.includes("blocked under") || msg.includes("policy violation") || msg.includes("content filter")) {
    return "blocked-safety";
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return "rate-limit";
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("invalid api key")) {
    return "auth";
  }
  if (msg.includes("network") || msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("fetch failed")) {
    return "network";
  }
  return "unknown";
}

export interface FallbackInput<T> {
  /** The send-function the caller wraps. Receives the profile to use; throws on error. */
  send: (profile: LexiconProfile) => Promise<T>;
  /** Ordered list of profile names to try. Default: ["identity", "openai", "anthropic", "enterprise"]. */
  profileOrder?: string[];
  /** Skip retries when this verdict is observed. Default: auth + rate-limit (retrying with a different lexicon won't help). */
  giveUpOn?: ClassifierVerdict[];
}

export interface FallbackTrace<T> {
  /** Final successful result, if any. */
  result?: T;
  /** Which profile worked. */
  successfulProfile?: string;
  /** Per-attempt log. */
  attempts: Array<{ profile: string; verdict: ClassifierVerdict; elapsedMs: number; errorMessage?: string }>;
  /** True iff any attempt succeeded. */
  ok: boolean;
}

const DEFAULT_ORDER = ["identity", "openai", "anthropic", "enterprise"];
const DEFAULT_GIVEUP: ClassifierVerdict[] = ["auth", "rate-limit"];

/** Try `send` with profiles in order. On classifier block → next profile.
 *  On non-block errors (auth/rate-limit) → give up immediately. */
export async function attemptWithFallback<T>(input: FallbackInput<T>): Promise<FallbackTrace<T>> {
  const order = input.profileOrder ?? DEFAULT_ORDER;
  const giveUp = new Set(input.giveUpOn ?? DEFAULT_GIVEUP);
  const attempts: FallbackTrace<T>["attempts"] = [];

  for (const name of order) {
    const profile = profileByName(name);
    if (!profile) continue;
    const t0 = Date.now();
    try {
      const result = await input.send(profile);
      attempts.push({ profile: name, verdict: "ok", elapsedMs: Date.now() - t0 });
      return { result, successfulProfile: name, attempts, ok: true };
    } catch (e) {
      const verdict = classifyError(e);
      attempts.push({ profile: name, verdict, elapsedMs: Date.now() - t0, errorMessage: (e as Error).message ?? String(e) });
      if (giveUp.has(verdict)) {
        return { attempts, ok: false };
      }
      // Continue to next profile only on classifier blocks
      if (verdict === "blocked-aup" || verdict === "blocked-safety") continue;
      // Any other unknown error — also try next profile (best effort)
      continue;
    }
  }
  return { attempts, ok: false };
}

// ============================================================
// Per-vendor decision cache
// ============================================================

export interface ProfileCache {
  /** Map vendor-id → most-recent successful profile. */
  byVendor: Map<string, string>;
}

export function createProfileCache(): ProfileCache {
  return { byVendor: new Map() };
}

export function rememberSuccessfulProfile(cache: ProfileCache, vendorId: string, profileName: string): void {
  cache.byVendor.set(vendorId, profileName);
}

export function recommendedProfile(cache: ProfileCache, vendorId: string): string | null {
  return cache.byVendor.get(vendorId) ?? null;
}

/** Serialize cache to JSON for persistence in .mneme/lexicon-cache.json. */
export function serializeProfileCache(cache: ProfileCache): string {
  return JSON.stringify({ byVendor: [...cache.byVendor.entries()] });
}

export function parseProfileCache(text: string): ProfileCache | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.byVendor)) return null;
    return { byVendor: new Map(obj.byVendor) };
  } catch {
    return null;
  }
}
