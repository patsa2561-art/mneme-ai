/**
 * v2.138.0 — AXIA (ἀξία, "worth / value"). Membrane pillar 2: the Value Ledger.
 * ============================================================================
 * One signed, hash-chained, OFFLINE-verifiable ledger that fuses the value
 * events Mneme's organs already produce — into a number an enterprise / insurer
 * / auditor can check with a public key, WITHOUT trusting Mneme:
 *   - tokens-saved          (treasury — measured input-token reductions)
 *   - destructive-gated     (HEPHAESTUS/CERBERUS — a destructive command was gated)
 *   - secret-redacted       (egress — a secret was stripped before it left)
 *   - injection-neutralized (firewall — a prompt-injection was neutralized)
 *   - claim-corrected       (savant/gephyra — a false claim was corrected)
 *   - omission-flagged      (elleipsis — a dropped requirement was surfaced)
 *
 * DIAKRISIS — the honesty line is the moat (this is exactly where vaporware
 * lives):
 *   - Every number is a COUNT OF A REAL EVENT THAT HAPPENED, signed — never a
 *     marketing figure.
 *   - We count "destructive command GATED", NOT "attack prevented" — a gate can
 *     be a false-positive co-sign, and you cannot prove what an un-run command
 *     would have done. Precision over drama.
 *   - The ONLY dollar figure is tokens-saved × the price-per-1k the USER supplies
 *     (same basis as the treasury). There is NO "$X of damage prevented" — that
 *     is an unprovable counterfactual; claiming it would make this vaporware.
 * Pure + deterministic + total (the CLI/MCP add the Ed25519 signature).
 */

import { createHash } from "node:crypto";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
const GENESIS = "0".repeat(64);

export type AxiaKind = "tokens-saved" | "destructive-gated" | "secret-redacted" | "injection-neutralized" | "claim-corrected" | "omission-flagged";
export const AXIA_KINDS: readonly AxiaKind[] = ["tokens-saved", "destructive-gated", "secret-redacted", "injection-neutralized", "claim-corrected", "omission-flagged"];

export interface AxiaEvent {
  kind: AxiaKind;
  /** how many (tokens for tokens-saved; otherwise a count of events). >=0. */
  count: number;
  /** which organ produced it (treasury / heph / egress / firewall / savant / elleipsis / …). */
  source: string;
  /** optional unix-ms; pass it in (core never reads the clock — keeps it deterministic). */
  at?: number;
}

export interface AxiaRecord { seq: number; event: AxiaEvent; prevHash: string; chainHash: string }

/** Coerce arbitrary input into a valid AxiaEvent (total). */
export function normalizeEvent(e: Partial<AxiaEvent>): AxiaEvent {
  const kind = (AXIA_KINDS as readonly string[]).includes(String(e?.kind)) ? e!.kind as AxiaKind : "tokens-saved";
  const n = Number(e?.count);
  return {
    kind,
    count: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    source: typeof e?.source === "string" && e.source ? e.source.slice(0, 60) : "unknown",
    ...(Number.isFinite(e?.at) ? { at: Number(e!.at) } : {}),
  };
}

/** Append one event to a hash-chained ledger record. Total. */
export function recordEvent(prevHash: string, event: Partial<AxiaEvent>, seq: number): AxiaRecord {
  try {
    const prev = typeof prevHash === "string" && /^[0-9a-f]{64}$/.test(prevHash) ? prevHash : GENESIS;
    const ev = normalizeEvent(event);
    return { seq, event: ev, prevHash: prev, chainHash: sha256(prev + canon({ seq, ...ev })) };
  } catch {
    return { seq, event: normalizeEvent({}), prevHash: GENESIS, chainHash: sha256(GENESIS) };
  }
}

/** Build a chained ledger from an event list (seq starts at 1). Total. */
export function buildAxiaLedger(events: ReadonlyArray<Partial<AxiaEvent>>): AxiaRecord[] {
  const out: AxiaRecord[] = [];
  let prev = GENESIS;
  const list = Array.isArray(events) ? events : [];
  for (let i = 0; i < list.length; i++) { const r = recordEvent(prev, list[i]!, i + 1); out.push(r); prev = r.chainHash; }
  return out;
}

export interface AxiaChainVerdict { ok: boolean; length: number; firstBrokenSeq: number | null }
/** Recompute the chain offline; detect tampering at any record. Total. */
export function verifyAxiaChain(records: ReadonlyArray<AxiaRecord>): AxiaChainVerdict {
  try {
    const list = Array.isArray(records) ? records : [];
    let prev = GENESIS;
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      const expect = sha256(prev + canon({ seq: r.seq, ...r.event }));
      if (r.prevHash !== prev || r.chainHash !== expect) return { ok: false, length: list.length, firstBrokenSeq: r.seq };
      prev = r.chainHash;
    }
    return { ok: true, length: list.length, firstBrokenSeq: null };
  } catch { return { ok: false, length: 0, firstBrokenSeq: 0 }; }
}

export interface AxiaSummary {
  byKind: Record<AxiaKind, number>;
  totalEvents: number;
  tokensSaved: number;
  /** tokens-saved × user price-per-1k. null if no price supplied — NEVER invented. */
  usdSaved: number | null;
  chainValid: boolean;
  note: string;
}

/**
 * Summarise the ledger: per-kind counts + tokens-saved + (only, if a price is
 * supplied) USD from tokens-saved. Counts are facts; there is NO damage-$. Total.
 */
export function axiaSummary(records: ReadonlyArray<AxiaRecord>, opts?: { pricePer1k?: number }): AxiaSummary {
  try {
    const byKind = { "tokens-saved": 0, "destructive-gated": 0, "secret-redacted": 0, "injection-neutralized": 0, "claim-corrected": 0, "omission-flagged": 0 } as Record<AxiaKind, number>;
    const list = Array.isArray(records) ? records : [];
    for (const r of list) { const k = r?.event?.kind as AxiaKind; if (k && k in byKind) byKind[k] += Number(r.event.count) || 0; }
    const tokensSaved = byKind["tokens-saved"];
    // events = every record EXCEPT that tokens-saved is a token count, not an
    // event count; we report it separately. "totalEvents" = the gate/redact/
    // correct/neutralize/flag events (the things that HAPPENED, not tokens).
    const totalEvents = byKind["destructive-gated"] + byKind["secret-redacted"] + byKind["injection-neutralized"] + byKind["claim-corrected"] + byKind["omission-flagged"];
    const price = Number(opts?.pricePer1k);
    const usdSaved = Number.isFinite(price) && price > 0 ? Math.round((tokensSaved / 1000) * price * 100) / 100 : null;
    const chainValid = verifyAxiaChain(list).ok;
    return {
      byKind, totalEvents, tokensSaved, usdSaved, chainValid,
      note: "Counts are signed facts — events Mneme GATED / SAVED / REDACTED / CORRECTED / FLAGGED. NOT 'attacks prevented' (a gate may be a false-positive co-sign) and NOT estimated $ damage (unprovable). The only $ is tokens-saved × your vendor's price-per-1k.",
    };
  } catch {
    return { byKind: { "tokens-saved": 0, "destructive-gated": 0, "secret-redacted": 0, "injection-neutralized": 0, "claim-corrected": 0, "omission-flagged": 0 }, totalEvents: 0, tokensSaved: 0, usdSaved: null, chainValid: true, note: "axia summary error — abstaining." };
  }
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface AxiaGauntlet {
  chainVerifiesOffline: boolean;
  tamperLocalized: boolean;
  countsByKind: boolean;
  usdOnlyFromUserRate: boolean;
  noDamageDollar: boolean;
  gatedNotPrevented: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function axiaGauntlet(): AxiaGauntlet {
  const events: Partial<AxiaEvent>[] = [
    { kind: "tokens-saved", count: 5000, source: "treasury" },
    { kind: "destructive-gated", count: 3, source: "heph" },
    { kind: "secret-redacted", count: 2, source: "egress" },
    { kind: "injection-neutralized", count: 1, source: "firewall" },
    { kind: "claim-corrected", count: 4, source: "savant" },
    { kind: "omission-flagged", count: 2, source: "elleipsis" },
  ];
  const led = buildAxiaLedger(events);

  const chainVerifiesOffline = verifyAxiaChain(led).ok === true;

  // tamper: mutate one record's count → chain breaks AT that seq.
  const tampered = led.map((r) => r.seq === 3 ? { ...r, event: { ...r.event, count: 999 } } : r);
  const tv = verifyAxiaChain(tampered);
  const tamperLocalized = tv.ok === false && tv.firstBrokenSeq === 3;

  const s = axiaSummary(led, { pricePer1k: 3 });
  const countsByKind = s.byKind["destructive-gated"] === 3 && s.byKind["secret-redacted"] === 2 && s.byKind["claim-corrected"] === 4 && s.tokensSaved === 5000
    && s.totalEvents === (3 + 2 + 1 + 4 + 2);
  // usd = 5000/1000 * 3 = 15.00, only because a price was supplied.
  const usdOnlyFromUserRate = s.usdSaved === 15 && axiaSummary(led).usdSaved === null;
  // there is no field that could carry an estimated damage figure.
  const noDamageDollar = !("damageUsd" in (s as object)) && !("damagePrevented" in (s as object)) && /NOT estimated \$ damage/.test(s.note);
  const gatedNotPrevented = /GATED/.test(s.note) && !/attacks prevented/i.test(JSON.stringify(s.byKind));

  const deterministic = JSON.stringify(axiaSummary(led, { pricePer1k: 3 })) === JSON.stringify(axiaSummary(led, { pricePer1k: 3 }));

  let total = true;
  try {
    buildAxiaLedger(null as unknown as AxiaEvent[]);
    axiaSummary(null as unknown as AxiaRecord[]);
    verifyAxiaChain(undefined as unknown as AxiaRecord[]);
    normalizeEvent({ kind: "bogus" as AxiaKind, count: -5, source: 123 as unknown as string });
    recordEvent("notahash", { kind: "tokens-saved", count: NaN }, 1);
  } catch { total = false; }

  const all = chainVerifiesOffline && tamperLocalized && countsByKind && usdOnlyFromUserRate && noDamageDollar
    && gatedNotPrevented && deterministic && total;
  return { chainVerifiesOffline, tamperLocalized, countsByKind, usdOnlyFromUserRate, noDamageDollar, gatedNotPrevented, deterministic, total, score: all ? 100 : 0 };
}
