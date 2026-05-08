/**
 * Bundled-WASM model checksum verification.
 *
 * Threat model: a compromised CDN, MITM proxy, or supply-chain attacker
 * could replace the ONNX/WASM model file in the user's cache. Since the
 * embedder loads + executes that file, malicious model = code execution.
 *
 * Defence: opt-in pinning. The user can set `MNEME_PINNED_MODEL_CHECKSUMS`
 * to a JSON object mapping relative-cache-path → expected SHA-256 hex.
 * After the model is loaded, we hash the cached files and refuse if any
 * mismatch.
 *
 * Wisdom check #1 (world-class?): YES.
 *   - SHA-256 = same primitive npm + Git use for content addressing.
 *   - Opt-in via env var — default behaviour preserved (no breaking change).
 *   - Verification happens AFTER cache write; we don't intercept the
 *     download (transformers.js owns that path).
 *
 * Wisdom check #2 (does this affect functionality?): NO.
 *   - Default: no checksum pinning. Existing users unaffected.
 *   - When set: failed verification surfaces a clear error message + the
 *     observed vs expected hashes, so the user can investigate.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

export interface ChecksumExpectation {
  /** Map: cache-relative path (e.g. "Xenova/all-MiniLM-L6-v2/onnx/model.onnx") → SHA-256 hex */
  [relativePath: string]: string;
}

export interface ChecksumResult {
  ok: boolean;
  verified: number;
  mismatches: Array<{ path: string; expected: string; actual: string }>;
  unexpected: string[]; // files in cache not in expectation map (informational only)
}

/** Compute SHA-256 of a file. */
export function sha256File(path: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

/** Walk a directory recursively, returning relative paths to all files. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile()) out.push(relative(root, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

/** Verify that every entry in `expected` matches the file in `cacheRoot`.
 *  Files in `cacheRoot` not listed in `expected` are reported as
 *  `unexpected` but DON'T fail verification (lets users pin only the
 *  files that matter). */
export function verifyCache(cacheRoot: string, expected: ChecksumExpectation): ChecksumResult {
  const result: ChecksumResult = { ok: true, verified: 0, mismatches: [], unexpected: [] };
  const present = new Set(listFiles(cacheRoot));
  for (const [relPath, expectedHash] of Object.entries(expected)) {
    const full = join(cacheRoot, relPath);
    if (!existsSync(full)) {
      result.ok = false;
      result.mismatches.push({ path: relPath, expected: expectedHash, actual: "(missing)" });
      continue;
    }
    const actual = sha256File(full);
    if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
      result.ok = false;
      result.mismatches.push({ path: relPath, expected: expectedHash, actual });
    } else {
      result.verified += 1;
    }
    present.delete(relPath);
  }
  result.unexpected = Array.from(present);
  return result;
}

/** Read the user's pinned checksum map from MNEME_PINNED_MODEL_CHECKSUMS
 *  env var. Returns null if not set. Format: JSON object. */
export function readPinnedChecksums(): ChecksumExpectation | null {
  const raw = process.env["MNEME_PINNED_MODEL_CHECKSUMS"];
  if (!raw || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as ChecksumExpectation;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * v1.11.1 — Trust-On-First-Use (TOFU) auto-pin.
 *
 * Reads/writes a SHA-256 checksum manifest at `<repoRoot>/.mneme/model-checksums.json`.
 * Same model SSH host keys use: first time we see the file, we trust + record;
 * every subsequent load verifies against the recorded hash.
 *
 * Wisdom check: world-class default? YES.
 *   - We don't ship hardcoded hashes (they'd go stale on every model upgrade).
 *   - We don't trust the CDN forever (typical naive default).
 *   - TOFU = trust the first download, refuse silent post-install changes.
 *   - User can re-pin by deleting `.mneme/model-checksums.json` (intentional act).
 */

import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

interface ManifestRecord {
  /** sha256 hex, lowercase */
  hash: string;
  /** ISO-8601 of first observation */
  pinnedAt: string;
}

interface ManifestFile {
  /** Manifest schema version */
  v: 1;
  /** Map relative-cache-path → record */
  files: Record<string, ManifestRecord>;
  /** Source for audit purposes — which Mneme version pinned these */
  pinnedByMnemeVersion: string;
}

export interface TofuResult {
  /** "fresh-pin" = first observation, manifest written now.
   *  "verified" = previously-pinned hashes all match.
   *  "tampered" = previously-pinned hash mismatch (DO NOT load model). */
  status: "fresh-pin" | "verified" | "tampered" | "no-files";
  manifestPath: string;
  filesPinned: number;
  mismatches: Array<{ path: string; expected: string; actual: string }>;
}

const MNEME_VERSION_FOR_MANIFEST = "1.11.1";

/**
 * Verify or pin the cache directory contents into a TOFU manifest.
 * Pure logic — no env-var reading, no exceptions for "tampered" case
 * (caller decides whether to throw).
 */
export function tofuVerifyOrPin(
  cacheRoot: string,
  manifestPath: string,
): TofuResult {
  const files = listFiles(cacheRoot);
  if (files.length === 0) {
    return { status: "no-files", manifestPath, filesPinned: 0, mismatches: [] };
  }

  if (existsSync(manifestPath)) {
    // Verify mode
    let manifest: ManifestFile;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestFile;
    } catch {
      // Corrupt manifest — refuse to silently re-pin (could mask tampering).
      return {
        status: "tampered",
        manifestPath,
        filesPinned: 0,
        mismatches: [{ path: manifestPath, expected: "(valid JSON manifest)", actual: "(corrupt)" }],
      };
    }
    const mismatches: TofuResult["mismatches"] = [];
    for (const [relPath, record] of Object.entries(manifest.files)) {
      const full = `${cacheRoot.replace(/[\\/]+$/, "")}/${relPath}`;
      if (!existsSync(full)) {
        mismatches.push({ path: relPath, expected: record.hash, actual: "(missing)" });
        continue;
      }
      const actual = sha256File(full).toLowerCase();
      if (actual !== record.hash.toLowerCase()) {
        mismatches.push({ path: relPath, expected: record.hash, actual });
      }
    }
    if (mismatches.length > 0) {
      return { status: "tampered", manifestPath, filesPinned: 0, mismatches };
    }
    return {
      status: "verified",
      manifestPath,
      filesPinned: Object.keys(manifest.files).length,
      mismatches: [],
    };
  }

  // Fresh-pin mode: snap every cache file's hash + write manifest atomically.
  const records: Record<string, ManifestRecord> = {};
  const now = new Date().toISOString();
  for (const rel of files) {
    const full = `${cacheRoot.replace(/[\\/]+$/, "")}/${rel}`;
    records[rel] = { hash: sha256File(full).toLowerCase(), pinnedAt: now };
  }
  const manifest: ManifestFile = {
    v: 1,
    files: records,
    pinnedByMnemeVersion: MNEME_VERSION_FOR_MANIFEST,
  };
  if (!existsSync(dirname(manifestPath))) {
    mkdirSync(dirname(manifestPath), { recursive: true });
  }
  // Atomic temp+rename so a partial write can't poison the manifest.
  const { renameSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const tmp = `${manifestPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, manifestPath);
  return {
    status: "fresh-pin",
    manifestPath,
    filesPinned: Object.keys(records).length,
    mismatches: [],
  };
}

/** All-in-one helper: check the cache root against pinned checksums, if
 *  the user has set them. Throws on mismatch. No-op when unset. */
export function verifyAgainstPin(cacheRoot: string): void {
  const expected = readPinnedChecksums();
  if (!expected) return;
  const result = verifyCache(cacheRoot, expected);
  if (!result.ok) {
    const lines = result.mismatches
      .slice(0, 5)
      .map((m) => `  ${m.path}\n    expected: ${m.expected}\n    actual:   ${m.actual}`)
      .join("\n");
    throw new Error(
      `Bundled-model checksum verification FAILED — refusing to load possibly-tampered model.\n${lines}\n` +
        `(${result.mismatches.length} mismatch${result.mismatches.length === 1 ? "" : "es"} total. ` +
        `Set MNEME_PINNED_MODEL_CHECKSUMS to {} to disable, or update with the new hashes after auditing.)`,
    );
  }
}
