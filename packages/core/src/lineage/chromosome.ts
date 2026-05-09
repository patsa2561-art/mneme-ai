/**
 * Chromosome serialization, signing, hashing, and verification.
 *
 * The hash is computed over the CANONICAL JSON of the chromosome with the
 * `signature` and `contentHash` fields zeroed out. Then the signature is
 * computed over the same canonical JSON. This means any tamper with ANY
 * field invalidates both the hash and the signature — defense in depth.
 *
 * "Canonical JSON" here = sorted keys, no extraneous whitespace,
 * RFC 8785-style JCS-lite. Implemented by recursive sort + standard
 * JSON.stringify (without indentation).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { signPayload, verifyPayload, loadOrCreateIdentity } from "./identity.js";
import { chromosomePath, chromosomesDir } from "./paths.js";
import type { Chromosome } from "./types.js";

/** Stable hash of the host machine — `sha256(hostname + cwd-prefix)`,
 *  truncated to 16 hex chars. Doesn't leak full hostname or path. */
export function machineFingerprint(repoRoot: string): string {
  return createHash("sha256")
    .update(hostname())
    .update("|")
    .update(repoRoot)
    .digest("hex")
    .slice(0, 16);
}

/** RFC-8785-lite canonical JSON: recursively sort keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortDeep);
  const out: Record<string, unknown> = {};
  const keys = Object.keys(v as Record<string, unknown>).sort();
  for (const k of keys) out[k] = sortDeep((v as Record<string, unknown>)[k]);
  return out;
}

/** Compute the content hash of a chromosome (signature + contentHash zeroed). */
export function computeChromosomeHash(c: Omit<Chromosome, "contentHash" | "signature">): string {
  const stripped = { ...c, contentHash: "", signature: "" };
  return createHash("sha256").update(canonicalJson(stripped)).digest("hex");
}

/** Build the canonical chromosome ID — `${ts}-${vendor}-${shortHash}`.
 *  Always sortable lexicographically. */
export function buildChromosomeId(createdAtIso: string, vendor: string, shortHash: string): string {
  // Replace colons + dots so the ID is filesystem-safe across all OSes.
  const ts = createdAtIso.replace(/:/g, "").replace(/\./g, "");
  const safeVendor = vendor.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
  return `${ts}-${safeVendor}-${shortHash.slice(0, 8)}`;
}

/** Sign + hash + persist a chromosome to disk. Returns the final
 *  chromosome with `contentHash` and `signature` populated. Atomic
 *  (write tmp + rename). */
export function persistChromosome(
  repoRoot: string,
  chromosome: Omit<Chromosome, "contentHash" | "signature" | "signedBy">,
): Chromosome {
  const identity = loadOrCreateIdentity(repoRoot);
  // Compute hash with empty signedBy/signature/contentHash for determinism.
  const seed = { ...chromosome, signedBy: identity.publicPem };
  const contentHash = computeChromosomeHash(seed as Omit<Chromosome, "contentHash" | "signature">);
  // Sign the canonical JSON of the seed (includes content hash for tamper resistance).
  const signed = { ...seed, contentHash, signature: "" };
  const signaturePayload = canonicalJson(signed);
  const signature = signPayload(repoRoot, signaturePayload);
  const final: Chromosome = { ...signed, signature };
  const dir = chromosomesDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = chromosomePath(repoRoot, final.id);
  // Atomic write: tmp + rename.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(final, null, 2), "utf8");
  // On Windows, rename over existing file is fine since v1.18.
  const { renameSync } = require("node:fs") as typeof import("node:fs");
  renameSync(tmp, path);
  return final;
}

/** Verify a chromosome — both hash AND signature must pass. */
export function verifyChromosome(c: Chromosome): { valid: boolean; reason?: string } {
  if (c.schemaVersion !== 1) return { valid: false, reason: `unsupported schemaVersion ${c.schemaVersion}` };
  const recomputed = computeChromosomeHash({ ...c, contentHash: "", signature: "" } as Omit<Chromosome, "contentHash" | "signature">);
  if (recomputed !== c.contentHash) {
    return { valid: false, reason: `contentHash mismatch (expected ${recomputed}, got ${c.contentHash})` };
  }
  const payload = canonicalJson({ ...c, signature: "" });
  if (!verifyPayload(c.signedBy, payload, c.signature)) {
    return { valid: false, reason: "signature verification failed" };
  }
  return { valid: true };
}

/** Load a chromosome by ID. Throws if missing or invalid. */
export function loadChromosome(repoRoot: string, id: string): Chromosome {
  const path = chromosomePath(repoRoot, id);
  if (!existsSync(path)) throw new Error(`chromosome not found: ${id}`);
  const json = JSON.parse(readFileSync(path, "utf8")) as Chromosome;
  const verdict = verifyChromosome(json);
  if (!verdict.valid) throw new Error(`chromosome ${id} failed verification: ${verdict.reason}`);
  return json;
}

/** List all chromosome IDs on disk, sorted newest-first (lexicographic on ID). */
export function listChromosomes(repoRoot: string): string[] {
  const dir = chromosomesDir(repoRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".chromosome.json"))
    .map((f) => f.replace(/\.chromosome\.json$/, ""))
    .sort()
    .reverse();
}
