/**
 * Schema-version negotiation — mitigates Threat T4 (MCP protocol breaking).
 *
 * Problem: Anthropic may evolve the MCP `tools/list` schema. Our pack format
 * has its own `schemaVersion` field. We need a clean migration path so packs
 * written for v1 keep working when v2 ships, OR fail loudly with a clear
 * error rather than crashing silently.
 *
 * Approach:
 *   • CURRENT_PACK_SCHEMA_VERSION = 1
 *   • Negotiation: caller provides the SUPPORTED set { 1, 2, ... }; the
 *     loader picks the best match for each pack and returns
 *     compatibility metadata.
 *   • Forward-compat: pack versions HIGHER than what we support → reject
 *     with a clear "this pack requires Mneme >= X" error.
 *   • Backward-compat: pack versions we know about → accept directly.
 *
 * This module is pure — caller passes the supported set + the pack;
 * negotiation returns either {ok: true, pack} or {ok: false, error}.
 */

export const CURRENT_PACK_SCHEMA_VERSION = 1;
export const SUPPORTED_PACK_SCHEMA_VERSIONS: ReadonlyArray<number> = [1];

export interface NegotiationOk {
  ok: true;
  /** The version we'll process this pack as. */
  effectiveVersion: number;
  /** True when we're upgrading a v(N) pack to current v(N+k) handling.
   *  Always false for now since we only support v1; reserved for future. */
  migrationApplied: boolean;
  /** Notes for the caller (e.g., "version 2 → 1 downgraded; some fields ignored"). */
  notes: string[];
}

export interface NegotiationFail {
  ok: false;
  /** Why negotiation failed. */
  reason: "version-too-new" | "version-unknown" | "version-missing";
  message: string;
  /** Versions we DO support, surfaced for the error message. */
  supported: ReadonlyArray<number>;
  /** The version the pack claimed (or null if missing). */
  claimed: number | null;
}

export type NegotiationResult = NegotiationOk | NegotiationFail;

/**
 * Negotiate a pack's schemaVersion against what this build of Mneme
 * supports.
 *
 * Pure function. NEVER throws. Returns structured result for the
 * caller to surface to user / log.
 */
export function negotiateSchemaVersion(
  packSchemaVersion: unknown,
  supported: ReadonlyArray<number> = SUPPORTED_PACK_SCHEMA_VERSIONS,
): NegotiationResult {
  if (typeof packSchemaVersion !== "number" || !Number.isFinite(packSchemaVersion)) {
    return {
      ok: false,
      reason: "version-missing",
      message: "Pack file is missing a numeric schemaVersion field.",
      supported,
      claimed: null,
    };
  }
  if (supported.includes(packSchemaVersion)) {
    return {
      ok: true,
      effectiveVersion: packSchemaVersion,
      migrationApplied: false,
      notes: [],
    };
  }
  // Pack newer than what we support — explicit error
  const max = supported.reduce((a, b) => Math.max(a, b), 0);
  if (packSchemaVersion > max) {
    return {
      ok: false,
      reason: "version-too-new",
      message:
        `Pack uses schemaVersion=${packSchemaVersion}, but this build of Mneme supports up to ${max}. ` +
        "Upgrade Mneme (`mneme upgrade`) to use this pack.",
      supported,
      claimed: packSchemaVersion,
    };
  }
  // Older + unsupported (gap in supported set, not a problem we ship today)
  return {
    ok: false,
    reason: "version-unknown",
    message:
      `Pack uses schemaVersion=${packSchemaVersion}, which this build does not handle. ` +
      `Supported versions: ${supported.join(", ")}.`,
    supported,
    claimed: packSchemaVersion,
  };
}

/** Convenience: returns true if a pack version can be loaded by this build. */
export function canLoad(packSchemaVersion: unknown): boolean {
  return negotiateSchemaVersion(packSchemaVersion).ok;
}
