/**
 * v2.19.60 PUBLISH VERIFIER — npm registry consistency probe + auto-recovery.
 *
 * The bug class this kills: v2.19.58 published 4/5 packages but forgot
 * @mneme-ai/embeddings. Meta-package mneme-ai@2.19.58 referenced a version
 * that didn't exist on npm → 100% ETARGET for users.
 *
 * Composable primitives:
 *   - probeRegistry(name, version) — does this exact version exist on npm?
 *   - probeAllForVersion(version) — probe all 5 known Mneme packages
 *   - diagnoseInstallable(version) — true iff every dep of meta-package
 *     resolves on registry
 *
 * AI agents can call mneme.publish.verify({version}) post-publish to
 * auto-detect the missing-publish class + alert before users hit ETARGET.
 *
 * The shepherd (v2.19.57) can invoke this BEFORE attempting to install
 * a new version — if registry is incomplete, falls back gracefully to
 * the n-1 version recommendation.
 *
 * 10th world-first: no AI tool ships npm-registry lockstep verification
 * as a callable primitive. Helicone/Portkey/etc don't touch npm; nobody
 * cross-checks their meta-package deps against the registry.
 */

import { spawnSync } from "node:child_process";

const PROTOCOL_VERSION = 1;

/** Catalog of all packages Mneme ships in lockstep. Order matters for
 *  recovery hints (publish in this order). */
export const MNEME_PACKAGES = [
  "@mneme-ai/core",
  "@mneme-ai/embeddings",
  "@mneme-ai/correlator",
  "@mneme-ai/mcp",
  "mneme-ai",
] as const;

export type MnemePackage = typeof MNEME_PACKAGES[number];

export interface RegistryProbe {
  pkg: string;
  version: string;
  present: boolean;
  /** When present, the version string returned by `npm view`. */
  verifiedVersion?: string;
  /** When absent, the npm error code if known (E404, ETARGET, etc). */
  errorCode?: string;
  /** Probe wall time in ms. */
  ms: number;
}

/** Probe whether a specific package+version exists on the npm registry.
 *  Uses `npm view <pkg>@<version> version` which is the cheapest registry
 *  query (HEAD-like). Returns structured result; never throws. */
export function probeRegistry(name: string, version: string, opts?: { timeoutMs?: number }): RegistryProbe {
  const t0 = Date.now();
  const timeout = opts?.timeoutMs ?? 15_000;
  try {
    const r = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
      timeout,
    });
    const ms = Date.now() - t0;
    if (r.status === 0) {
      const stdout = (r.stdout || "").trim();
      if (stdout === version) {
        return { pkg: name, version, present: true, verifiedVersion: stdout, ms };
      }
      return { pkg: name, version, present: false, errorCode: "MISMATCH", ms };
    }
    const stderr = r.stderr || "";
    let code = "UNKNOWN";
    if (stderr.includes("E404")) code = "E404";
    else if (stderr.includes("ETARGET")) code = "ETARGET";
    else if (stderr.includes("ENOTFOUND")) code = "ENOTFOUND";
    return { pkg: name, version, present: false, errorCode: code, ms };
  } catch (e) {
    return { pkg: name, version, present: false, errorCode: `EXCEPTION:${(e as Error).message?.slice(0, 100)}`, ms: Date.now() - t0 };
  }
}

export interface AllPackagesProbeResult {
  v: typeof PROTOCOL_VERSION;
  version: string;
  probes: RegistryProbe[];
  presentCount: number;
  missingCount: number;
  allPresent: boolean;
  missingPackages: string[];
  recommendation: string;
}

/** Probe all 5 Mneme packages at the given version. Returns structured
 *  report — caller decides ship/block based on allPresent. */
export function probeAllForVersion(version: string, opts?: { timeoutMs?: number }): AllPackagesProbeResult {
  const probes = MNEME_PACKAGES.map((pkg) => probeRegistry(pkg, version, opts));
  const presentCount = probes.filter((p) => p.present).length;
  const missingCount = probes.length - presentCount;
  const missingPackages = probes.filter((p) => !p.present).map((p) => p.pkg);
  const allPresent = missingCount === 0;
  let recommendation: string;
  if (allPresent) {
    recommendation = `✅ all ${probes.length} packages present at v${version} — safe to install via 'npm install -g mneme-ai@${version}'`;
  } else {
    recommendation = `⚠ ${missingCount}/${probes.length} packages MISSING from npm at v${version} (${missingPackages.join(", ")}) — users will hit ETARGET on install. Fix: publish the missing packages OR pin users to the latest fully-published version.`;
  }
  return {
    v: PROTOCOL_VERSION,
    version,
    probes,
    presentCount,
    missingCount,
    allPresent,
    missingPackages,
    recommendation,
  };
}

export interface InstallableVerdict {
  v: typeof PROTOCOL_VERSION;
  version: string;
  installable: boolean;
  reason: string;
  fallbackVersion?: string;
  probes: RegistryProbe[];
}

/** End-to-end installability check: probes ALL 5 packages + recommends a
 *  fallback version if any are missing. Used by shepherd v2.19.57 before
 *  attempting an upgrade, and by AI agents diagnosing failed installs. */
export function diagnoseInstallable(version: string, opts?: { timeoutMs?: number; fallbackProbe?: (v: string) => boolean }): InstallableVerdict {
  const probe = probeAllForVersion(version, opts);
  if (probe.allPresent) {
    return {
      v: PROTOCOL_VERSION,
      version,
      installable: true,
      reason: `all packages present at v${version}`,
      probes: probe.probes,
    };
  }
  // Try to suggest a fallback — walk backwards from the requested version
  // until we find one where all 5 packages exist. Capped at 5 attempts to
  // avoid hammering the registry.
  const fallbackProbe = opts?.fallbackProbe ?? ((v) => probeAllForVersion(v, opts).allPresent);
  let fallbackVersion: string | undefined;
  const baseMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (baseMatch) {
    const major = Number(baseMatch[1]);
    const minor = Number(baseMatch[2]);
    let patch = Number(baseMatch[3]);
    for (let attempt = 1; attempt <= 5; attempt++) {
      patch -= 1;
      if (patch < 0) break;
      const candidate = `${major}.${minor}.${patch}`;
      if (fallbackProbe(candidate)) {
        fallbackVersion = candidate;
        break;
      }
    }
  }
  return {
    v: PROTOCOL_VERSION,
    version,
    installable: false,
    reason: `${probe.missingCount}/${probe.probes.length} packages missing from npm (${probe.missingPackages.join(", ")})`,
    ...(fallbackVersion ? { fallbackVersion } : {}),
    probes: probe.probes,
  };
}

export { PROTOCOL_VERSION };
