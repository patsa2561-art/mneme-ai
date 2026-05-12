/**
 * v1.80.0 -- CONDUIT: cross-vendor sync status.
 *
 * Single-source-of-truth report: given a soul prompt's embedded
 * heartbeat (v1.75 TELEPATHY) and the local Mneme version, compute
 * sync state across all AI clones.
 *
 *   IN-SYNC          -- soul.version == local.version
 *   SOURCE-NEWER     -- source AI generated this soul on a NEWER Mneme
 *                       than the local one (user may need to upgrade local)
 *   DESTINATION-NEWER -- local Mneme is newer than the soul's version
 *                       (suggest user regenerate the soul prompt to
 *                       pick up new features)
 */

export type CrossVendorSync = "in-sync" | "source-newer" | "destination-newer" | "unknown";

export interface SyncStatusInput {
  /** Version embedded in the pasted soul prompt's heartbeat block. */
  soulVersion: string;
  /** Local Mneme version (from package.json). */
  localVersion: string;
  /** Optional npm-latest from heartbeat. */
  npmLatest?: string | null;
}

export interface SyncStatusReport {
  status: CrossVendorSync;
  soulVersion: string;
  localVersion: string;
  npmLatest: string | null;
  recommendation: string;
  /** Plain-English summary. */
  summary: string;
}

function cmp(a: string, b: string): number {
  const ap = a.split(".").map((n) => parseInt(n, 10) || 0);
  const bp = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const ai = ap[i] ?? 0;
    const bi = bp[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

export function computeSyncStatus(input: SyncStatusInput): SyncStatusReport {
  const { soulVersion, localVersion } = input;
  const npmLatest = input.npmLatest ?? null;
  if (!soulVersion || !localVersion) {
    return {
      status: "unknown",
      soulVersion,
      localVersion,
      npmLatest,
      recommendation: "version info missing -- proceed with caution",
      summary: "sync status unknown",
    };
  }
  const c = cmp(localVersion, soulVersion);
  let status: CrossVendorSync;
  let recommendation: string;
  if (c === 0) {
    status = "in-sync";
    recommendation = "no action needed";
  } else if (c < 0) {
    status = "source-newer";
    recommendation = `local Mneme is older than the soul (local v${localVersion}, soul v${soulVersion}). Run 'upgrade mneme' on this machine to catch up.`;
  } else {
    status = "destination-newer";
    recommendation = `local Mneme is NEWER than the soul (local v${localVersion}, soul v${soulVersion}). Regenerate the soul prompt to use new features.`;
  }
  return {
    status,
    soulVersion,
    localVersion,
    npmLatest,
    recommendation,
    summary: `cross-vendor sync: ${status}`,
  };
}
