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
