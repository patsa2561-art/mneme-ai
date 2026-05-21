/**
 * v2.21.2 — AI MORTUARY.
 *
 * "What happens to your AI when YOU die?"
 *
 * Every human eventually dies. AI integration into individual lives is
 * only growing (Mneme corpus, custom personas, decision history, code
 * provenance). Vendor accounts close. Family inherits NOTHING — the
 * AI persona dies with the person.
 *
 * AI Mortuary is the cryptographic protocol that fixes this. It runs
 * fully local-first; vendor sunset cannot end it. Six primitives:
 *
 *   1. DEAD-MAN SWITCH — owner pings every N days; if missed by grace
 *      window, the switch fires automatically. No vendor in the loop.
 *
 *   2. BENEFICIARY REGISTRY — each beneficiary registers their RSA
 *      public key + the scope they're entitled to (financial /
 *      personal / professional / legal / medical / family / all).
 *      Different relationships get different slices.
 *
 *   3. SCOPE-PARTITIONED ENCRYPTED BUNDLES — when the switch fires,
 *      Mneme partitions the owner's state into slices (filtered by
 *      tag) + encrypts each slice to the beneficiary's RSA pubkey
 *      using hybrid RSA-OAEP + AES-256-GCM. Standards-grade crypto
 *      from node:crypto stdlib; zero new deps.
 *
 *   4. BENEFICIARY REVIEW WINDOW — after the switch fires, each
 *      beneficiary has N days to accept / reject their bundle.
 *      Rejection deletes the slice; acceptance writes a signed
 *      acknowledgement to the audit chain.
 *
 *   5. JURISDICTIONAL ADAPTER — render the inheritance event as a
 *      legally-readable artifact in the owner's declared jurisdiction
 *      (US / EU / TH / JP defaults; pluggable templates).
 *
 *   6. HMAC AUDIT CHAIN — every state change (registration,
 *      acceptance, rejection, switch-fire) is HMAC-signed in
 *      mortuary_chain.jsonl. Tamper-evident for 20+ years.
 *
 * Why this is world-changing:
 *   - Civilizational: every human will eventually need this
 *   - Cryptographic: not an emotional gimmick; verifiable inheritance
 *   - Vendor-independent: works after Anthropic / OpenAI shut down
 *   - Multi-jurisdiction: not US-only; works globally
 *   - Mneme has all the substrate (APOSTILLE / soul / persona)
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHmac, createHash, randomBytes, generateKeyPairSync, publicEncrypt, privateDecrypt, constants, createCipheriv, createDecipheriv } from "node:crypto";

const DIR = ".mneme/mortuary";
const CONFIG = "config.json";
const BENEFICIARIES = "beneficiaries.jsonl";
const PINGS = "pings.jsonl";
const CHAIN = "mortuary_chain.jsonl";
const BUNDLES_DIR = "bundles";
const KEY = "mortuary.key";

export type Jurisdiction = "US" | "EU" | "TH" | "JP" | "GLOBAL";

export type ScopeSlice =
  | "financial"
  | "personal"
  | "professional"
  | "legal"
  | "medical"
  | "family"
  | "everything";

export const ALL_SLICES: ScopeSlice[] = [
  "financial", "personal", "professional", "legal", "medical", "family",
];

// ─── 1. CONFIG + DEAD-MAN SWITCH ────────────────────────────────────────

export interface MortuaryConfig {
  v: 1;
  owner: string;
  jurisdiction: Jurisdiction;
  /** Days between required pings. */
  pingWindowDays: number;
  /** Extra grace days after a missed ping before the switch fires. */
  graceDays: number;
  /** Days beneficiaries have to accept/reject after the switch fires. */
  reviewWindowDays: number;
  /** Last ping timestamp. */
  lastPingAt: string;
  /** Set to non-empty when switch has fired. */
  firedAt?: string;
  createdAt: string;
}

const DEFAULTS = {
  pingWindowDays: 30,
  graceDays: 7,
  reviewWindowDays: 30,
};

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  const bd = join(d, BUNDLES_DIR);
  if (!existsSync(bd)) mkdirSync(bd, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const d = dir(repoRoot);
  const p = join(d, KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

function configPath(repoRoot: string): string { return join(dir(repoRoot), CONFIG); }

export interface InitOptions {
  owner: string;
  jurisdiction?: Jurisdiction;
  pingWindowDays?: number;
  graceDays?: number;
  reviewWindowDays?: number;
}

export function init(repoRoot: string, opts: InitOptions): MortuaryConfig {
  const cfg: MortuaryConfig = {
    v: 1,
    owner: opts.owner,
    jurisdiction: opts.jurisdiction ?? "GLOBAL",
    pingWindowDays: opts.pingWindowDays ?? DEFAULTS.pingWindowDays,
    graceDays: opts.graceDays ?? DEFAULTS.graceDays,
    reviewWindowDays: opts.reviewWindowDays ?? DEFAULTS.reviewWindowDays,
    lastPingAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(configPath(repoRoot), JSON.stringify(cfg, null, 2), "utf8");
  appendChain(repoRoot, "init", { owner: cfg.owner, jurisdiction: cfg.jurisdiction });
  return cfg;
}

export function getConfig(repoRoot: string): MortuaryConfig | null {
  const p = configPath(repoRoot);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as MortuaryConfig; } catch { return null; }
}

export function ping(repoRoot: string, now: Date = new Date()): MortuaryConfig {
  const cfg = getConfig(repoRoot);
  if (!cfg) throw new Error("mortuary: not initialised — run `mneme mortuary init` first");
  if (cfg.firedAt) throw new Error("mortuary: switch already fired; pings rejected");
  cfg.lastPingAt = now.toISOString();
  writeFileSync(configPath(repoRoot), JSON.stringify(cfg, null, 2), "utf8");
  appendFileSync(join(dir(repoRoot), PINGS), JSON.stringify({ ts: cfg.lastPingAt, sig: sign(cfg.lastPingAt + cfg.owner, key(repoRoot)) }) + "\n", "utf8");
  appendChain(repoRoot, "ping", { ts: cfg.lastPingAt });
  return cfg;
}

export interface SwitchStatus {
  initialised: boolean;
  firedAt?: string;
  daysSinceLastPing: number;
  daysUntilFire: number;
  willFireAt: string | null;
  inReviewWindow: boolean;
  reviewEndsAt: string | null;
}

export function switchStatus(repoRoot: string, now: Date = new Date()): SwitchStatus {
  const cfg = getConfig(repoRoot);
  if (!cfg) return { initialised: false, daysSinceLastPing: 0, daysUntilFire: 0, willFireAt: null, inReviewWindow: false, reviewEndsAt: null };
  const lastPingMs = new Date(cfg.lastPingAt).getTime();
  const daysSince = (now.getTime() - lastPingMs) / 86400000;
  const fireAfterDays = cfg.pingWindowDays + cfg.graceDays;
  const daysUntilFire = Math.max(0, fireAfterDays - daysSince);
  const willFireAt = new Date(lastPingMs + fireAfterDays * 86400000).toISOString();
  let inReview = false, reviewEndsAt: string | null = null;
  if (cfg.firedAt) {
    const firedMs = new Date(cfg.firedAt).getTime();
    const reviewEndsMs = firedMs + cfg.reviewWindowDays * 86400000;
    inReview = now.getTime() < reviewEndsMs;
    reviewEndsAt = new Date(reviewEndsMs).toISOString();
  }
  return {
    initialised: true,
    firedAt: cfg.firedAt,
    daysSinceLastPing: Number(daysSince.toFixed(2)),
    daysUntilFire: Number(daysUntilFire.toFixed(2)),
    willFireAt,
    inReviewWindow: inReview,
    reviewEndsAt,
  };
}

/** Should the switch fire NOW given current config + time?  Pure check
 *  — doesn't fire; just reports. */
export function shouldFire(repoRoot: string, now: Date = new Date()): boolean {
  const cfg = getConfig(repoRoot);
  if (!cfg || cfg.firedAt) return false;
  const lastMs = new Date(cfg.lastPingAt).getTime();
  return now.getTime() - lastMs > (cfg.pingWindowDays + cfg.graceDays) * 86400000;
}

// ─── 2. BENEFICIARY REGISTRY ────────────────────────────────────────────

export interface Beneficiary {
  v: 1;
  id: string;
  name: string;
  /** RSA-OAEP public key in PEM format. */
  publicKeyPem: string;
  /** Slices this beneficiary inherits. */
  scope: ScopeSlice[];
  /** Plain-text relationship (spouse / accountant / lawyer / child / friend). */
  relationship: string;
  addedAt: string;
}

function benefPath(repoRoot: string): string { return join(dir(repoRoot), BENEFICIARIES); }

export interface AddBeneficiaryOptions {
  name: string;
  publicKeyPem: string;
  scope: ScopeSlice[];
  relationship: string;
}

export function addBeneficiary(repoRoot: string, opts: AddBeneficiaryOptions): Beneficiary {
  const b: Beneficiary = {
    v: 1,
    id: "bn_" + randomBytes(4).toString("hex"),
    name: opts.name,
    publicKeyPem: opts.publicKeyPem,
    scope: opts.scope,
    relationship: opts.relationship,
    addedAt: new Date().toISOString(),
  };
  appendFileSync(benefPath(repoRoot), JSON.stringify(b) + "\n", "utf8");
  appendChain(repoRoot, "beneficiary-add", { id: b.id, name: b.name, scope: b.scope });
  return b;
}

export function listBeneficiaries(repoRoot: string): Beneficiary[] {
  const p = benefPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as Beneficiary; } catch { return null; } }).filter((b): b is Beneficiary => !!b);
  } catch { return []; }
}

export function removeBeneficiary(repoRoot: string, id: string): void {
  const rest = listBeneficiaries(repoRoot).filter((b) => b.id !== id);
  writeFileSync(benefPath(repoRoot), rest.map((b) => JSON.stringify(b)).join("\n") + (rest.length > 0 ? "\n" : ""), "utf8");
  appendChain(repoRoot, "beneficiary-remove", { id });
}

/** Helper: generate an RSA keypair for a beneficiary (returned as PEM
 *  strings). The beneficiary keeps the private key; the owner uses the
 *  public key in addBeneficiary(). */
export function generateBeneficiaryKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey as string, privateKeyPem: privateKey as string };
}

// ─── 3. SCOPE-PARTITIONED ENCRYPTED BUNDLES (hybrid RSA + AES) ──────────

export interface InheritanceBundle {
  v: 1;
  /** sha256 of the original plaintext payload (for integrity-check after decrypt). */
  payloadSha: string;
  /** Beneficiary id this bundle is encrypted to. */
  beneficiaryId: string;
  /** Beneficiary name (for the legal artifact). */
  beneficiaryName: string;
  /** Scope slices included. */
  scope: ScopeSlice[];
  /** Owner. */
  owner: string;
  /** Jurisdiction. */
  jurisdiction: Jurisdiction;
  /** When the switch fired. */
  firedAt: string;
  /** Base64 ciphertext (AES-256-GCM). */
  ciphertextB64: string;
  /** Base64 IV. */
  ivB64: string;
  /** Base64 auth tag (GCM). */
  authTagB64: string;
  /** Base64 RSA-OAEP-encrypted AES session key. */
  wrappedKeyB64: string;
  /** HMAC over the canonical bundle payload (for tamper-detection by owner-secret). */
  ownerHmac: string;
}

/** Owner-side: collect the slice payloads from repo state + emit
 *  one encrypted bundle per beneficiary. Each bundle contains only the
 *  slices that beneficiary is entitled to. */
export interface PartitionOptions {
  /** Override the timestamp the bundles record as firedAt (test injection). */
  firedAt?: string;
  /** Provide the slice payloads directly (caller supplies the actual
   *  Mneme state to be inherited).  In production the daemon collects
   *  these from soul / time-bridge / replica / apostille; tests pass
   *  synthetic payloads. */
  slicePayloads: Partial<Record<ScopeSlice, string>>;
}

export function partitionAndEncrypt(repoRoot: string, opts: PartitionOptions): InheritanceBundle[] {
  const cfg = getConfig(repoRoot);
  if (!cfg) throw new Error("mortuary: not initialised");
  const k = key(repoRoot);
  const firedAt = opts.firedAt ?? new Date().toISOString();
  const beneficiaries = listBeneficiaries(repoRoot);
  const bundles: InheritanceBundle[] = [];
  for (const b of beneficiaries) {
    // Filter slice payloads to the scope this beneficiary is entitled to.
    const includedSlices = b.scope.includes("everything") ? ALL_SLICES : b.scope;
    const subPayload: Record<string, string> = {};
    for (const s of includedSlices) {
      if (opts.slicePayloads[s] !== undefined) subPayload[s] = opts.slicePayloads[s]!;
    }
    const plaintext = JSON.stringify(subPayload);
    const payloadSha = createHash("sha256").update(plaintext).digest("hex").slice(0, 32);

    // Hybrid encryption: random AES-256-GCM session key, wrap with RSA-OAEP.
    const sessionKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", sessionKey, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const wrappedKey = publicEncrypt({ key: b.publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, sessionKey);

    const bundle: Omit<InheritanceBundle, "ownerHmac"> = {
      v: 1,
      payloadSha,
      beneficiaryId: b.id,
      beneficiaryName: b.name,
      scope: includedSlices,
      owner: cfg.owner,
      jurisdiction: cfg.jurisdiction,
      firedAt,
      ciphertextB64: ct.toString("base64"),
      ivB64: iv.toString("base64"),
      authTagB64: authTag.toString("base64"),
      wrappedKeyB64: wrappedKey.toString("base64"),
    };
    const canonical = `${bundle.v}|${bundle.payloadSha}|${bundle.beneficiaryId}|${bundle.firedAt}|${bundle.scope.join(",")}|${bundle.ciphertextB64.slice(0, 64)}`;
    const ownerHmac = sign(canonical, k);
    const full: InheritanceBundle = { ...bundle, ownerHmac };
    writeFileSync(join(dir(repoRoot), BUNDLES_DIR, `${b.id}.bundle.json`), JSON.stringify(full, null, 2), "utf8");
    bundles.push(full);
    appendChain(repoRoot, "bundle-created", { beneficiaryId: b.id, scope: includedSlices });
  }
  return bundles;
}

/** Beneficiary-side: decrypt with their private key. Verifies the
 *  AES-GCM auth tag + integrity SHA. */
export function decryptBundle(bundle: InheritanceBundle, privateKeyPem: string): { ok: boolean; payload?: Record<string, string>; error?: string } {
  try {
    const sessionKey = privateDecrypt(
      { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(bundle.wrappedKeyB64, "base64"),
    );
    const iv = Buffer.from(bundle.ivB64, "base64");
    const ct = Buffer.from(bundle.ciphertextB64, "base64");
    const authTag = Buffer.from(bundle.authTagB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", sessionKey, iv);
    decipher.setAuthTag(authTag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const ptStr = pt.toString("utf8");
    const computedSha = createHash("sha256").update(ptStr).digest("hex").slice(0, 32);
    if (computedSha !== bundle.payloadSha) return { ok: false, error: "payload sha mismatch — tampered" };
    return { ok: true, payload: JSON.parse(ptStr) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ─── 4. DEAD-MAN SWITCH FIRE + REVIEW WINDOW ────────────────────────────

export interface FireOptions extends PartitionOptions {
  /** Force fire even if shouldFire() returns false (admin / test). */
  force?: boolean;
}

export function fire(repoRoot: string, opts: FireOptions, now: Date = new Date()): { bundles: InheritanceBundle[]; reviewEndsAt: string } {
  const cfg = getConfig(repoRoot);
  if (!cfg) throw new Error("mortuary: not initialised");
  if (cfg.firedAt) throw new Error("mortuary: already fired at " + cfg.firedAt);
  if (!opts.force && !shouldFire(repoRoot, now)) {
    throw new Error(`mortuary: switch is not due to fire (lastPing=${cfg.lastPingAt}). Use force:true to simulate.`);
  }
  cfg.firedAt = now.toISOString();
  writeFileSync(configPath(repoRoot), JSON.stringify(cfg, null, 2), "utf8");
  const bundles = partitionAndEncrypt(repoRoot, { firedAt: cfg.firedAt, slicePayloads: opts.slicePayloads });
  const reviewEndsAt = new Date(now.getTime() + cfg.reviewWindowDays * 86400000).toISOString();
  appendChain(repoRoot, "switch-fired", { firedAt: cfg.firedAt, reviewEndsAt, bundleCount: bundles.length });
  return { bundles, reviewEndsAt };
}

export type ReviewResponse = "accept" | "reject";

export function respond(repoRoot: string, beneficiaryId: string, response: ReviewResponse): { ok: boolean; reason?: string } {
  const cfg = getConfig(repoRoot);
  if (!cfg || !cfg.firedAt) return { ok: false, reason: "switch has not fired" };
  const bundlePath = join(dir(repoRoot), BUNDLES_DIR, `${beneficiaryId}.bundle.json`);
  if (!existsSync(bundlePath)) return { ok: false, reason: "no bundle for that beneficiary id" };
  appendChain(repoRoot, "review-response", { beneficiaryId, response, ts: new Date().toISOString() });
  if (response === "reject") {
    try { unlinkSync(bundlePath); } catch { /* */ }
  }
  return { ok: true };
}

// ─── 5. JURISDICTIONAL ADAPTER ──────────────────────────────────────────

const TEMPLATES: Record<Jurisdiction, string> = {
  US: `LAST WILL AND TESTAMENT — DIGITAL ASSET INSTRUCTIONS (Mneme Inheritance Bundle)\n\nI, {{owner}}, in addition to my Last Will and Testament, hereby instruct my executor to deliver the cryptographic inheritance bundles below to my designated beneficiaries:\n{{beneficiaryList}}\n\nThese bundles are encrypted to each beneficiary's RSA public key. Decryption keys are held by the beneficiary; the executor's sole duty is delivery.\n\nSigned at: {{firedAt}}\nMneme Mortuary HMAC (chain integrity): {{hmac}}`,
  EU: `INSTRUMENT OF SUCCESSION FOR DIGITAL HERITAGE (Pursuant to Regulation (EU) No 650/2012 + GDPR Art. 17)\n\nDeclarant: {{owner}}\nJurisdiction declared: EU member state of habitual residence\n\nThe following beneficiaries inherit scope-limited slices of my digital persona:\n{{beneficiaryList}}\n\nAll bundles are end-to-end encrypted; the GDPR right-to-be-forgotten survives this instrument because the slices encrypt to private keys held only by named beneficiaries.\n\nFired: {{firedAt}}\nChain integrity: {{hmac}}`,
  TH: `เอกสารคำสั่งทางพินัยกรรมว่าด้วยมรดกดิจิทัล (Mneme Inheritance Bundle)\n\nข้าพเจ้า {{owner}} กำหนดให้ผู้รับมรดกต่อไปนี้ ได้รับสิทธิ์เข้าถึงข้อมูล AI ของข้าพเจ้าตามขอบเขตที่ระบุ:\n{{beneficiaryList}}\n\nข้อมูลทั้งหมดเข้ารหัสด้วยกุญแจสาธารณะของผู้รับมรดก; ผู้จัดการมรดกมีหน้าที่เพียงนำส่ง.\n\nลงนามเมื่อ: {{firedAt}}\nChain integrity (HMAC): {{hmac}}`,
  JP: `デジタル遺産に関する遺言補遺 (Mneme Inheritance Bundle)\n\n遺言者: {{owner}}\n以下の受益者に、私のAI状態の指定された範囲を相続させます:\n{{beneficiaryList}}\n\n各バンドルは受益者の公開鍵で暗号化されており、復号鍵は受益者のみが保持します。\n\n発火日時: {{firedAt}}\nチェーン整合性: {{hmac}}`,
  GLOBAL: `MNEME INHERITANCE INSTRUMENT — GLOBAL TEMPLATE\n\nOwner: {{owner}}\nJurisdiction: declarant's habitual residence applies\n\nBeneficiaries:\n{{beneficiaryList}}\n\nFired: {{firedAt}}\nHMAC: {{hmac}}\n\nThis document accompanies the encrypted inheritance bundles. Each bundle decrypts only to the corresponding beneficiary's RSA private key.`,
};

export function renderWill(repoRoot: string): string {
  const cfg = getConfig(repoRoot);
  if (!cfg) throw new Error("mortuary: not initialised");
  const beneficiaries = listBeneficiaries(repoRoot);
  const list = beneficiaries.map((b) => `  • ${b.name} (${b.relationship}) — id ${b.id}; scope: ${b.scope.join(", ")}`).join("\n");
  const k = key(repoRoot);
  const hmacBase = `${cfg.owner}|${cfg.jurisdiction}|${cfg.firedAt ?? ""}|${beneficiaries.length}`;
  const hmac = sign(hmacBase, k);
  return TEMPLATES[cfg.jurisdiction]
    .replace("{{owner}}", cfg.owner)
    .replace("{{beneficiaryList}}", list)
    .replace("{{firedAt}}", cfg.firedAt ?? "(not yet fired)")
    .replace("{{hmac}}", hmac);
}

// ─── 6. HMAC AUDIT CHAIN ────────────────────────────────────────────────

interface ChainEntry {
  v: 1;
  seq: number;
  ts: string;
  kind: string;
  payload: Record<string, unknown>;
  prevSig: string | null;
  sig: string;
}

function chainPath(repoRoot: string): string { return join(dir(repoRoot), CHAIN); }

function readChain(repoRoot: string): ChainEntry[] {
  const p = chainPath(repoRoot);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l) as ChainEntry; } catch { return null; } }).filter((e): e is ChainEntry => !!e);
  } catch { return []; }
}

function appendChain(repoRoot: string, kind: string, payload: Record<string, unknown>): void {
  const chain = readChain(repoRoot);
  const prev = chain[chain.length - 1];
  const seq = (prev?.seq ?? 0) + 1;
  const ts = new Date().toISOString();
  const k = key(repoRoot);
  const canonical = `${seq}|${ts}|${kind}|${JSON.stringify(payload)}|${prev?.sig ?? ""}`;
  const sig = sign(canonical, k);
  const entry: ChainEntry = { v: 1, seq, ts, kind, payload, prevSig: prev?.sig ?? null, sig };
  appendFileSync(chainPath(repoRoot), JSON.stringify(entry) + "\n", "utf8");
}

export function verifyChain(repoRoot: string): { ok: boolean; brokenAt?: number; entries: number } {
  const chain = readChain(repoRoot);
  const k = key(repoRoot);
  let prevSig: string | null = null;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i]!;
    const canonical = `${e.seq}|${e.ts}|${e.kind}|${JSON.stringify(e.payload)}|${prevSig ?? ""}`;
    const expected = sign(canonical, k);
    if (expected !== e.sig) return { ok: false, brokenAt: i, entries: chain.length };
    if (e.prevSig !== prevSig) return { ok: false, brokenAt: i, entries: chain.length };
    prevSig = e.sig;
  }
  return { ok: true, entries: chain.length };
}

// ─── FORMATTERS ────────────────────────────────────────────────────────

export function formatStatus(s: SwitchStatus, cfg?: MortuaryConfig | null): string {
  if (!s.initialised) return "⚱️ MORTUARY — not initialised. Run `mneme mortuary init --owner <name>` first.";
  const lines: string[] = [];
  lines.push("⚱️ MORTUARY — dead-man switch status");
  lines.push("");
  if (cfg) {
    lines.push(`  Owner:          ${cfg.owner}`);
    lines.push(`  Jurisdiction:   ${cfg.jurisdiction}`);
    lines.push(`  Ping window:    ${cfg.pingWindowDays} days`);
    lines.push(`  Grace days:     ${cfg.graceDays}`);
    lines.push(`  Review window:  ${cfg.reviewWindowDays} days`);
    lines.push("");
  }
  if (s.firedAt) {
    lines.push(`  ⚠ SWITCH FIRED at ${s.firedAt}`);
    lines.push(`  Review ends:     ${s.reviewEndsAt}`);
    lines.push(`  In review:       ${s.inReviewWindow ? "yes" : "no"}`);
  } else {
    lines.push(`  Days since last ping:  ${s.daysSinceLastPing}`);
    lines.push(`  Days until fire:       ${s.daysUntilFire}`);
    lines.push(`  Will fire at:          ${s.willFireAt}`);
  }
  return lines.join("\n");
}

export function formatBeneficiaries(list: Beneficiary[]): string {
  if (list.length === 0) return "⚱️ No beneficiaries registered.";
  const lines: string[] = ["⚱️ Beneficiaries:", ""];
  for (const b of list) {
    lines.push(`  ${b.id}  ${b.name.padEnd(28)} ${b.relationship.padEnd(16)} scope: ${b.scope.join(", ")}`);
  }
  return lines.join("\n");
}
