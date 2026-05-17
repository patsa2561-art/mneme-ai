/**
 * v2.19.31 — MNEME CROSS-DEVICE SYNAPSE SYNC (Phase D of SYNAPSE GENESIS)
 *
 *   "บั๊กใหญ่มาก — ไม่สามารถ sync brain ข้าม device ได้. ต้องทำให้ใช้
 *    ได้ ผมถึงบอกว่าคุณต้องเทสเยอะๆ ว่ามัน sync brain ได้จริงๆ ข้าม mobile
 *    + computer + notebook"
 *                                          — user mandate, 2026-05-17
 *
 *   Diagnosis: v2.19.29 SYNAPSE GENESIS learned weights locally. v2.19.30
 *   SOUL EMBALMING preserved them across BAN. Neither handles the third
 *   axis: the user works on mobile, laptop, and desktop. Each grows its
 *   own synapse store. Without a merge protocol, every device re-learns
 *   the same lessons from scratch and the brain never unifies.
 *
 *   The protocol must be:
 *     - CRDT (commutative, associative, idempotent) so merge order
 *       doesn't matter (mobile→laptop ≡ laptop→mobile)
 *     - "Last-strongest-wins" per synapse key — the device that has
 *       observed a synapse most strongly / most recently provides the
 *       canonical weight, BUT permanent=true is sticky (once any device
 *       has crystallised a synapse, the merged result is permanent too)
 *     - Cumulative observationCount — total reinforcement across all
 *       devices, never lose evidence
 *     - HMAC-signed export envelopes — receivers verify before merging
 *     - Vendor-neutral — transport is caller-supplied (git branch via
 *       DIASPORA, HTTP bridge, USB stick, QR-code chain via BEACON,
 *       whatever the user prefers)
 *
 *   Composes onto:
 *     - v2.19.29 Phase A HEBBIAN (SynapseWeight / SynapseStore types)
 *     - v2.19.30 SOUL EMBALMING (HMAC chain pattern)
 *     - v1.72   DIASPORA (transport — caller wires git/HTTP/QR)
 *
 * Honest scope:
 *   - PURE FUNCTION merge. Never throws.
 *   - HMAC-signed envelopes — forged exports auto-dropped.
 *   - Deterministic: same inputs → same merged store + same provenance map.
 *   - Defensive: empty exports, single-device, NaN weights, key collisions
 *     handled silently. 24/7 safe.
 *   - "permanent OR" semantics — never demotes a permanent synapse.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SynapseStore, SynapseWeight } from "../synapse_genesis/index.js";

const PROTOCOL_VERSION = 1 as const;

export interface DeviceSynapseExport {
  v: typeof PROTOCOL_VERSION;
  /** Stable, user-supplied device id (e.g. "macbook-pro-2026" or hash thereof). */
  deviceId: string;
  /** ms since epoch when the export was packaged. */
  exportedAtMs: number;
  store: SynapseStore;
  /** HMAC over the canonical export body (everything above except sig). */
  sig: string;
}

export interface MergeProvenance {
  /** Composite synapse key. */
  key: string;
  /** deviceId whose weight + lastObservedAtMs won. */
  winnerDeviceId: string;
  /** All contributing devices (deviceId → contributing weight). */
  contributors: Array<{ deviceId: string; weight: number; observationCount: number; lastObservedAtMs: number; permanent: boolean }>;
  /** Final merged values. */
  mergedWeight: number;
  mergedObservationCount: number;
  mergedPermanent: boolean;
  mergedLastObservedAtMs: number;
}

export interface MergedSynapseResult {
  v: typeof PROTOCOL_VERSION;
  store: SynapseStore;
  /** Per-key trace of which device contributed what — auditable. */
  provenance: MergeProvenance[];
  /** Devices that participated in the merge (after dedup). */
  participatingDevices: string[];
  /** Devices that were dropped because of bad signature / shape. */
  rejectedDevices: string[];
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_SYNAPSE_SYNC_SECRET"] || `mneme-synapse-sync-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Package a local store for cross-device transport.
 * The envelope is HMAC-signed so receivers can detect tampering.
 */
export function exportForSync(input: {
  deviceId: string;
  store: SynapseStore;
  nowMs?: number;
  secret?: string;
}): DeviceSynapseExport {
  const sec = input.secret ?? defaultSecret();
  const exportedAtMs = input.nowMs ?? Date.now();
  const body = {
    v: PROTOCOL_VERSION,
    deviceId: input.deviceId,
    exportedAtMs,
    store: input.store,
  };
  const sig = hmacHex(body, sec);
  return { ...body, sig };
}

/** Verify an export envelope's HMAC. Returns false on forged / tampered envelopes. */
export function verifySyncExport(envelope: DeviceSynapseExport, secret?: string): boolean {
  if (!envelope || typeof envelope !== "object") return false;
  if (envelope.v !== PROTOCOL_VERSION) return false;
  if (typeof envelope.deviceId !== "string" || envelope.deviceId.length === 0) return false;
  if (typeof envelope.exportedAtMs !== "number" || !Number.isFinite(envelope.exportedAtMs)) return false;
  if (!envelope.store || typeof envelope.store !== "object") return false;
  const sec = secret ?? defaultSecret();
  const { sig, ...body } = envelope;
  return safeEqHex(hmacHex(body, sec), sig);
}

/**
 * CRDT merge rule applied per synapse-key across devices:
 *
 *   weight:               max( device.weight )          — "strongest wins"
 *   lastObservedAtMs:     max( device.lastObservedAtMs ) — "most recent wins"
 *   observationCount:     sum( device.observationCount ) — cumulative evidence
 *   permanent:            OR( device.permanent )         — sticky / monotone
 *   permanentSinceWeight: min(>0) of device.permanentSinceWeight  — first to crystallise
 *
 * Winner deviceId is the one whose (weight, lastObservedAtMs) pair lexicographically
 * sorts highest — deterministic tie-break by deviceId ascending.
 *
 * Commutativity proof (sketch): max / sum / OR / min-over-positives are all
 * commutative and associative; tie-break by deviceId is a total order, so
 * mergeOrder doesn't matter.
 */
function mergeWeightsAcrossDevices(input: Array<{ deviceId: string; weight: SynapseWeight }>): MergeProvenance {
  const first = input[0]!;
  const key = first.weight.key;

  let mergedWeight = -Infinity;
  let mergedLastMs = -Infinity;
  let mergedObs = 0;
  let mergedPermanent = false;
  let mergedPermanentSinceWeight = 0;
  // Winner tracking (deterministic tie-break)
  let winnerDeviceId = first.deviceId;
  let winnerWeight = -Infinity;
  let winnerLastMs = -Infinity;

  for (const { deviceId, weight: w } of input) {
    if (Number.isFinite(w.weight) && w.weight > mergedWeight) mergedWeight = w.weight;
    if (Number.isFinite(w.lastObservedAtMs) && w.lastObservedAtMs > mergedLastMs) mergedLastMs = w.lastObservedAtMs;
    mergedObs += Math.max(0, w.observationCount | 0);
    if (w.permanent) mergedPermanent = true;
    if (w.permanentSinceWeight > 0) {
      mergedPermanentSinceWeight = mergedPermanentSinceWeight === 0
        ? w.permanentSinceWeight
        : Math.min(mergedPermanentSinceWeight, w.permanentSinceWeight);
    }

    // Winner: highest weight, tie-break by latest ts, then by deviceId asc.
    const wWeight = Number.isFinite(w.weight) ? w.weight : -Infinity;
    const wLast = Number.isFinite(w.lastObservedAtMs) ? w.lastObservedAtMs : -Infinity;
    if (
      wWeight > winnerWeight ||
      (wWeight === winnerWeight && wLast > winnerLastMs) ||
      (wWeight === winnerWeight && wLast === winnerLastMs && deviceId < winnerDeviceId)
    ) {
      winnerDeviceId = deviceId;
      winnerWeight = wWeight;
      winnerLastMs = wLast;
    }
  }

  // Clamp -Infinity guards (single-device empty case)
  if (mergedWeight === -Infinity) mergedWeight = 0;
  if (mergedLastMs === -Infinity) mergedLastMs = 0;

  return {
    key,
    winnerDeviceId,
    // Sort contributors by deviceId for deterministic output (commutativity).
    contributors: input.map((x) => ({
      deviceId: x.deviceId,
      weight: x.weight.weight,
      observationCount: x.weight.observationCount,
      lastObservedAtMs: x.weight.lastObservedAtMs,
      permanent: x.weight.permanent,
    })).sort((a, b) => a.deviceId.localeCompare(b.deviceId)),
    mergedWeight,
    mergedObservationCount: mergedObs,
    mergedPermanent,
    mergedLastObservedAtMs: mergedLastMs,
  };
}

/**
 * Merge N device exports into one canonical synapse store.
 *
 * Verifies each envelope's HMAC first; bad envelopes go into `rejectedDevices`
 * and contribute nothing. Duplicate deviceIds: last-export-wins (most recent
 * exportedAtMs).
 *
 * The merged store gets a freshly-recomputed signature with the local secret
 * (so it can re-export). Caller (daemon) typically writes the merged store
 * back to disk as the new local synapse_genesis state.
 */
export function mergeSynapseStores(input: {
  exports: DeviceSynapseExport[];
  secret?: string;
  /** Optional explicit synapse_genesis secret for the OUTPUT store sig. */
  storeSecret?: string;
}): MergedSynapseResult {
  const sec = input.secret ?? defaultSecret();
  const storeSec = input.storeSecret
    ?? process.env["MNEME_SYNAPSE_GENESIS_SECRET"]
    ?? "mneme-synapse-genesis-v1";

  const verifiedByDevice = new Map<string, DeviceSynapseExport>();
  const rejected: string[] = [];

  for (const env of input.exports ?? []) {
    if (!verifySyncExport(env, sec)) {
      if (env?.deviceId && typeof env.deviceId === "string") rejected.push(env.deviceId);
      continue;
    }
    const existing = verifiedByDevice.get(env.deviceId);
    if (!existing || env.exportedAtMs > existing.exportedAtMs) {
      verifiedByDevice.set(env.deviceId, env);
    }
  }

  const participatingDevices = Array.from(verifiedByDevice.keys()).sort();

  // Bucket weights by key
  const byKey = new Map<string, Array<{ deviceId: string; weight: SynapseWeight }>>();
  for (const [deviceId, env] of verifiedByDevice) {
    for (const w of env.store?.weights ?? []) {
      if (!w || typeof w.key !== "string") continue;
      const list = byKey.get(w.key) ?? [];
      list.push({ deviceId, weight: w });
      byKey.set(w.key, list);
    }
  }

  const provenance: MergeProvenance[] = [];
  const mergedWeights: SynapseWeight[] = [];
  // Deterministic output order: sort keys lex
  for (const key of Array.from(byKey.keys()).sort()) {
    const bucket = byKey.get(key)!;
    const prov = mergeWeightsAcrossDevices(bucket);
    provenance.push(prov);
    const exemplar = bucket[0]!.weight;
    // permanentSinceWeight: min positive across contributors (first to crystallise)
    let permSince = 0;
    for (const c of bucket) {
      if (c.weight.permanentSinceWeight > 0) {
        permSince = permSince === 0 ? c.weight.permanentSinceWeight : Math.min(permSince, c.weight.permanentSinceWeight);
      }
    }
    mergedWeights.push({
      key,
      eventPattern: exemplar.eventPattern,
      toolName: exemplar.toolName,
      weight: prov.mergedWeight,
      observationCount: prov.mergedObservationCount,
      lastObservedAtMs: prov.mergedLastObservedAtMs,
      permanentSinceWeight: permSince,
      permanent: prov.mergedPermanent,
    });
  }

  // lastDecayedAtMs: max across participating stores
  let lastDecayedAtMs: number | null = null;
  for (const env of verifiedByDevice.values()) {
    const t = env.store?.lastDecayedAtMs;
    if (typeof t === "number" && Number.isFinite(t)) {
      lastDecayedAtMs = lastDecayedAtMs === null ? t : Math.max(lastDecayedAtMs, t);
    }
  }

  const baseStore = {
    v: 1 as const,
    weights: mergedWeights,
    lastDecayedAtMs,
  };
  const storeSig = createHmac("sha256", storeSec).update(canon(baseStore)).digest("hex");
  const store: SynapseStore = { ...baseStore, sig: storeSig };

  return {
    v: PROTOCOL_VERSION,
    store,
    provenance,
    participatingDevices,
    rejectedDevices: Array.from(new Set(rejected)).sort(),
  };
}

/**
 * DIASPORA-shape adapter: serialize an export envelope to a JSON path the
 * caller's transport (git branch `diaspora/synapse-<deviceId>`, HTTP PUT,
 * QR-chain, USB stick) can carry. Returns the canonical bytes + the
 * recommended file path; the caller's chosen transport actually moves it.
 */
export function packForDiaspora(envelope: DeviceSynapseExport): {
  path: string;
  bytes: string;
  branchHint: string;
} {
  // Sanitise: keep only [a-zA-Z0-9_-], then collapse runs of dots/slashes/etc.
  // Two-stage scrub catches path traversal (..), shell metachars, and unicode.
  const safeId = envelope.deviceId
    .replace(/[^a-zA-Z0-9_-]/g, "_")  // any non-alphanumeric → _
    .replace(/_+/g, "_")               // collapse runs
    .replace(/^[_-]+|[_-]+$/g, "")     // trim edges
    .slice(0, 64) || "device";
  return {
    path: `.mneme/diaspora/synapse-${safeId}.json`,
    bytes: JSON.stringify(envelope),
    branchHint: `diaspora/synapse-${safeId}`,
  };
}

/**
 * DIASPORA-shape unpack: read JSON bytes a caller fetched via their
 * transport and return the typed envelope. Returns null on parse failure.
 */
export function unpackFromDiaspora(bytes: string): DeviceSynapseExport | null {
  try {
    const obj = JSON.parse(bytes);
    if (obj && typeof obj === "object" && obj.v === PROTOCOL_VERSION) return obj as DeviceSynapseExport;
    return null;
  } catch { return null; }
}

export interface CrossDeviceSyncStats {
  participatingDevices: number;
  rejectedDevices: number;
  totalSynapses: number;
  permanentSynapses: number;
  multiDeviceSynapses: number;
  unifiedObservations: number;
}

export function computeSyncStats(result: MergedSynapseResult): CrossDeviceSyncStats {
  let permanent = 0;
  let multiDevice = 0;
  let observations = 0;
  for (const p of result.provenance) {
    if (p.mergedPermanent) permanent++;
    if (p.contributors.length > 1) multiDevice++;
    observations += p.mergedObservationCount;
  }
  return {
    participatingDevices: result.participatingDevices.length,
    rejectedDevices: result.rejectedDevices.length,
    totalSynapses: result.store.weights.length,
    permanentSynapses: permanent,
    multiDeviceSynapses: multiDevice,
    unifiedObservations: observations,
  };
}

export function formatSyncStatsLine(s: CrossDeviceSyncStats): string {
  return `🧬 SYNC ${s.participatingDevices}dev · ${s.totalSynapses} synapses · ${s.multiDeviceSynapses} multi-dev · ${s.permanentSynapses} perm · ${s.unifiedObservations} obs · ${s.rejectedDevices} rejected`;
}

export const SYNAPSE_SYNC_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
});
