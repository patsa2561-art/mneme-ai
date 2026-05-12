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
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeGenome, verifyGenome, type MnemeGenome } from "./genome.js";

const WANDERER_DIR = ".mneme/exodus/wanderer";

export interface MWTBundle {
  formatVersion: 1;
  packedAt: string;
  packedBy: string;
  genome: MnemeGenome;
  checksum: string;
  transitMetadata: {
    transport: "file" | "qr" | "http" | "usb" | "email";
    compression: "none";
  };
}

function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const o = v as Record<string, unknown>;
  const ks = Object.keys(o).sort();
  return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}

function checksumOf(genome: MnemeGenome): string {
  return createHash("sha256").update(canonicalize(genome)).digest("hex").slice(0, 32);
}

/** Pack the current Mneme state into a .mwt bundle. */
export function packWanderer(repoRoot: string, opts?: { packedBy?: string; transport?: MWTBundle["transitMetadata"]["transport"] }): { path: string; bundle: MWTBundle; sizeBytes: number } {
  const dir = join(repoRoot, WANDERER_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const genome = encodeGenome(repoRoot, { emittedBy: opts?.packedBy ?? "wanderer" });
  const bundle: MWTBundle = {
    formatVersion: 1,
    packedAt: new Date().toISOString(),
    packedBy: opts?.packedBy ?? "wanderer",
    genome,
    checksum: checksumOf(genome),
    transitMetadata: {
      transport: opts?.transport ?? "file",
      compression: "none",
    },
  };
  const body = JSON.stringify(bundle, null, 2);
  const path = join(dir, `wisdom-${bundle.packedAt.replace(/[:.]/g, "-")}.mwt`);
  writeFileSync(path, body, "utf8");
  // Also write a stable "latest" pointer.
  writeFileSync(join(dir, "latest.mwt"), body, "utf8");
  return { path, bundle, sizeBytes: Buffer.byteLength(body, "utf8") };
}

/** Read + verify a .mwt bundle. */
export function unpackWanderer(repoRoot: string, bundlePath: string): { ok: boolean; reason: string; bundle: MWTBundle | null } {
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
  // Verify checksum.
  const expected = checksumOf(bundle.genome);
  if (expected !== bundle.checksum) {
    return { ok: false, reason: `checksum mismatch (expected ${expected.slice(0, 8)}..., got ${bundle.checksum.slice(0, 8)}...)`, bundle };
  }
  // Verify the inner genome HMAC (this works only if the bundle came
  // from THIS machine; cross-machine verification requires whitelist).
  const v = verifyGenome(repoRoot, bundle.genome);
  if (!v.ok) {
    return { ok: false, reason: `inner genome ${v.reason}`, bundle };
  }
  return { ok: true, reason: "bundle valid + genome HMAC verified", bundle };
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
