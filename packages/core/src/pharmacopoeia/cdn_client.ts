/**
 * VACCINE CDN CLIENT (v1.43.0 — Demon Stage 1.1).
 *
 * Every Mneme install polls a public CDN endpoint for the latest
 * pharmacopoeia (signature library) and atomically swaps it in. No npm
 * release required to push a new vaccine — patterns ship in 10 minutes
 * across the federation.
 *
 * Free-first contract:
 *   - Default CDN URL is empty → poller is a no-op until the user (or
 *     enterprise) sets MNEME_PHARMACOPOEIA_CDN. Mneme costs $0 to use.
 *   - Self-hosted users (or paid enterprise tier — hidden until we
 *     decide to monetize) can point at any URL serving the bundle.
 *   - Verification is HMAC-SHA-256 over the canonical bundle JSON. The
 *     verifier secret lives in `.mneme/pharmacopoeia-cdn-secret.bin`
 *     and is OPTIONAL — when missing, bundles are accepted unsigned
 *     with a warning.
 *
 * Atomic swap protocol (no partial-write window):
 *   1. Fetch JSON to a temp file in `.mneme/pharmacopoeia/staging/`.
 *   2. Verify HMAC if secret present.
 *   3. Validate schema (version monotonic + vaccine array shape).
 *   4. Atomic rename → `.mneme/pharmacopoeia/active.json`.
 *   5. Append one line to `.mneme/pharmacopoeia/history.jsonl`.
 *
 * Race-safety: a lock file `.mneme/pharmacopoeia/refresh.lock` (PID +
 * mtime) prevents two concurrent pulls from corrupting state. Stale
 * locks (>5 min) get cleared automatically.
 *
 * Wild-idea bonus (paranoid by default):
 *   - Bundles older than the active version are REJECTED — even if
 *     freshly signed. Prevents downgrade attacks where an attacker
 *     signs a known-vulnerable old bundle and serves it to the CDN.
 *
 * Wired into:
 *   - pharmacopoeia/pulse_integration.ts → renders the
 *     "✨ Pharmacopoeia v3471 active (47 min old)" pulse line.
 *   - cli/commands/pharmacopoeia.ts → mneme pharmacopoeia status / refresh.
 *   - nucleus_daemon.ts caretaker pass (every CARETAKER_PASS_EVERY ticks)
 *     calls refresh() if MNEME_PHARMACOPOEIA_CDN is set.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const BASE_DIR = ".mneme/pharmacopoeia";
const ACTIVE_FILE = "active.json";
const STAGING_DIR = "staging";
const HISTORY_FILE = "history.jsonl";
const LOCK_FILE = "refresh.lock";
const SECRET_FILE = ".mneme/pharmacopoeia-cdn-secret.bin";
const STALE_LOCK_MS = 5 * 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;       // 10 MB sanity cap

export interface VaccineEntry {
  /** Strain identifier — must match pharmacopoeia/strain registry. */
  strain: string;
  /** Detection pattern — regex source string OR semantic-rule id. */
  pattern: string;
  /** Pattern severity 1-4 (matches Mneme strain severity scale). */
  severity: 1 | 2 | 3 | 4;
  /** Free-text human description. */
  description?: string;
}

export interface PharmacopoeiaBundle {
  /** Monotonically increasing version number. Downgrades REJECTED. */
  version: number;
  /** ISO-8601 publish timestamp. */
  publishedAt: string;
  /** Stable bundle id (sha256 of canonical content excluding signature). */
  bundleId: string;
  /** Free-text release note. */
  notes?: string;
  /** Vaccine entries. */
  vaccines: VaccineEntry[];
  /** HMAC-SHA-256 over canonical(bundle without this field). 64 hex chars.
   *  Optional — bundles without signature are accepted with `verified=false`
   *  when no secret is configured locally. */
  signature?: string;
}

export interface PharmacopoeiaState {
  active: PharmacopoeiaBundle | null;
  /** ms since active bundle was fetched. null when no active bundle. */
  ageMs: number | null;
  /** True when active bundle had a valid signature when fetched. */
  verified: boolean;
  /** When the last refresh attempt happened (success OR failure). */
  lastRefreshAt: string | null;
  /** Result of last refresh: "ok" | "no-cdn" | "no-update" | "verify-failed" | "stale-version" | "fetch-failed" | "schema-invalid". */
  lastRefreshOutcome: string;
}

export interface PharmacopoeiaCDNOptions {
  cdnUrl?: string | null;
  repoRoot?: string;
  fetchTimeoutMs?: number;
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function baseDir(repoRoot: string): string { return join(repoRoot, BASE_DIR); }
function activePath(repoRoot: string): string { return join(baseDir(repoRoot), ACTIVE_FILE); }
function stagingDir(repoRoot: string): string { return join(baseDir(repoRoot), STAGING_DIR); }
function historyPath(repoRoot: string): string { return join(baseDir(repoRoot), HISTORY_FILE); }
function lockPath(repoRoot: string): string { return join(baseDir(repoRoot), LOCK_FILE); }
function secretPath(repoRoot: string): string { return join(repoRoot, SECRET_FILE); }

export class PharmacopoeiaCDN {
  private cdnUrl: string | null;
  private repoRoot: string;
  private fetchTimeoutMs: number;

  constructor(opts: PharmacopoeiaCDNOptions = {}) {
    this.cdnUrl = opts.cdnUrl ?? process.env["MNEME_PHARMACOPOEIA_CDN"] ?? null;
    this.repoRoot = opts.repoRoot ?? process.cwd();
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  /** Read the currently-active bundle. Returns null when none on disk. */
  readActive(): PharmacopoeiaBundle | null {
    const p = activePath(this.repoRoot);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as PharmacopoeiaBundle;
    } catch {
      return null;
    }
  }

  /** Compose state — used by `pharmacopoeia status` + pulse integration. */
  status(): PharmacopoeiaState {
    const active = this.readActive();
    let ageMs: number | null = null;
    let lastRefreshAt: string | null = null;
    let lastRefreshOutcome = "no-refresh-yet";
    let verified = false;
    if (active) {
      try {
        ageMs = Date.now() - statSync(activePath(this.repoRoot)).mtimeMs;
      } catch { ageMs = null; }
    }
    // Last refresh metadata lives in the history file's last line.
    const last = this.readLastHistoryEntry();
    if (last) {
      lastRefreshAt = last.ts ?? null;
      lastRefreshOutcome = last.outcome ?? "unknown";
      verified = !!last.verified;
    }
    return { active, ageMs, verified, lastRefreshAt, lastRefreshOutcome };
  }

  private readLastHistoryEntry(): { ts?: string; outcome?: string; verified?: boolean } | null {
    const p = historyPath(this.repoRoot);
    if (!existsSync(p)) return null;
    try {
      const txt = readFileSync(p, "utf8").trimEnd();
      if (!txt) return null;
      const lastLine = txt.split("\n").pop() ?? "";
      return JSON.parse(lastLine) as { ts?: string; outcome?: string; verified?: boolean };
    } catch { return null; }
  }

  private writeHistory(entry: Record<string, unknown>): void {
    ensureDir(baseDir(this.repoRoot));
    try {
      appendFileSync(historyPath(this.repoRoot), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
    } catch {
      // history file write must never block the refresh pipeline
    }
  }

  /** Acquire the per-repo refresh lock. Returns false if another refresh
   *  is in flight (and the existing lock is fresh). Stale locks are
   *  cleared automatically. */
  private acquireLock(): boolean {
    const lp = lockPath(this.repoRoot);
    if (existsSync(lp)) {
      try {
        const st = statSync(lp);
        if (Date.now() - st.mtimeMs < STALE_LOCK_MS) return false;     // fresh lock — back off
        unlinkSync(lp);                                                  // stale → take over
      } catch {
        // lock file vanished mid-check — proceed
      }
    }
    ensureDir(baseDir(this.repoRoot));
    try {
      writeFileSync(lp, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      return true;
    } catch {
      return false;
    }
  }

  private releaseLock(): void {
    try { unlinkSync(lockPath(this.repoRoot)); } catch { /* ignore */ }
  }

  private readSecret(): Buffer | null {
    const p = secretPath(this.repoRoot);
    if (!existsSync(p)) return null;
    try { return readFileSync(p); } catch { return null; }
  }

  /** Compute canonical signature input — bundle without `signature` field. */
  private canonical(bundle: PharmacopoeiaBundle): string {
    const { signature: _ignored, ...rest } = bundle;
    return JSON.stringify(rest, Object.keys(rest).sort());
  }

  private verifyBundle(bundle: PharmacopoeiaBundle): boolean {
    const secret = this.readSecret();
    if (!secret || !bundle.signature) return false;
    const computed = createHmac("sha256", secret).update(this.canonical(bundle)).digest("hex");
    return computed === bundle.signature;
  }

  private validateSchema(input: unknown): { ok: boolean; reason?: string; bundle?: PharmacopoeiaBundle } {
    if (!input || typeof input !== "object") return { ok: false, reason: "not-an-object" };
    const b = input as Partial<PharmacopoeiaBundle>;
    if (typeof b.version !== "number" || !Number.isFinite(b.version) || b.version < 0) return { ok: false, reason: "invalid-version" };
    if (typeof b.publishedAt !== "string" || !b.publishedAt) return { ok: false, reason: "missing-publishedAt" };
    if (typeof b.bundleId !== "string" || !b.bundleId) return { ok: false, reason: "missing-bundleId" };
    if (!Array.isArray(b.vaccines)) return { ok: false, reason: "vaccines-not-array" };
    for (const v of b.vaccines) {
      if (!v || typeof v !== "object") return { ok: false, reason: "vaccine-entry-not-object" };
      const ve = v as Partial<VaccineEntry>;
      if (typeof ve.strain !== "string" || !ve.strain) return { ok: false, reason: "vaccine-missing-strain" };
      if (typeof ve.pattern !== "string" || !ve.pattern) return { ok: false, reason: "vaccine-missing-pattern" };
      if (typeof ve.severity !== "number" || ve.severity < 1 || ve.severity > 4) return { ok: false, reason: "vaccine-bad-severity" };
    }
    return { ok: true, bundle: b as PharmacopoeiaBundle };
  }

  /** Atomically pull the latest bundle from the configured CDN.
   *  Returns the outcome + which version is now active.
   *
   *  Failure modes are explicit + classified — caller can react
   *  differently to "no-cdn" (informational) vs "verify-failed"
   *  (security alert).
   */
  async refresh(): Promise<{ outcome: PharmacopoeiaState["lastRefreshOutcome"]; version: number | null; verified: boolean; bytes?: number }> {
    if (!this.cdnUrl) {
      const outcome = "no-cdn";
      this.writeHistory({ outcome, verified: false });
      return { outcome, version: this.readActive()?.version ?? null, verified: false };
    }
    if (!this.acquireLock()) {
      const outcome = "locked";
      // Don't write history for transient lock contention.
      return { outcome, version: this.readActive()?.version ?? null, verified: false };
    }
    try {
      let raw: string;
      let bytes = 0;
      try {
        const res = await fetch(this.cdnUrl, { signal: AbortSignal.timeout(this.fetchTimeoutMs) });
        if (!res.ok) {
          const outcome = "fetch-failed";
          this.writeHistory({ outcome, verified: false, httpStatus: res.status });
          return { outcome, version: this.readActive()?.version ?? null, verified: false };
        }
        raw = await res.text();
        bytes = raw.length;
        if (bytes > MAX_BUNDLE_BYTES) {
          const outcome = "fetch-failed";
          this.writeHistory({ outcome, verified: false, reason: "oversize", bytes });
          return { outcome, version: this.readActive()?.version ?? null, verified: false, bytes };
        }
      } catch (e) {
        const outcome = "fetch-failed";
        this.writeHistory({ outcome, verified: false, error: (e as Error)?.message });
        return { outcome, version: this.readActive()?.version ?? null, verified: false };
      }

      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch (e) {
        const outcome = "schema-invalid";
        this.writeHistory({ outcome, verified: false, reason: "json-parse", error: (e as Error)?.message });
        return { outcome, version: this.readActive()?.version ?? null, verified: false, bytes };
      }

      const validation = this.validateSchema(parsed);
      if (!validation.ok || !validation.bundle) {
        const outcome = "schema-invalid";
        this.writeHistory({ outcome, verified: false, reason: validation.reason });
        return { outcome, version: this.readActive()?.version ?? null, verified: false, bytes };
      }
      const bundle = validation.bundle;

      // DOWNGRADE PROTECTION — never accept an older bundle even if signed.
      const current = this.readActive();
      if (current && bundle.version < current.version) {
        const outcome = "stale-version";
        this.writeHistory({ outcome, verified: false, attemptedVersion: bundle.version, currentVersion: current.version });
        return { outcome, version: current.version, verified: false, bytes };
      }
      if (current && bundle.version === current.version) {
        const outcome = "no-update";
        this.writeHistory({ outcome, verified: false, version: bundle.version });
        return { outcome, version: bundle.version, verified: false, bytes };
      }

      // Verify (best-effort — accept unsigned when no local secret).
      const verified = this.verifyBundle(bundle);
      const secret = this.readSecret();
      if (secret && bundle.signature && !verified) {
        // Secret IS configured + bundle IS signed but verify FAILED — security alert.
        const outcome = "verify-failed";
        this.writeHistory({ outcome, verified: false, attemptedVersion: bundle.version });
        return { outcome, version: current?.version ?? null, verified: false, bytes };
      }

      // Atomic swap — write to staging then rename.
      ensureDir(stagingDir(this.repoRoot));
      const stagingFile = join(stagingDir(this.repoRoot), `bundle-${bundle.version}-${Date.now()}.json`);
      writeFileSync(stagingFile, JSON.stringify(bundle, null, 2));
      renameSync(stagingFile, activePath(this.repoRoot));

      const outcome = "ok";
      this.writeHistory({ outcome, verified, version: bundle.version, bundleId: bundle.bundleId, vaccineCount: bundle.vaccines.length });
      return { outcome, version: bundle.version, verified, bytes };
    } finally {
      this.releaseLock();
    }
  }
}
