/**
 * THE PROVIDER WEB (ใยแมงมุม) — a spider's web of chat providers where new threads spin themselves in.
 *
 * The crazy-but-real idea: a chat provider should NOT be code baked into the core. It should be a
 * thread of silk — a small DECLARATIVE descriptor (what it can do, how to send a button, how to read
 * a tap, how to clear) — and the web should route asks out across every thread and feel a tap come
 * back on ANY of them, including a thread that didn't exist when this version shipped. Add WeChat /
 * Mastodon / a Matrix.org room / a corporate webhook by declaring its silk; touch no core, ship no
 * release. The web is the spider's nervous system; the Approval Matrix is its first-wins reflex.
 *
 * Why this is the right shape, not just a metaphor:
 *  • capability-negotiated — a thread that can't edit a message gets a follow-up "answered" note
 *    instead; a thread with no buttons is read by its text reply. The matrix never branches on a
 *    provider name; it asks the web "what can this thread do?".
 *  • declarative inbound — every provider packs a tap differently (Telegram `callback_query.data`,
 *    WeChat `Content`, a webhook `payload.choice`). A silk declares dot-paths + an optional value
 *    map, so one harvester parses them all. New shapes = new data, not new branches.
 *  • runtime-weavable — a signed silk descriptor can be ingested live, so the web grows a thread
 *    without a deploy (the verify hook keeps an unsigned/forged thread out).
 *
 * Pure + deterministic; the actual HTTP send/edit is the provider adapter's job at the CLI edge.
 * Composes with the Approval Matrix: the web supplies the surfaces + how to clear each; the matrix
 * supplies the authoritative ticket + first-wins.
 */

export type InboundTransport = "webhook" | "longpoll";
export type VerifyScheme = "hmac" | "signature" | "challenge" | "none";
export interface SilkCapabilities { buttons: boolean; edit: boolean; inbound: InboundTransport; verify: VerifyScheme }

/** How to pull {id, answer} out of THIS provider's inbound payload — dot-paths + optional shaping. */
export interface SilkParse {
  answerPath: string;                  // dot-path to the answer / button-data (required)
  idPath?: string;                     // dot-path to the request id (omit if packed into the answer)
  combinedSep?: string;                // answer+id packed together (Telegram "allow:t1") → split → [answer, id]
  answerMap?: Record<string, string>;  // provider value → canonical, e.g. { yes: "allow", no: "deny", "1": "allow" }
}

/** A thread of the web — everything needed to talk to one provider, declared, not coded. */
export interface ProviderSilk {
  provider: string;                    // "wechat"
  label?: string;                      // human label
  capabilities: SilkCapabilities;
  parse: SilkParse;
  endpoints?: { send?: string; edit?: string };   // optional URL templates ({token},{chat},{id})
  addedAt?: number; signed?: boolean;
}

function dot(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return String(path).split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export interface SilkValid { ok: boolean; reasons: string[] }
export function validateSilk(silk: unknown): SilkValid {
  const reasons: string[] = [];
  const s = silk as ProviderSilk;
  if (!s || typeof s !== "object") return { ok: false, reasons: ["not a silk descriptor"] };
  if (!s.provider || typeof s.provider !== "string") reasons.push("missing provider name");
  if (!s.capabilities || typeof s.capabilities !== "object") reasons.push("missing capabilities");
  else if (!["webhook", "longpoll"].includes(s.capabilities.inbound)) reasons.push("capabilities.inbound must be webhook|longpoll");
  if (!s.parse || typeof s.parse !== "object" || !s.parse.answerPath) reasons.push("parse.answerPath is required (how to read a tap)");
  return { ok: reasons.length === 0, reasons };
}

export interface ProviderWeb { threads: Record<string, ProviderSilk> }
export function emptyWeb(): ProviderWeb { return { threads: {} }; }

export interface WeaveResult { web: ProviderWeb; woven: boolean; reasons: string[] }
/** Spin a new thread into the web (idempotent by provider; last valid wins). */
export function weave(web: ProviderWeb, silk: ProviderSilk, opts?: { now?: number }): WeaveResult {
  const v = validateSilk(silk);
  if (!v.ok) return { web, woven: false, reasons: v.reasons };
  const threads = { ...(web?.threads ?? {}), [silk.provider]: { ...silk, addedAt: silk.addedAt ?? opts?.now ?? 0 } };
  return { web: { threads }, woven: true, reasons: [] };
}
/** Ingest a (optionally signed) descriptor at RUNTIME — the web grows a thread with no redeploy.
 *  `verify` is the caller's signature check; when required, an unsigned/forged descriptor is refused. */
export function ingestDescriptor(web: ProviderWeb, descriptor: ProviderSilk, opts?: { requireSigned?: boolean; verify?: (d: ProviderSilk) => boolean; now?: number }): WeaveResult {
  if (opts?.requireSigned) { const ok = !!opts.verify && opts.verify(descriptor); if (!ok) return { web, woven: false, reasons: ["descriptor signature not verified — refusing to weave an untrusted thread"] }; }
  return weave(web, { ...descriptor, signed: !!opts?.requireSigned }, { now: opts?.now });
}

export function threads(web: ProviderWeb): ProviderSilk[] { return Object.values(web?.threads ?? {}); }
export function silkOf(web: ProviderWeb, provider: string): ProviderSilk | undefined { return web?.threads?.[provider]; }

export interface RoutePlan { send: string[]; skipped: Array<{ provider: string; reason: string }> }
/** Which threads an ask goes out on. Default = every woven thread. A requested subset is honored;
 *  a requested provider that isn't woven is skipped + reported (never a silent drop). */
export function routePlan(web: ProviderWeb, requested?: ReadonlyArray<string> | null): RoutePlan {
  const woven = new Set(Object.keys(web?.threads ?? {}));
  if (!requested || requested.length === 0) return { send: [...woven], skipped: [] };
  const send: string[] = []; const skipped: RoutePlan["skipped"] = [];
  for (const p of requested) { if (woven.has(p)) send.push(p); else skipped.push({ provider: p, reason: "no thread woven for this provider — declare its silk first" }); }
  return { send, skipped };
}

export interface Harvested { ok: boolean; id: string | null; answer: string | null; provider: string; reason: string }
/** Read a tap from ANY provider's inbound payload using its declared silk — one harvester for all. */
export function harvestInbound(web: ProviderWeb, provider: string, payload: unknown): Harvested {
  const silk = silkOf(web, provider);
  if (!silk) return { ok: false, id: null, answer: null, provider, reason: "no thread woven for this provider" };
  const p = silk.parse;
  let answer = dot(payload, p.answerPath);
  let id: unknown = p.idPath ? dot(payload, p.idPath) : undefined;
  if (p.combinedSep && typeof answer === "string" && answer.includes(p.combinedSep)) {
    const parts = answer.split(p.combinedSep); answer = parts[0]; if (id === undefined) id = parts[1];
  }
  let a = answer === undefined || answer === null ? null : String(answer).trim();
  if (a && p.answerMap && p.answerMap[a] !== undefined) a = p.answerMap[a];
  const i = id === undefined || id === null ? null : String(id).trim();
  if (!a) return { ok: false, id: i, answer: null, provider, reason: "could not read an answer at the declared path" };
  return { ok: true, id: i, answer: a, provider, reason: "harvested" };
}

/** Capability-negotiated clear method for a thread: edit-in-place if it can, else a follow-up note. */
export function clearMethodFor(web: ProviderWeb, provider: string): "edit" | "notify" {
  return silkOf(web, provider)?.capabilities.edit ? "edit" : "notify";
}

/** The six first-class threads Mneme ships woven by default (real providers + the computer). */
export function defaultWeb(now = 0): ProviderWeb {
  const silks: ProviderSilk[] = [
    { provider: "telegram", capabilities: { buttons: true, edit: true, inbound: "longpoll", verify: "none" }, parse: { answerPath: "callback_query.data", combinedSep: ":", answerMap: { yes: "allow", no: "deny", approve: "allow", deny: "deny" } } },
    { provider: "slack", capabilities: { buttons: true, edit: true, inbound: "webhook", verify: "signature" }, parse: { answerPath: "actions.0.value", idPath: "callback_id", answerMap: { yes: "allow", no: "deny" } } },
    { provider: "discord", capabilities: { buttons: true, edit: true, inbound: "webhook", verify: "signature" }, parse: { answerPath: "data.custom_id", combinedSep: ":", answerMap: { yes: "allow", no: "deny" } } },
    { provider: "line", capabilities: { buttons: true, edit: false, inbound: "webhook", verify: "hmac" }, parse: { answerPath: "events.0.postback.data", combinedSep: ":", answerMap: { yes: "allow", no: "deny" } } },
    { provider: "whatsapp", capabilities: { buttons: true, edit: false, inbound: "webhook", verify: "challenge" }, parse: { answerPath: "entry.0.changes.0.value.messages.0.button.text", answerMap: { yes: "allow", no: "deny", approve: "allow" } } },
    { provider: "computer", capabilities: { buttons: true, edit: true, inbound: "longpoll", verify: "none" }, parse: { answerPath: "answer", idPath: "id" } },
  ];
  let web = emptyWeb();
  for (const s of silks) web = weave(web, s, { now }).web;
  return web;
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ProviderWebGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function providerWebGauntlet(): ProviderWebGauntlet {
  const web = defaultWeb(1);

  const defaultOK = threads(web).length === 6 && !!silkOf(web, "computer") && !!silkOf(web, "whatsapp");

  // a real Telegram tap (packed "allow:t1") harvests to {id:t1, answer:allow}
  const tg = harvestInbound(web, "telegram", { callback_query: { data: "allow:t1" } });
  const tgOK = tg.ok && tg.id === "t1" && tg.answer === "allow";
  // a value map normalizes provider words ("yes" → allow) on LINE postback
  const ln = harvestInbound(web, "line", { events: [{ postback: { data: "yes:t9" } }] });
  const lnOK = ln.ok && ln.answer === "allow" && ln.id === "t9";

  // ★ THE WHOLE POINT: a FUTURE provider (WeChat) plugs in by DECLARING silk — zero core change
  const wechat: ProviderSilk = { provider: "wechat", label: "WeChat", capabilities: { buttons: false, edit: false, inbound: "webhook", verify: "signature" }, parse: { answerPath: "Content", idPath: "MsgId", answerMap: { "同意": "allow", "拒绝": "deny", yes: "allow" } } };
  const woven = weave(web, wechat, { now: 2 });
  const wc = harvestInbound(woven.web, "wechat", { MsgId: "m42", Content: "同意" });
  const wechatOK = woven.woven && wc.ok && wc.answer === "allow" && wc.id === "m42" && clearMethodFor(woven.web, "wechat") === "notify";

  // routePlan: default = all; subset honored; unknown provider skipped + reported
  const rDefault = routePlan(web);
  const rSubset = routePlan(web, ["line", "whatsapp"]);
  const rUnknown = routePlan(web, ["line", "mastodon"]);
  const routeOK = rDefault.send.length === 6 && rSubset.send.sort().join() === ["line", "whatsapp"].join()
    && rUnknown.send.join() === "line" && rUnknown.skipped[0]?.provider === "mastodon";

  // capability negotiation: editable vs not
  const capOK = clearMethodFor(web, "telegram") === "edit" && clearMethodFor(web, "line") === "notify" && clearMethodFor(web, "whatsapp") === "notify";

  // validate rejects a broken silk; harvest fails cleanly on an unwoven provider / bad payload
  const badSilk = validateSilk({ provider: "x" });
  const validOK = !badSilk.ok && badSilk.reasons.some((r) => r.includes("answerPath")) && validateSilk(wechat).ok;
  const missOK = harvestInbound(web, "telegram", { callback_query: {} }).ok === false && harvestInbound(web, "nope", {}).ok === false;

  // runtime ingest: required-signed refuses an unverified descriptor, accepts a verified one
  const refused = ingestDescriptor(web, wechat, { requireSigned: true, verify: () => false });
  const accepted = ingestDescriptor(web, wechat, { requireSigned: true, verify: () => true, now: 3 });
  const ingestOK = !refused.woven && refused.reasons[0].includes("signature") && accepted.woven && accepted.web.threads.wechat.signed === true;

  const total = (() => { try { weave(null as never, null as never); harvestInbound(null as never, "x", null); routePlan(null as never, null); validateSilk(null); clearMethodFor(emptyWeb(), "x"); return true; } catch { return false; } })();

  const checks = [
    { name: "DEFAULT-SIX-THREADS", pass: defaultOK, detail: "telegram/slack/discord/line/whatsapp/computer woven by default" },
    { name: "HARVEST-TELEGRAM", pass: tgOK, detail: "packed 'allow:t1' callback → {id:t1, answer:allow} via declared paths" },
    { name: "HARVEST-VALUE-MAP", pass: lnOK, detail: "LINE 'yes' normalized to 'allow' by the silk's answerMap" },
    { name: "FUTURE-PROVIDER-AUTO-PLUG", pass: wechatOK, detail: "WeChat plugs in by DECLARING silk (Chinese button words mapped) — zero core change" },
    { name: "ROUTE-DEFAULT-SUBSET-UNKNOWN", pass: routeOK, detail: "default routes all; subset honored; an unwoven provider is skipped + reported" },
    { name: "CAPABILITY-NEGOTIATION", pass: capOK, detail: "editable threads edit-in-place; others get a follow-up note" },
    { name: "VALIDATE+MISS-SAFE", pass: validOK && missOK, detail: "a broken silk is rejected; a bad/unwoven payload fails cleanly (no throw)" },
    { name: "RUNTIME-SIGNED-INGEST", pass: ingestOK, detail: "a signed descriptor weaves live; an unverified one is refused" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
