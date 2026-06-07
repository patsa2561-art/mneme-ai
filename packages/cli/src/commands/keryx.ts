/**
 * `mneme keryx` (v2.213.0) — KERYX, the gate-as-a-service relay protocol surface.
 * The PROTOCOL is shipped + measured (keryxGauntlet=100). The hosted relay server + per-
 * provider webhook adapters (LINE / Slack / Discord) deploy on top of `gephyra serve`.
 *   keryx demo            — show a signed ask/answer envelope round-trip
 *   keryx verify <file>   — verify an envelope JSON offline (needs --secret)
 *   keryx status          — protocol + gauntlet status
 */
import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as https from "node:https";
import * as http from "node:http";
import { keryx, providerWeb, rendezvous } from "@mneme-ai/core";
import { createHmac } from "node:crypto";
import { sendAsk, clearMessage, type ProvidersConfig, type ProviderCfg, type AskSpec } from "./keryx_providers.js";

function out(s: string): void { process.stdout.write(s + "\n"); }
/** Name shown in the chat = the AI agent the user actually runs (auto-detected), else "Mneme-AI". */
export function detectAgent(): string {
  const e = process.env;
  if (e.CLAUDECODE || e.CLAUDE_CODE) return "Claude Code";
  if (e.CURSOR_AGENT || e.CURSOR_TRACE_ID) return "Cursor";
  if (e.GROK || e.XAI_API_KEY) return "Grok";
  if (e.GEMINI_CLI || e.GEMINI_API_KEY) return "Gemini";
  if (e.AIDER || e.AIDER_MODEL) return "Aider";
  if (e.CODEX || e.CODEX_SANDBOX) return "Codex";
  if (e.CONTINUE) return "Continue";
  if (e.CLINE) return "Cline";
  return "Mneme-AI";
}
const provPath = (cwd: string) => join(cwd, ".mneme", "keryx", "providers.json");
const bcastPath = (cwd: string) => join(cwd, ".mneme", "keryx", "broadcasts.json");
function loadProviders(cwd: string): ProvidersConfig { try { return existsSync(provPath(cwd)) ? JSON.parse(readFileSync(provPath(cwd), "utf8")) : {}; } catch { return {}; } }
/** A provider is connected if it has a token — OR (LINE) a channelId+secret to mint one from. */
function isConnected(p: string, pc?: ProviderCfg): boolean { return !!(pc && (pc.token || (p === "line" && pc.channelId && pc.channelSecret))); }
interface Bcast { id: string; nonce: string; sent: Array<{ provider: string; messageId: string }>; answered: string | null; answer?: string }
function loadBcasts(cwd: string): Bcast[] { try { return existsSync(bcastPath(cwd)) ? JSON.parse(readFileSync(bcastPath(cwd), "utf8")) : []; } catch { return []; } }
function saveBcasts(cwd: string, b: Bcast[]): void { mkdirSync(join(cwd, ".mneme", "keryx"), { recursive: true }); writeFileSync(bcastPath(cwd), JSON.stringify(b, null, 2), "utf8"); }
const mod = (url: string) => (url.startsWith("https:") ? https : http);
function getJson(url: string): Promise<Record<string, unknown>> { return new Promise((res) => { mod(url).get(url, (r) => { let s = ""; r.on("data", (d) => (s += d)); r.on("end", () => { try { res(JSON.parse(s || "{}")); } catch { res({}); } }); }).on("error", () => res({})); }); }
function postJson(url: string, body: object): Promise<Record<string, unknown>> { return new Promise((res) => { const u = new URL(url); const data = JSON.stringify(body); const r = mod(url).request({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (x) => { let s = ""; x.on("data", (d) => (s += d)); x.on("end", () => { try { res(JSON.parse(s || "{}")); } catch { res({}); } }); }); r.on("error", () => res({})); r.write(data); r.end(); }); }

export function registerKeryxCommands(program: Command): void {
  const k = program.command("keryx").description("🏛 KERYX — the herald: a dumb, signed relay so ANY chat (LINE/Slack/Discord/Telegram) can reach your local agent behind NAT. Only a summary+hash crosses; answers are signed + replay-proof.");

  k.command("status", { isDefault: true }).description("Protocol + gauntlet status.").action(() => {
    const g = keryx.keryxGauntlet();
    out(`🏛 KERYX protocol — gauntlet ${g.score}/100 (${g.checks.filter((c) => c.pass).length}/${g.checks.length}). Channel-agnostic, signed, replay-proof, raw-free.`);
    out("   Deploy the relay on `gephyra serve` (your DO droplet); the daemon connects OUT (behind NAT). See docs/KERYX.md.");
  });

  k.command("connect <provider>").description("🔗 ZERO-CONFIG PAIR — link LINE/Slack/Discord/WhatsApp (any provider) by SENDING ONE CODE to your bot from the app itself. No webhook config, no server. The relay sees the code inbound + links this machine. Run via your AI agent — just say which app.")
    .option("--relay <url>", "the hosted Keryx relay (defaults to your configured one)")
    .option("--ttl <min>", "code lifetime in minutes (default 10)")
    .action(async (provider: string, o: { relay?: string; ttl?: string }) => {
      const cwd = process.cwd(); const dir = join(cwd, ".mneme", "keryx"); mkdirSync(dir, { recursive: true });
      // stable per-machine daemon id (multi-tenant routing key) + a local signing secret
      const idPath = join(dir, "daemon-id"); let daemonId = "";
      try { daemonId = existsSync(idPath) ? readFileSync(idPath, "utf8").trim() : ""; } catch { /* */ }
      if (!daemonId) { daemonId = "d-" + createHmac("sha256", "mneme-daemon-id").update(cwd + "|" + Date.now()).digest("hex").slice(0, 12); writeFileSync(idPath, daemonId, "utf8"); }
      const secPath = join(dir, "rendezvous-secret"); let secret = "";
      try { secret = existsSync(secPath) ? readFileSync(secPath, "utf8").trim() : ""; } catch { /* */ }
      if (!secret) { secret = createHmac("sha256", "mneme-rdv").update(daemonId + "|" + Date.now()).digest("hex"); writeFileSync(secPath, secret, "utf8"); }
      const ttlMs = (Number(o.ttl) || 10) * 60_000;
      // counter from existing pairings (deterministic, no Math.random)
      const pPath = join(dir, "pairings.json"); let recs: rendezvous.PairingRecord[] = [];
      try { recs = existsSync(pPath) ? JSON.parse(readFileSync(pPath, "utf8")) : []; } catch { /* */ }
      const { code, record } = rendezvous.mintPairingCode(daemonId, provider, { now: Date.now(), ttlMs, secret, counter: recs.length });
      recs.push(record); writeFileSync(pPath, JSON.stringify(recs, null, 2), "utf8");
      // register with the relay so its inbound webhook can match the code (best-effort — ops layer)
      const cfg = loadProviders(cwd) as unknown as { keryxRelay?: string };
      let relay = o.relay || cfg.keryxRelay || "";
      try { const pc = JSON.parse(readFileSync(join(cwd, ".mneme", "pager", "config.json"), "utf8")); relay = o.relay || cfg.keryxRelay || pc.keryxRelay || ""; } catch { /* */ }
      let registered = false;
      if (relay) { const r = await postJson(`${relay.replace(/\/$/, "")}/keryx/pair-register`, { daemonId, record, key: secret }); registered = !!(r && (r.ok || r.registered)); }   // key CLAIMS this daemonId (TOFU) — only this machine can drain it
      const links: Record<string, string> = { line: "https://developers.line.biz (Messaging API → set webhook to the relay)", slack: "your Slack app → Event Subscriptions → the relay URL", discord: "Discord Developer Portal → your bot", whatsapp: "Meta WhatsApp Cloud API → webhook = the relay URL" };
      out(`🔗 Pair ${provider} — ZERO config on your side:`);
      out(`   1. Open your ${provider} bot/app${links[provider] ? "  ·  " + links[provider] : ""}`);
      out(`   2. SEND THIS CODE to the bot, from the ${provider} app:`);
      out(``);
      out(`        ${code}`);
      out(``);
      out(`   ⏱ expires in ${Math.round(ttlMs / 60000)} min · one-time · signed to THIS machine only`);
      out(relay ? (registered ? `   ✓ registered with relay ${relay} — the moment you send the code, ${provider} is linked + you'll get approvals there.` : `   ⚠ relay ${relay} did not confirm (its /keryx/pair-register may not be deployed yet) — code minted + saved locally.`) : `   ⚠ no relay configured — set keryxRelay first (Telegram needs none; LINE/Slack/Discord/WhatsApp need the hosted relay).`);
    });

  k.command("rotate").description("🔑 Rotate this machine's relay key (compromise recovery) — proves the old key, swaps to a fresh one. Existing pairings keep working; the old key can no longer drain.")
    .option("--relay <url>", "the hosted Keryx relay (defaults to your configured one)")
    .action(async (o: { relay?: string }) => {
      const cwd = process.cwd(); const dir = join(cwd, ".mneme", "keryx");
      const idPath = join(dir, "daemon-id"), secPath = join(dir, "rendezvous-secret");
      if (!existsSync(idPath) || !existsSync(secPath)) { out("✗ nothing to rotate — run `mneme keryx connect <provider>` first."); process.exitCode = 2; return; }
      const daemonId = readFileSync(idPath, "utf8").trim(); const oldKey = readFileSync(secPath, "utf8").trim();
      const newKey = createHmac("sha256", "mneme-rdv-rotate").update(daemonId + "|" + oldKey + "|" + Date.now()).digest("hex");
      let relay = o.relay || "";
      try { const pc = JSON.parse(readFileSync(join(cwd, ".mneme", "pager", "config.json"), "utf8")); relay = o.relay || pc.keryxRelay || ""; } catch { /* */ }
      if (!relay) { out("✗ no relay configured."); process.exitCode = 2; return; }
      const r = await postJson(`${relay.replace(/\/$/, "")}/keryx/rotate-key`, { daemonId, oldKey, newKey });
      if (r && (r.ok || r.rotated)) { writeFileSync(secPath, newKey, "utf8"); out(`🔑 key rotated for ${daemonId} — the old key is now dead; this machine keeps its pairings.`); }
      else { out(`✗ rotation refused by relay: ${JSON.stringify(r)} (old key mismatch?)`); process.exitCode = 2; }
    });

  k.command("web").description("🕸 PROVIDER WEB — the providers woven into the mesh + their capabilities. Any provider (incl. a future one like WeChat) plugs in by declaring 'silk' — no core change.")
    .option("--harvest <provider>", "test-parse an inbound payload from STDIN/--payload for a provider")
    .option("--payload <json>", "inline inbound payload to harvest").action((o: { harvest?: string; payload?: string }) => {
      const web = providerWeb.defaultWeb();
      if (o.harvest) {
        let payload: unknown = {}; try { payload = JSON.parse(o.payload ?? "{}"); } catch { /* */ }
        const h = providerWeb.harvestInbound(web, o.harvest, payload);
        out(h.ok ? `🕸 harvested ${o.harvest}: answer="${h.answer}" id=${h.id ?? "—"}` : `✗ ${o.harvest}: ${h.reason}`); return;
      }
      out(`🕸 PROVIDER WEB — ${providerWeb.threads(web).length} threads woven (gauntlet ${providerWeb.providerWebGauntlet().score}/100):`);
      for (const s of providerWeb.threads(web)) out(`   ${providerWeb.clearMethodFor(web, s.provider) === "edit" ? "✏️ " : "📨"} ${s.provider.padEnd(9)} buttons=${s.capabilities.buttons} edit=${s.capabilities.edit} inbound=${s.capabilities.inbound} verify=${s.capabilities.verify}`);
      out("   → add a provider (WeChat / Mastodon / a webhook): declare its silk descriptor; the matrix routes + harvests it with zero core change. First tap on ANY surface wins; the rest clear.");
    });

  k.command("demo").description("Show a signed ask→answer round-trip (no network).").action(() => {
    const secret = "demo-daemon-key", now = Date.now();
    const ask = keryx.buildAsk(secret, { id: "demo1", channel: "line", summary: "Deploy to prod?", rawCommand: "kubectl apply -f prod.yaml", nonce: "n1", now });
    const ans = keryx.buildAnswer(secret, ask, "deny", now + 1500);
    out("ASK (agent → human, via relay):"); out("  " + JSON.stringify({ kind: ask.kind, channel: ask.channel, payload: ask.payload, commandHash: ask.commandHash.slice(0, 12) + "…", sig: ask.sig.slice(0, 12) + "…" }));
    out("  raw command NEVER crosses · verify offline: " + keryx.verifyEnvelope(secret, ask, now + 100).ok);
    out("ANSWER (human → agent, via relay):"); out("  " + JSON.stringify({ kind: ans.kind, payload: ans.payload, boundToAsk: ans.id === ask.id }));
    out("  forged by relay (wrong key)? " + keryx.verifyEnvelope("wrong", ask, now + 100).ok + "  ← the relay can route but never fabricate");
  });

  k.command("channels <text...>").description("SMART NL → which chats. Pass the user's own words (EN/Thai) — 'send to line and whatsapp' / 'ส่งไป line กับ whatsapp พอ' / 'ทุกช่อง' — prints the resolved lanes the broadcast will fire to.")
    .action((text: string[]) => {
      const lanes = keryx.extractChannels((text ?? []).join(" "));
      out(lanes ? `→ broadcast to: ${lanes.join(", ")}` : "→ broadcast to: ALL configured chats");
    });

  k.command("providers").description("List configured chat providers (.mneme/keryx/providers.json).").action(() => {
    const c = loadProviders(process.cwd()) as Record<string, ProviderCfg>; const on = keryx.ALL_PROVIDERS.filter((p) => isConnected(p, c[p]));
    out(on.length ? `🏛 connected providers: ${on.join(", ")}` : "no providers configured — add tokens to .mneme/keryx/providers.json (see docs/KERYX.md)");
  });

  k.command("broadcast").description("Fan an ask out to ALL connected providers at once (one agent → every chat). Pair with `keryx bridge` to receive the answer + auto-clear the others.")
    .requiredOption("--question <q>", "the question").option("--kind <k>", "approve|choice|text", "approve").option("--choices <list>", "comma-separated (choice)")
    .option("--relay <url>", "KERYX relay base URL (to register expectation)").option("--daemon <id>", "daemon id", "default").option("--agent <a>", "agent name shown in chat (default: auto-detected AI agent / Mneme-AI)")
    .action(async (o: { question: string; kind?: string; choices?: string; relay?: string; daemon?: string; agent?: string }) => {
      const cwd = process.cwd(); const cfg = loadProviders(cwd) as Record<string, ProviderCfg>;
      const connected = keryx.ALL_PROVIDERS.filter((p) => isConnected(p, cfg[p]));
      if (!connected.length) { out("no providers configured — see `mneme keryx providers`"); process.exitCode = 2; return; }
      const id = Math.abs([...`${o.question}${Date.now()}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
      const spec: AskSpec = { id, nonce: id, question: o.question, kind: (["approve", "choice", "text"].includes(o.kind ?? "") ? o.kind : "approve") as AskSpec["kind"], choices: o.choices ? o.choices.split(",").map((s) => s.trim()).filter(Boolean) : undefined, agent: o.agent ?? detectAgent() };
      const sent: Bcast["sent"] = [];
      for (const p of connected) { const r = await sendAsk(p, cfg[p], spec); out(`  ${r.ok ? "✓" : "✗"} ${p}${r.messageId ? " (msg " + r.messageId + ")" : ""}${r.reason ? " — " + r.reason : ""}`); if (r.ok) sent.push({ provider: p, messageId: r.messageId ?? "" }); }
      const b = loadBcasts(cwd); b.push({ id, nonce: id, sent, answered: null }); saveBcasts(cwd, b);
      if (o.relay) await postJson(`${o.relay.replace(/\/$/, "")}/keryx/expect`, { daemonId: o.daemon ?? "default", askId: id });
      out(`📡 broadcast id ${id} → ${sent.length}/${connected.length} providers. Run \`mneme keryx bridge --relay ${o.relay ?? "<url>"}\` to receive + auto-clear.`);
    });

  k.command("test-send <provider>").description("PRE-STAGE CHECK — send one real test message to a provider with your token, so you confirm OUTBOUND works BEFORE you demo (catches a bad token/payload early).")
    .action(async (provider: string) => {
      const cwd = process.cwd(); const cfg = (loadProviders(cwd) as Record<string, ProviderCfg>)[provider];
      if (!isConnected(provider, cfg)) { out(`✗ ${provider} not configured in .mneme/keryx/providers.json (needs token${provider === "line" ? " or channelId+channelSecret" : ""})`); process.exitCode = 2; return; }
      const r = await sendAsk(provider, cfg, { id: "selftest", nonce: "selftest", question: "✅ Test — tap a button to confirm replies reach the relay", kind: "approve", agent: detectAgent() });
      out(r.ok ? `✓ sent to ${provider}${r.messageId ? " (msg " + r.messageId + ")" : ""} — check your chat; tap a button + run \`mneme keryx bridge\` to confirm the round-trip.` : `✗ ${provider} send FAILED: ${r.reason ?? "unknown"} — re-check token/channel/id.`);
      if (!r.ok) process.exitCode = 2;
    });

  k.command("bridge").description("Poll the relay for answers; FIRST answer wins, then CLEAR the question on every other provider (edit Telegram/Slack/Discord · notify LINE/WhatsApp).")
    .requiredOption("--relay <url>", "KERYX relay base URL").option("--daemon <id>", "daemon id", "default").option("--once", "drain once and exit (testing)")
    .action(async (o: { relay: string; daemon?: string; once?: boolean }) => {
      const cwd = process.cwd(); const base = o.relay.replace(/\/$/, ""); const daemon = o.daemon ?? "default";
      const drainOnce = async () => {
        const r = await getJson(`${base}/keryx/drain?daemon=${encodeURIComponent(daemon)}`);
        const answers = (r.answers as Array<{ id: string; payload: string; channel: string }>) ?? [];
        for (const a of answers) {
          const b = loadBcasts(cwd); const rec = b.find((x) => x.id === a.id);
          if (!rec) { out(`· answer for unknown id ${a.id} (ignored)`); continue; }
          if (rec.answered) { out(`· ${a.id} already answered on ${rec.answered} — ignored (first wins)`); continue; }
          rec.answered = a.channel; rec.answer = a.payload; saveBcasts(cwd, b);
          out(`✅ ${a.id} answered "${a.payload}" on ${a.channel} → clearing others…`);
          const cfg = loadProviders(cwd) as Record<string, ProviderCfg>;
          for (const act of keryx.clearPlan(rec.sent, a.channel)) { await clearMessage(act.provider, cfg[act.provider], act.messageId, a.channel); out(`   ${act.method === "edit" ? "✏️ edited" : "📨 notified"} ${act.provider}`); }
        }
        return answers.length;
      };
      if (o.once) { const n = await drainOnce(); out(`drained ${n} answer(s).`); return; }
      out(`🏛 KERYX bridge — polling ${base} for daemon ${daemon} (Ctrl-C to stop)…`);
      for (;;) { try { await drainOnce(); } catch { /* keep polling */ } await new Promise((r) => setTimeout(r, 2000)); }
    });

  k.command("verify <file>").description("Verify an envelope JSON offline.").requiredOption("--secret <s>", "the daemon shared key")
    .action((file: string, o: { secret: string }) => {
      if (!existsSync(file)) { out("file not found"); process.exitCode = 2; return; }
      try { const e = JSON.parse(readFileSync(file, "utf8")); const r = keryx.verifyEnvelope(o.secret, e, Date.now()); out(`${r.ok ? "✓" : "✗"} ${r.reason}`); if (!r.ok) process.exitCode = 2; }
      catch { out("✗ invalid envelope JSON"); process.exitCode = 2; }
    });
}
