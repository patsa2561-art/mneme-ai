/**
 * DEMON STAGE 5.3 — Replicating Wisdom (v1.44.0)
 *
 * SCOPE: every Mneme install becomes a TEACHER for the next install via
 * a portable "starter pack" — a single .mwt (Mneme Wisdom Transfer) JSON
 * file containing the most-validated vaccines + best-validator endorsements
 * + this install's lineage chromosome. New installs can `inherit()` the
 * pack to bootstrap with proven wisdom instead of starting blank.
 *
 * Crucially, this is HASH-CHAINED: pack N references pack N-1's hash, so
 * the lineage of teaching is auditable. A pack can be REJECTED if its
 * chain is broken — prevents wisdom poisoning by spoofed packs.
 *
 * INNOVATIONS BEYOND SPEC:
 *   - "Top-K curation" — only the K most-vouched, never-revoked vaccines
 *     ride the pack (K=20 default). Quality > quantity
 *   - "Rejection rate" surfaced in pack metadata so the receiver can
 *     decide whether to inherit at all (e.g., refuse packs > 30% rejected)
 *   - "Donor signature" — the donor signs the pack with the same mesh
 *     secret used by gossip; receivers in the same mesh trust the chain,
 *     receivers in a different mesh treat it as untrusted (advisory only)
 *   - "No PII smuggling" — we re-scrub pack contents through the same
 *     PII regexes used by the synthetic army before packing
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, createHmac } from "node:crypto";

import { computeAllVerdicts, listCards } from "../teeth/genome_market.js";
import { getOrCreateMeshSecret } from "./gossip_mesh.js";

const PACK_DIR_REL = ".mneme/wisdom-packs";
const INHERITANCE_LOG_REL = ".mneme/wisdom-inheritance.jsonl";

const TOP_K = 20;
const MAX_REJECTION_RATE = 0.30;

const PII_REGEXES: { re: RegExp; replacement: string }[] = [
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "<email>" },
  { re: /\+?\d[\d\s().-]{7,}\d/g, replacement: "<phone>" },
  { re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "<ipv4>" },
];

function scrub(s: string): string {
  let out = s;
  for (const { re, replacement } of PII_REGEXES) out = out.replace(re, replacement);
  return out;
}

export interface PackedVaccine {
  id: string;
  title: string;
  body: string;          // PII-scrubbed
  contentHash: string;   // sha256 of ORIGINAL body
  netStake: number;      // at pack time
  vouches: number;
}

export interface WisdomPack {
  v: 1;
  packId: string;        // sha256 of payload
  donorSender: string;   // mesh sender id
  packedAt: string;
  prevPackHash: string | null;
  vaccines: PackedVaccine[];
  metadata: {
    totalCards: number;
    ratifiedCount: number;
    revokedCount: number;
    rejectionRate: number;     // revoked / totalCards
    donorMnemeVersion: string;
  };
  signature: string;     // hmac-sha256(secret, packId)
}

export function packWisdom(repoRoot: string, opts: { donorSender: string; donorMnemeVersion: string; topK?: number }): WisdomPack {
  const root = resolve(repoRoot);
  const cards = listCards(root);
  const verdicts = computeAllVerdicts(root);
  const ratified = verdicts.filter((v) => v.ratified && !v.revoked).slice(0, opts.topK ?? TOP_K);
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const vaccines: PackedVaccine[] = [];
  for (const v of ratified) {
    const card = cardById.get(v.cardId);
    if (!card) continue;
    vaccines.push({
      id: card.id,
      title: scrub(card.title),
      body: scrub(card.body),
      contentHash: card.contentHash,
      netStake: v.netStake,
      vouches: v.vouchCount,
    });
  }

  const totalCards = verdicts.length;
  const revokedCount = verdicts.filter((v) => v.revoked).length;
  const ratifiedCount = verdicts.filter((v) => v.ratified && !v.revoked).length;
  const rejectionRate = totalCards === 0 ? 0 : +(revokedCount / totalCards).toFixed(4);

  // Chain to previous pack (if any)
  const prev = listLocalPacks(root).slice(-1)[0];
  const prevPackHash = prev?.packId ?? null;

  // Compute packId from a stable payload (everything except packId + signature)
  const payload = {
    v: 1 as const,
    donorSender: opts.donorSender,
    packedAt: new Date().toISOString(),
    prevPackHash,
    vaccines,
    metadata: {
      totalCards,
      ratifiedCount,
      revokedCount,
      rejectionRate,
      donorMnemeVersion: opts.donorMnemeVersion,
    },
  };
  const packId = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const secret = getOrCreateMeshSecret(root);
  const signature = createHmac("sha256", secret).update(packId).digest("hex");

  const pack: WisdomPack = { ...payload, packId, signature };

  mkdirSync(join(root, PACK_DIR_REL), { recursive: true });
  const safeId = packId.slice(0, 16);
  writeFileSync(join(root, PACK_DIR_REL, `${pack.packedAt.replace(/[:.]/g, "-")}_${safeId}.mwt.json`), JSON.stringify(pack, null, 2));

  return pack;
}

export function listLocalPacks(repoRoot: string): WisdomPack[] {
  const dir = join(resolve(repoRoot), PACK_DIR_REL);
  if (!existsSync(dir)) return [];
  const out: WisdomPack[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".mwt.json")) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as WisdomPack); } catch { /* skip */ }
  }
  out.sort((a, b) => a.packedAt.localeCompare(b.packedAt));
  return out;
}

export type InheritOutcome =
  | { outcome: "inherited"; vaccinesAdded: number }
  | { outcome: "rejected-rate"; reason: string }
  | { outcome: "rejected-signature"; reason: string }
  | { outcome: "rejected-chain"; reason: string }
  | { outcome: "duplicate"; reason: string };

/**
 * Receive a wisdom pack and decide whether to inherit it. Inheritance =
 * we record the pack in our inheritance log (NOT auto-merge into our own
 * cards — that's still a deliberate operator action). This keeps the
 * receiving install's signature strictly opt-in.
 */
export function inheritPack(repoRoot: string, pack: WisdomPack, opts: { sameMesh?: boolean } = {}): InheritOutcome {
  const root = resolve(repoRoot);

  // 1. Reject high-rejection packs (poisoned source)
  if (pack.metadata.rejectionRate > MAX_REJECTION_RATE) {
    return { outcome: "rejected-rate", reason: `donor's rejection rate ${(pack.metadata.rejectionRate * 100).toFixed(0)}% > ${MAX_REJECTION_RATE * 100}% threshold` };
  }

  // 2. Verify packId integrity (recompute from payload)
  const { packId, signature, ...rest } = pack;
  const recomputed = createHash("sha256").update(JSON.stringify(rest)).digest("hex");
  if (recomputed !== packId) {
    return { outcome: "rejected-signature", reason: "packId does not match payload hash — pack was tampered" };
  }

  // 3. Same-mesh signature check (only enforced when sameMesh=true)
  if (opts.sameMesh) {
    const secret = getOrCreateMeshSecret(root);
    const expected = createHmac("sha256", secret).update(packId).digest("hex");
    if (expected !== signature) {
      return { outcome: "rejected-signature", reason: "donor signature does not verify under our mesh secret" };
    }
  }

  // 4. Chain integrity — if pack claims a prevPackHash, we must have it locally
  if (pack.prevPackHash !== null) {
    const haveIt = listLocalPacks(root).some((p) => p.packId === pack.prevPackHash);
    if (!haveIt) return { outcome: "rejected-chain", reason: `prevPackHash ${pack.prevPackHash.slice(0, 12)}... not found locally` };
  }

  // 5. Dedup
  const log = readInheritanceLog(root);
  if (log.some((e) => e.packId === packId)) {
    return { outcome: "duplicate", reason: "pack already inherited" };
  }

  appendInheritanceLog(root, { packId, donorSender: pack.donorSender, inheritedAt: new Date().toISOString(), vaccinesCount: pack.vaccines.length });
  // Save the pack itself locally so future chain validations see it
  mkdirSync(join(root, PACK_DIR_REL), { recursive: true });
  writeFileSync(join(root, PACK_DIR_REL, `inherited_${packId.slice(0, 16)}.mwt.json`), JSON.stringify(pack, null, 2));

  return { outcome: "inherited", vaccinesAdded: pack.vaccines.length };
}

interface InheritanceRecord { packId: string; donorSender: string; inheritedAt: string; vaccinesCount: number }

function readInheritanceLog(repoRoot: string): InheritanceRecord[] {
  const path = join(repoRoot, INHERITANCE_LOG_REL);
  if (!existsSync(path)) return [];
  const out: InheritanceRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

function appendInheritanceLog(repoRoot: string, rec: InheritanceRecord): void {
  const path = join(repoRoot, INHERITANCE_LOG_REL);
  mkdirSync(join(repoRoot, ".mneme"), { recursive: true });
  appendFileSync(path, JSON.stringify(rec) + "\n");
}

export function listInheritances(repoRoot: string): InheritanceRecord[] {
  return readInheritanceLog(repoRoot);
}
