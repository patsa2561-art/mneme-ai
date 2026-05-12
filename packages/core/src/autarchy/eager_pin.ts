/**
 * v1.66.0 -- AUTARCHY A4: QUANTUM CHECKSUM (TRIPLE-WITNESS PIN).
 *
 * Wild idea: don't wait for the first `mneme index` to pin model
 * checksums. Pin them at THREE witness points:
 *
 *   W1: BUILD time     -- npm publish baked the publisher's hashes (future)
 *   W2: FIRST AUTODIAGNOSE -- Schroedinger probe pins on detection
 *   W3: NTH USE         -- every 100th embed call re-verifies + warns on drift
 *
 * For v1.66.0 we ship W2 fully + W3 as a counter-based reverify hook.
 * W1 needs npm publish wiring -- shipped as a docstring contract here,
 * actual CI integration is a follow-up.
 *
 * Triple-witness pin means an attacker has to corrupt the cache AT
 * ALL THREE pin-times to slip a tampered model past us.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const PIN_FILE = ".mneme/embedder-checksums.json";

export interface ChecksumPin {
  /** ISO ts when pin was first taken. */
  pinnedAt: string;
  /** Which witness triggered the pin. */
  pinnedBy: "build-time" | "first-autodiagnose" | "nth-use" | "manual";
  /** Path -> sha256 of every model file at pin time. */
  fileHashes: Record<string, string>;
  /** Hash of the bundle directory (folded sha256 over fileHashes). */
  bundleHash: string;
}

export interface ReverifyResult {
  status: "match" | "drift" | "no-pin" | "no-cache";
  driftedFiles: Array<{ path: string; expected: string; actual: string }>;
  detail: string;
}

function sha256File(path: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

function walkCache(cacheDir: string, maxFiles = 1000): string[] {
  if (!existsSync(cacheDir)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= maxFiles) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      try {
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else if (/\.(onnx|json|bin|model)$/.test(e)) out.push(p);
        if (out.length >= maxFiles) return;
      } catch { /* */ }
    }
  };
  walk(cacheDir);
  return out;
}

function computePin(cacheDir: string): { fileHashes: Record<string, string>; bundleHash: string } {
  const files = walkCache(cacheDir);
  const fileHashes: Record<string, string> = {};
  const hasher = createHash("sha256");
  for (const f of files.sort()) {
    try {
      const h = sha256File(f);
      const rel = f.slice(cacheDir.length + 1).replace(/\\/g, "/");
      fileHashes[rel] = h;
      hasher.update(`${rel}:${h}\n`);
    } catch { /* skip unreadable */ }
  }
  return { fileHashes, bundleHash: hasher.digest("hex") };
}

function readPin(repoRoot: string): ChecksumPin | null {
  const p = join(repoRoot, PIN_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as ChecksumPin; } catch { return null; }
}

function writePin(repoRoot: string, pin: ChecksumPin): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoRoot, PIN_FILE), JSON.stringify(pin, null, 2) + "\n", "utf8");
}

/** W2: pin during first autodiagnose. Idempotent -- repins ONLY if
 *  no pin exists. */
export function pinIfUnpinned(repoRoot: string, cacheDir: string, by: ChecksumPin["pinnedBy"] = "first-autodiagnose"): { pinned: boolean; pin: ChecksumPin | null; reason: string } {
  const existing = readPin(repoRoot);
  if (existing) return { pinned: false, pin: existing, reason: "Already pinned." };
  if (!existsSync(cacheDir)) return { pinned: false, pin: null, reason: `Cache dir missing: ${cacheDir}` };
  const { fileHashes, bundleHash } = computePin(cacheDir);
  if (Object.keys(fileHashes).length === 0) {
    return { pinned: false, pin: null, reason: "No model files in cache yet; pin after first download." };
  }
  const pin: ChecksumPin = {
    pinnedAt: new Date().toISOString(),
    pinnedBy: by,
    fileHashes,
    bundleHash,
  };
  writePin(repoRoot, pin);
  return { pinned: true, pin, reason: `Pinned ${Object.keys(fileHashes).length} model file(s); bundleHash ${bundleHash.slice(0, 12)}...` };
}

/** W3: re-verify against the pin. Called every Nth embed in production. */
export function reverifyAgainstPin(repoRoot: string, cacheDir: string): ReverifyResult {
  const pin = readPin(repoRoot);
  if (!pin) return { status: "no-pin", driftedFiles: [], detail: "No pin recorded yet; call pinIfUnpinned first." };
  if (!existsSync(cacheDir)) return { status: "no-cache", driftedFiles: [], detail: `Cache dir missing: ${cacheDir}` };
  const current = computePin(cacheDir);
  if (current.bundleHash === pin.bundleHash) {
    return { status: "match", driftedFiles: [], detail: `Bundle hash ${pin.bundleHash.slice(0, 12)} matches pin.` };
  }
  const drifted: ReverifyResult["driftedFiles"] = [];
  for (const [path, expected] of Object.entries(pin.fileHashes)) {
    const actual = current.fileHashes[path];
    if (actual === undefined) drifted.push({ path, expected, actual: "(missing)" });
    else if (actual !== expected) drifted.push({ path, expected, actual });
  }
  return {
    status: "drift",
    driftedFiles: drifted.slice(0, 5),
    detail: `Bundle hash drift detected (${drifted.length} file(s) changed).`,
  };
}

/** Read the persisted pin for status reporting. */
export function readChecksumPin(repoRoot: string): ChecksumPin | null {
  return readPin(repoRoot);
}
