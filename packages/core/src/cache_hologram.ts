/**
 * MNEME CACHE HOLOGRAM (v1.32.0).
 *
 * Pre-fix: Mneme had ~10 separate cache files (version-check, oracle
 * PRECOG, ecosystem, store snapshots, pulse-trace, supernova log,
 * trust grades, ghost-negatives, ...) -- each owned by its module,
 * with NO awareness of the others. Symptoms:
 *
 *   - User upgrades from v1.27.9 → v1.30.0. Pulse cache (1h TTL) keeps
 *     showing "v1.27.9 (latest: v1.30.0)" for an hour. AUTO-ACTION
 *     fires the npm upgrade unnecessarily. Reported by tester.
 *   - Gap-scan ground truth + synthesize input drift independently.
 *   - Trust grades go stale without anyone noticing.
 *   - No single dashboard of "is my cache layer healthy?"
 *
 * THIS MODULE -- Cache Hologram:
 *
 *   A central registry of every cache in .mneme/. Each cache declares
 *   its TTL + which UPSTREAM SOURCES it depends on (e.g., the version
 *   check depends on the mneme package version). On any registered
 *   source change, we PROPAGATE invalidation through the dependency
 *   DAG -- like a photon through a causal cone in special relativity.
 *
 *   Module that owns a cache calls `registerCache()` once at boot.
 *   Module that mutates an upstream source calls `invalidateSource()`
 *   -- everything downstream becomes stale instantly.
 *
 * KILLER IDEA -- PHOTONICS PROPAGATION:
 *
 *   Each "source of truth" (mneme version, package.json mtime, .git
 *   HEAD sha) is hashed into a "photon" -- a stable signature of its
 *   current state. Each cache stores the photon it was BUILT against.
 *   `isFresh(id)` is a 2-step check:
 *     (1) cache file mtime within TTL
 *     (2) photon of every upstream source still matches
 *   If EITHER fails -> stale -> rebuild on next read.
 *
 *   This makes invalidation INSTANT (no polling) AND CAUSAL (only
 *   downstream caches in the source's "future light cone" get
 *   rebuilt -- nothing wasted). Same Big-O guarantee a CDN gets from
 *   tag-based invalidation, but at the filesystem layer with zero
 *   infrastructure.
 *
 * Future work (v1.33+): emit photons via filesystem watcher so
 * downstream caches refresh BEFORE the next read, not on it. For now
 * we use lazy refresh -- staleness checked at access time.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface CacheNode {
  /** Stable id, e.g. "version-check", "oracle-precog". */
  id: string;
  /** Path relative to repo root, e.g. ".mneme/version-check.json". */
  relPath: string;
  /** TTL in milliseconds. 0 = no time-based expiry (only photon-based). */
  ttlMs: number;
  /** Photon source ids this cache derives from. When any photon
   *  changes, this cache is stale. Empty = self-contained. */
  dependsOn: string[];
  /** Human-readable description of what this cache holds. */
  description: string;
}

/** A photon = a stable hash of the current state of some source of
 *  truth. When the source mutates, the photon shifts; downstream caches
 *  detect the shift and rebuild. */
export type PhotonSource =
  | { id: string; kind: "constant"; value: string }
  | { id: string; kind: "file-mtime"; absPath: string }
  | { id: string; kind: "file-content"; absPath: string }
  | { id: string; kind: "fn"; compute: () => string | Promise<string> };

const HOLOGRAM_FILENAME = "cache-hologram.json";

interface HologramFile {
  /** Per-cache: { photons: { sourceId: photonSig }, builtAt: ISO } */
  caches: Record<string, { photons: Record<string, string>; builtAt: string }>;
  /** Last-known photon sig per source -- so we can compare across calls. */
  sources: Record<string, string>;
}

const REGISTRY = new Map<string, CacheNode>();
const SOURCES = new Map<string, PhotonSource>();

function hologramPath(repoRoot: string): string {
  return join(repoRoot, ".mneme", HOLOGRAM_FILENAME);
}

function readHologram(repoRoot: string): HologramFile {
  try {
    const path = hologramPath(repoRoot);
    if (!existsSync(path)) return { caches: {}, sources: {} };
    return JSON.parse(readFileSync(path, "utf8")) as HologramFile;
  } catch { return { caches: {}, sources: {} }; }
}

function writeHologram(repoRoot: string, h: HologramFile): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(hologramPath(repoRoot), JSON.stringify(h, null, 2), "utf8");
  } catch { /* best-effort */ }
}

/** Compute the current photon signature for a source. Returns "" on
 *  any failure -- treated as "source missing", which still counts as
 *  a stable photon (will only flip when source becomes available). */
async function computePhoton(source: PhotonSource): Promise<string> {
  try {
    if (source.kind === "constant") return source.value;
    if (source.kind === "file-mtime") {
      if (!existsSync(source.absPath)) return "missing";
      return String(statSync(source.absPath).mtimeMs);
    }
    if (source.kind === "file-content") {
      if (!existsSync(source.absPath)) return "missing";
      return createHash("sha256").update(readFileSync(source.absPath, "utf8")).digest("hex").slice(0, 16);
    }
    if (source.kind === "fn") {
      return String(await source.compute());
    }
    return "";
  } catch { return ""; }
}

// ─── Public API ─────────────────────────────────────────────────────────

/** Register a cache + the sources it depends on. Idempotent -- safe to
 *  call on every module init. */
export function registerCache(node: CacheNode): void {
  REGISTRY.set(node.id, node);
}

/** Register a photon source (something whose change should invalidate
 *  caches). Idempotent. */
export function registerSource(source: PhotonSource): void {
  SOURCES.set(source.id, source);
}

/** Mark a cache as freshly built RIGHT NOW. Captures current photons
 *  of every upstream source. Call after writing the cache file. */
export async function markBuilt(repoRoot: string, cacheId: string): Promise<void> {
  const node = REGISTRY.get(cacheId);
  if (!node) return;
  const photons: Record<string, string> = {};
  for (const sourceId of node.dependsOn) {
    const source = SOURCES.get(sourceId);
    if (source) photons[sourceId] = await computePhoton(source);
  }
  const hologram = readHologram(repoRoot);
  hologram.caches[cacheId] = { photons, builtAt: new Date().toISOString() };
  // Also refresh the per-source last-known table.
  for (const sourceId of node.dependsOn) {
    if (photons[sourceId] !== undefined) hologram.sources[sourceId] = photons[sourceId]!;
  }
  writeHologram(repoRoot, hologram);
}

export interface FreshnessReport {
  fresh: boolean;
  reason: "fresh" | "ttl-expired" | "photon-shift" | "never-built" | "no-cache-file";
  shiftedSource?: string;
  builtAt?: string;
  ageSec?: number;
}

/** Check if a cache is fresh. Two-step:
 *    1. cache file exists + mtime within TTL
 *    2. every upstream source's photon still matches the build-time photon */
export async function isFresh(repoRoot: string, cacheId: string): Promise<FreshnessReport> {
  const node = REGISTRY.get(cacheId);
  if (!node) return { fresh: false, reason: "never-built" };
  const cachePath = join(repoRoot, node.relPath);
  if (!existsSync(cachePath)) return { fresh: false, reason: "no-cache-file" };
  const hologram = readHologram(repoRoot);
  const entry = hologram.caches[cacheId];
  if (!entry) return { fresh: false, reason: "never-built" };
  // Step 1: TTL check (only when ttlMs > 0). Use raw ms to avoid the
  // sub-second-precision-loss bug from Math.floor(ms/1000).
  const ageMs = Date.now() - Date.parse(entry.builtAt);
  const ageSec = Math.floor(ageMs / 1000);
  if (node.ttlMs > 0 && ageMs > node.ttlMs) {
    return { fresh: false, reason: "ttl-expired", builtAt: entry.builtAt, ageSec };
  }
  // Step 2: photon check.
  for (const sourceId of node.dependsOn) {
    const source = SOURCES.get(sourceId);
    if (!source) continue;
    const currentPhoton = await computePhoton(source);
    const builtPhoton = entry.photons[sourceId] ?? "";
    if (currentPhoton !== builtPhoton) {
      return { fresh: false, reason: "photon-shift", shiftedSource: sourceId, builtAt: entry.builtAt, ageSec };
    }
  }
  return { fresh: true, reason: "fresh", builtAt: entry.builtAt, ageSec };
}

/** Force-invalidate a cache by deleting its file. The hologram entry
 *  is also cleared so next isFresh() reports "never-built". */
export function invalidate(repoRoot: string, cacheId: string): { invalidated: boolean; reason?: string } {
  const node = REGISTRY.get(cacheId);
  if (!node) return { invalidated: false, reason: "unknown cache id" };
  const cachePath = join(repoRoot, node.relPath);
  try { if (existsSync(cachePath)) unlinkSync(cachePath); } catch { /* */ }
  const hologram = readHologram(repoRoot);
  delete hologram.caches[cacheId];
  writeHologram(repoRoot, hologram);
  return { invalidated: true };
}

/** PHOTONICS PROPAGATION: invalidate every cache that depends on the
 *  given source. Use when a source-of-truth changes (e.g., mneme
 *  upgrade → invalidateSource("mneme-version") → version-check cache
 *  is wiped → next pulse fetches fresh). */
export function invalidateSource(repoRoot: string, sourceId: string): { invalidated: string[] } {
  const invalidated: string[] = [];
  for (const [cacheId, node] of REGISTRY) {
    if (node.dependsOn.includes(sourceId)) {
      const r = invalidate(repoRoot, cacheId);
      if (r.invalidated) invalidated.push(cacheId);
    }
  }
  return { invalidated };
}

/** Single-pane snapshot of every registered cache's current state.
 *  Used by the Manifest LIVE STATE block + `mneme cache hologram` CLI. */
export interface HologramSnapshot {
  generatedAt: string;
  caches: Array<{
    id: string;
    description: string;
    relPath: string;
    fresh: boolean;
    reason: FreshnessReport["reason"];
    shiftedSource?: string;
    ageSec?: number;
    ttlMs: number;
    dependsOn: string[];
  }>;
  /** Counts for the at-a-glance summary line. */
  tally: { fresh: number; stale: number; total: number };
}

export async function snapshotHologram(repoRoot: string): Promise<HologramSnapshot> {
  const generatedAt = new Date().toISOString();
  const caches: HologramSnapshot["caches"] = [];
  for (const [id, node] of REGISTRY) {
    const fr = await isFresh(repoRoot, id);
    caches.push({
      id, description: node.description, relPath: node.relPath,
      fresh: fr.fresh, reason: fr.reason,
      shiftedSource: fr.shiftedSource,
      ageSec: fr.ageSec,
      ttlMs: node.ttlMs,
      dependsOn: node.dependsOn,
    });
  }
  const tally = {
    fresh: caches.filter((c) => c.fresh).length,
    stale: caches.filter((c) => !c.fresh).length,
    total: caches.length,
  };
  return { generatedAt, caches, tally };
}

/** v1.32.0 -- bootstrap default cache + source registrations for the
 *  caches Mneme ships with. Idempotent. Call once at process boot. */
export function registerDefaultMnemeCaches(): void {
  // Sources of truth that downstream caches care about.
  registerSource({ id: "mneme-version", kind: "fn", compute: () => {
    try {
      // Lazy require to avoid pulling version_check at module init.
      // Same logic as readLiveMnemeVersion -- we read the package.json
      // adjacent to this module.
      const path = require("node:path");
      const fs = require("node:fs");
      const url = require("node:url");
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      // Walk up looking for the closest package.json.
      let dir = here;
      for (let i = 0; i < 6; i++) {
        const candidate = path.join(dir, "package.json");
        if (fs.existsSync(candidate)) {
          const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
          if (pkg.version) return pkg.version;
        }
        dir = path.dirname(dir);
      }
      return "unknown";
    } catch { return "unknown"; }
  }});
  registerSource({ id: "package-json-mtime", kind: "fn", compute: () => {
    try {
      const fs = require("node:fs");
      const path = require("node:path");
      const p = path.join(process.cwd(), "package.json");
      return fs.existsSync(p) ? String(fs.statSync(p).mtimeMs) : "missing";
    } catch { return "missing"; }
  }});

  // Caches with their dependencies.
  registerCache({
    id: "version-check",
    relPath: ".mneme/version-check.json",
    ttlMs: 60 * 60 * 1000,
    dependsOn: ["mneme-version"],
    description: "npm-registry version probe, invalidated when local mneme version changes",
  });
  registerCache({
    id: "ecosystem",
    relPath: ".mneme/ecosystem.json",
    ttlMs: 0,
    dependsOn: ["package-json-mtime"],
    description: "auto-detected ecosystem packs (Stripe / React / etc.)",
  });
  registerCache({
    id: "oracle-precog",
    relPath: ".mneme/oracle/cache.jsonl",
    ttlMs: 5 * 60 * 1000,
    dependsOn: [],
    description: "PRECOG predictions for next-likely tools",
  });
  registerCache({
    id: "trust-grades",
    relPath: ".mneme/trust-grades.json",
    ttlMs: 0,
    dependsOn: ["mneme-version"],
    description: "per-subsystem calibration grades (excellent / acceptable / weak / untrusted)",
  });
  registerCache({
    id: "pulse-trace",
    relPath: ".mneme/pulse-trace.jsonl",
    ttlMs: 0,
    dependsOn: [],
    description: "SUPER SONIC continuity log (delta between prompts)",
  });
}
