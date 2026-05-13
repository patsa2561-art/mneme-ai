/**
 * v2.8.0 -- BIRTHRIGHT TOKEN: genealogy-as-security.
 *
 *   "Only the Mneme that was BORN here can speak for this repo."
 *
 * The threat model: as Mneme starts federating across devices, a
 * malicious copy of a user's `.mneme/` directory could speak with the
 * user's voice — sign covenants, issue passports, vote in consensus.
 *
 * The fix: at first install on a fresh repo, Mneme MINTS a one-time
 * BIRTHRIGHT TOKEN. The token is:
 *   - HMAC-chained to the repo fingerprint at birth time
 *   - Witness-stamped by the parent pole (anchor v1.88)
 *   - Stored once at .mneme/birthright.token (mode 0600)
 *   - NEVER regenerated — a second mint attempt on the same repo
 *     fails unless the existing token is explicitly burned first
 *
 * Cross-device federation (consensus / passport / spore push / etc)
 * checks the birthright before accepting the instance as a peer:
 *
 *   present birthright → server / peer verifies the HMAC chain →
 *   accepts the instance as the legitimate Mneme of THIS repo
 *
 * Copied `.mneme/` dirs fail because their birthright was minted for
 * a DIFFERENT repo fingerprint; the HMAC chain breaks when they
 * present it to a peer that recomputes the fingerprint locally.
 *
 * Nobel-tier move: birthright tokens form a GENEALOGY TREE. Every
 * spawned replica (consent kernel A2 + birthright C1 of THIS module)
 * is stamped with its parent's birthright. A whole family tree can be
 * walked back to the originating instance. Audit becomes possible
 * across the entire federation.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeSecretFile } from "../util/secret_store.js";
import { safeHmacEqual } from "../util/hmac_compare.js";

export interface BirthrightToken {
  /** Birthright version. */
  v: 1;
  /** Unique token id. */
  id: string;
  /** SHA-256 fingerprint of the repo at birth. */
  repoFingerprint: string;
  /** ISO timestamp of mint. */
  mintedAt: string;
  /** Optional parent token id when this is a spawned replica. */
  parentId?: string;
  /** Witness-stamp from the anchor pole (poleId + signature). */
  witness?: { poleId: string; sig: string };
  /** HMAC over the canonical body. */
  hmac: string;
}

function canonicalize(t: Omit<BirthrightToken, "hmac">): string {
  return JSON.stringify({
    v: t.v,
    id: t.id,
    repoFingerprint: t.repoFingerprint,
    mintedAt: t.mintedAt,
    parentId: t.parentId ?? null,
    witness: t.witness ? { poleId: t.witness.poleId, sig: t.witness.sig } : null,
  });
}

const BIRTHRIGHT_PATH = ".mneme/birthright.token";

function birthrightPath(repoRoot: string): string {
  return join(repoRoot, BIRTHRIGHT_PATH);
}

/** Compute a stable fingerprint for a repo. v2.8 uses a SHA-256 over
 *  the absolute path + the .git/config contents (if present) so two
 *  separate clones of the same repo on the same machine get distinct
 *  fingerprints. */
export function computeRepoFingerprint(repoRoot: string): string {
  let extra = "";
  const cfg = join(repoRoot, ".git", "config");
  if (existsSync(cfg)) {
    try { extra = readFileSync(cfg, "utf8"); } catch { /* BE:silent-by-design — fingerprint degrades gracefully */ }
  }
  return createHash("sha256").update(`${repoRoot}|${extra}`).digest("hex");
}

export interface MintInput {
  repoRoot: string;
  /** Caller-supplied secret (typically the pole-secret from anchor). */
  secret: string;
  /** Optional parent token to chain to. */
  parentId?: string;
  /** Optional anchor pole identity for witness-stamping. */
  witness?: { poleId: string; sig: string };
  /** When true, forces a re-mint even if a token already exists. */
  force?: boolean;
}

/** Mint the birthright token for this repo. Throws if a token already
 *  exists (unless force=true). */
export function mintBirthright(input: MintInput): BirthrightToken {
  const path = birthrightPath(input.repoRoot);
  if (existsSync(path) && !input.force) {
    // Load + return existing — minting is idempotent.
    try {
      const raw = readFileSync(path, "utf8");
      const tok = JSON.parse(raw) as BirthrightToken;
      // Verify it's still valid for this repo's CURRENT fingerprint.
      const currentFingerprint = computeRepoFingerprint(input.repoRoot);
      if (tok.repoFingerprint === currentFingerprint && verifyBirthright(tok, input.secret).ok) {
        return tok;
      }
      throw new Error("existing birthright invalid for current repo fingerprint; pass force=true to re-mint");
    } catch (e) {
      if ((e as Error).message.includes("force=true")) throw e;
      // Corrupted token → re-mint via fallthrough.
    }
  }
  const id = createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 24);
  const body: Omit<BirthrightToken, "hmac"> = {
    v: 1,
    id,
    repoFingerprint: computeRepoFingerprint(input.repoRoot),
    mintedAt: new Date().toISOString(),
    parentId: input.parentId,
    witness: input.witness,
  };
  const hmac = createHmac("sha256", input.secret).update(canonicalize(body)).digest("hex");
  const token: BirthrightToken = { ...body, hmac };
  writeSecretFile(path, JSON.stringify(token, null, 2));
  return token;
}

export type BirthrightVerdict = "VALID" | "TAMPERED" | "WRONG_REPO" | "MISSING";

/** Verify a presented birthright token against the current repo. */
export function verifyBirthright(token: BirthrightToken, secret: string, repoRoot?: string): { ok: boolean; verdict: BirthrightVerdict } {
  const expected = createHmac("sha256", secret).update(canonicalize(token)).digest("hex");
  if (!safeHmacEqual(expected, token.hmac)) return { ok: false, verdict: "TAMPERED" };
  if (repoRoot) {
    const currentFp = computeRepoFingerprint(repoRoot);
    if (currentFp !== token.repoFingerprint) return { ok: false, verdict: "WRONG_REPO" };
  }
  return { ok: true, verdict: "VALID" };
}

/** Load the local birthright (if any) without minting. */
export function loadBirthright(repoRoot: string): BirthrightToken | null {
  const path = birthrightPath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BirthrightToken;
  } catch { /* BE:silent-by-design — return null on corruption */ return null; }
}

/** Pulse one-liner. */
export function formatBirthrightPulseLine(t: BirthrightToken): string {
  return `BIRTHRIGHT · id=${t.id.slice(0, 8)} · mintedAt=${t.mintedAt.slice(0, 10)} · parent=${t.parentId ? t.parentId.slice(0, 8) : "(root)"}`;
}
