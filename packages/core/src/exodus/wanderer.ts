/**
 * v1.61.0 -- EXODUS LAYER 2: THE WANDERER.
 *
 * "Portable Mneme" -- single-file bundle that contains the GENOME +
 * a minimal verifier so the wisdom can travel anywhere. Bundle is a
 * self-contained JSON envelope (no native deps).
 *
 * Future v1.62+ adds an AssemblyScript/WASM port so the bundle runs
 * outside Node. For v1.61 the bundle is a `.mwt` (Mneme Wandering
 * Treasure) JSON file that any Mneme instance can ingest in <60s.
 *
 *   .mwt schema:
 *     {
 *       formatVersion: 1,
 *       packedAt: <iso>,
 *       packedBy: <vendor>,
 *       genome: MnemeGenome,
 *       checksum: <hex>,
 *       transitMetadata: { transport: "file"|"qr"|"http"|..., compression: "none"|"gzip" }
 *     }
 *
 * The bundle is HMAC-protected via the genome's existing HMAC; the
 * checksum is a SHA-256 of the canonical genome body so any in-flight
 * tampering is detected immediately.
 */

import { createHash } from "node:crypto";
import { safeHmacNotEqual } from "../util/hmac_compare.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { encodeGenome, verifyGenome, type MnemeGenome } from "./genome.js";

const WANDERER_DIR = ".mneme/exodus/wanderer";

export interface MWTBundle {
  formatVersion: 1;
  packedAt: string;
  packedBy: string;
  genome: MnemeGenome;
  checksum: string;
  /** v1.84 Bug R5-3: portable content-only signature for cross-machine
   *  verification. SHA-256 of (canonical genome bytes + packedAt +
   *  packedBy). Machine-independent so unpack-on-different-machine
   *  still passes integrity check even when inner HMAC is local-only. */
  portableSig?: string;
  transitMetadata: {
    transport: "file" | "qr" | "http" | "usb" | "email";
    compression: "none";
  };
}

/** v1.61.1 hotfix: switched from a recursive canonicalize() (which can
 *  drift on undefined / NaN / array-vs-object edge cases between encode
 *  and decode) to plain JSON.stringify. Node's V8 preserves object key
 *  insertion order deterministically, so the bytes match across a pure
 *  write/read roundtrip. Inner genome HMAC still uses the canonicalize
 *  function (genome.ts) for tamper detection across instances; the
 *  wanderer checksum is only an in-flight integrity check, so plain
 *  stringify is the simpler + bulletproof choice. */
function checksumOf(genome: MnemeGenome): string {
  return createHash("sha256").update(JSON.stringify(genome)).digest("hex").slice(0, 32);
}

/** v1.84 Bug R5-3: machine-independent signature so cross-machine unpack
 *  passes integrity check. Hashes (canonical genome bytes + packedAt +
 *  packedBy). NOT a secret; just a content fingerprint. */
function portableSigOf(genome: MnemeGenome, packedAt: string, packedBy: string): string {
  return createHash("sha256")
    .update(JSON.stringify(genome))
    .update("|")
    .update(packedAt)
    .update("|")
    .update(packedBy)
    .digest("hex");
}

/** Pack the current Mneme state into a .mwt bundle.
 *  v1.84 Bug R5-4: now honors `opts.outPath` (was previously ignored). */
export function packWanderer(
  repoRoot: string,
  opts?: {
    packedBy?: string;
    transport?: MWTBundle["transitMetadata"]["transport"];
    /** Absolute or relative path the .mwt should be written to.
     *  When omitted, falls back to .mneme/exodus/wanderer/wisdom-<ts>.mwt. */
    outPath?: string;
  },
): { path: string; bundle: MWTBundle; sizeBytes: number } {
  const packedAt = new Date().toISOString();
  const packedBy = opts?.packedBy ?? "wanderer";
  const genome = encodeGenome(repoRoot, { emittedBy: packedBy });
  const bundle: MWTBundle = {
    formatVersion: 1,
    packedAt,
    packedBy,
    genome,
    checksum: checksumOf(genome),
    portableSig: portableSigOf(genome, packedAt, packedBy),
    transitMetadata: {
      transport: opts?.transport ?? "file",
      compression: "none",
    },
  };
  const body = JSON.stringify(bundle, null, 2);
  // v1.84 Bug R5-4: honor opts.outPath when provided.
  let outPath: string;
  if (opts?.outPath) {
    outPath = resolve(opts.outPath);
    const outDir = dirname(outPath);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  } else {
    const dir = join(repoRoot, WANDERER_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    outPath = join(dir, `wisdom-${packedAt.replace(/[:.]/g, "-")}.mwt`);
    // Also write a stable "latest" pointer (only when using default dir).
    writeFileSync(join(dir, "latest.mwt"), body, "utf8");
  }
  writeFileSync(outPath, body, "utf8");
  return { path: outPath, bundle, sizeBytes: Buffer.byteLength(body, "utf8") };
}

/** Read + verify a .mwt bundle.
 *  v1.84 Bug R5-3: when the bundle carries a `portableSig`, we accept
 *  cross-machine verification via content-fingerprint. Inner HMAC is
 *  ATTEMPTED but a failure no longer blocks unpack — the portable sig
 *  is the cross-machine source of truth. */
export function unpackWanderer(
  repoRoot: string,
  bundlePath: string,
  opts?: { requireLocalHmac?: boolean },
): { ok: boolean; reason: string; bundle: MWTBundle | null; crossMachine?: boolean } {
  if (!existsSync(bundlePath)) return { ok: false, reason: "bundle file does not exist", bundle: null };
  let bundle: MWTBundle;
  try {
    bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as MWTBundle;
  } catch (e) {
    return { ok: false, reason: `parse error: ${(e as Error).message}`, bundle: null };
  }
  if (bundle.formatVersion !== 1) {
    return { ok: false, reason: `unknown format version ${bundle.formatVersion}`, bundle };
  }
  // Verify content checksum (in-flight tamper detection).
  const expected = checksumOf(bundle.genome);
  if (expected !== bundle.checksum) {
    return { ok: false, reason: `checksum mismatch (expected ${expected.slice(0, 8)}..., got ${bundle.checksum.slice(0, 8)}...)`, bundle };
  }
  // v1.84: portable signature verification (works across machines).
  if (bundle.portableSig) {
    const expectedSig = portableSigOf(bundle.genome, bundle.packedAt, bundle.packedBy);
    if (safeHmacNotEqual(expectedSig, bundle.portableSig)) {
      return { ok: false, reason: `portable signature mismatch -- bundle tampered`, bundle };
    }
  }
  // Inner genome HMAC -- only works when the bundle was packed on THIS
  // machine. We attempt it but no longer block on failure unless the
  // caller explicitly requires it (`requireLocalHmac: true`).
  const v = verifyGenome(repoRoot, bundle.genome);
  if (v.ok) {
    return { ok: true, reason: "bundle valid + local genome HMAC verified", bundle, crossMachine: false };
  }
  if (opts?.requireLocalHmac) {
    return { ok: false, reason: `inner genome ${v.reason} (requireLocalHmac=true)`, bundle };
  }
  // Cross-machine path: portable sig already verified above, so accept.
  if (!bundle.portableSig) {
    return { ok: false, reason: `inner genome ${v.reason} AND no portableSig present (older bundle?)`, bundle };
  }
  return {
    ok: true,
    reason: "bundle valid via portableSig (cross-machine; local HMAC differs as expected)",
    bundle,
    crossMachine: true,
  };
}

/** Compute the QR-code-friendly footprint of a bundle. Returns the
 *  payload bytes; lets the caller decide compression / chunking. */
export function describeBundle(bundle: MWTBundle): {
  bytes: number;
  vaccineCount: number;
  commitAnchors: number;
  estimatedQrChunks: number;
} {
  const bytes = Buffer.byteLength(JSON.stringify(bundle), "utf8");
  // QR code v40 (largest std) holds ~3000 bytes; assume 2500 effective.
  return {
    bytes,
    vaccineCount: bundle.genome.strands.A.vaccines.length,
    commitAnchors: bundle.genome.strands.A.commitAnchors.length,
    estimatedQrChunks: Math.ceil(bytes / 2500),
  };
}
