/**
 * v2.65.0 — SWARM BUS: cross-agent message bus over Mneme MCP.
 *
 * Continues Mneme MCP user-roadmap. v2.60-v2.64 quintet shipped:
 * bodyguard / diplomat / conscience / memory / consensus. v2.65 adds
 * the **cross-agent coordination** primitive (6th of 7).
 *
 * (Distinct namespace from v2.19 `swarm/` orchestrator wrapper.
 * SWARM BUS = the actual message broker. Separate concern.)
 *
 * Killer use case: Claude finishes auth.ts → broadcasts on channel
 * "team_x" → Cursor (in a different window, same Mneme MCP) receives
 * via drain → verifies artifact HMAC → adds tests → broadcasts back.
 * User watches the full Claude → Cursor → Continue handoff chain in
 * `mneme swarm_bus audit`, each step HMAC-proven.
 *
 * Multi-agent orchestration today = framework lock-in (LangGraph,
 * CrewAI, AutoGen). SWARM BUS = vendor-agnostic broker. Any agent
 * that speaks MCP can join the swarm.
 *
 * 6 wild innovations:
 *
 *  1. PER-AGENT INBOX — each agent has its own queue. broadcast()
 *     enqueues to ALL subscribers of the channel; drain() pops the
 *     pending messages for one agent (marking them delivered).
 *     Messages persist across process restarts.
 *
 *  2. LAMPORT-CLOCK CAUSAL ORDERING — broadcast bumps a per-channel
 *     Lamport timestamp; messages delivered in causally-correct
 *     order even when broadcasters race.
 *
 *  3. ARTIFACT HMAC VERIFICATION — broadcast can include
 *     `artifactHmac` (e.g. SHA-256 of `auth.ts`). Receiving agent
 *     re-hashes the file before acting. Tamper between broadcast
 *     and consume is detectable.
 *
 *  4. CHANNEL ACL VIA PASSPORT (composes with v2.61 PASSPORT) —
 *     channels can be `private`; subscribe + broadcast require a
 *     valid capability passport with scope `swarm:<channel>`.
 *     Public channels are open.
 *
 *  5. HANDOFF NARRATIVE — `auditHandoff(channel)` walks the ledger
 *     and renders the agent → agent → agent chain as plain English
 *     with HMAC proof per step. Inspector for "what did the swarm
 *     actually do?".
 *
 *  6. HMAC-CHAINED LEDGER (`.mneme/swarm_bus/bus.jsonl`) — every
 *     subscribe + broadcast + drain row's HMAC depends on prev row.
 *     Same canonical-JSON convention as v2.61-v2.64.
 *
 * Pure ESM. Defensive — never throws.
 */

import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const KEY_ENV = "MNEME_SWARM_BUS_KEY";
const DEFAULT_KEY = "mneme-swarm-bus-v1";
function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

/* ── Types ──────────────────────────────────────────────────────── */

export type ChannelKind = "public" | "private";

export interface SwarmMessage {
  id: string;
  at: string;
  channel: string;
  from: string;
  text: string;
  lamport: number;
  artifactHmac?: string;
  artifactPath?: string;
  hmac: string;
}

export interface BroadcastInput {
  channel: string;
  from: string;
  text: string;
  artifactHmac?: string;
  artifactPath?: string;
  passportToken?: string;
  cwd?: string;
}

export interface BroadcastResult {
  ok: boolean;
  reason: "delivered" | "channel_unknown" | "no_subscribers" | "passport_required" | "passport_invalid";
  message?: SwarmMessage;
  deliveredTo: string[];
  hint: string;
}

export interface SubscribeInput {
  channel: string;
  agent: string;
  passportToken?: string;
  cwd?: string;
}

export interface SubscribeResult {
  ok: boolean;
  reason: "subscribed" | "already_subscribed" | "passport_required" | "passport_invalid";
  channel: string;
  agent: string;
  hint: string;
}

export interface DrainInput {
  agent: string;
  channel?: string;
  limit?: number;
  cwd?: string;
}

export interface DrainResult {
  ok: boolean;
  messages: SwarmMessage[];
  hint: string;
}

export interface CreateChannelInput {
  channel: string;
  kind: ChannelKind;
  owner: string;
  cwd?: string;
}

/* ── Canonical JSON HMAC ────────────────────────────────────────── */

function canonicalJson(o: unknown): string {
  if (o === undefined) return "null";
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map((x) => canonicalJson(x === undefined ? null : x)).join(",") + "]";
  const entries = Object.entries(o as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

function signHmac(body: unknown): string {
  return createHmac("sha256", keyOf()).update(canonicalJson(body)).digest("hex");
}

/* ── State (channels + inboxes) ─────────────────────────────────── */

interface ChannelMeta {
  name: string;
  kind: ChannelKind;
  owner: string;
  createdAt: string;
  lamport: number;
  subscribers: string[];
}

interface SwarmState {
  channels: Record<string, ChannelMeta>;
  inboxes: Record<string, SwarmMessage[]>;
}

function statePath(cwd: string): string {
  return join(cwd, ".mneme", "swarm_bus", "state.json");
}

function readState(cwd: string): SwarmState {
  try { return JSON.parse(readFileSync(statePath(cwd), "utf8")) as SwarmState; }
  catch { return { channels: {}, inboxes: {} }; }
}

function writeState(cwd: string, s: SwarmState): void {
  try {
    mkdirSync(dirname(statePath(cwd)), { recursive: true });
    writeFileSync(statePath(cwd), JSON.stringify(s, null, 2));
  } catch { /* noop */ }
}

/* ── Ledger ─────────────────────────────────────────────────────── */

interface LedgerEntry {
  kind: "channel_create" | "subscribe" | "broadcast" | "drain";
  at: string;
  channel: string;
  agent: string;
  detail: string;
  prevHmac: string;
  hmac: string;
}

function ledgerPath(cwd: string): string {
  return join(cwd, ".mneme", "swarm_bus", "bus.jsonl");
}

function lastLedgerHmac(cwd: string): string {
  try {
    const lines = readFileSync(ledgerPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return "";
    return (JSON.parse(lines[lines.length - 1]!) as LedgerEntry).hmac;
  } catch { return ""; }
}

function appendLedger(cwd: string, entry: Omit<LedgerEntry, "hmac" | "prevHmac">): LedgerEntry {
  const prevHmac = lastLedgerHmac(cwd);
  const body: Omit<LedgerEntry, "hmac"> = { ...entry, prevHmac };
  const hmac = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
  const row: LedgerEntry = { ...body, hmac };
  try {
    mkdirSync(dirname(ledgerPath(cwd)), { recursive: true });
    appendFileSync(ledgerPath(cwd), JSON.stringify(row) + "\n");
  } catch { /* noop */ }
  return row;
}

export function readLedger(cwd: string): LedgerEntry[] {
  try {
    return readFileSync(ledgerPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as LedgerEntry);
  } catch { return []; }
}

export function verifyLedgerChain(cwd: string): { ok: boolean; rows: number; brokenAt?: number } {
  const lines = readLedger(cwd);
  let prevHmac = "";
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i]!;
    if (row.prevHmac !== prevHmac) return { ok: false, rows: i, brokenAt: i };
    const { hmac, ...body } = row;
    const expected = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
    if (expected !== hmac) return { ok: false, rows: i, brokenAt: i };
    prevHmac = hmac;
  }
  return { ok: true, rows: lines.length };
}

/* ── Passport verification (composes with v2.61) ────────────────── */

async function verifyPassportToken(cwd: string, token: string, channel: string): Promise<boolean> {
  try {
    const mod = await import("../passport/index.js" as string) as typeof import("../passport/index.js");
    const r = mod.verifyPassport({ token, cwd, expectedScope: [`swarm:${channel}`] });
    return r.valid;
  } catch { return false; }
}

/* ── Channels ───────────────────────────────────────────────────── */

export function createChannel(input: CreateChannelInput): { ok: boolean; channel: ChannelMeta; hint: string } {
  const cwd = input.cwd ?? process.cwd();
  const s = readState(cwd);
  const existing = s.channels[input.channel];
  if (existing) {
    return { ok: true, channel: existing, hint: `channel '${input.channel}' already exists (kind=${existing.kind})` };
  }
  const meta: ChannelMeta = {
    name: input.channel,
    kind: input.kind,
    owner: input.owner,
    createdAt: new Date().toISOString(),
    lamport: 0,
    subscribers: [],
  };
  s.channels[input.channel] = meta;
  writeState(cwd, s);
  appendLedger(cwd, { kind: "channel_create", at: meta.createdAt, channel: input.channel, agent: input.owner, detail: `kind=${input.kind}` });
  return { ok: true, channel: meta, hint: `channel '${input.channel}' created (kind=${input.kind}, owner=${input.owner})` };
}

export function listChannels(cwd: string): ChannelMeta[] {
  const s = readState(cwd);
  return Object.values(s.channels);
}

/* ── Subscribe ──────────────────────────────────────────────────── */

export async function subscribe(input: SubscribeInput): Promise<SubscribeResult> {
  const cwd = input.cwd ?? process.cwd();
  const s = readState(cwd);
  if (!s.channels[input.channel]) {
    createChannel({ channel: input.channel, kind: "public", owner: input.agent, cwd });
    Object.assign(s, readState(cwd));
  }
  const channel = s.channels[input.channel]!;
  if (channel.kind === "private") {
    if (!input.passportToken) {
      return { ok: false, reason: "passport_required", channel: input.channel, agent: input.agent, hint: "private channel requires passport token" };
    }
    const valid = await verifyPassportToken(cwd, input.passportToken, input.channel);
    if (!valid) {
      return { ok: false, reason: "passport_invalid", channel: input.channel, agent: input.agent, hint: "passport invalid or missing swarm:<channel> scope" };
    }
  }
  if (channel.subscribers.includes(input.agent)) {
    return { ok: true, reason: "already_subscribed", channel: input.channel, agent: input.agent, hint: "already subscribed" };
  }
  channel.subscribers.push(input.agent);
  if (!s.inboxes[input.agent]) s.inboxes[input.agent] = [];
  writeState(cwd, s);
  appendLedger(cwd, { kind: "subscribe", at: new Date().toISOString(), channel: input.channel, agent: input.agent, detail: "subscribed" });
  return { ok: true, reason: "subscribed", channel: input.channel, agent: input.agent, hint: `subscribed to '${input.channel}'` };
}

/* ── Broadcast ──────────────────────────────────────────────────── */

export async function broadcast(input: BroadcastInput): Promise<BroadcastResult> {
  const cwd = input.cwd ?? process.cwd();
  const s = readState(cwd);
  const channel = s.channels[input.channel];
  if (!channel) {
    return { ok: false, reason: "channel_unknown", deliveredTo: [], hint: `channel '${input.channel}' does not exist; create + subscribe first` };
  }
  if (channel.kind === "private") {
    if (!input.passportToken) {
      return { ok: false, reason: "passport_required", deliveredTo: [], hint: "private channel requires passport token" };
    }
    const valid = await verifyPassportToken(cwd, input.passportToken, input.channel);
    if (!valid) {
      return { ok: false, reason: "passport_invalid", deliveredTo: [], hint: "passport invalid or missing swarm:<channel> scope" };
    }
  }
  channel.lamport++;
  const at = new Date().toISOString();
  const id = randomBytes(8).toString("hex");
  const msgBody = {
    id, at, channel: input.channel, from: input.from, text: input.text,
    lamport: channel.lamport, artifactHmac: input.artifactHmac, artifactPath: input.artifactPath,
  };
  const msg: SwarmMessage = { ...msgBody, hmac: signHmac(msgBody) };
  const recipients = channel.subscribers.filter((a) => a !== input.from);
  for (const agent of recipients) {
    if (!s.inboxes[agent]) s.inboxes[agent] = [];
    s.inboxes[agent].push(msg);
    s.inboxes[agent].sort((a, b) => a.lamport - b.lamport || a.at.localeCompare(b.at));
  }
  writeState(cwd, s);
  appendLedger(cwd, { kind: "broadcast", at, channel: input.channel, agent: input.from, detail: `id=${id} lamport=${msg.lamport} to=${recipients.length}` });
  return {
    ok: true, reason: "delivered", message: msg, deliveredTo: recipients,
    hint: recipients.length === 0
      ? `broadcast accepted but channel has no other subscribers`
      : `delivered to ${recipients.length} agent(s): ${recipients.join(", ")}`,
  };
}

export function verifyMessage(m: SwarmMessage): boolean {
  if (!m || typeof m.hmac !== "string") return false;
  const { hmac, ...body } = m;
  return signHmac(body) === hmac;
}

/* ── Drain ──────────────────────────────────────────────────────── */

export function drain(input: DrainInput): DrainResult {
  const cwd = input.cwd ?? process.cwd();
  const s = readState(cwd);
  const inbox = s.inboxes[input.agent] ?? [];
  const filtered = input.channel ? inbox.filter((m) => m.channel === input.channel) : inbox;
  const taken = typeof input.limit === "number" ? filtered.slice(0, input.limit) : filtered;
  const takenIds = new Set(taken.map((m) => m.id));
  s.inboxes[input.agent] = inbox.filter((m) => !takenIds.has(m.id));
  writeState(cwd, s);
  if (taken.length > 0) {
    appendLedger(cwd, { kind: "drain", at: new Date().toISOString(), channel: input.channel ?? "*", agent: input.agent, detail: `count=${taken.length}` });
  }
  return { ok: true, messages: taken, hint: `drained ${taken.length} message(s) for agent '${input.agent}'` };
}

/* ── Peek (without consuming) ───────────────────────────────────── */

export function peekInbox(cwd: string, agent: string): SwarmMessage[] {
  const s = readState(cwd);
  return s.inboxes[agent] ?? [];
}

/* ── Handoff narrative ──────────────────────────────────────────── */

export interface HandoffStep {
  step: number;
  at: string;
  from: string;
  channel: string;
  detail: string;
  hmac: string;
}

export interface HandoffNarrative {
  ok: boolean;
  channel: string;
  steps: HandoffStep[];
  chain: string[];
  rendered: string;
}

export function auditHandoff(cwd: string, channel: string): HandoffNarrative {
  const rows = readLedger(cwd).filter((r) => r.channel === channel && r.kind === "broadcast");
  const steps: HandoffStep[] = rows.map((r, i) => ({
    step: i + 1, at: r.at, from: r.agent, channel: r.channel, detail: r.detail, hmac: r.hmac,
  }));
  const chain: string[] = [];
  for (const s of steps) if (chain[chain.length - 1] !== s.from) chain.push(s.from);
  const renderedLines = [
    `🐝 SWARM handoff · channel '${channel}' · ${steps.length} step(s)`,
    "",
    ...steps.map((s) => `   ${s.step}. ${s.from.padEnd(16)} ${s.at}  ${s.detail}  [HMAC ${s.hmac.slice(0, 12)}…]`),
  ];
  if (chain.length >= 2) {
    renderedLines.push("");
    renderedLines.push(`   chain: ${chain.join(" → ")}`);
  }
  return { ok: true, channel, steps, chain, rendered: renderedLines.join("\n") };
}

/* ── Render inbox ───────────────────────────────────────────────── */

export function renderInbox(messages: SwarmMessage[]): string {
  if (messages.length === 0) return "🐝 SWARM inbox · (empty)";
  const lines = [`🐝 SWARM inbox · ${messages.length} message(s)`, ""];
  for (const m of messages) {
    lines.push(`   [#${m.lamport}] ${m.from.padEnd(16)} → ${m.channel}  ${m.at}`);
    lines.push(`         ${m.text.slice(0, 100)}${m.text.length > 100 ? "…" : ""}`);
    if (m.artifactPath) lines.push(`         artifact: ${m.artifactPath} ${m.artifactHmac ? `(hmac ${m.artifactHmac.slice(0, 12)}…)` : ""}`);
  }
  return lines.join("\n");
}
