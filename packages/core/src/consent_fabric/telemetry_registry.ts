/**
 * v2.21.6 — CONSENT FABRIC · TELEMETRY REGISTRY.
 *
 * Declarative manifest of every Mneme feature that records data,
 * plus a persistent opt-in / opt-out store.
 *
 *   - Defaults to OPT-IN (everything starts disabled) per Article 2.
 *   - Granting + revoking persists at `.mneme/consent/telemetry.json`.
 *   - `isFeatureEnabled(feature)` is the single gate every recorder
 *     calls before writing. Old recorders that don't check yet
 *     count as legacy until refactored.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DIR = ".mneme/consent";
const STORE_FILE = "telemetry.json";

export interface TelemetryFeature {
  /** Stable feature key. */
  key: string;
  /** What this feature records, plain English. */
  records: string;
  /** Where the data is stored. */
  storedAt: string;
  /** Whether the feature reaches external services. */
  external: boolean;
  /** Default state per the consent contract. v2.21.6: ALL false (opt-IN). */
  defaultEnabled: false;
}

/** The authoritative registry. Every new feature MUST be added here
 *  in the same commit that ships it, or the consent_fabric test will
 *  fail. */
export const TELEMETRY_FEATURES: TelemetryFeature[] = [
  { key: "lineage",         records: "git-history-derived knowledge lineage for ask + atrophy.",        storedAt: ".mneme/lineage/",     external: false, defaultEnabled: false },
  { key: "aletheia",        records: "interaction-level honesty traces used to grade vendor accuracy.", storedAt: ".mneme/aletheia/",    external: false, defaultEnabled: false },
  { key: "replay",          records: "tool-call + response capture for retrospective audit.",            storedAt: ".mneme/replay.jsonl", external: false, defaultEnabled: false },
  { key: "pheromone",       records: "verb-usage hits feeding Atlas Help HOT layer.",                     storedAt: ".mneme/atlas/pheromones.jsonl", external: false, defaultEnabled: false },
  { key: "soul_compliance", records: "compliance score grading the AI agent's adherence to soul rules.", storedAt: ".mneme/soul/",        external: false, defaultEnabled: false },
  { key: "boomerang",       records: "cross-vendor activity ledger (which vendor edited which file).",   storedAt: ".mneme/boomerang.jsonl", external: false, defaultEnabled: false },
  { key: "earthquake_probes", records: "vendor-response fingerprints for silent-model-drift detection.", storedAt: ".mneme/earthquake/probes.jsonl", external: false, defaultEnabled: false },
  { key: "trust_capsule_chain", records: "signed install-attestation receipts.",                          storedAt: ".mneme/trust/",       external: false, defaultEnabled: false },
];

interface PersistedState {
  v: 1;
  enabled: Record<string, boolean>;
  history: Array<{ ts: string; action: "grant" | "revoke" | "default"; feature: string; reason?: string }>;
}

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function storePath(repoRoot: string): string { return join(dir(repoRoot), STORE_FILE); }

function loadStore(repoRoot: string): PersistedState {
  const p = storePath(repoRoot);
  if (!existsSync(p)) return { v: 1, enabled: {}, history: [] };
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch { return { v: 1, enabled: {}, history: [] }; }
}

function saveStore(repoRoot: string, state: PersistedState): void {
  writeFileSync(storePath(repoRoot), JSON.stringify(state, null, 2), "utf8");
}

/** The single gate every telemetry recorder must call before writing.
 *  Returns false for any feature the user has not explicitly granted. */
export function isFeatureEnabled(repoRoot: string, featureKey: string): boolean {
  const reg = TELEMETRY_FEATURES.find((f) => f.key === featureKey);
  if (!reg) return false; // unknown feature → never enabled
  const state = loadStore(repoRoot);
  if (featureKey in state.enabled) return state.enabled[featureKey] === true;
  return reg.defaultEnabled; // i.e. false
}

export function grantTelemetry(repoRoot: string, featureKey: string, reason?: string): { ok: boolean; reason?: string } {
  const reg = TELEMETRY_FEATURES.find((f) => f.key === featureKey);
  if (!reg) return { ok: false, reason: `unknown feature "${featureKey}"` };
  const state = loadStore(repoRoot);
  state.enabled[featureKey] = true;
  state.history.push({ ts: new Date().toISOString(), action: "grant", feature: featureKey, ...(reason ? { reason } : {}) });
  saveStore(repoRoot, state);
  return { ok: true };
}

export function revokeTelemetry(repoRoot: string, featureKey: string, reason?: string): { ok: boolean; reason?: string } {
  const reg = TELEMETRY_FEATURES.find((f) => f.key === featureKey);
  if (!reg) return { ok: false, reason: `unknown feature "${featureKey}"` };
  const state = loadStore(repoRoot);
  state.enabled[featureKey] = false;
  state.history.push({ ts: new Date().toISOString(), action: "revoke", feature: featureKey, ...(reason ? { reason } : {}) });
  saveStore(repoRoot, state);
  return { ok: true };
}

export interface TelemetryStatusRow {
  key: string;
  records: string;
  external: boolean;
  defaultEnabled: false;
  currentlyEnabled: boolean;
  source: "default" | "granted" | "revoked";
}

export function listTelemetryStatus(repoRoot: string): TelemetryStatusRow[] {
  const state = loadStore(repoRoot);
  return TELEMETRY_FEATURES.map((f) => {
    const cur = state.enabled[f.key];
    const source: TelemetryStatusRow["source"] = cur === undefined ? "default" : cur ? "granted" : "revoked";
    return {
      key: f.key,
      records: f.records,
      external: f.external,
      defaultEnabled: f.defaultEnabled,
      currentlyEnabled: cur ?? f.defaultEnabled,
      source,
    };
  });
}

export function formatTelemetryStatus(rows: TelemetryStatusRow[]): string {
  const lines = [`📋 TELEMETRY REGISTRY — Article 2 (opt-IN by default)`, ""];
  lines.push("  Every feature below is DISABLED until you explicitly grant.");
  lines.push("");
  for (const r of rows) {
    const badge = r.currentlyEnabled ? "🟢 enabled" : "⚪ disabled";
    const ext = r.external ? "  ⚠ EXTERNAL" : "";
    lines.push(`  ${badge}  ${r.key.padEnd(28)} (${r.source})${ext}`);
    lines.push(`    records:  ${r.records}`);
  }
  lines.push("");
  lines.push(`  Grant:  mneme telemetry grant <feature> [--reason "..."]`);
  lines.push(`  Revoke: mneme telemetry revoke <feature> [--reason "..."]`);
  return lines.join("\n");
}
