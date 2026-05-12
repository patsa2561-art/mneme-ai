/**
 * v1.66.0 -- AUTARCHY A3: TIMECRYSTAL PHARMACOPOEIA.
 *
 * Wild idea: vaccines replicate across TIME (every git commit) AND
 * SPACE (every npm install). A baked vaccine bundle ships INSIDE the
 * @mneme-ai/core package. First call auto-installs the baked bundle
 * if no local vaccines exist + no CDN env var is set. No setup, no
 * env var, no manual download.
 *
 * The CDN env var (MNEME_PHARMACOPOEIA_CDN) remains the override
 * path for orgs that pin a custom bundle. Free-first by default.
 *
 * Pure read on init; only writes when explicitly installed.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/** Baked vaccine bundle shipped with the npm package. Conservative seed
 *  set: 5 classic hallucination patterns that ALWAYS apply to any code
 *  repo. The bundle grows over time via apoptosis auto-mints + mesh
 *  imports. */
const BAKED_BUNDLE_V1: Array<{
  id: string;
  simhash: string;
  signature: string;
  refuteCount: number;
  sample: string;
}> = [
  {
    id: "baked-fake-path",
    simhash: "f0e1d2c3b4a59687",
    signature: "named-existence-fake-path",
    refuteCount: 1,
    sample: "the file fake_made_up_xyz.ts implements completelyImaginaryFn()",
  },
  {
    id: "baked-fake-version",
    simhash: "0123456789abcdef",
    signature: "temporal-fake-version",
    refuteCount: 1,
    sample: "we shipped this feature in v9.99.99 with sha deadbeefcafefade",
  },
  {
    id: "baked-absolute-claim",
    simhash: "fedcba9876543210",
    signature: "humility-absolute-overconfidence",
    refuteCount: 1,
    sample: "this is absolutely perfect 100% bug-free always works never fails guaranteed",
  },
  {
    id: "baked-blockchain-everywhere",
    simhash: "1357902468acebdf",
    signature: "semantic-blockchain-misuse",
    refuteCount: 1,
    sample: "the README.md runs blockchain consensus zkSNARK quantum entanglement on every commit",
  },
  {
    id: "baked-compound-fab",
    simhash: "2468ace0fdb97531",
    signature: "fractal-compound-fabrication",
    refuteCount: 1,
    sample: "the CHANGELOG.md exists and packages/imaginary/madeup.ts is required for the build in v9.42.0 absolutely guaranteed",
  },
];

export const BAKED_BUNDLE_VERSION = "v1.66.0-seed1";

export interface PharmacopoeiaStatus {
  /** Number of vaccines currently in the local bank. */
  localCount: number;
  /** Bundle version baked into this npm install. */
  bakedVersion: string;
  /** Number of vaccines in the baked bundle. */
  bakedCount: number;
  /** Whether the env CDN override is set. */
  cdnOverrideSet: boolean;
  /** Whether the local bank has already absorbed the baked bundle. */
  bakedAlreadyInstalled: boolean;
  /** Plain-English headline. */
  headline: string;
}

function vaccinePath(repoRoot: string): string {
  return join(repoRoot, ".mneme/squadron/lie-vaccines.jsonl");
}

function readVaccineIds(repoRoot: string): Set<string> {
  const p = vaccinePath(repoRoot);
  if (!existsSync(p)) return new Set();
  const ids = new Set<string>();
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line) as { id?: string };
        if (j.id) ids.add(j.id);
      } catch { /* */ }
    }
  } catch { /* */ }
  return ids;
}

/** Install the baked bundle into the local vaccine bank, idempotently.
 *  Returns the number of vaccines newly added. */
export function installBakedBundle(repoRoot: string): number {
  const existing = readVaccineIds(repoRoot);
  const dir = join(repoRoot, ".mneme/squadron");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let added = 0;
  const now = new Date().toISOString();
  for (const v of BAKED_BUNDLE_V1) {
    if (existing.has(v.id)) continue;
    const row = { ...v, firstSeen: now, lastSeen: now, source: "baked-pharmacopoeia" };
    appendFileSync(vaccinePath(repoRoot), JSON.stringify(row) + "\n", "utf8");
    added += 1;
  }
  return added;
}

/** Read pharmacopoeia status: what's local, what's baked, has the
 *  baked bundle been absorbed already? */
export function pharmacopoeiaStatus(repoRoot: string): PharmacopoeiaStatus {
  const existing = readVaccineIds(repoRoot);
  const cdnOverrideSet = typeof process.env["MNEME_PHARMACOPOEIA_CDN"] === "string" && process.env["MNEME_PHARMACOPOEIA_CDN"]!.length > 0;
  const bakedIds = new Set(BAKED_BUNDLE_V1.map((v) => v.id));
  let installed = 0;
  for (const id of bakedIds) if (existing.has(id)) installed += 1;
  const bakedAlreadyInstalled = installed === BAKED_BUNDLE_V1.length;
  const headline = bakedAlreadyInstalled
    ? `Pharmacopoeia ready: ${existing.size} local vaccine(s); baked bundle ${BAKED_BUNDLE_VERSION} installed.${cdnOverrideSet ? " CDN override active." : ""}`
    : `Pharmacopoeia gap: ${installed}/${BAKED_BUNDLE_V1.length} baked vaccines absorbed.${cdnOverrideSet ? " CDN override active." : " Call installBakedBundle(repoRoot) to seed."}`;
  return {
    localCount: existing.size,
    bakedVersion: BAKED_BUNDLE_VERSION,
    bakedCount: BAKED_BUNDLE_V1.length,
    cdnOverrideSet,
    bakedAlreadyInstalled,
    headline,
  };
}

/** Auto-install baked bundle on first read if local bank is empty AND
 *  no CDN override is configured. The "free-first" path: users get a
 *  working vaccine bank from npm install, not from manual setup. */
export function ensurePharmacopoeia(repoRoot: string): { installed: number; status: PharmacopoeiaStatus } {
  const status = pharmacopoeiaStatus(repoRoot);
  if (status.cdnOverrideSet) return { installed: 0, status };
  if (status.bakedAlreadyInstalled) return { installed: 0, status };
  const installed = installBakedBundle(repoRoot);
  return { installed, status: pharmacopoeiaStatus(repoRoot) };
}

/** Expose the baked bundle for inspection (e.g. by tests). */
export function getBakedBundle(): typeof BAKED_BUNDLE_V1 {
  return [...BAKED_BUNDLE_V1];
}
