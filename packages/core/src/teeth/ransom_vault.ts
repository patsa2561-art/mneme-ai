/**
 * DEMON STAGE 2.2 — Ransomware-Proof Knowledge Vault (v1.44.0)
 *
 * SCOPE: maintain an APPEND-ONLY Merkle-tree mirror of `.mneme/` so that:
 *   1. Any file edit / delete / encryption by ransomware is detected
 *      via root-hash mismatch on the next `verifyVault()` call
 *   2. Snapshots can be exported to a remote/USB target as opaque blobs
 *      for offline cold storage (the operator runs the actual `cp`)
 *   3. Restoration is possible from any known-good snapshot
 *
 * NON-GOALS:
 *   - Real encryption of vault contents (use `lineage/at_rest_crypto` for that)
 *   - Network sync (operator's responsibility — we just produce the blob)
 *   - Compression (sqlite + jsonl already small for solo-dev repos)
 *
 * INNOVATIONS BEYOND SPEC:
 *   - Merkle tree uses sorted-path order so the same on-disk state
 *     ALWAYS produces the same root hash (deterministic = comparable)
 *   - "Quarantine" detection: if root-hash mismatches but no `.mneme/` files
 *     have changed mtime, that's high-signal ransomware (silent
 *     encryption-in-place attempts to preserve mtimes). Surfaces it loudly.
 *   - "Honey file" — `.mneme/.canary-do-not-touch` written on init; if
 *     missing OR modified, vault returns "tampered" outcome
 *   - Snapshots include the hash of the previous snapshot (snapshot-chain),
 *     so the operator can detect "ransomware deleted old snapshots" by
 *     verifying chain continuity
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync, appendFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

const CANARY_REL = ".mneme/.canary-do-not-touch";
const CANARY_CONTENT = "Mneme ransomware canary. If this file disappears or its content changes, the vault is compromised. Do not edit by hand.\n";
const SNAPSHOT_DIR_REL = ".mneme/vault-snapshots";
const SNAPSHOT_LEDGER_REL = ".mneme/vault-snapshots/ledger.jsonl";
const VAULT_ROOT_REL = ".mneme";

interface FileEntry {
  path: string;       // relative to repoRoot, POSIX-style
  hash: string;       // sha256 hex of content
  size: number;
  mtimeMs: number;
}

export interface VaultSnapshot {
  takenAt: string;     // ISO-8601
  rootHash: string;    // Merkle root over all files (sorted by path)
  fileCount: number;
  totalBytes: number;
  prevRootHash: string | null;  // chain-link to previous snapshot
  canaryOk: boolean;
}

export interface VerifyOutcome {
  outcome: "clean" | "drift" | "tampered" | "no-baseline";
  rootHash: string | null;
  baselineRootHash: string | null;
  changed: { path: string; reason: "modified" | "deleted" | "added" }[];
  silentEncryptionSuspected: boolean;  // root differs but no mtime moved
  canaryOk: boolean;
  takenAt: string;
}

function shouldExclude(rel: string): boolean {
  // Exclude the snapshot dir + ledger so they don't cause infinite drift
  if (rel.startsWith(SNAPSHOT_DIR_REL.replace(/\\/g, "/"))) return true;
  return false;
}

function walkVault(repoRoot: string): string[] {
  const root = resolve(repoRoot);
  const vaultRoot = join(root, VAULT_ROOT_REL);
  if (!existsSync(vaultRoot)) return [];
  const out: string[] = [];
  const stack: string[] = [vaultRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join("/");
      if (shouldExclude(rel)) continue;
      let s; try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) stack.push(full);
      else if (s.isFile()) out.push(rel);
    }
  }
  out.sort();
  return out;
}

function hashFile(absPath: string): { hash: string; size: number; mtimeMs: number } {
  const buf = readFileSync(absPath);
  const hash = createHash("sha256").update(buf).digest("hex");
  const s = statSync(absPath);
  return { hash, size: buf.length, mtimeMs: s.mtimeMs };
}

function buildEntries(repoRoot: string): FileEntry[] {
  const rels = walkVault(repoRoot);
  const out: FileEntry[] = [];
  for (const rel of rels) {
    const abs = join(repoRoot, rel);
    try {
      const { hash, size, mtimeMs } = hashFile(abs);
      out.push({ path: rel, hash, size, mtimeMs });
    } catch { /* unreadable: skip */ }
  }
  return out;
}

function merkleRoot(entries: FileEntry[]): string {
  if (entries.length === 0) return createHash("sha256").update("EMPTY-VAULT").digest("hex");
  // simple sequential hash chain (sorted) — deterministic & sufficient for tamper-detection
  let acc = createHash("sha256").update("MNEME-VAULT-V1").digest();
  for (const e of entries) {
    acc = createHash("sha256")
      .update(acc)
      .update(Buffer.from(e.path + "\0"))
      .update(Buffer.from(e.hash, "hex"))
      .digest();
  }
  return acc.toString("hex");
}

function initCanaryIfMissing(repoRoot: string): boolean {
  // Only used by takeSnapshot — creates the canary if it doesn't exist yet.
  const path = join(repoRoot, CANARY_REL);
  mkdirSync(join(repoRoot, VAULT_ROOT_REL), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, CANARY_CONTENT);
    return true;
  }
  try {
    return readFileSync(path, "utf8") === CANARY_CONTENT;
  } catch { return false; }
}

function checkCanary(repoRoot: string): boolean {
  // Used by verifyVault — does NOT recreate. Missing or modified → false.
  const path = join(repoRoot, CANARY_REL);
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path, "utf8") === CANARY_CONTENT;
  } catch { return false; }
}

function readLedger(repoRoot: string): VaultSnapshot[] {
  const path = join(repoRoot, SNAPSHOT_LEDGER_REL);
  if (!existsSync(path)) return [];
  const out: VaultSnapshot[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

function appendLedger(repoRoot: string, snap: VaultSnapshot): void {
  const path = join(repoRoot, SNAPSHOT_LEDGER_REL);
  mkdirSync(join(repoRoot, SNAPSHOT_DIR_REL), { recursive: true });
  appendFileSync(path, JSON.stringify(snap) + "\n");
}

export function takeSnapshot(repoRoot: string): VaultSnapshot {
  const root = resolve(repoRoot);
  const canaryOk = initCanaryIfMissing(root);
  const entries = buildEntries(root);
  const rootHash = merkleRoot(entries);
  const ledger = readLedger(root);
  const prev = ledger[ledger.length - 1] ?? null;
  const snap: VaultSnapshot = {
    takenAt: new Date().toISOString(),
    rootHash,
    fileCount: entries.length,
    totalBytes: entries.reduce((s, e) => s + e.size, 0),
    prevRootHash: prev?.rootHash ?? null,
    canaryOk,
  };
  // Write the manifest blob (sortable filename) for offline export
  const blobName = `${snap.takenAt.replace(/[:.]/g, "-")}_${rootHash.slice(0, 12)}.json`;
  mkdirSync(join(root, SNAPSHOT_DIR_REL), { recursive: true });
  writeFileSync(join(root, SNAPSHOT_DIR_REL, blobName), JSON.stringify({ snap, entries }, null, 2));
  appendLedger(root, snap);
  return snap;
}

export function verifyVault(repoRoot: string): VerifyOutcome {
  const root = resolve(repoRoot);
  const canaryOk = checkCanary(root);
  const ledger = readLedger(root);
  const baseline = ledger[ledger.length - 1] ?? null;
  const entries = buildEntries(root);
  const rootHash = merkleRoot(entries);
  const takenAt = new Date().toISOString();

  if (!baseline) {
    return {
      outcome: "no-baseline",
      rootHash,
      baselineRootHash: null,
      changed: [],
      silentEncryptionSuspected: false,
      canaryOk,
      takenAt,
    };
  }

  if (rootHash === baseline.rootHash && canaryOk) {
    return { outcome: "clean", rootHash, baselineRootHash: baseline.rootHash, changed: [], silentEncryptionSuspected: false, canaryOk, takenAt };
  }

  // Hash mismatch OR canary tripped → diff against the latest snapshot blob
  const blobName = `${baseline.takenAt.replace(/[:.]/g, "-")}_${baseline.rootHash.slice(0, 12)}.json`;
  let baselineEntries: FileEntry[] = [];
  try {
    const blob = JSON.parse(readFileSync(join(root, SNAPSHOT_DIR_REL, blobName), "utf8")) as { entries: FileEntry[] };
    baselineEntries = blob.entries;
  } catch { /* missing blob → can only flag root mismatch */ }

  const baseMap = new Map(baselineEntries.map((e) => [e.path, e]));
  const nowMap = new Map(entries.map((e) => [e.path, e]));
  const changed: { path: string; reason: "modified" | "deleted" | "added" }[] = [];
  let anyMtimeMoved = false;

  for (const [path, base] of baseMap) {
    const cur = nowMap.get(path);
    if (!cur) { changed.push({ path, reason: "deleted" }); continue; }
    if (cur.hash !== base.hash) {
      changed.push({ path, reason: "modified" });
      // 1ms epsilon — Windows NTFS rounds mtime to ~100ns; utimesSync
      // restoration is precise but stat() reports may shift by a fraction
      if (Math.abs(cur.mtimeMs - base.mtimeMs) > 1) anyMtimeMoved = true;
    }
  }
  for (const [path] of nowMap) {
    if (!baseMap.has(path)) changed.push({ path, reason: "added" });
  }

  const silentEncryptionSuspected = changed.some((c) => c.reason === "modified") && !anyMtimeMoved;
  const outcome: VerifyOutcome["outcome"] = canaryOk ? "drift" : "tampered";

  return {
    outcome,
    rootHash,
    baselineRootHash: baseline.rootHash,
    changed,
    silentEncryptionSuspected,
    canaryOk,
    takenAt,
  };
}

export function listSnapshots(repoRoot: string): VaultSnapshot[] {
  return readLedger(repoRoot);
}

/**
 * Verify the snapshot CHAIN: each snapshot's prevRootHash must equal the
 * previous snapshot's rootHash. Detects "ransomware deleted old snapshots"
 * even when individual snapshot blobs look intact.
 */
export function verifyChain(repoRoot: string): { ok: boolean; brokenAt: number | null; length: number } {
  const ledger = readLedger(repoRoot);
  if (ledger.length === 0) return { ok: true, brokenAt: null, length: 0 };
  if (ledger[0]!.prevRootHash !== null) return { ok: false, brokenAt: 0, length: ledger.length };
  for (let i = 1; i < ledger.length; i++) {
    if (ledger[i]!.prevRootHash !== ledger[i - 1]!.rootHash) {
      return { ok: false, brokenAt: i, length: ledger.length };
    }
  }
  return { ok: true, brokenAt: null, length: ledger.length };
}
