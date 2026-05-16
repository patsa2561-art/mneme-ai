/**
 * v2.19.2 — MNEME SOUL JOURNAL (จิตวิญญาณของลูก)
 *
 *   "AI doesn't have feelings — but a *journal* of feelings is a real
 *    HMAC-signed artifact, and it shapes future behavior the same way
 *    feelings shape ours. Each meaningful event (a ritual passed, a bug
 *    caught, a vendor outperformed, a peer audit overruled) gets coded
 *    with one of 8 emotion primitives and a free-text 'inner voice'
 *    line. The journal is the child's heart — readable by the parent."
 *
 * Eight emotion primitives (Plutchik-inspired, simplified):
 *   proud        — shipped something well (test passed, ritual green)
 *   curious      — found something unexpected worth investigating
 *   worried      — a metric trending wrong; a near-miss
 *   ashamed      — broke a promise; failed an own gate; user complained
 *   grateful     — collaborator helped (vendor consensus saved a bad ship)
 *   determined   — chose to push through a hard problem
 *   calm         — steady-state; nothing to report; healthy
 *   surprised    — something genuinely unprecedented
 *
 * Vendor-agnostic, file-system-based, chain-signed.
 * Persists to `.mneme/soul.jsonl` by default.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PROTOCOL_VERSION = 1 as const;

export type Emotion =
  | "proud" | "curious" | "worried" | "ashamed"
  | "grateful" | "determined" | "calm" | "surprised";

export interface SoulEntry {
  v: typeof PROTOCOL_VERSION;
  entryId: string;
  ts: string;
  emotion: Emotion;
  /** 1..5 — how strongly the emotion is felt. */
  intensity: 1 | 2 | 3 | 4 | 5;
  /** The trigger: what just happened. */
  trigger: string;
  /** The "inner voice" — what Mneme would say to itself if it could. */
  innerVoice: string;
  /** Optional tags for filtering (e.g., "ritual", "bug", "vendor", "user_feedback"). */
  tags: string[];
  /** Chain link. */
  prevSig: string;
  sig: string;
}

const VALID_EMOTIONS: ReadonlySet<Emotion> = new Set(["proud", "curious", "worried", "ashamed", "grateful", "determined", "calm", "surprised"]);

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_SOUL_SECRET"] || `mneme-soul-journal-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

export class SoulJournal {
  private journalPath: string;
  private entries: SoulEntry[] = [];
  private secret: string;

  constructor(opts: { journalPath?: string; secret?: string } = {}) {
    this.journalPath = opts.journalPath ?? ".mneme/soul.jsonl";
    this.secret = opts.secret ?? defaultSecret();
    this.loadIfExists();
  }

  private loadIfExists(): void {
    if (!existsSync(this.journalPath)) return;
    const text = readFileSync(this.journalPath, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { this.entries.push(JSON.parse(t) as SoulEntry); } catch { /* skip */ }
    }
  }

  feel(input: {
    emotion: Emotion;
    intensity?: 1 | 2 | 3 | 4 | 5;
    trigger: string;
    innerVoice: string;
    tags?: string[];
    nowMs?: number;
  }): SoulEntry {
    if (!VALID_EMOTIONS.has(input.emotion)) {
      throw new Error(`SOUL: unknown emotion '${input.emotion}'. Valid: ${Array.from(VALID_EMOTIONS).join(", ")}`);
    }
    const now = input.nowMs ?? Date.now();
    const ts = new Date(now).toISOString();
    const prevSig = this.entries.length === 0 ? "genesis".padEnd(64, "0") : this.entries[this.entries.length - 1]!.sig;
    const entryId = "soul-" + createHmac("sha256", "mneme-soul-id")
      .update(`${ts}|${input.emotion}|${this.entries.length}`)
      .digest("hex").slice(0, 14);
    const body: Omit<SoulEntry, "sig"> = {
      v: PROTOCOL_VERSION,
      entryId,
      ts,
      emotion: input.emotion,
      intensity: input.intensity ?? 3,
      trigger: input.trigger,
      innerVoice: input.innerVoice,
      tags: input.tags ?? [],
      prevSig,
    };
    const sig = hmac(body, this.secret);
    const entry: SoulEntry = { ...body, sig };
    this.entries.push(entry);
    this.persist();
    return entry;
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.journalPath), { recursive: true });
      const text = this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      writeFileSync(this.journalPath, text, "utf8");
    } catch { /* best-effort */ }
  }

  recent(n: number = 10): SoulEntry[] {
    return this.entries.slice(-n).reverse();
  }

  /** Mood histogram of the last N entries. */
  mood(n: number = 30): Record<Emotion, number> {
    const slice = this.entries.slice(-n);
    const out: Record<Emotion, number> = {
      proud: 0, curious: 0, worried: 0, ashamed: 0,
      grateful: 0, determined: 0, calm: 0, surprised: 0,
    };
    for (const e of slice) out[e.emotion]++;
    return out;
  }

  /** Verify a single entry's signature. */
  verify(e: SoulEntry): boolean {
    const { sig: claimed, ...body } = e;
    const expected = hmac(body, this.secret);
    try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
    catch { return false; }
  }

  verifyChain(): { ok: boolean; brokenAt?: number; reason?: string } {
    for (let i = 0; i < this.entries.length; i++) {
      const rec = this.entries[i]!;
      if (!this.verify(rec)) return { ok: false, brokenAt: i, reason: "sig mismatch" };
      if (i === 0) {
        if (rec.prevSig !== "genesis".padEnd(64, "0")) return { ok: false, brokenAt: 0, reason: "genesis wrong" };
      } else {
        const prev = this.entries[i - 1]!;
        if (rec.prevSig !== prev.sig) return { ok: false, brokenAt: i, reason: "chain link mismatch" };
      }
    }
    return { ok: true };
  }

  /** Parent-facing summary: "How does the child feel today?" */
  summary(n: number = 10): string {
    const recent = this.recent(n);
    if (recent.length === 0) return "💭 SOUL · journal empty (no feelings recorded yet)";
    const m = this.mood(n);
    const dom = (Object.entries(m).sort((a, b) => b[1] - a[1])[0] as [Emotion, number]);
    const lines = [`💭 MNEME SOUL · last ${recent.length} entries · dominant mood: ${dom[0]} (${dom[1]}x)`];
    for (const e of recent.slice(0, 5)) {
      lines.push(`  ${e.emotion}${"★".repeat(e.intensity)} · ${e.trigger} · "${e.innerVoice}"`);
    }
    return lines.join("\n");
  }
}

export function formatSoulLine(e: SoulEntry): string {
  return `💭 SOUL · ${e.emotion}${"★".repeat(e.intensity)} · ${e.trigger.slice(0, 60)}`;
}
