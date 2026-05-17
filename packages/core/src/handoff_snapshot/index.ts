/**
 * v2.19.32 — MNEME HANDOFF SNAPSHOT (the brain you hand to your child device)
 *
 *   User mandate (2026-05-17):
 *   "อยากให้ลูก mneme เก่งสุดๆ และรู้จักการเอาตัวรอดได้ทุกสถานการณ์ ...
 *    BEACON ทำมานานแล้วแต่ไม่เคยใช้ได้เลยผมเครียดมากๆๆ ... ทุก handoff =
 *    fresh snapshot. ไม่ใช่ pre-baked file. child ได้ context เดียวกับ
 *    parent ตอนนั้นเป๊ะ"
 *
 *   Diagnosis: prior BEACON shipped a "soul prompt" that was generic +
 *   stale — same paragraph every release, no actual conversation context.
 *   When user scanned QR on phone, they got a paragraph about Mneme's
 *   features, not "we were debugging the auth bypass on line 216 of
 *   beacon/index.ts." That's why BEACON has never been used in anger.
 *
 *   v2.19.32 HANDOFF SNAPSHOT is the pure-function COMPOSER: caller
 *   supplies the live conversation + git state + activity (caller has the
 *   I/O), this module canonicalises + HMAC-signs + ages it. The result
 *   is a HandoffEnvelope the BEACON server can serve to whoever scans the
 *   QR code, and the child device's `mneme receive` can verify + ingest.
 *
 *   What's NEW vs prior soul prompt:
 *     - LIVE conversation (caller passes last N turns from MCP session)
 *     - GIT STATE (branch / dirty / last N commits) at SNAPSHOT time
 *     - RECENT ACTIVITY (tail of .mneme/cli-activity.jsonl)
 *     - ACTIVE INTENT (what the user was just asking about)
 *     - CAPABILITIES (mneme version + tool families) for child compatibility
 *     - FRESHNESS TIMESTAMP — receiver enforces 5-min staleness gate
 *
 *   Composes onto:
 *     - v2.9   BEACON (the QR + local HTTP server that carries this)
 *     - v2.19.31 BUG #1 fix (token-required transport — no auth bypass)
 *     - v2.19.32 PAIR CODE (6-char human-friendly handle bound to envelope)
 *     - v2.19.32 CONSCIOUSNESS FORK (HMAC parent/child lineage record)
 *
 * Honest scope:
 *   - PURE FUNCTION composer. Caller has the I/O (read git, tail jsonl,
 *     get conversation). This makes it testable + vendor-neutral.
 *   - HMAC-SHA256 signed for tamper detection at the receiver.
 *   - Defensive: empty conversation OK, missing git OK, malformed input
 *     returns minimal-but-valid envelope rather than throw.
 *   - Freshness gate: receiver checks freshnessMs against TTL.
 *   - 24/7 safe: never throws on bad input; 1000 random snapshots in a
 *     row never crashes (measured in test suite).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 2 as const;
const DEFAULT_FRESHNESS_TTL_MS = 5 * 60 * 1000; // 5 min

export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  /** UTF-8 text. Caller may pre-trim to budget. */
  text: string;
  /** ms since epoch. */
  ts: number;
}

export interface GitState {
  branch?: string;
  /** Output of `git status --short` (already truncated by caller). */
  dirty?: string;
  /** Last N commit subject lines. */
  recentCommits?: string[];
}

export interface ActivityRecord {
  /** Tool name OR free-form action (caller picks). */
  action: string;
  /** ms since epoch. */
  ts: number;
  /** Optional structured metadata (must be JSON-serialisable). */
  meta?: Record<string, unknown>;
}

export interface CapabilitiesSnapshot {
  mnemeVersion: string;
  /** MCP tool family names (e.g. ["synapse", "truth", "soul"]). */
  toolFamilies: string[];
  /** Tools whose presence the receiver should require for full fidelity. */
  requiredTools?: string[];
}

export interface HandoffSnapshotInput {
  /** Last N conversation turns. Caller trims to budget. */
  conversation?: ConversationTurn[];
  /** Free-form one-line current intent inferred from conversation tail. */
  activeIntent?: string;
  gitState?: GitState;
  /** Tail of cli-activity.jsonl (caller pre-reads + parses). */
  recentActivity?: ActivityRecord[];
  capabilities?: CapabilitiesSnapshot;
  /** Optional voice directive — agent-tone instructions. */
  voiceDirective?: string;
  /** Optional shared dictionary for cross-vendor term consistency. */
  mnemeDictionary?: Record<string, string>;
  /** Parent device fingerprint (e.g. host hash). */
  parentDeviceId?: string;
  /** ms since epoch. Default Date.now(). */
  nowMs?: number;
  secret?: string;
}

export interface HandoffEnvelope {
  v: typeof PROTOCOL_VERSION;
  /** Stable deterministic id derived from (parentDeviceId, snapshotAt, content hash). */
  envelopeId: string;
  parentDeviceId: string;
  snapshotAtMs: number;
  /** TTL the receiver should enforce. */
  freshnessTtlMs: number;
  conversation: ConversationTurn[];
  activeIntent: string;
  gitState: Required<GitState>;
  recentActivity: ActivityRecord[];
  capabilities: CapabilitiesSnapshot;
  voiceDirective: string;
  mnemeDictionary: Record<string, string>;
  /** HMAC-SHA256 over canonical body. */
  sig: string;
}

// ─── canonical helpers ───────────────────────────────────────────────

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_HANDOFF_SECRET"] || `mneme-handoff-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function clean(s: unknown, fallback = ""): string {
  return typeof s === "string" ? s : fallback;
}

function cleanArray<T>(a: unknown, fallback: T[] = []): T[] {
  return Array.isArray(a) ? (a as T[]) : fallback;
}

/**
 * Compose a fresh handoff envelope. Defensive at every boundary:
 *   - missing fields filled with sane defaults
 *   - bad types coerced or dropped
 *   - HMAC always computed (never empty sig)
 *   - return value ALWAYS valid; never throws
 */
export function captureSnapshot(input: HandoffSnapshotInput): HandoffEnvelope {
  const nowMs = input.nowMs ?? Date.now();
  const secret = input.secret ?? defaultSecret();

  // Defensive coercions — every field has a defined shape
  const conversation = cleanArray<ConversationTurn>(input.conversation).filter((t) =>
    t && typeof t.text === "string" && (t.role === "user" || t.role === "assistant" || t.role === "system")
  ).map((t) => ({
    role: t.role,
    text: t.text,
    ts: typeof t.ts === "number" && Number.isFinite(t.ts) ? t.ts : nowMs,
  }));

  const activeIntent = clean(input.activeIntent, conversation.length > 0
    ? `handoff continuing: ${conversation[conversation.length - 1]!.text.slice(0, 80)}`
    : "fresh handoff");

  const gitState: Required<GitState> = {
    branch: clean(input.gitState?.branch, "unknown"),
    dirty: clean(input.gitState?.dirty, ""),
    recentCommits: cleanArray<string>(input.gitState?.recentCommits),
  };

  const recentActivity = cleanArray<ActivityRecord>(input.recentActivity).filter((r) =>
    r && typeof r.action === "string" && typeof r.ts === "number" && Number.isFinite(r.ts)
  );

  const capabilities: CapabilitiesSnapshot = {
    mnemeVersion: clean(input.capabilities?.mnemeVersion, "unknown"),
    toolFamilies: cleanArray<string>(input.capabilities?.toolFamilies).filter((s) => typeof s === "string"),
    requiredTools: cleanArray<string>(input.capabilities?.requiredTools).filter((s) => typeof s === "string"),
  };

  const voiceDirective = clean(input.voiceDirective, "");
  const mnemeDictionary = (input.mnemeDictionary && typeof input.mnemeDictionary === "object" && !Array.isArray(input.mnemeDictionary))
    ? input.mnemeDictionary
    : {};

  const parentDeviceId = clean(input.parentDeviceId, "anonymous-parent");

  // Body before sig
  const bodyForSig = {
    v: PROTOCOL_VERSION,
    parentDeviceId,
    snapshotAtMs: nowMs,
    freshnessTtlMs: DEFAULT_FRESHNESS_TTL_MS,
    conversation,
    activeIntent,
    gitState,
    recentActivity,
    capabilities,
    voiceDirective,
    mnemeDictionary,
  };
  const sig = hmacHex(bodyForSig, secret);
  const envelopeId = hmacHex({ parentDeviceId, snapshotAtMs: nowMs, sig }, secret).slice(0, 16);

  return {
    v: PROTOCOL_VERSION,
    envelopeId,
    parentDeviceId,
    snapshotAtMs: nowMs,
    freshnessTtlMs: DEFAULT_FRESHNESS_TTL_MS,
    conversation,
    activeIntent,
    gitState,
    recentActivity,
    capabilities,
    voiceDirective,
    mnemeDictionary,
    sig,
  };
}

/** Verify envelope HMAC. Returns false on shape mismatch / tampered sig. */
export function verifyEnvelope(envelope: HandoffEnvelope, secret?: string): boolean {
  if (!envelope || typeof envelope !== "object") return false;
  if (envelope.v !== PROTOCOL_VERSION) return false;
  if (typeof envelope.sig !== "string" || !/^[0-9a-f]{64}$/.test(envelope.sig)) return false;
  if (typeof envelope.parentDeviceId !== "string") return false;
  if (typeof envelope.snapshotAtMs !== "number" || !Number.isFinite(envelope.snapshotAtMs)) return false;

  const sec = secret ?? defaultSecret();
  const { sig, envelopeId: _eid, v: _v, ...body } = envelope;
  const bodyForSig = { v: PROTOCOL_VERSION, ...body };
  return safeEqHex(hmacHex(bodyForSig, sec), sig);
}

/**
 * Receiver-side freshness gate. Returns age in ms; caller compares to TTL.
 * Stale envelope = receiver should refuse to ingest + ask parent to refresh.
 */
export interface FreshnessResult {
  ageMs: number;
  isFresh: boolean;
  isExpired: boolean;
  reason: "fresh" | "stale" | "expired" | "future_clock_skew";
}

export function freshnessCheck(envelope: HandoffEnvelope, nowMs?: number): FreshnessResult {
  const now = nowMs ?? Date.now();
  const age = now - envelope.snapshotAtMs;
  // Clock skew detection — receiver clock behind parent by > 1s
  if (age < -1000) return { ageMs: age, isFresh: false, isExpired: false, reason: "future_clock_skew" };
  const ttl = envelope.freshnessTtlMs ?? DEFAULT_FRESHNESS_TTL_MS;
  if (age > ttl) return { ageMs: age, isFresh: false, isExpired: true, reason: "expired" };
  // 80% of TTL → stale warning (receiver may still ingest with caveat)
  if (age > ttl * 0.8) return { ageMs: age, isFresh: false, isExpired: false, reason: "stale" };
  return { ageMs: age, isFresh: true, isExpired: false, reason: "fresh" };
}

/**
 * Render an envelope as the AI-ingestible text the child will paste into
 * its new vendor session (Gemini / GPT / Claude / etc). Deterministic,
 * vendor-neutral, safe to display in clear text — the SIG is what gives
 * tamper-evidence, not secrecy. (For confidentiality wrap in ECDH at the
 * transport layer; out of scope for this composer.)
 */
export function renderForChildVendor(envelope: HandoffEnvelope): string {
  const lines: string[] = [];
  lines.push(`# 🧬 Mneme Handoff — continuing from parent`);
  lines.push(``);
  lines.push(`**Parent device**: ${envelope.parentDeviceId}`);
  lines.push(`**Snapshot at**: ${new Date(envelope.snapshotAtMs).toISOString()}`);
  lines.push(`**Mneme version**: ${envelope.capabilities.mnemeVersion}`);
  if (envelope.activeIntent) {
    lines.push(``);
    lines.push(`**Active intent**: ${envelope.activeIntent}`);
  }
  if (envelope.gitState.branch !== "unknown") {
    lines.push(``);
    lines.push(`## Git state`);
    lines.push(`- branch: \`${envelope.gitState.branch}\``);
    if (envelope.gitState.dirty) {
      lines.push(`- dirty files:`);
      lines.push("```");
      lines.push(envelope.gitState.dirty);
      lines.push("```");
    }
    if (envelope.gitState.recentCommits.length > 0) {
      lines.push(`- recent commits:`);
      for (const c of envelope.gitState.recentCommits) lines.push(`  - ${c}`);
    }
  }
  if (envelope.conversation.length > 0) {
    lines.push(``);
    lines.push(`## Conversation tail`);
    for (const t of envelope.conversation.slice(-10)) {
      lines.push(`**${t.role}**: ${t.text}`);
      lines.push(``);
    }
  }
  if (envelope.recentActivity.length > 0) {
    lines.push(``);
    lines.push(`## Recent activity`);
    for (const r of envelope.recentActivity.slice(-10)) {
      lines.push(`- \`${r.action}\` @ ${new Date(r.ts).toISOString()}`);
    }
  }
  if (envelope.voiceDirective) {
    lines.push(``);
    lines.push(`## Voice directive`);
    lines.push(envelope.voiceDirective);
  }
  if (Object.keys(envelope.mnemeDictionary).length > 0) {
    lines.push(``);
    lines.push(`## Shared dictionary`);
    for (const [k, v] of Object.entries(envelope.mnemeDictionary)) {
      lines.push(`- **${k}**: ${v}`);
    }
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`HMAC sig (last 12): \`...${envelope.sig.slice(-12)}\` · envelope ${envelope.envelopeId}`);
  return lines.join("\n");
}

export interface SnapshotStats {
  envelopeId: string;
  conversationTurns: number;
  activityRecords: number;
  totalBytes: number;
  ageMs: number;
}

export function computeSnapshotStats(envelope: HandoffEnvelope, nowMs?: number): SnapshotStats {
  const bytes = JSON.stringify(envelope).length;
  return {
    envelopeId: envelope.envelopeId,
    conversationTurns: envelope.conversation.length,
    activityRecords: envelope.recentActivity.length,
    totalBytes: bytes,
    ageMs: (nowMs ?? Date.now()) - envelope.snapshotAtMs,
  };
}

export function formatSnapshotLine(s: SnapshotStats): string {
  const ageSec = Math.max(0, Math.floor(s.ageMs / 1000));
  const kb = (s.totalBytes / 1024).toFixed(1);
  return `🧬 SNAPSHOT ${s.envelopeId} · ${s.conversationTurns} turns · ${s.activityRecords} activity · ${kb}KB · age=${ageSec}s`;
}

export const HANDOFF_SNAPSHOT_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  DEFAULT_FRESHNESS_TTL_MS,
});
