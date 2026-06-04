/**
 * TRACKER HUB — the autonomous real-time monitor behind X-Ray tracking.
 *
 * One-shot X-Ray becomes a live monitor: register a repo+branch once, and the
 * hub keeps it current via BOTH mechanisms the industry uses (Vercel / CI):
 *   • POLL  — every N s, `git ls-remote` the tracked branch (cheap, no clone);
 *             SHA changed → re-scan → compute drift → push to open browsers.
 *   • WEBHOOK — a GitHub/GitLab push event hits the hub → trigger the same tick
 *             instantly (true real-time).
 * Either way the browser, subscribed over SSE, updates with NO re-click.
 *
 * Pure-ish + testable: the SHA source (`refOf`) and the scanner (`build`) are
 * INJECTED, so the whole loop — change-detect → re-scan → drift → broadcast — is
 * unit-tested deterministically without a network (the real-git path is proven
 * separately in track.test.ts). The HTTP/SSE wiring lives in server.ts.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { remoteRef, reportDelta, type ReportDelta } from "./track.js";
import type { XRayReport, SignedXRay } from "./types.js";

/** Verify a GitHub-style `sha256=…` HMAC over a raw webhook body. Constant-time.
 *  Returns true when no secret is configured (open mode) OR the signature matches. */
export function verifyWebhookSig(secret: string | undefined, rawBody: string, header: string | undefined): boolean {
  if (!secret) return true;                       // open mode (no secret configured)
  if (!header) return false;
  // GitHub/GitLab sign the raw body with HMAC-SHA256 → `sha256=<hex>`.
  const hmacExpected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(hmacExpected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A minimal SSE sink — a node ServerResponse satisfies this (testable with a fake). */
export interface SseSink { write(chunk: string): void; end(): void; on(event: "close", cb: () => void): void }

export interface BuildResult { report: XRayReport; signed: SignedXRay }
export type BuildFn = (gitUrl: string, branch?: string) => Promise<BuildResult>;
export type RefFn = (gitUrl: string, branch?: string) => string;

export interface HistoryEntry { at: number; sha: string; grade: string; drift: ReportDelta["drift"]; highlights: string[] }
export interface TrackRecord {
  id: string; gitUrl: string; branch?: string; lastSha: string;
  prevReport: XRayReport | null; signed: SignedXRay | null;
  subscribers: Set<SseSink>;
  createdAt: number; lastChangeAt: number;
  history: HistoryEntry[];                 // Time-Machine: drift over time
}

export interface HubOptions { build: BuildFn; refOf?: RefFn; now?: () => number; maxTracks?: number; maxHistory?: number; storePath?: string }

/** The persisted shape of a track (everything except live SSE subscribers). */
interface PersistedTrack { id: string; gitUrl: string; branch?: string; lastSha: string; prevReport: XRayReport | null; signed: SignedXRay | null; createdAt: number; lastChangeAt: number; history: HistoryEntry[] }

/** Stable track id from repo+branch, so re-tracking the same target reuses it. */
export function trackId(gitUrl: string, branch?: string): string {
  return createHash("sha256").update(`${gitUrl.trim()}#${branch ?? ""}`).digest("hex").slice(0, 16);
}

export class TrackerHub {
  readonly tracks = new Map<string, TrackRecord>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly build: BuildFn;
  private readonly refOf: RefFn;
  private readonly now: () => number;
  private readonly maxTracks: number;
  private readonly maxHistory: number;
  private readonly storePath?: string;

  constructor(opts: HubOptions) {
    this.build = opts.build;
    this.refOf = opts.refOf ?? remoteRef;
    this.now = opts.now ?? (() => Date.now());
    this.maxTracks = opts.maxTracks ?? 500;
    this.maxHistory = opts.maxHistory ?? 50;
    this.storePath = opts.storePath;
    this.load();
  }

  /** DURABLE STORE — survive a process restart (the droplet redeploys + restarts
   *  the service; tracks must NOT vanish). One JSON file at storePath; subscribers
   *  are live-only and never persisted. Best-effort + total (never throws). */
  private load(): void {
    if (!this.storePath || !existsSync(this.storePath)) return;
    try {
      const rows = JSON.parse(readFileSync(this.storePath, "utf8")) as PersistedTrack[];
      for (const r of Array.isArray(rows) ? rows : []) {
        if (!r || typeof r.id !== "string") continue;
        this.tracks.set(r.id, { ...r, subscribers: new Set() });
      }
    } catch { /* corrupt store → start clean, don't crash the server */ }
  }
  private save(): void {
    if (!this.storePath) return;
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      const rows: PersistedTrack[] = [...this.tracks.values()].map((r) => ({ id: r.id, gitUrl: r.gitUrl, branch: r.branch, lastSha: r.lastSha, prevReport: r.prevReport, signed: r.signed, createdAt: r.createdAt, lastChangeAt: r.lastChangeAt, history: r.history }));
      writeFileSync(this.storePath, JSON.stringify(rows));
    } catch { /* best-effort */ }
  }

  /** Register a repo+branch and run the initial scan. Idempotent per (url,branch). */
  async createTrack(gitUrl: string, branch?: string): Promise<{ id: string; signed: SignedXRay; record: TrackRecord }> {
    const id = trackId(gitUrl, branch);
    const existing = this.tracks.get(id);
    if (existing && existing.signed) return { id, signed: existing.signed, record: existing };
    if (this.tracks.size >= this.maxTracks && !existing) throw new Error("tracker capacity reached");
    const { report, signed } = await this.build(gitUrl, branch);
    const t = this.now();
    const delta = reportDelta(null, report);
    const record: TrackRecord = existing ?? {
      id, gitUrl, branch, lastSha: report.subject.commitHash, prevReport: report, signed,
      subscribers: new Set(), createdAt: t, lastChangeAt: t, history: [],
    };
    record.lastSha = report.subject.commitHash; record.prevReport = report; record.signed = signed;
    record.history.push({ at: t, sha: report.subject.commitHash, grade: report.summary.grade, drift: delta.drift, highlights: delta.highlights });
    this.tracks.set(id, record);
    this.save();
    return { id, signed, record };
  }

  /** Subscribe an SSE sink; immediately replays the current state. Auto-cleans on close. */
  subscribe(id: string, sink: SseSink): boolean {
    const rec = this.tracks.get(id);
    if (!rec) return false;
    rec.subscribers.add(sink);
    sink.write(`event: hello\ndata: ${JSON.stringify({ id, lastSha: rec.lastSha, grade: rec.signed?.report.summary.grade, branch: rec.branch, subscribers: rec.subscribers.size })}\n\n`);
    sink.on("close", () => rec.subscribers.delete(sink));
    return true;
  }

  /** One tick for a track: SHA changed → re-scan → drift → broadcast. Returns the
   *  change result, or null when there was nothing to do / the track is unknown. */
  async tick(id: string): Promise<{ changed: boolean; delta?: ReportDelta; sha: string; reason: string } | null> {
    const rec = this.tracks.get(id);
    if (!rec) return null;
    const sha = this.refOf(rec.gitUrl, rec.branch);
    if (!sha) return { changed: false, sha: rec.lastSha, reason: "could not resolve remote ref" };
    if (sha === rec.lastSha) return { changed: false, sha, reason: "no change" };
    let built: BuildResult;
    try { built = await this.build(rec.gitUrl, rec.branch); }
    catch (e) { return { changed: false, sha: rec.lastSha, reason: `re-scan failed: ${(e as Error).message}` }; }
    const delta = reportDelta(rec.prevReport, built.report);
    const t = this.now();
    rec.lastSha = built.report.subject.commitHash || sha;
    rec.prevReport = built.report; rec.signed = built.signed; rec.lastChangeAt = t;
    rec.history.push({ at: t, sha: rec.lastSha, grade: built.report.summary.grade, drift: delta.drift, highlights: delta.highlights });
    if (rec.history.length > this.maxHistory) rec.history.splice(0, rec.history.length - this.maxHistory);
    this.save();
    this.broadcast(rec, "update", { id, delta, signed: built.signed, at: t });
    return { changed: true, delta, sha: rec.lastSha, reason: delta.drift };
  }

  /** Poll every track once (the background poller calls this on an interval). */
  async pollAll(): Promise<number> {
    let changes = 0;
    for (const id of [...this.tracks.keys()]) { const r = await this.tick(id); if (r?.changed) changes++; }
    return changes;
  }

  startPoller(pollMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.pollAll(); }, Math.max(2_000, pollMs));
    if (typeof this.timer.unref === "function") this.timer.unref();
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private broadcast(rec: TrackRecord, event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const s of rec.subscribers) { try { s.write(frame); } catch { rec.subscribers.delete(s); } }
  }
}

// ─── gauntlet ────────────────────────────────────────────────────────────────
export interface GauntletCheck { name: string; pass: boolean; detail: string }
export interface HubGauntletResult { score: number; checks: GauntletCheck[] }

function fakeReport(grade: string, secrets: number, commit: string): XRayReport {
  return {
    v: 1, subject: { kind: "git-url", ref: "x", repoName: "x", commitHash: commit }, generatedAt: "",
    summary: { headline: "", grade: grade as XRayReport["summary"]["grade"], signalsRun: 8, bullets: [] },
    deps: { total: 0, byBand: { thriving: 0, healthy: 0, watch: 0, moribund: 0, dead: 0 }, atRisk: [], licenses: { permissive: 0, "weak-copyleft": 0, "strong-copyleft": 0, unknown: 0 }, licenseFlags: [], partial: false, note: "" },
    secrets: { filesScanned: 0, totalFindings: secrets, excludedTestHits: 0, byKind: {}, hits: [], worstVerdict: "ALLOW", note: "" },
    busFactor: { authors: 1, singleOwnerFilePct: 0, fragileFiles: [], topContributorShare: 0, busFactor: 1, note: "" },
    age: { bornAt: "", lastCommitAt: "", lifespan: "", lifespanDays: 0, totalCommits: 0, totalAuthors: 0, dormant: false, vitality: "active", note: "" },
    complexity: { filesAnalysed: 0, totalSymbols: 0, hotspots: [], maxDepth: 0, note: "" },
    hotspots: { windowDays: 0, filesConsidered: 0, hotspots: [], trend: [], note: "" },
    coupling: { windowDays: 0, pairs: [], note: "" },
    security: { commandsScanned: 0, writeCount: 0, destructive: [], injectionFindings: 0, injectionWhere: [], note: "" },
    fingerprint: `fp-${grade}-${secrets}-${commit}`,
  };
}

export async function hubGauntlet(): Promise<HubGauntletResult> {
  const checks: GauntletCheck[] = [];
  // controllable SHA source + scanner
  let sha = "sha-aaa", grade = "A", secrets = 0;
  const refOf: RefFn = () => sha;
  const build: BuildFn = async () => { const report = fakeReport(grade, secrets, sha); return { report, signed: { report, receipt: { ok: true } } }; };
  const hub = new TrackerHub({ build, refOf, now: () => 1000 });

  const { id } = await hub.createTrack("https://github.com/a/b", "main");
  checks.push({ name: "CREATE", pass: !!id && hub.tracks.get(id)?.lastSha === "sha-aaa", detail: "initial scan registers the track at its head SHA" });

  // a fake browser subscribes over SSE
  const frames: string[] = [];
  let closed = false;
  const sink: SseSink = { write: (c) => frames.push(c), end: () => {}, on: (_e, cb) => { void cb; closed = closed; } };
  hub.subscribe(id, sink);
  checks.push({ name: "SUBSCRIBE", pass: frames.some((f) => f.includes("event: hello")), detail: "an SSE subscriber gets an immediate hello with current state" });

  // no change → tick is a no-op, no broadcast
  const before = frames.length;
  const t0 = await hub.tick(id);
  checks.push({ name: "NO-CHANGE", pass: t0?.changed === false && frames.length === before, detail: "unchanged SHA → no re-scan, no broadcast (cheap poll)" });

  // a push introduces a secret → change detected → drift broadcast to the browser
  sha = "sha-bbb"; grade = "C"; secrets = 1;
  const t1 = await hub.tick(id);
  const pushed = frames.find((f) => f.includes("event: update"));
  checks.push({ name: "DRIFT-BROADCAST", pass: t1?.changed === true && t1?.delta?.drift === "degraded" && !!pushed && pushed.includes("secret leak"), detail: "git change → re-scan → drift pushed to the open browser (no re-click)" });

  // Time-Machine: history accrued (baseline + the change)
  const rec = hub.tracks.get(id)!;
  checks.push({ name: "TIME-MACHINE", pass: rec.history.length === 2 && rec.history[1].drift === "degraded", detail: "per-change drift history retained (Time-Machine indexing)" });

  // idempotent track id
  checks.push({ name: "STABLE-ID", pass: trackId("https://github.com/a/b", "main") === id, detail: "same repo+branch → same track id (re-track reuses)" });

  // poll drives all tracks
  sha = "sha-ccc"; grade = "B"; secrets = 0;
  const n = await hub.pollAll();
  checks.push({ name: "POLL-ALL", pass: n === 1, detail: "the poller advances every track in one pass" });

  hub.stop();
  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 100), checks };
}
