/**
 * KERYX provider adapters — OUTBOUND send + cross-provider CLEAR for each chat.
 *
 * The agent's ask fans out to EVERY configured provider at once (buttons carry the
 * `keryx:<id>:<answer>` token). When the human answers on one, `clearOthers` edits the
 * message on Telegram/Slack/Discord (buttons vanish) and posts a follow-up on LINE/WhatsApp
 * (no edit API). A late tap anywhere is ignored — the answer is one-time (first wins).
 *
 * ★HONEST: payloads follow each provider's documented API; validate live with YOUR token.
 */
import * as https from "node:https";

export interface ProviderCfg { token?: string; chatId?: string; channel?: string; to?: string; phoneId?: string; channelId?: string; channelSecret?: string }

/** LINE: mint a short-lived channel access token from channelId + channelSecret (so the user
 *  only needs those two — no token-hunting). Returns "" on failure. */
function mintLineToken(channelId: string, channelSecret: string): Promise<string> {
  return new Promise((resolve) => {
    const form = `grant_type=client_credentials&client_id=${encodeURIComponent(channelId)}&client_secret=${encodeURIComponent(channelSecret)}`;
    const req = https.request({ hostname: "api.line.me", path: "/v2/oauth/accessToken", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(form) }, timeout: 15000 },
      (res) => { let s = ""; res.on("data", (d) => (s += d)); res.on("end", () => { try { resolve(String(JSON.parse(s).access_token ?? "")); } catch { resolve(""); } }); });
    req.on("error", () => resolve("")); req.on("timeout", () => { req.destroy(); resolve(""); });
    req.write(form); req.end();
  });
}
async function lineToken(cfg: ProviderCfg): Promise<string> { return cfg.token || (cfg.channelId && cfg.channelSecret ? await mintLineToken(cfg.channelId, cfg.channelSecret) : ""); }
export interface ProvidersConfig { telegram?: ProviderCfg; slack?: ProviderCfg; discord?: ProviderCfg; line?: ProviderCfg; whatsapp?: ProviderCfg }

function httpsJson(host: string, path: string, headers: Record<string, string>, body: object): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({ hostname: host, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers }, timeout: 15000 },
      (res) => { let s = ""; res.on("data", (d) => (s += d)); res.on("end", () => { let j = {}; try { j = JSON.parse(s); } catch { /* */ } resolve({ status: res.statusCode ?? 500, json: j }); }); });
    req.on("error", () => resolve({ status: 0, json: {} })); req.on("timeout", () => { req.destroy(); resolve({ status: 0, json: {} }); });
    req.write(data); req.end();
  });
}

export interface AskSpec { id: string; nonce: string; question: string; kind: "approve" | "choice" | "text"; choices?: string[]; agent: string }
/** options as [label, answerToken] pairs for buttons. */
function options(spec: AskSpec): Array<[string, string]> {
  if (spec.kind === "approve") return [["✅ Yes", `keryx:${spec.id}:allow`], ["⛔ No", `keryx:${spec.id}:deny`]];
  if (spec.kind === "choice") return (spec.choices ?? []).map((c) => [c, `keryx:${spec.id}:${c}`]);
  return []; // text → no buttons; the user replies free-text
}
const title = (spec: AskSpec) => `❓ ${spec.agent} asks${spec.kind === "text" ? " (reply with your answer)" : ""}:\n${spec.question}`;
/** Compact one-line card text (for LINE template / WhatsApp body, which have tight limits). */
const cardText = (spec: AskSpec, max: number) => `${spec.agent ? "🤖 " + spec.agent + ": " : ""}${spec.question}`.slice(0, max);

/** Send the ask to ONE provider. Returns the provider message id (for later clearing). */
export async function sendAsk(provider: string, cfg: ProviderCfg, spec: AskSpec): Promise<{ ok: boolean; messageId?: string; reason?: string }> {
  const lineCreds = provider === "line" && (cfg?.token || (cfg?.channelId && cfg?.channelSecret));
  if (!cfg?.token && !lineCreds) return { ok: false, reason: "no token" };
  const opts = options(spec);
  try {
    if (provider === "telegram") {
      const kb = spec.kind === "text" ? { force_reply: true } : { inline_keyboard: opts.map(([t, d]) => [{ text: t, callback_data: d }]) };
      const r = await httpsJson("api.telegram.org", `/bot${cfg.token}/sendMessage`, {}, { chat_id: cfg.chatId, text: title(spec), reply_markup: kb });
      return { ok: !!(r.json.ok), messageId: String((r.json.result as { message_id?: number })?.message_id ?? "") };
    }
    if (provider === "slack") {
      const blocks = [{ type: "section", text: { type: "mrkdwn", text: title(spec) } }, ...(opts.length ? [{ type: "actions", elements: opts.map(([t, d]) => ({ type: "button", text: { type: "plain_text", text: t }, value: d, action_id: d })) }] : [])];
      const r = await httpsJson("slack.com", "/api/chat.postMessage", { authorization: `Bearer ${cfg.token}` }, { channel: cfg.channel, text: title(spec), blocks });
      return { ok: !!(r.json.ok), messageId: String(r.json.ts ?? "") };
    }
    if (provider === "discord") {
      const components = opts.length ? [{ type: 1, components: opts.slice(0, 5).map(([t, d]) => ({ type: 2, style: 1, label: t.slice(0, 80), custom_id: d.slice(0, 100) })) }] : [];
      const r = await httpsJson("discord.com", `/api/v10/channels/${cfg.channel}/messages`, { authorization: `Bot ${cfg.token}` }, { content: title(spec), components });
      return { ok: r.status < 300, messageId: String(r.json.id ?? "") };
    }
    if (provider === "line") {
      const token = await lineToken(cfg); if (!token) return { ok: false, reason: "LINE token mint failed (check channelId/secret)" };
      const actions = opts.length ? opts.slice(0, 4).map(([t, d]) => ({ type: "postback", label: t.slice(0, 20), data: d, displayText: t })) : [{ type: "message", label: "reply", text: "(type your answer)" }];
      const msg = opts.length ? { type: "template", altText: spec.question, template: { type: "buttons", text: cardText(spec, 160), actions } } : { type: "text", text: title(spec) };
      // push to a specific user if `to` is set; else broadcast to all friends (personal bot)
      const path = cfg.to ? "/v2/bot/message/push" : "/v2/bot/message/broadcast";
      const payload = cfg.to ? { to: cfg.to, messages: [msg] } : { messages: [msg] };
      const r = await httpsJson("api.line.me", path, { authorization: `Bearer ${token}` }, payload);
      return { ok: r.status < 300, messageId: "", reason: r.status < 300 ? undefined : `HTTP ${r.status}` }; // LINE push/broadcast has no editable id
    }
    if (provider === "whatsapp") {
      const interactive = opts.length ? { type: "button", body: { text: cardText(spec, 1024) }, action: { buttons: opts.slice(0, 3).map(([t, d]) => ({ type: "reply", reply: { id: d.slice(0, 256), title: t.slice(0, 20) } })) } } : null;
      const msg = interactive ? { messaging_product: "whatsapp", to: cfg.to, type: "interactive", interactive } : { messaging_product: "whatsapp", to: cfg.to, type: "text", text: { body: title(spec) } };
      const r = await httpsJson("graph.facebook.com", `/v20.0/${cfg.phoneId}/messages`, { authorization: `Bearer ${cfg.token}` }, msg);
      return { ok: r.status < 300, messageId: "" };
    }
    return { ok: false, reason: "unknown provider" };
  } catch (e) { return { ok: false, reason: (e as Error).message }; }
}

/** Clear / mark-answered on the providers the human did NOT answer on. Edits where possible. */
export async function clearMessage(provider: string, cfg: ProviderCfg, messageId: string, answeredOn: string): Promise<void> {
  // ROOT-CAUSE FIX: LINE has no pre-set `token` (it mints one from channelId+secret) — the old
  // `if (!cfg?.token) return` silently killed every LINE clear. Allow LINE's minted-credential path.
  const lineCreds = provider === "line" && (cfg?.token || (cfg?.channelId && cfg?.channelSecret));
  if (!cfg?.token && !lineCreds) return;
  // Telegram/Slack/Discord can EDIT the original message away; LINE/WhatsApp cannot delete their own
  // buttons (no edit/delete API), so tell the human the buttons above are now inactive.
  const editable = provider === "telegram" || provider === "slack" || provider === "discord";
  const note = editable
    ? `✅ answered on ${answeredOn} — this request is closed.`
    : `✅ answered on ${answeredOn} — this request is closed. (the Yes/No buttons above are now inactive — please ignore them.)`;
  try {
    if (provider === "telegram" && messageId) { await httpsJson("api.telegram.org", `/bot${cfg.token}/editMessageText`, {}, { chat_id: cfg.chatId, message_id: Number(messageId), text: note }); return; }
    if (provider === "slack" && messageId) { await httpsJson("slack.com", "/api/chat.update", { authorization: `Bearer ${cfg.token}` }, { channel: cfg.channel, ts: messageId, text: note, blocks: [] }); return; }
    if (provider === "discord" && messageId) { await httpsJson("discord.com", `/api/v10/channels/${cfg.channel}/messages/${messageId}`, { authorization: `Bot ${cfg.token}` }, { content: note, components: [] }); return; }
    if (provider === "line") { const token = await lineToken(cfg); if (!token) return; const path = cfg.to ? "/v2/bot/message/push" : "/v2/bot/message/broadcast"; const payload = cfg.to ? { to: cfg.to, messages: [{ type: "text", text: note }] } : { messages: [{ type: "text", text: note }] }; await httpsJson("api.line.me", path, { authorization: `Bearer ${token}` }, payload); return; }
    if (provider === "whatsapp") { await httpsJson("graph.facebook.com", `/v20.0/${cfg.phoneId}/messages`, { authorization: `Bearer ${cfg.token}` }, { messaging_product: "whatsapp", to: cfg.to, type: "text", text: { body: note } }); return; }
  } catch { /* clearing is best-effort */ }
}
