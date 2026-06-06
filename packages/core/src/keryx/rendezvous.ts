/**
 * KERYX RENDEZVOUS — universal, zero-config provider pairing.
 *
 * The problem: Telegram is NAT-friendly (long-poll), but LINE / Slack / Discord / WhatsApp push taps
 * to a PUBLIC webhook — so a customer would have to stand up a server AND wire per-provider routing
 * (which bot ↔ which laptop). That kills "instant + zero-server".
 *
 * The move (the "crazy but real" part): a customer never pastes routing config. Their daemon mints a
 * short, SIGNED, single-use pairing code; the customer simply SENDS THAT CODE TO THEIR BOT from the
 * provider app itself. The shared relay's inbound webhook sees the code in the message + the
 * conversation identity, verifies it offline (HMAC + TTL + one-time), and LINKS that
 * (provider, conversation) ↔ daemon. The inbound message IS the routing — universal across every
 * provider that can receive text + fire a webhook, so a new provider needs zero new routing code.
 *
 * This module is the deterministic, signed, MEASURABLE brain of that flow (mint · match · link ·
 * route). The transport (the hosted relay that owns the public URL) is the ops layer on top — it
 * calls these pure functions; tampering, replay, expiry, and cross-daemon leakage all fail closed.
 *
 * ★HONEST (DIAKRISIS): this is the pairing PROTOCOL — verifiable + testable now. It does not, by
 * itself, deploy the multi-tenant relay or set a provider's webhook URL (those are ops steps). What
 * it guarantees: a code can only link the daemon that minted it, only once, only before it expires,
 * and an inbound event routes to exactly one daemon (or none) — provably.
 */
import { createHmac } from "node:crypto";

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford-ish (no I/L/O/U) — unambiguous to type
function b32(buf: Buffer, n: number): string { let s = ""; for (let i = 0; i < n; i++) s += B32[buf[i % buf.length] % 32]; return s; }
function hmac(secret: string, msg: string): string { return createHmac("sha256", secret || "mneme-rendezvous-v1").update(msg).digest("hex"); }

export interface PairingRecord { code: string; daemonId: string; provider: string; createdAt: number; exp: number; used: boolean; sig: string }
export interface MintOpts { now: number; ttlMs?: number; counter?: number; secret?: string }
/** Mint a short single-use pairing code bound (by HMAC) to one daemon + provider, with a TTL. */
export function mintPairingCode(daemonId: string, provider: string, opts: MintOpts): { code: string; record: PairingRecord } {
  const now = Number(opts?.now) || 0; const ttl = Number(opts?.ttlMs) || 10 * 60 * 1000; // 10 min default
  const counter = Number(opts?.counter) || 0; const secret = opts?.secret;
  const seed = `${daemonId}|${provider}|${now}|${counter}`;
  const code = "MNEME-" + b32(Buffer.from(hmac(secret ?? "mneme-rendezvous-v1", seed), "hex"), 6);
  const rec: PairingRecord = { code, daemonId: String(daemonId), provider: String(provider), createdAt: now, exp: now + ttl, used: false, sig: "" };
  rec.sig = hmac(secret ?? "mneme-rendezvous-v1", `${rec.code}|${rec.daemonId}|${rec.provider}|${rec.createdAt}|${rec.exp}`);
  return { code, record: rec };
}
function recordValid(rec: PairingRecord, secret?: string): boolean {
  if (!rec || typeof rec !== "object") return false;
  const want = hmac(secret ?? "mneme-rendezvous-v1", `${rec.code}|${rec.daemonId}|${rec.provider}|${rec.createdAt}|${rec.exp}`);
  return rec.sig === want;
}

export interface MatchResult { ok: boolean; daemonId?: string; provider?: string; code?: string; reason: string }
/** Given an inbound message text + the known pairing records, find & verify a code (HMAC·TTL·one-time).
 *  `skipSig` is for the RELAY, which trusts records that arrived via authenticated pair-register and
 *  cannot hold each daemon's minting secret — it still enforces TTL + one-time; the minting daemon
 *  re-verifies the HMAC when it drains the link. */
export function matchPairingCode(text: string, records: ReadonlyArray<PairingRecord>, opts: { now: number; secret?: string; provider?: string; skipSig?: boolean }): MatchResult {
  const up = String(text ?? "").toUpperCase();
  const now = Number(opts?.now) || 0;
  for (const rec of records ?? []) {
    if (!rec?.code || !up.includes(rec.code)) continue;
    if (!opts?.skipSig && !recordValid(rec, opts?.secret)) return { ok: false, code: rec.code, reason: "forged record (HMAC mismatch)" };
    if (rec.used) return { ok: false, code: rec.code, reason: "code already used (replay)" };
    if (now > rec.exp) return { ok: false, code: rec.code, reason: "code expired" };
    if (opts?.provider && opts.provider !== rec.provider) return { ok: false, code: rec.code, reason: `code is for ${rec.provider}, not ${opts.provider}` };
    return { ok: true, daemonId: rec.daemonId, provider: rec.provider, code: rec.code, reason: "ok" };
  }
  return { ok: false, reason: "no known pairing code in the message" };
}
/** Mark a record used (immutable) — call after a successful match so the code can't be replayed. */
export function consume(records: ReadonlyArray<PairingRecord>, code: string): PairingRecord[] {
  return (records ?? []).map((r) => (r.code === code ? { ...r, used: true } : r));
}

export interface PairLink { daemonId: string; provider: string; conversation: string; at: number }
export interface LinkTable { links: PairLink[] }
export function emptyLinkTable(): LinkTable { return { links: [] }; }
/** Record the (provider, conversation) ↔ daemon link learned from a verified pairing. Idempotent. */
export function link(table: LinkTable, m: { daemonId?: string; provider?: string }, conversation: string, now: number): LinkTable {
  const links = [...(table?.links ?? [])];
  const daemonId = String(m?.daemonId ?? ""), provider = String(m?.provider ?? ""), conv = String(conversation ?? "");
  if (!daemonId || !provider || !conv) return { links };
  const i = links.findIndex((l) => l.provider === provider && l.conversation === conv);
  const entry: PairLink = { daemonId, provider, conversation: conv, at: Number(now) || 0 };
  if (i >= 0) links[i] = entry; else links.push(entry);   // a conversation maps to ONE daemon (latest pairing wins)
  return { links };
}
/** An inbound provider event → which daemon owns it (by provider + conversation). */
export function routeInbound(table: LinkTable, provider: string, conversation: string): string | null {
  const l = (table?.links ?? []).find((x) => x.provider === provider && x.conversation === String(conversation)); return l ? l.daemonId : null;
}
/** A daemon wants to push to a provider → the conversation(s) to send to. */
export function routeOutbound(table: LinkTable, daemonId: string, provider: string): string[] {
  return (table?.links ?? []).filter((x) => x.daemonId === daemonId && x.provider === provider).map((x) => x.conversation);
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface RendezvousGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function rendezvousGauntlet(): RendezvousGauntlet {
  const S = "test-secret"; const T0 = 1_000_000;
  const PROVIDERS = ["line", "slack", "discord", "whatsapp", "telegram"];
  // full lifecycle for EVERY provider: mint → send code → match → link → route both ways
  let allProvidersOK = true; let table = emptyLinkTable(); let records: PairingRecord[] = [];
  PROVIDERS.forEach((p, i) => {
    const { code, record } = mintPairingCode("daemonA", p, { now: T0, secret: S, counter: i });
    records.push(record);
    const m = matchPairingCode(`hi please link ${code} thanks`, records, { now: T0 + 1000, secret: S, provider: p });
    if (!m.ok || m.daemonId !== "daemonA" || m.provider !== p) { allProvidersOK = false; return; }
    records = consume(records, code);
    table = link(table, m, `conv-${p}`, T0 + 1000);
    if (routeInbound(table, p, `conv-${p}`) !== "daemonA") allProvidersOK = false;
    if (routeOutbound(table, "daemonA", p)[0] !== `conv-${p}`) allProvidersOK = false;
  });

  // reject: expired
  const { code: ec, record: er } = mintPairingCode("d", "line", { now: T0, ttlMs: 1000, secret: S });
  const expired = matchPairingCode(ec, [er], { now: T0 + 5000, secret: S });
  // reject: replay (used)
  const { code: rc, record: rr } = mintPairingCode("d", "line", { now: T0, secret: S, counter: 9 });
  const replay = matchPairingCode(rc, consume([rr], rc), { now: T0 + 100, secret: S });
  // reject: forged (tampered daemonId after signing)
  const { record: fr } = mintPairingCode("d", "line", { now: T0, secret: S, counter: 7 });
  const forged = matchPairingCode(fr.code, [{ ...fr, daemonId: "attacker" }], { now: T0 + 100, secret: S });
  // reject: unknown code
  const unknown = matchPairingCode("MNEME-ZZZZZZ", records, { now: T0 + 100, secret: S });
  // isolation: daemonB's inbound never routes to daemonA
  let t2 = emptyLinkTable();
  const a = mintPairingCode("A", "line", { now: T0, secret: S, counter: 21 });
  const b = mintPairingCode("B", "line", { now: T0, secret: S, counter: 22 });
  const ma = matchPairingCode(a.code, [a.record, b.record], { now: T0 + 1, secret: S });
  const mb = matchPairingCode(b.code, [a.record, b.record], { now: T0 + 1, secret: S });
  t2 = link(t2, ma, "convA", T0); t2 = link(t2, mb, "convB", T0);
  const isolationOK = routeInbound(t2, "line", "convA") === "A" && routeInbound(t2, "line", "convB") === "B";

  const total = (() => { try { matchPairingCode(null as never, null as never, { now: 0 }); link(null as never, {}, "", 0); routeInbound(null as never, "x", "y"); mintPairingCode("", "", { now: 0 }); return true; } catch { return false; } })();

  const checks = [
    { name: "EVERY-PROVIDER-LIFECYCLE", pass: allProvidersOK, detail: "mint→send-code→match→link→route both ways works identically for line/slack/discord/whatsapp/telegram (one code, any app)" },
    { name: "REJECT-EXPIRED", pass: !expired.ok && expired.reason.includes("expired"), detail: "a code past its TTL never links" },
    { name: "REJECT-REPLAY", pass: !replay.ok && replay.reason.includes("used"), detail: "a used code can't be replayed" },
    { name: "REJECT-FORGED", pass: !forged.ok && forged.reason.includes("forged"), detail: "tampering the record (HMAC mismatch) is caught" },
    { name: "REJECT-UNKNOWN", pass: !unknown.ok, detail: "a code that was never minted links nothing" },
    { name: "CROSS-DAEMON-ISOLATION", pass: isolationOK, detail: "daemon B's conversation never routes to daemon A — multi-tenant safe" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
