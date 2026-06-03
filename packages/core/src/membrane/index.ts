/**
 * THE MEMBRANE — the capstone that fuses the three membrane pillars into ONE
 * signed packet every AI agent crosses at session start.
 *
 * Mneme already ships the three pillars as discrete, proven modules:
 *   PILLAR 1 — CAPABILITY  → STELE  (a merkle-rooted, delta-syncable surface)
 *   PILLAR 2 — VALUE       → AXIA   (a hash-chained, offline-verifiable ledger)
 *   PILLAR 3 — ACTIVATION  → BOOT   (a when→tool decision table / instructions)
 *
 * Each answers one of the three STRUCTURAL reasons an installed-but-idle tool
 * stays idle: the agent (1) doesn't KNOW what exists, (2) doesn't know WHEN to
 * use it, (3) can't PROVE the value it created. The MEMBRANE fuses all three so
 * an agent fetches ONE packet at boot — and a third party verifies it offline
 * with one Ed25519 receipt:
 *
 *   capability: "you hold the latest, complete surface — here's the O(delta) you
 *                lack (0 if your merkle root already matches)."   (STELE)
 *   activation: "here is WHEN to reach for each tool."            (BOOT)
 *   value:      "here is the MEASURED, signed value created +     (AXIA)
 *                destructive ops GATED — verifiable, no $ fiction."
 *
 * ★ HONEST (DIAKRISIS): the win is the FUSION + the offline-verifiable proof —
 *   NOT a new analysis (all three roots already exist + each scores 100 on its
 *   own gauntlet). buildMembrane is pure + total (never throws); the caller
 *   (CLI/MCP) gathers the live AXIA events + recalled cortex facts and injects
 *   them, so the core stays fs-free + deterministic. Signing is at the edge via
 *   sealMembrane. AXIA's discipline carries through: counts are FACTS of events
 *   (GATED / SAVED / REDACTED / CORRECTED / FLAGGED), never "attacks prevented"
 *   and never an invented "$ damage" — the only dollar figure is tokens-saved ×
 *   the price-per-1k YOU supply.
 */
import { buildStele, steleDelta, type SteleEntry } from "../stele/index.js";
import { buildBootPacket, type DecisionRow, CAPABILITY_LINES } from "../boot/index.js";
import { buildAxiaLedger, axiaSummary, type AxiaEvent, type AxiaRecord, type AxiaKind } from "../axia/index.js";
import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../agent_manifest.js";
import { issueReceipt, verifyReceipt, canonicalJson, type NotaryReceipt } from "../notary/receipt.js";
import { createHash } from "node:crypto";

// ─────────────────────────── shapes ───────────────────────────

/** PILLAR 1 — the capability surface, provably current via merkle (STELE). */
export interface MembraneCapability {
  /** merkle root of the whole command surface (tamper-evident fingerprint). */
  root: string;
  /** number of capabilities on the surface. */
  count: number;
  /** the agent's held root matched the live root ⇒ nothing to sync. */
  upToDate: boolean;
  added: SteleEntry[];
  changed: SteleEntry[];
  removed: string[];
  /** ≈tokens to pull ONLY the delta (vs the full surface). */
  deltaTokenEstimate: number;
  fullTokenEstimate: number;
  note: string;
}

/** PILLAR 3 — when to reach for which tool (signals, not commands; BOOT). */
export interface MembraneActivation {
  /** the ≤2KB compact form for an MCP `instructions` field. */
  instructions: string;
  decisionTable: DecisionRow[];
  capabilities: typeof CAPABILITY_LINES;
}

/** PILLAR 2 — the measured, signed value created (AXIA; facts, never $ fiction). */
export interface MembraneValue {
  /** per-kind counts: tokens-saved + destructive-gated / secret-redacted / … */
  byKind: Record<AxiaKind, number>;
  /** the gate/redact/correct/neutralize/flag events that HAPPENED (not tokens). */
  totalEvents: number;
  tokensSaved: number;
  /** tokens-saved × the user-supplied price-per-1k. null if no price — NEVER invented. */
  usdSaved: number | null;
  /** the AXIA hash chain verifies offline. */
  chainValid: boolean;
  /** the hash-chained ledger records (verify offline with verifyAxiaChain). */
  records: AxiaRecord[];
  note: string;
}

export interface MembranePacket {
  v: 1;
  version: string;
  healthy: boolean;
  capability: MembraneCapability; // PILLAR 1 — STELE
  activation: MembraneActivation; // PILLAR 3 — BOOT
  value: MembraneValue;           // PILLAR 2 — AXIA
  cortexFacts: { key: string; value: string }[];
  note: string;
}

export interface MembraneInput {
  version: string;
  healthy?: boolean;
  /** the merkle root the agent currently holds (for delta-sync). */
  heldRoot?: string;
  /** the agent's held name→hash map (for precise added/changed/removed). */
  heldLeaves?: Record<string, string>;
  /** optional task hint to lightly rank the activation table (never drops rows). */
  task?: string;
  /** signed shared-memory facts the caller (CLI/MCP) recalled. */
  cortexFacts?: { key: string; value: string }[];
  /** the live AXIA value events the caller gathered from the organs. */
  axiaEvents?: Array<Partial<AxiaEvent>>;
  /** the user's own vendor price per 1k tokens (only then is USD reported). */
  pricePer1k?: number;
  /** override the command catalog (tests). */
  catalog?: ManifestCommand[];
}

const MEMBRANE_NOTE =
  "ONE signed onboarding membrane fusing the three pillars: CAPABILITY (STELE — provably current via merkle delta), " +
  "ACTIVATION (BOOT — when to reach for each tool; signals, not commands), and VALUE (AXIA — measured, hash-chained, offline-verifiable). " +
  "Token figures are ≈chars/4 estimates; counts are facts of events Mneme GATED/SAVED/REDACTED/CORRECTED/FLAGGED — never 'attacks prevented', never an invented $ damage.";

/** Map the live command catalog to capability leaves (command = identity). */
export function catalogToEntries(catalog: ManifestCommand[]): SteleEntry[] {
  return (Array.isArray(catalog) ? catalog : [])
    .filter((c) => c && typeof c.command === "string" && c.command)
    .map((c) => ({ name: c.command, version: c.since, summary: c.what }));
}

/**
 * Fuse the three pillars into one packet. Pure + total (never throws; caller
 * injects cortex facts + AXIA events so the core stays fs-free + deterministic).
 */
export function buildMembrane(input: MembraneInput): MembranePacket {
  try {
    const version = typeof input?.version === "string" && input.version ? input.version : "?";
    const healthy = input?.healthy !== false;
    const entries = catalogToEntries(input?.catalog ?? MNEME_COMMAND_CATALOG);

    // PILLAR 1 — STELE: capability surface + delta vs what the agent holds.
    const stele = buildStele(entries);
    const delta = steleDelta(entries, typeof input?.heldRoot === "string" ? input.heldRoot : "", input?.heldLeaves);
    const capability: MembraneCapability = {
      root: stele.root,
      count: stele.count,
      upToDate: delta.upToDate,
      added: delta.added,
      changed: delta.changed,
      removed: delta.removed,
      deltaTokenEstimate: delta.deltaTokenEstimate,
      fullTokenEstimate: delta.fullTokenEstimate,
      note: delta.note,
    };

    // PILLAR 3 — BOOT: activation table (reuse the boot packet's table + instructions).
    const boot = buildBootPacket({ version, healthy, cortexFacts: input?.cortexFacts, task: input?.task });
    const activation: MembraneActivation = {
      instructions: boot.instructions,
      decisionTable: boot.decisionTable,
      capabilities: boot.capabilities,
    };

    // PILLAR 2 — AXIA: the hash-chained, offline-verifiable value ledger.
    const records = buildAxiaLedger(input?.axiaEvents ?? []);
    const sum = axiaSummary(records, { pricePer1k: input?.pricePer1k });
    const value: MembraneValue = {
      byKind: sum.byKind,
      totalEvents: sum.totalEvents,
      tokensSaved: sum.tokensSaved,
      usdSaved: sum.usdSaved,
      chainValid: sum.chainValid,
      records,
      note: sum.note,
    };

    return { v: 1, version, healthy, capability, activation, value, cortexFacts: boot.cortexFacts, note: MEMBRANE_NOTE };
  } catch {
    // total: a broken membrane must never break the session.
    const version = typeof input?.version === "string" ? input.version : "?";
    return {
      v: 1,
      version,
      healthy: false,
      capability: { root: "", count: 0, upToDate: false, added: [], changed: [], removed: [], deltaTokenEstimate: 0, fullTokenEstimate: 0, note: "membrane degraded — capability surface unavailable." },
      activation: { instructions: "", decisionTable: [], capabilities: CAPABILITY_LINES },
      value: { byKind: { "tokens-saved": 0, "destructive-gated": 0, "secret-redacted": 0, "injection-neutralized": 0, "claim-corrected": 0, "omission-flagged": 0 }, totalEvents: 0, tokensSaved: 0, usdSaved: null, chainValid: true, records: [], note: "membrane degraded — value ledger unavailable." },
      cortexFacts: [],
      note: "membrane degraded.",
    };
  }
}

// ─────────────────────────── seal / verify (the edge) ───────────────────────────

export interface SignedMembrane {
  packet: MembranePacket;
  receipt: NotaryReceipt;
}

/** Seal the membrane with an Ed25519 NOTARY receipt (offline-verifiable). */
export function sealMembrane(repoRoot: string, packet: MembranePacket, issuedAt?: number): SignedMembrane {
  const receipt = issueReceipt(repoRoot, {
    kind: "claim-verdict",
    subject: `membrane:v${packet.version}@${packet.capability.root.slice(0, 12)}`,
    payload: packet,
    includePayload: true,
    issuedAt,
  });
  return { packet, receipt };
}

/** Verify a sealed membrane offline: receipt valid AND the outer packet hashes to
 *  the receipt's payloadHash (so a tampered packet is caught). */
export function verifyMembrane(signed: SignedMembrane): { valid: boolean; reason: string } {
  const r = verifyReceipt(signed.receipt);
  if (!r.valid) return { valid: false, reason: r.reason };
  const rec = signed.receipt as { payloadHash?: string };
  const h = createHash("sha256").update(canonicalJson(signed.packet)).digest("hex");
  if (!rec.payloadHash || rec.payloadHash !== h) {
    return { valid: false, reason: "packet does not match the signed payloadHash (tampered)" };
  }
  return { valid: true, reason: r.reason };
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface MembraneGauntlet {
  score: number; // 0 or 100
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

/** Prove the fusion is sound: all three pillars present + faithful, delta-sync
 *  correct, value ledger honest + chain-valid, deterministic, total. Pure. */
export function membraneGauntlet(): MembraneGauntlet {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const cat: ManifestCommand[] = [
    { command: "mneme a", since: "1.0", group: "core", what: "alpha", when: "x" },
    { command: "mneme b", since: "1.0", group: "core", what: "beta", when: "y" },
    { command: "mneme c", since: "2.0", group: "core", what: "gamma", when: "z" },
  ];
  const events: Array<Partial<AxiaEvent>> = [
    { kind: "tokens-saved", count: 1200, source: "treasury", at: 1 },
    { kind: "destructive-gated", count: 3, source: "heph", at: 2 },
    { kind: "secret-redacted", count: 2, source: "egress", at: 3 },
  ];

  // 1) fuses all three pillars
  const m = buildMembrane({ version: "9.9.9", catalog: cat, axiaEvents: events });
  checks.push({
    name: "fuses all 3 pillars",
    pass: m.capability.root.length === 64 && m.capability.count === 3 && m.activation.decisionTable.length > 0 && m.value.records.length === 3,
    detail: `root=${m.capability.root.slice(0, 8)} count=${m.capability.count} rows=${m.activation.decisionTable.length} ledger=${m.value.records.length}`,
  });

  // 2) PILLAR-1: a cold agent (no held root) must be told the FULL surface is new
  checks.push({
    name: "cold agent: full surface is the delta",
    pass: m.capability.upToDate === false && m.capability.added.length === 3 && m.capability.removed.length === 0,
    detail: `upToDate=${m.capability.upToDate} added=${m.capability.added.length}`,
  });

  // 3) PILLAR-1: an up-to-date agent (held root == live root) pulls 0
  const fresh = buildMembrane({ version: "9.9.9", catalog: cat, heldRoot: m.capability.root });
  checks.push({
    name: "current agent: 0 tokens to sync",
    pass: fresh.capability.upToDate === true && fresh.capability.added.length === 0 && fresh.capability.deltaTokenEstimate === 0,
    detail: `upToDate=${fresh.capability.upToDate} deltaTok=${fresh.capability.deltaTokenEstimate}`,
  });

  // 4) PILLAR-2: AXIA value is faithful (token count + event counts + chain valid)
  checks.push({
    name: "value ledger measured + chain-valid",
    pass: m.value.tokensSaved === 1200 && m.value.byKind["destructive-gated"] === 3 && m.value.totalEvents === 5 && m.value.chainValid === true,
    detail: `saved=${m.value.tokensSaved} gated=${m.value.byKind["destructive-gated"]} events=${m.value.totalEvents} chain=${m.value.chainValid}`,
  });

  // 5) no fabricated value — no events ⇒ all zero, USD null
  const empty = buildMembrane({ version: "9.9.9", catalog: cat });
  checks.push({
    name: "no fabricated value",
    pass: empty.value.tokensSaved === 0 && empty.value.totalEvents === 0 && empty.value.usdSaved === null,
    detail: `saved=${empty.value.tokensSaved} events=${empty.value.totalEvents} usd=${String(empty.value.usdSaved)}`,
  });

  // 6) USD only when the caller supplies a price (1200/1000 × 3 = 3.6)
  const priced = buildMembrane({ version: "9.9.9", catalog: cat, axiaEvents: events, pricePer1k: 3 });
  checks.push({
    name: "USD only with user-supplied price",
    pass: priced.value.usdSaved === 3.6,
    detail: `usd=${String(priced.value.usdSaved)}`,
  });

  // 7) deterministic — same input ⇒ identical packet
  const a = buildMembrane({ version: "9.9.9", catalog: cat, axiaEvents: events });
  const b = buildMembrane({ version: "9.9.9", catalog: cat, axiaEvents: events });
  checks.push({ name: "deterministic", pass: canonicalJson(a) === canonicalJson(b), detail: "byte-identical on identical input" });

  // 8) total — garbage in never throws
  let totalOk = true;
  try {
    buildMembrane({ version: undefined as unknown as string, catalog: null as unknown as ManifestCommand[], axiaEvents: null as unknown as Partial<AxiaEvent>[] });
  } catch { totalOk = false; }
  checks.push({ name: "total (never throws)", pass: totalOk, detail: "garbage input degraded gracefully" });

  // 9) honest framing present (signals-not-commands + no-$-fiction disclosure)
  checks.push({
    name: "honest framing",
    pass: /signals, not commands/i.test(m.note) && /never an invented \$ damage/i.test(m.note),
    detail: "note discloses estimate + signals-not-commands + no $-fiction",
  });

  const pass = checks.every((c) => c.pass);
  return { score: pass ? 100 : 0, checks };
}
