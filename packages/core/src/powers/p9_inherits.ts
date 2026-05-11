/**
 * POWER 9 — INHERITS THE EARTH (v1.48.0)
 *
 * The Rosetta Capsule: a long-term-archive packager that bundles
 *   1. The Mneme PROTOCOL spec (Power 1)
 *   2. The ALETHEIA Manifesto (Power 4)
 *   3. The current ratified wisdom packs (Stage 5)
 *   4. The replay chain headers (just the hashes -- enough to verify
 *      a future archive's integrity without keeping all bodies)
 *   5. Self-describing decoding instructions: a plain-English README
 *      explaining how to read the JSON files even if no Mneme code
 *      exists in the future.
 *
 * Designed so a future intelligence (or future human) opening the
 * capsule a millennium from now has enough context to reconstruct
 * what Mneme was, why it existed, and what it preserved.
 *
 * IDEA-CHEST:
 *   - The capsule hash chains to the prior capsule, so the entire
 *     history of capsules forms a "bookshelf" anyone can verify.
 *   - The decoding README is the most important file -- it's the
 *     Rosetta Stone for the entire bundle. We hand-write it instead
 *     of generating it, so a future reader can trust the format
 *     description didn't drift.
 *   - Capsule output is a single JSON envelope so it's grep-able with
 *     basic tools 1000 years from now (no proprietary archive format).
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { exportSpec, MNEME_PROTOCOL_VERSION } from "./p1_substrate.js";
import { ALETHEIA_ARTICLES } from "./p4_philosophical.js";

const CAPSULE_DIR_REL = ".mneme/rosetta-capsules";

export interface RosettaCapsule {
  formatVersion: 1;
  capsuleId: string;          // sha256 of payload
  createdAt: string;
  prevCapsuleHash: string | null;
  authorNote: string;
  protocol: ReturnType<typeof exportSpec>;
  manifesto: { id: string; headline: string; rule: string; why: string }[];
  wisdomPacks: { packId: string; packedAt: string; vaccineCount: number; donorSender: string }[];
  replayChainHeads: { atRange: string; entryCount: number; finalHash: string | null }[];
  decodingInstructions: string;
}

const DECODING_INSTRUCTIONS = `
=== HOW TO READ THIS CAPSULE (plain-English Rosetta Stone) ===

You are reading a Mneme Rosetta Capsule, a long-term-archive
intended to outlive the software that produced it. If you no
longer have access to a working Mneme runtime, this README is
sufficient to understand the contents.

1. The CAPSULE itself is a single JSON object with these fields:
   - formatVersion        integer; this format is version 1
   - capsuleId            sha256 hex of the JSON payload (excluding
                          this id field). To verify integrity:
                          recompute the hash over the JSON-stringified
                          object with capsuleId removed; it must match.
   - createdAt            ISO-8601 timestamp of when the capsule was sealed
   - prevCapsuleHash      sha256 of the previous capsule, or null for
                          the first capsule. Capsules form a chain.
   - authorNote           free-form prose: who sealed this, and why.
   - protocol             the Mneme PROTOCOL specification at seal time.
                          Includes the capability list every conforming
                          implementation MUST provide.
   - manifesto            the ALETHEIA Manifesto: nine articles laying
                          out the values Mneme committed to. Article IDs
                          (M-001..M-NNN) are forever-stable.
   - wisdomPacks          summary of every ratified wisdom pack at seal
                          time. Each wisdomPack ID is sha256 of the
                          original pack payload.
   - replayChainHeads     the FINAL hash of the HMAC-chained replay log
                          for each rotation epoch. Sufficient to detect
                          tampering without keeping every line body.
   - decodingInstructions THIS TEXT.

2. To VERIFY a wisdom pack referenced here:
   - Locate the .mwt JSON file with matching packId.
   - Recompute sha256 over the pack payload (everything except
     the packId + signature fields).
   - Match must be exact; any mismatch means the pack was tampered
     after this capsule sealed it.

3. To VERIFY the replay chain:
   - For each replayChainHead entry, find the corresponding
     replay.jsonl file. Compute the HMAC chain forward from the
     genesis hash (literally the string "GENESIS"); the final
     hash MUST match the entry's finalHash.

4. The PROTOCOL field is the core: any intelligence reading this
   capsule who wants to RECONSTRUCT a Mneme implementation should
   start there. Implement the listed capabilities; you'll have a
   conforming Mneme.

5. The MANIFESTO articles are NOT just opinion -- they're the
   contract any conforming implementation accepts. Reading them
   tells you what Mneme was for, what it refused to be, and why.

6. The bookshelf: prevCapsuleHash links capsules backward in time.
   A future reader who has access to the FULL chain can audit every
   modification across the protocol's lifetime by walking the chain.

This is enough to read every capsule even if no Mneme runtime
remains. This is the Rosetta-Stone property.
`.trim();

function readWisdomPacks(repoRoot: string): RosettaCapsule["wisdomPacks"] {
  const dir = join(resolve(repoRoot), ".mneme/wisdom-packs");
  if (!existsSync(dir)) return [];
  const out: RosettaCapsule["wisdomPacks"] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".mwt.json")) continue;
    try {
      const p = JSON.parse(readFileSync(join(dir, f), "utf8")) as { packId?: string; packedAt?: string; vaccines?: unknown[]; donorSender?: string };
      if (!p.packId || !p.packedAt) continue;
      out.push({
        packId: p.packId,
        packedAt: p.packedAt,
        vaccineCount: Array.isArray(p.vaccines) ? p.vaccines.length : 0,
        donorSender: p.donorSender ?? "unknown",
      });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => a.packedAt.localeCompare(b.packedAt));
}

function readReplayHeads(repoRoot: string): RosettaCapsule["replayChainHeads"] {
  const dir = join(resolve(repoRoot), ".mneme");
  if (!existsSync(dir)) return [];
  const out: RosettaCapsule["replayChainHeads"] = [];
  const candidates: string[] = [];
  for (const f of readdirSync(dir)) {
    if (f === "replay.jsonl" || f.startsWith("replay.jsonl.rotated-")) candidates.push(f);
  }
  candidates.sort();
  for (const f of candidates) {
    try {
      const txt = readFileSync(join(dir, f), "utf8").trim();
      if (!txt) continue;
      const lines = txt.split("\n");
      const last = JSON.parse(lines[lines.length - 1]!) as { hash: string; ts: string };
      const first = JSON.parse(lines[0]!) as { ts: string };
      out.push({ atRange: `${first.ts} -> ${last.ts}`, entryCount: lines.length, finalHash: last.hash ?? null });
    } catch { /* skip */ }
  }
  return out;
}

function findPrevCapsuleHash(repoRoot: string): string | null {
  const dir = join(resolve(repoRoot), CAPSULE_DIR_REL);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".rosetta.json")).sort();
  if (files.length === 0) return null;
  const last = files[files.length - 1]!;
  try {
    const p = JSON.parse(readFileSync(join(dir, last), "utf8")) as RosettaCapsule;
    return p.capsuleId;
  } catch { return null; }
}

export function createRosettaCapsule(repoRoot: string, opts: { authorNote?: string } = {}): RosettaCapsule {
  const root = resolve(repoRoot);
  mkdirSync(join(root, CAPSULE_DIR_REL), { recursive: true });

  const protocol = exportSpec();
  const manifesto = ALETHEIA_ARTICLES.map((a) => ({ id: a.id, headline: a.headline, rule: a.rule, why: a.why }));
  const wisdomPacks = readWisdomPacks(root);
  const replayChainHeads = readReplayHeads(root);
  const prevCapsuleHash = findPrevCapsuleHash(root);
  const createdAt = new Date().toISOString();

  // Build the payload WITHOUT capsuleId, hash it, then attach the id.
  const payload = {
    formatVersion: 1 as const,
    createdAt,
    prevCapsuleHash,
    authorNote: opts.authorNote ?? `Mneme Rosetta capsule, sealed at protocol version ${MNEME_PROTOCOL_VERSION}.`,
    protocol,
    manifesto,
    wisdomPacks,
    replayChainHeads,
    decodingInstructions: DECODING_INSTRUCTIONS,
  };
  const capsuleId = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const capsule: RosettaCapsule = { ...payload, capsuleId };

  const filename = `${createdAt.replace(/[:.]/g, "-")}_${capsuleId.slice(0, 16)}.rosetta.json`;
  writeFileSync(join(root, CAPSULE_DIR_REL, filename), JSON.stringify(capsule, null, 2));

  return capsule;
}

export function listCapsules(repoRoot: string): { capsuleId: string; createdAt: string; prevCapsuleHash: string | null }[] {
  const dir = join(resolve(repoRoot), CAPSULE_DIR_REL);
  if (!existsSync(dir)) return [];
  const out: { capsuleId: string; createdAt: string; prevCapsuleHash: string | null }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".rosetta.json")) continue;
    try {
      const p = JSON.parse(readFileSync(join(dir, f), "utf8")) as RosettaCapsule;
      out.push({ capsuleId: p.capsuleId, createdAt: p.createdAt, prevCapsuleHash: p.prevCapsuleHash });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Verify that a capsule's stored capsuleId matches its payload hash. */
export function verifyCapsule(capsule: RosettaCapsule): boolean {
  // recompute over the payload (everything except capsuleId)
  const { capsuleId: _stored, ...rest } = capsule;
  const recomputed = createHash("sha256").update(JSON.stringify(rest)).digest("hex");
  return recomputed === capsule.capsuleId;
}

/** Verify the chain integrity of a sequence of capsules sorted by createdAt. */
export function verifyCapsuleChain(repoRoot: string): { ok: boolean; brokenAt: number | null; length: number } {
  const dir = join(resolve(repoRoot), CAPSULE_DIR_REL);
  if (!existsSync(dir)) return { ok: true, brokenAt: null, length: 0 };
  const files = readdirSync(dir).filter((f) => f.endsWith(".rosetta.json")).sort();
  const capsules: RosettaCapsule[] = [];
  for (const f of files) {
    try { capsules.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as RosettaCapsule); } catch { /* */ }
  }
  if (capsules.length === 0) return { ok: true, brokenAt: null, length: 0 };
  if (capsules[0]!.prevCapsuleHash !== null) return { ok: false, brokenAt: 0, length: capsules.length };
  for (let i = 1; i < capsules.length; i++) {
    if (capsules[i]!.prevCapsuleHash !== capsules[i - 1]!.capsuleId) return { ok: false, brokenAt: i, length: capsules.length };
  }
  return { ok: true, brokenAt: null, length: capsules.length };
}
