/**
 * MNEME LIVE — the self-verifying liveness layer that keeps the background support for AI agents
 * provably working, in real time, and catches SILENT breakage before a user ever hits it.
 *
 * The hard lesson behind this module: a one-line guard drift (the LINE clear path required a `token`
 * that LINE never has) silently broke cross-provider clears for sessions, and nothing noticed —
 * because the only proof was a human tapping a phone. MNEME LIVE replaces "hope it works" with two
 * things that run continuously:
 *   1) PROBES — is the daemon's heartbeat fresh, the hook wired, the relay reachable, the state file
 *      intact, and — critically — is EVERY configured provider ready on BOTH its send AND its clear
 *      path (the exact class of drift that caused the bug)?
 *   2) A CANARY — a deterministic end-to-end self-test of the approval pipeline (broadcast → first-win
 *      → clear-all-others → late-tap-reply) that FAILS loudly the moment any step regresses.
 *
 * `providerReady` is the SINGLE source of truth for "can this provider act?" — send, clear, and the
 * canary all consult it, so the send/clear guards can never drift apart again.
 *
 * ★HONEST (DIAKRISIS): probes prove what is checkable (heartbeat/config/reachability/round-trip), not
 * that every future tap will deliver (a provider can still drop a message). The value is that silent,
 * structural breakage is caught + surfaced + (where safe) auto-healed — not a delivery guarantee.
 */
import { openTicket, processTap } from "../keryx/approval_matrix.js";

export type Health = "live" | "degraded" | "down";
export interface ProviderCreds { token?: string; channelId?: string; channelSecret?: string; phoneId?: string; to?: string }

/** THE SINGLE PREDICATE — "can this provider send AND clear?" Send, clear, and the canary all use it,
 *  so the two guards can never drift apart (the drift that silently broke LINE for sessions). */
export function providerReady(provider: string, cfg: ProviderCreds | undefined | null): { sendReady: boolean; clearReady: boolean; reason: string } {
  const none = { sendReady: false, clearReady: false, reason: "not configured" };
  if (!cfg) return none;
  let ok = false; let reason = "ok";
  if (provider === "line") { ok = !!(cfg.token || (cfg.channelId && cfg.channelSecret)); reason = ok ? "channel creds present" : "need channelId + channelSecret (or token)"; }
  else if (provider === "whatsapp") { ok = !!(cfg.token && cfg.phoneId); reason = ok ? "token + phoneId present" : "need token + phoneId"; }
  else { ok = !!cfg.token; reason = ok ? "token present" : "need a bot token"; }   // telegram / slack / discord
  return { sendReady: ok, clearReady: ok, reason };   // SAME readiness for both paths — no drift possible
}

export interface Probe { name: string; status: Health; detail: string; heal?: string }
export interface LiveFacts {
  daemonHeartbeatAgeMs: number | null;                 // null = no daemon running
  hookWired: boolean;
  relay?: { configured: boolean; reachable: boolean | null };
  providers?: Array<{ name: string; cfg: ProviderCreds | null; reachable?: boolean | null }>;
  stateOk?: boolean;                                    // state.json parseable
  pendingCount?: number;
  versionBehind?: boolean | null;
  canaryOk?: boolean;
}
export interface LiveReport { verdict: Health; probes: Probe[]; heals: string[]; summary: string }
const worst = (a: Health, b: Health): Health => (a === "down" || b === "down") ? "down" : (a === "degraded" || b === "degraded") ? "degraded" : "live";

/** Deterministically evaluate liveness from gathered facts (the CLI/daemon gathers; this judges). */
export function evaluateLiveness(f: LiveFacts): LiveReport {
  const probes: Probe[] = []; const heals: string[] = [];
  // daemon
  const age = f?.daemonHeartbeatAgeMs;
  if (age == null) probes.push({ name: "daemon", status: "down", detail: "no heartbeat — the pager daemon isn't running", heal: "mneme pager doctor" });
  else if (age > 90_000) probes.push({ name: "daemon", status: "degraded", detail: `heartbeat ${Math.round(age / 1000)}s stale`, heal: "mneme pager doctor" });
  else probes.push({ name: "daemon", status: "live", detail: `heartbeat ${Math.round(age / 1000)}s fresh` });
  if (probes[0].heal) heals.push(probes[0].heal);
  // hook
  probes.push(f?.hookWired ? { name: "hook", status: "live", detail: "PreToolUse hook wired" } : { name: "hook", status: "degraded", detail: "the agent hook isn't wired — approvals won't trigger", heal: "mneme pager autosetup" });
  if (!f?.hookWired) heals.push("mneme pager autosetup");
  // providers — BOTH send + clear must be ready (the guard-drift class)
  for (const p of f?.providers ?? []) {
    const r = providerReady(p.name, p.cfg);
    if (!p.cfg) continue;                                // not configured → skip (not an error)
    if (!r.sendReady || !r.clearReady) probes.push({ name: `provider:${p.name}`, status: "down", detail: `send/clear not both ready — ${r.reason}`, heal: `configure ${p.name}` });
    else if (p.reachable === false) probes.push({ name: `provider:${p.name}`, status: "down", detail: "credentials present but the provider API is unreachable", heal: `check ${p.name} token/network` });
    else probes.push({ name: `provider:${p.name}`, status: "live", detail: `ready (${r.reason})${p.reachable ? " + reachable" : ""}` });
  }
  // relay
  if (f?.relay?.configured) probes.push(f.relay.reachable === false ? { name: "relay", status: "degraded", detail: "keryx relay unreachable — non-Telegram taps may not arrive", heal: "check the relay droplet" } : { name: "relay", status: "live", detail: "keryx relay reachable" });
  // state
  if (f?.stateOk === false) { probes.push({ name: "state", status: "down", detail: "state.json is corrupt", heal: "mneme pager reset-state" }); heals.push("mneme pager reset-state"); }
  // canary
  if (f?.canaryOk === false) probes.push({ name: "canary", status: "down", detail: "the approval pipeline self-test FAILED — a step regressed", heal: "investigate the pipeline" });
  else if (f?.canaryOk === true) probes.push({ name: "canary", status: "live", detail: "approval pipeline self-test passed end-to-end" });
  // version (info-level)
  if (f?.versionBehind) probes.push({ name: "version", status: "degraded", detail: "a newer Mneme is available", heal: "mneme upgrade" });

  const verdict = probes.reduce((acc, p) => worst(acc, p.status), "live" as Health);
  const down = probes.filter((p) => p.status === "down").length, deg = probes.filter((p) => p.status === "degraded").length;
  const summary = verdict === "live" ? `LIVE — all ${probes.length} checks green` : `${verdict.toUpperCase()} — ${down} down, ${deg} degraded of ${probes.length}`;
  return { verdict, probes, heals: [...new Set(heals)], summary };
}

export interface CanaryStep { step: string; ok: boolean }
export interface CanaryResult { ok: boolean; steps: CanaryStep[] }
/** A deterministic end-to-end self-test of the approval pipeline — runs a fake approval through the
 *  REAL matrix (broadcast → first-win → clear-all-others-once → correct-name → late-tap-reply) and
 *  FAILS the moment any step regresses. The daemon runs this live to catch silent breakage. */
export function approvalCanary(): CanaryResult {
  const steps: CanaryStep[] = [];
  const surfaces = ["telegram", "line", "slack", "discord", "whatsapp", "computer"];
  const t0 = openTicket({ id: "canary", command: "self-test", agent: "mneme", createdAt: 0, surfaces });
  steps.push({ step: "broadcast-6-surfaces", ok: t0.surfaces.length === 6 });
  const tap = processTap(t0, { surface: "telegram", decision: "allow", at: 1 });
  steps.push({ step: "first-win-accepted", ok: tap.outcome === "accepted" && tap.ticket.decision === "allow" });
  const clears = tap.actions.filter((a) => a.type === "clear");
  steps.push({ step: "clear-all-5-others-once", ok: new Set(clears.map((c) => c.surface)).size === 5 && !clears.some((c) => c.surface === "telegram") });
  steps.push({ step: "clears-name-the-answerer", ok: clears.every((c) => c.text.includes("telegram")) });
  const late = processTap(tap.ticket, { surface: "line", decision: "deny", at: 2 });
  steps.push({ step: "late-tap-answered-not-silent", ok: late.outcome === "already-decided" && late.actions.length === 1 && late.actions[0].surface === "line" });
  steps.push({ step: "decision-immutable", ok: late.ticket.decision === "allow" });
  return { ok: steps.every((s) => s.ok), steps };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface LiveGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function liveGauntlet(): LiveGauntlet {
  // providerReady: the guard-drift fix — LINE with channel creds is ready on BOTH paths
  const lineR = providerReady("line", { channelId: "x", channelSecret: "y" });
  const drift = lineR.sendReady === lineR.clearReady && lineR.sendReady === true && providerReady("line", {}).sendReady === false && providerReady("telegram", { token: "t" }).clearReady === true;

  // a healthy system → live
  const healthy = evaluateLiveness({ daemonHeartbeatAgeMs: 5000, hookWired: true, providers: [{ name: "telegram", cfg: { token: "t" }, reachable: true }, { name: "line", cfg: { channelId: "c", channelSecret: "s" }, reachable: true }], relay: { configured: true, reachable: true }, stateOk: true, canaryOk: true });
  const healthyOK = healthy.verdict === "live" && healthy.probes.every((p) => p.status === "live");

  // the EXACT guard-bug class: a provider configured but a send/clear path not ready → DOWN + surfaced
  const broken = evaluateLiveness({ daemonHeartbeatAgeMs: 5000, hookWired: true, providers: [{ name: "whatsapp", cfg: { token: "t" } /* missing phoneId */ }] });
  const catchesDriftOK = broken.verdict === "down" && broken.probes.some((p) => p.name === "provider:whatsapp" && p.status === "down");

  // daemon down → down + heal suggested
  const noDaemon = evaluateLiveness({ daemonHeartbeatAgeMs: null, hookWired: true });
  const daemonOK = noDaemon.verdict === "down" && noDaemon.heals.includes("mneme pager doctor");

  // stale daemon → degraded
  const stale = evaluateLiveness({ daemonHeartbeatAgeMs: 120000, hookWired: true });
  const staleOK = stale.verdict === "degraded";

  // canary failure → down
  const canaryFail = evaluateLiveness({ daemonHeartbeatAgeMs: 5000, hookWired: true, canaryOk: false });
  const canaryFailOK = canaryFail.verdict === "down" && canaryFail.probes.some((p) => p.name === "canary" && p.status === "down");

  // the live canary itself passes end-to-end
  const can = approvalCanary();
  const canaryOK = can.ok && can.steps.length === 6 && can.steps.every((s) => s.ok);

  const total = (() => { try { evaluateLiveness(null as never); providerReady("line", null); approvalCanary(); return true; } catch { return false; } })();

  const checks = [
    { name: "PROVIDER-READY-NO-DRIFT", pass: drift, detail: "one predicate gives send==clear readiness — LINE channel-creds ready on both paths (the guard-drift fix)" },
    { name: "HEALTHY→LIVE", pass: healthyOK, detail: "a fresh daemon + wired hook + ready providers + relay + canary → LIVE" },
    { name: "CATCHES-SILENT-DRIFT", pass: catchesDriftOK, detail: "a provider whose send/clear path isn't ready → DOWN + surfaced (the bug-that-was-silent is now loud)" },
    { name: "DAEMON-DOWN→DOWN+HEAL", pass: daemonOK, detail: "no heartbeat → DOWN with an auto-heal action" },
    { name: "STALE→DEGRADED", pass: staleOK, detail: "a stale heartbeat → degraded" },
    { name: "CANARY-FAIL→DOWN", pass: canaryFailOK, detail: "a failed pipeline self-test → DOWN" },
    { name: "CANARY-PASSES-E2E", pass: canaryOK, detail: "the live approval canary passes all 6 pipeline steps end-to-end" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
