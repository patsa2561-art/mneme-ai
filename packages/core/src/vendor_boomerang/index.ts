/**
 * v2.19.0 — MNEME VENDOR BOOMERANG (the cross-vendor brain no single vendor has)
 *
 *   "Grok generates code that touches src/foo.ts. Claude wrote that file
 *    yesterday. Grok has no idea Claude exists — xAI's silo can't see
 *    Anthropic's history, and vice versa. BOOMERANG closes the gap:
 *    Mneme records every vendor's recent edits in a local activity
 *    ledger, and when a NEW vendor arrives at a file another vendor
 *    just touched, Mneme injects 'recent cross-vendor context' into the
 *    incoming vendor's prompt: 'last touched by claude 2h ago — they
 *    introduced calculateTotal at line 42; don't duplicate.'"
 *
 * Vendor-agnostic: every vendor (claude / chatgpt / gemini / cursor /
 * copilot / codex / llama / mistral / qwen / deepseek / grok /
 * perplexity / other) writes to the same ledger and reads the same
 * boomerang context.
 *
 * Honest scope:
 *   - BOOMERANG ledger is local to the repo's .mneme/ directory by
 *     default; no cross-org leakage.
 *   - BOOMERANG does NOT execute on the vendor's behalf — it formats a
 *     plain-text context block the AI agent should prepend to its
 *     next prompt. The user's MCP client wires that into the call.
 *   - Activity ledger entries are HMAC-signed (chain), so a vendor
 *     can't falsely "claim credit" for edits it didn't make.
 *
 * Composes onto v2.18 NEXUS PROACTIVE (push side) + v2.16 LIVING MODEL
 * (anti-entropy if you want it to gossip). Pure additive layer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Vendor } from "../arena/index.js";

const PROTOCOL_VERSION = 1 as const;

export type ActivityKind =
  | "file_edit"      // added/modified a file
  | "symbol_create"  // introduced a new symbol
  | "symbol_move"    // moved a symbol's location
  | "symbol_delete"  // deleted a symbol
  | "test_add";      // added a test

export interface ActivityRecord {
  v: typeof PROTOCOL_VERSION;
  recordId: string;
  vendor: Vendor;
  kind: ActivityKind;
  /** Repo-relative file path. */
  filePath: string;
  /** Optional symbol name (for symbol-* kinds). */
  symbol?: string;
  /** Optional line / location reference. */
  location?: string;
  /** Short note from the vendor (or AI) about what it did. */
  note: string;
  ts: string;
  /** Chain-link: HMAC depends on prev sig for tamper detection across the ledger. */
  prevSig: string;
  sig: string;
}

export interface BoomerangContext {
  v: typeof PROTOCOL_VERSION;
  builtFor: Vendor;
  filePath: string;
  /** Records that match this file + are recent + are from OTHER vendors. */
  relevantRecords: ActivityRecord[];
  /** Plain-text block ready to inject into the next prompt. */
  injectedContextBlock: string;
  builtAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_BOOMERANG_SECRET"] || `mneme-vendor-boomerang-v${PROTOCOL_VERSION}`;
}

export class VendorBoomerang {
  private ledger: ActivityRecord[] = [];
  private secret: string;

  constructor(secret?: string) {
    this.secret = secret ?? defaultSecret();
  }

  /** Record an activity. Returns the signed record. */
  record(input: {
    vendor: Vendor;
    kind: ActivityKind;
    filePath: string;
    symbol?: string;
    location?: string;
    note: string;
    ts?: string;
  }): ActivityRecord {
    const ts = input.ts ?? new Date().toISOString();
    const prevSig = this.ledger.length === 0 ? "genesis".padEnd(64, "0") : this.ledger[this.ledger.length - 1]!.sig;
    const recordId = "act-" + createHmac("sha256", "mneme-boomerang-id")
      .update(`${input.vendor}|${input.filePath}|${ts}|${this.ledger.length}`)
      .digest("hex").slice(0, 14);
    const body: Omit<ActivityRecord, "sig"> = {
      v: PROTOCOL_VERSION,
      recordId,
      vendor: input.vendor,
      kind: input.kind,
      filePath: input.filePath,
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ...(input.location ? { location: input.location } : {}),
      note: input.note,
      ts,
      prevSig,
    };
    const sig = createHmac("sha256", this.secret).update(canon(body)).digest("hex");
    const rec: ActivityRecord = { ...body, sig };
    this.ledger.push(rec);
    return rec;
  }

  /** Build a boomerang context for `incomingVendor` touching `filePath`. */
  build(input: {
    incomingVendor: Vendor;
    filePath: string;
    /** Look-back window in seconds; default 24h. */
    lookbackSeconds?: number;
    /** Max records to surface. Default 8. */
    maxRecords?: number;
    nowMs?: number;
  }): BoomerangContext {
    const now = input.nowMs ?? Date.now();
    const lookbackMs = (input.lookbackSeconds ?? 86400) * 1000;
    const cutoff = now - lookbackMs;
    const max = input.maxRecords ?? 8;

    const relevant = this.ledger
      .filter((r) => r.vendor !== input.incomingVendor)
      .filter((r) => r.filePath === input.filePath)
      .filter((r) => Date.parse(r.ts) >= cutoff)
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, max);

    const lines = relevant.length === 0
      ? ["(no recent cross-vendor activity on this file)"]
      : relevant.map((r) => {
          const ageMin = Math.round((now - Date.parse(r.ts)) / 60_000);
          const sym = r.symbol ? ` · symbol \`${r.symbol}\`` : "";
          const loc = r.location ? ` @ ${r.location}` : "";
          return `- ${r.vendor} · ${r.kind}${sym}${loc} · ${ageMin}m ago · "${r.note}"`;
        });
    const injectedContextBlock = [
      `[MNEME BOOMERANG · ${input.filePath}]`,
      `Recent activity by OTHER vendors on this file (look-back ${input.lookbackSeconds ?? 86400}s):`,
      ...lines,
      `(Source: HMAC-signed local activity ledger; ${relevant.length} record(s).)`,
    ].join("\n");
    const builtAt = new Date(now).toISOString();
    const body: Omit<BoomerangContext, "sig"> = {
      v: PROTOCOL_VERSION,
      builtFor: input.incomingVendor,
      filePath: input.filePath,
      relevantRecords: relevant,
      injectedContextBlock,
      builtAt,
    };
    const sig = createHmac("sha256", this.secret).update(canon(body)).digest("hex");
    return { ...body, sig };
  }

  /** Verify a record's signature in isolation. */
  verifyRecord(r: ActivityRecord): boolean {
    const { sig: claimed, ...body } = r;
    const expected = createHmac("sha256", this.secret).update(canon(body)).digest("hex");
    try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
    catch { return false; }
  }

  /** Verify the full chain integrity (each record's prevSig matches predecessor.sig). */
  verifyChain(): { ok: boolean; brokenAt?: number; reason?: string } {
    for (let i = 0; i < this.ledger.length; i++) {
      const rec = this.ledger[i]!;
      if (!this.verifyRecord(rec)) {
        return { ok: false, brokenAt: i, reason: "record sig mismatch" };
      }
      if (i === 0) {
        if (rec.prevSig !== "genesis".padEnd(64, "0")) {
          return { ok: false, brokenAt: 0, reason: "genesis prevSig wrong" };
        }
      } else {
        const prev = this.ledger[i - 1]!;
        if (rec.prevSig !== prev.sig) {
          return { ok: false, brokenAt: i, reason: "chain link mismatch" };
        }
      }
    }
    return { ok: true };
  }

  /** Per-vendor activity counts. */
  stats(): { totalRecords: number; perVendor: Record<string, number>; uniqueFiles: number } {
    const perVendor: Record<string, number> = {};
    const files = new Set<string>();
    for (const r of this.ledger) {
      perVendor[r.vendor] = (perVendor[r.vendor] ?? 0) + 1;
      files.add(r.filePath);
    }
    return { totalRecords: this.ledger.length, perVendor, uniqueFiles: files.size };
  }

  /** Export the full ledger (e.g., to persist .mneme/boomerang.jsonl). */
  exportLedger(): ActivityRecord[] {
    return [...this.ledger];
  }
}

export function formatBoomerangLine(c: BoomerangContext): string {
  return `📡 BOOMERANG · for ${c.builtFor} · ${c.filePath} · ${c.relevantRecords.length} cross-vendor record(s)`;
}

let _instance: VendorBoomerang | null = null;
export function defaultBoomerang(): VendorBoomerang {
  if (!_instance) _instance = new VendorBoomerang();
  return _instance;
}
