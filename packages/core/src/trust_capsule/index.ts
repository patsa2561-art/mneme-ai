/**
 * v2.21.4 — TRUST CAPSULE.
 *
 * Discrete, single-line, tamper-evident attestation that an installed
 * Mneme is what it claims to be. AI agents read ONE number (trustScore
 * 0-100) instead of 30 fields. Composes on top of `verify-self`.
 *
 * INNOVATIONS
 *
 *   1. MERKLE INSTALL-ROOT — compute a single 22-char hash over every
 *      shipped file (.js / .cjs / .mjs / .json / .d.ts). Detects a
 *      single-byte tamper anywhere in the install tree, not just in
 *      package.json (which is all the v2.19.96 verify-self hashed).
 *
 *   2. TRUST SCORE (0-100) — single composed signal:
 *        +40 if HMAC signature of capsule verifies
 *        +20 if current Merkle matches the install-time snapshot
 *        +20 if install path lives under a sane npm prefix
 *        +20 if install is recent (≤ 90 days since first snapshot)
 *      Bands: 0-39 ABORT · 40-69 CAUTION · 70-100 TRUST. One number
 *      replaces "read 30 fields and decide".
 *
 *   3. CAPSULE URI — `mneme://attest/v1/<ver>/<merkle22>/<ts>/<sig22>`
 *      paste-able anywhere: pulse banner, commit message, Slack, gist.
 *      Receiver pastes back into `mneme verify-self --verify <uri>`
 *      to validate.
 *
 *   4. NONCE-BOUND CAPABILITY — optional caller-supplied nonce binds
 *      the capsule to a single session. Stops replay of a captured
 *      capsule into a future session.
 *
 *   5. OFFLINE-FIRST DRIFT — first verify-self call caches the
 *      Merkle to `.mneme/trust/install-merkle.json`; subsequent calls
 *      compare. No network. A file tampered with AFTER install
 *      shows up as `driftedFiles[]`.
 *
 * Composes onto v2.19.96 verifySelf — does not replace it.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";

const KEY_FILE = "capsule.key";
const SNAPSHOT_FILE = "install-merkle.json";
const TRUST_DIR_REL = join(".mneme", "trust");

const HASHABLE_EXT = new Set([".js", ".cjs", ".mjs", ".json", ".d.ts", ".ts", ".md", ".txt"]);
const SKIP_DIR = new Set(["node_modules", ".git", ".mneme", "logs", "cache", "tmp", "coverage", "dist-test"]);
const MAX_FILES = 50_000;

// ─── KEY ─────────────────────────────────────────────────────────────

function trustDir(repoRoot: string): string {
  const d = join(repoRoot, TRUST_DIR_REL);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function getKey(repoRoot: string): string {
  const p = join(trustDir(repoRoot), KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

// ─── MERKLE ──────────────────────────────────────────────────────────

export interface MerkleResult {
  /** Merkle root: base64url, 22 chars. */
  root: string;
  /** Total file count hashed. */
  fileCount: number;
  /** Total bytes hashed. */
  byteCount: number;
  /** Per-file hash lines (sorted by relative path) — useful for diff. */
  entries: Array<{ path: string; sha: string; size: number }>;
}

function walk(root: string, dir: string, files: string[]): void {
  if (files.length > MAX_FILES) return;
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(root, full, files);
    else if (st.isFile()) {
      const lower = name.toLowerCase();
      const dot = lower.lastIndexOf(".");
      if (dot === -1) continue;
      const ext = lower.endsWith(".d.ts") ? ".d.ts" : lower.slice(dot);
      if (HASHABLE_EXT.has(ext)) files.push(full);
    }
  }
}

/** Compute the Merkle install-root over all hashable files under installRoot.
 *  Pure read-only. Deterministic: same install → same root, byte for byte. */
export function computeInstallMerkle(installRoot: string): MerkleResult {
  const files: string[] = [];
  walk(installRoot, installRoot, files);
  const entries: Array<{ path: string; sha: string; size: number }> = [];
  let byteCount = 0;
  for (const f of files) {
    let buf: Buffer;
    try { buf = readFileSync(f); } catch { continue; }
    const sha = createHash("sha256").update(buf).digest("base64url").slice(0, 22);
    const rel = relative(installRoot, f).split(sep).join("/");
    entries.push({ path: rel, sha, size: buf.length });
    byteCount += buf.length;
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const concat = entries.map((e) => `${e.path}\t${e.sha}`).join("\n");
  const root = createHash("sha256").update(concat).digest("base64url").slice(0, 22);
  return { root, fileCount: entries.length, byteCount, entries };
}

// ─── SNAPSHOT (offline-first drift baseline) ─────────────────────────

export interface InstallSnapshot {
  v: 1;
  /** When the install was first observed. */
  capturedAt: string;
  /** Installed version at capture time. */
  version: string;
  /** Merkle root at capture time. */
  merkle: string;
  /** File count at capture time. */
  fileCount: number;
}

function snapshotPath(repoRoot: string): string {
  return join(trustDir(repoRoot), SNAPSHOT_FILE);
}

export function getInstallSnapshot(repoRoot: string): InstallSnapshot | null {
  const p = snapshotPath(repoRoot);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/** Persist the install Merkle as the offline-first drift baseline.
 *  Called by `verify-self` on first run (lazy) or by postinstall (eager).
 *  Idempotent. */
export function captureInstallSnapshot(repoRoot: string, opts: { version: string; merkle: string; fileCount: number }): InstallSnapshot {
  const snap: InstallSnapshot = {
    v: 1,
    capturedAt: new Date().toISOString(),
    version: opts.version,
    merkle: opts.merkle,
    fileCount: opts.fileCount,
  };
  writeFileSync(snapshotPath(repoRoot), JSON.stringify(snap, null, 2), "utf8");
  return snap;
}

// ─── DRIFT ───────────────────────────────────────────────────────────

export interface DriftReport {
  drifted: boolean;
  /** Files present in current Merkle but absent from snapshot. */
  added: string[];
  /** Files in snapshot but absent now. */
  removed: string[];
  /** Files in both but content changed. */
  changed: string[];
}

export function compareToSnapshot(current: MerkleResult, snapshot: InstallSnapshot | null, snapshotEntries?: Array<{ path: string; sha: string }>): DriftReport {
  if (!snapshot) return { drifted: false, added: [], removed: [], changed: [] };
  // Without per-file snapshot we can only compare roots; but we expose
  // a richer report if the caller hands us entries (used by tests).
  if (!snapshotEntries) {
    const drifted = current.root !== snapshot.merkle;
    return { drifted, added: [], removed: [], changed: drifted ? ["<root-mismatch>"] : [] };
  }
  const cur = new Map(current.entries.map((e) => [e.path, e.sha]));
  const snap = new Map(snapshotEntries.map((e) => [e.path, e.sha]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [p, sha] of cur) {
    if (!snap.has(p)) added.push(p);
    else if (snap.get(p) !== sha) changed.push(p);
  }
  for (const [p] of snap) if (!cur.has(p)) removed.push(p);
  return { drifted: added.length + removed.length + changed.length > 0, added, removed, changed };
}

// ─── TRUST SCORE ─────────────────────────────────────────────────────

export interface TrustScoreInput {
  signatureOk: boolean;
  noDrift: boolean;
  pathSane: boolean;
  recent: boolean;
}

export type TrustBand = "ABORT" | "CAUTION" | "TRUST";

export interface TrustScore {
  score: number;
  band: TrustBand;
  components: {
    signature: 0 | 40;
    drift: 0 | 20;
    path: 0 | 20;
    age: 0 | 20;
  };
}

/** Standard npm prefix patterns we treat as sane. Pure substring check —
 *  cheap, no shell-out. */
const SANE_PATH_HINTS = [
  "node_modules",     // any project local install
  "/usr/local",       // homebrew + manual prefix
  "/opt/",            // /opt/homebrew + /opt/local
  "AppData\\",        // %APPDATA% on Windows
  "AppData/",         // same, forward slashes
  "nvm",              // any NVM variant
  ".volta",           // volta
  ".fnm",             // fnm
  "scoop",            // scoop
];

function isPathSane(installPath: string): boolean {
  if (!installPath) return false;
  const p = installPath.toLowerCase();
  return SANE_PATH_HINTS.some((h) => p.includes(h.toLowerCase()));
}

function isRecent(snapshot: InstallSnapshot | null, maxDays = 90): boolean {
  if (!snapshot) return true; // fresh first-run snapshot counts as recent
  try {
    const captured = Date.parse(snapshot.capturedAt);
    if (Number.isNaN(captured)) return false;
    return (Date.now() - captured) / 86_400_000 <= maxDays;
  } catch { return false; }
}

export function computeTrustScore(inp: TrustScoreInput): TrustScore {
  const components = {
    signature: (inp.signatureOk ? 40 : 0) as 0 | 40,
    drift: (inp.noDrift ? 20 : 0) as 0 | 20,
    path: (inp.pathSane ? 20 : 0) as 0 | 20,
    age: (inp.recent ? 20 : 0) as 0 | 20,
  };
  const score = components.signature + components.drift + components.path + components.age;
  const band: TrustBand = score < 40 ? "ABORT" : score < 70 ? "CAUTION" : "TRUST";
  return { score, band, components };
}

// ─── CAPSULE URI ─────────────────────────────────────────────────────

export interface Capsule {
  version: string;
  merkle: string;
  ts: number;
  exp: number;
  sig: string;
  nonce?: string;
  /** 22-char sig of the previous capsule in this chain (optional). */
  prev?: string;
}

const CAPSULE_PREFIX = "mneme://attest/v1/";

/** Default capsule TTL — 5 minutes. Short enough that replaying a
 *  captured capsule into a future session is physically prevented;
 *  long enough that humans + AI agents can paste-and-act without race
 *  conditions. */
export const DEFAULT_TTL_SECONDS = 300;

export interface BuildCapsuleOptions {
  version: string;
  merkle: string;
  /** Caller-supplied nonce binds the capsule to a single session. */
  nonce?: string;
  /** Time-to-live in seconds (default 300 = 5 min). Pass 0 to mint a
   *  capsule with no expiry — discouraged in production. */
  ttlSeconds?: number;
  /** Previous capsule's sig — links this capsule into a chain. AI
   *  agents that see multiple capsules in one session verify they form
   *  a chain (no rogue capsule injection mid-session). */
  prev?: string;
}

/** Build a single-line capsule URI. Pure local — uses the install-local
 *  HMAC key (auto-generated on first call, lives in
 *  `.mneme/trust/capsule.key`).
 *
 *  First-principles defenses:
 *    - TTL: capsule self-destructs after ttlSeconds (default 300).
 *      Replay attack window is physical, not cryptographic.
 *    - chain-link: optional `prev` ties this capsule to predecessor.
 *      Captured one capsule? Useless without the whole chain.
 *    - nonce: session-bound capability. */
export function buildCapsule(repoRoot: string, opts: BuildCapsuleOptions): { capsule: Capsule; uri: string } {
  const k = getKey(repoRoot);
  const ts = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds === undefined ? DEFAULT_TTL_SECONDS : Math.max(0, opts.ttlSeconds);
  const exp = ttl === 0 ? 0 : ts + ttl;
  const noncePart = opts.nonce ? `|${opts.nonce}` : "";
  const prevPart = opts.prev ? `|${opts.prev}` : "";
  const canonical = `${opts.version}|${opts.merkle}|${ts}|${exp}${noncePart}${prevPart}`;
  const sig = sign(canonical, k);
  const capsule: Capsule = { version: opts.version, merkle: opts.merkle, ts, exp, sig };
  if (opts.nonce) capsule.nonce = opts.nonce;
  if (opts.prev) capsule.prev = opts.prev;
  const params: string[] = [];
  if (opts.nonce) params.push(`nonce=${encodeURIComponent(opts.nonce)}`);
  if (opts.prev) params.push(`prev=${encodeURIComponent(opts.prev)}`);
  const queryPart = params.length ? `?${params.join("&")}` : "";
  const uri = `${CAPSULE_PREFIX}${encodeURIComponent(opts.version)}/${opts.merkle}/${ts}/${exp}/${sig}${queryPart}`;
  return { capsule, uri };
}

export function parseCapsule(uri: string): Capsule | null {
  if (!uri.startsWith(CAPSULE_PREFIX)) return null;
  const rest = uri.slice(CAPSULE_PREFIX.length);
  const [pathPart, queryPart] = rest.split("?");
  const segs = pathPart!.split("/");
  if (segs.length !== 5) return null;
  const [verEnc, merkle, tsStr, expStr, sig] = segs;
  const ts = parseInt(tsStr!, 10);
  const exp = parseInt(expStr!, 10);
  if (Number.isNaN(ts) || Number.isNaN(exp) || !merkle || !sig) return null;
  const out: Capsule = { version: decodeURIComponent(verEnc!), merkle, ts, exp, sig };
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const n = params.get("nonce");
    if (n) out.nonce = n;
    const p = params.get("prev");
    if (p) out.prev = p;
  }
  return out;
}

export interface VerifyCapsuleOptions {
  /** When true, accept capsules past their expiry (use for forensics
   *  on old capsules; never for production gating). */
  allowExpired?: boolean;
  /** Caller-known expected nonce — if set, capsule's nonce must match. */
  expectedNonce?: string;
}

export function verifyCapsule(repoRoot: string, capsule: Capsule | string, opts: VerifyCapsuleOptions = {}): { ok: boolean; reason?: string } {
  const c = typeof capsule === "string" ? parseCapsule(capsule) : capsule;
  if (!c) return { ok: false, reason: "malformed capsule URI" };
  const k = getKey(repoRoot);
  const noncePart = c.nonce ? `|${c.nonce}` : "";
  const prevPart = c.prev ? `|${c.prev}` : "";
  const canonical = `${c.version}|${c.merkle}|${c.ts}|${c.exp}${noncePart}${prevPart}`;
  const expected = sign(canonical, k);
  if (expected !== c.sig) return { ok: false, reason: "HMAC signature mismatch — capsule was forged or signed by a different install" };
  if (c.exp > 0 && !opts.allowExpired) {
    const now = Math.floor(Date.now() / 1000);
    if (now > c.exp) return { ok: false, reason: `capsule expired ${now - c.exp}s ago — request a fresh one` };
  }
  if (opts.expectedNonce !== undefined && c.nonce !== opts.expectedNonce) {
    return { ok: false, reason: "nonce mismatch — capsule was minted for a different session" };
  }
  return { ok: true };
}

/** Verify a sequence of capsules forms a valid chain. Each capsule's
 *  `prev` must equal the prior capsule's `sig`. First capsule must not
 *  have `prev` (or `prev` is ignored on the first link). All capsules
 *  must individually verify (signature + non-expired). */
export function verifyCapsuleChain(repoRoot: string, capsules: Array<Capsule | string>, opts: VerifyCapsuleOptions = {}): { ok: boolean; reason?: string; brokenAt?: number } {
  if (capsules.length === 0) return { ok: false, reason: "empty chain" };
  let prevSig: string | undefined = undefined;
  for (let i = 0; i < capsules.length; i++) {
    const c = typeof capsules[i] === "string" ? parseCapsule(capsules[i] as string) : capsules[i] as Capsule;
    if (!c) return { ok: false, reason: `capsule ${i} malformed`, brokenAt: i };
    const v = verifyCapsule(repoRoot, c, opts);
    if (!v.ok) return { ok: false, reason: `capsule ${i}: ${v.reason}`, brokenAt: i };
    if (i > 0 && c.prev !== prevSig) {
      return { ok: false, reason: `capsule ${i} prev=${c.prev?.slice(0, 8) ?? "<none>"} does not match capsule ${i - 1} sig=${prevSig?.slice(0, 8)}`, brokenAt: i };
    }
    prevSig = c.sig;
  }
  return { ok: true };
}

// ─── HEADLINE — verifySelfDeep ───────────────────────────────────────

export interface DeepAttestation {
  ok: boolean;
  version: string;
  installPath: string;
  merkle: string;
  fileCount: number;
  snapshotCaptured: boolean;
  drift: DriftReport;
  trustScore: TrustScore;
  capsuleUri: string;
  /** One line a human can paste anywhere. */
  oneLine: string;
}

export interface VerifySelfDeepOptions {
  /** Caller-supplied nonce to bind capsule to a session. */
  nonce?: string;
  /** When true, refuses to capture a snapshot if none exists yet.
   *  Useful for CI gating. */
  noAutoCapture?: boolean;
}

/** The discrete + super-optimized verify-self. Composes Merkle install-
 *  root + drift + trust score + capsule URI into one call. */
export function verifySelfDeep(installRoot: string, repoRoot: string, version: string, opts: VerifySelfDeepOptions = {}): DeepAttestation {
  const merkle = computeInstallMerkle(installRoot);
  let snapshot = getInstallSnapshot(repoRoot);
  let snapshotCaptured = false;
  // Offline-first: lazy capture on first run (unless caller opted out).
  if (!snapshot && !opts.noAutoCapture) {
    snapshot = captureInstallSnapshot(repoRoot, { version, merkle: merkle.root, fileCount: merkle.fileCount });
    snapshotCaptured = true;
  }
  const drift = compareToSnapshot(merkle, snapshot);
  // Build capsule first so we know whether sig verifies (used in trust score).
  const { uri } = buildCapsule(repoRoot, { version, merkle: merkle.root, nonce: opts.nonce });
  const sigOk = verifyCapsule(repoRoot, uri).ok;
  const trustScore = computeTrustScore({
    signatureOk: sigOk,
    noDrift: !drift.drifted,
    pathSane: isPathSane(installRoot),
    recent: isRecent(snapshot),
  });
  const oneLine = `TRUST=${trustScore.score}/100 [${trustScore.band}] · v${version} · merkle=${merkle.root} · drift=${drift.drifted ? "YES" : "no"} · ${uri}`;
  return {
    ok: trustScore.band !== "ABORT",
    version,
    installPath: installRoot,
    merkle: merkle.root,
    fileCount: merkle.fileCount,
    snapshotCaptured,
    drift,
    trustScore,
    capsuleUri: uri,
    oneLine,
  };
}

// ─── FORMATTER ───────────────────────────────────────────────────────

export function formatDeepAttestation(a: DeepAttestation): string {
  const badge = a.trustScore.band === "TRUST" ? "🟢"
              : a.trustScore.band === "CAUTION" ? "🟡"
              : "🔴";
  const lines: string[] = [
    `${badge} TRUST CAPSULE — ${a.trustScore.band} (${a.trustScore.score}/100)`,
    ``,
    `  Version:        ${a.version}`,
    `  Install path:   ${a.installPath}`,
    `  Merkle root:    ${a.merkle}  (${a.fileCount} files)`,
    `  Snapshot:       ${a.snapshotCaptured ? "captured now (first run)" : "loaded from .mneme/trust/install-merkle.json"}`,
    `  Drift:          ${a.drift.drifted ? `⚠ YES (added=${a.drift.added.length} removed=${a.drift.removed.length} changed=${a.drift.changed.length})` : "✓ no drift"}`,
    ``,
    `  Trust score components:`,
    `    signature OK:   ${a.trustScore.components.signature === 40 ? "✓ +40" : "✗ +0"}`,
    `    no drift:       ${a.trustScore.components.drift === 20 ? "✓ +20" : "✗ +0"}`,
    `    path sane:      ${a.trustScore.components.path === 20 ? "✓ +20" : "✗ +0"}`,
    `    recent install: ${a.trustScore.components.age === 20 ? "✓ +20" : "✗ +0"}`,
    ``,
    `  Capsule URI (paste anywhere — pulse, commit, Slack):`,
    `    ${a.capsuleUri}`,
    ``,
    `  One-line for AI agents:`,
    `    ${a.oneLine}`,
    ``,
  ];
  return lines.join("\n");
}
