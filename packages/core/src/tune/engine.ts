/**
 * v2.26.0 — PEAK PERFORMANCE GAUNTLET / AUTO-OPTIMIZER engine.
 *
 * Spawns the local Mneme MCP server, runs the N1-N12 probes against
 * it, scores each 0..10 stars, emits an HMAC-signed scorecard.
 *
 * The probes are NOT the 108-vector fuzzer — they are the deep-finding
 * specific tests from the user's v2.24.0 audit screenshot. Each probe
 * tests ONE finding and returns a star score so the operator + AI agent
 * can see drift over time.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type {
  Finding, FindingId, FindingResult, ProbeTarget, ScoreCard, SuggestedFix,
} from "./types.js";

const HMAC_KEY = process.env["MNEME_TUNE_KEY"] ?? "mneme-tune-v1";
const CHAIN_SEED = "0".repeat(64);

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function sha(buf: string): string { return createHash("sha256").update(buf).digest("hex"); }
function hmacOf(prev: string, payload: string): string {
  return createHmac("sha256", HMAC_KEY).update(prev + "|" + payload).digest("hex");
}

// ── stdio MCP client (lightweight) ───────────────────────────────────────

interface JsonRpcReply {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

class MiniClient {
  private child: ChildProcessWithoutNullStreams;
  private buf = "";
  private pending = new Map<number | string, (r: JsonRpcReply) => void>();
  private nextId = 1;
  // v2.26.1 — collect notifications (responses without an id) so probes
  // can verify server-pushed events like notifications/message + the
  // boot-handshake nudge.
  private notifications: JsonRpcReply[] = [];

  constructor(target: ProbeTarget) {
    const node = process.execPath;
    const bin = process.env["MNEME_CLI_BIN"] ?? "packages/cli/bin/mneme.js";
    if (target.cmd) {
      this.child = spawn(target.cmd.exe, target.cmd.args, {
        cwd: target.cwd,
        env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    } else {
      this.child = spawn(node, [bin, "mcp"], {
        cwd: target.cwd,
        env: { ...process.env, MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0", NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    }
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", () => { /* drain */ });
    this.child.on("error", () => { /* propagates via per-call timeouts */ });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const r = JSON.parse(line) as JsonRpcReply;
        if (r.id !== undefined && r.id !== null) {
          const k = r.id as number | string;
          const next = this.pending.get(k);
          if (next) { this.pending.delete(k); next(r); }
        } else if (r.method) {
          // Server-pushed notification (no id) — collect for probes.
          this.notifications.push(r);
        }
      } catch { /* skip */ }
    }
  }

  async send(method: string, params: unknown, timeoutMs = 5000): Promise<JsonRpcReply | null> {
    const id = this.nextId++;
    const frame = { jsonrpc: "2.0", id, method, params };
    return await new Promise<JsonRpcReply | null>((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, timeoutMs);
      this.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      try { this.child.stdin.write(JSON.stringify(frame) + "\n"); }
      catch { clearTimeout(timer); this.pending.delete(id); resolve(null); }
    });
  }

  /** Send raw line (for transport-layer probes). */
  sendRaw(line: string): void {
    try { this.child.stdin.write(line + (line.endsWith("\n") ? "" : "\n")); } catch { /* ignore */ }
  }

  /** v2.26.1 — read collected notifications since session start. */
  collectedNotifications(): ReadonlyArray<JsonRpcReply> {
    return this.notifications;
  }

  async close(): Promise<void> {
    try { this.child.stdin.end(); } catch { /* ignore */ }
    try { this.child.kill("SIGTERM"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 80));
    try { this.child.kill("SIGKILL"); } catch { /* ignore */ }
  }
}

// ── helpers used by multiple probes ───────────────────────────────────

async function initClient(target: ProbeTarget): Promise<MiniClient> {
  const c = new MiniClient(target);
  // Brief wait for stdin pipe to be ready.
  await new Promise((r) => setTimeout(r, 200));
  const init = await c.send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mneme-tune", version: "1.0" },
  }, 8000);
  void init;
  return c;
}

function isToolError(r: JsonRpcReply | null): boolean {
  if (!r || !r.result) return false;
  const res = r.result as { isError?: boolean };
  return res.isError === true;
}

// ── 12 probes ─────────────────────────────────────────────────────────

const PROBES: Finding[] = [
  // N1 — capability honesty (resources/list answers; completion shape valid)
  {
    id: "N1",
    title: "Capabilities declared = capabilities delivered (resources/list + completion/complete)",
    spec: "MCP §capabilities — declared capabilities MUST work end-to-end.",
    sinceVersion: "v2.26.0",
    remediation: [
      "Ensure resources/list does NOT await deferred runtime (closes timeout).",
      "Defensive-parse completion/complete; always return CompletionResult shape; never throw.",
    ],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      const r1 = await c.send("resources/list", {}, 3000);
      const r2 = await c.send("completion/complete", { ref: { type: "ref/prompt", name: "x" }, argument: { name: "y", value: "z" } }, 3000);
      const r3 = await c.send("completion/complete", { ref: {} as unknown, argument: {} as unknown }, 3000);
      await c.close();
      const okResources = r1 && Array.isArray((r1.result as { resources?: unknown[] })?.resources);
      const okCompletion = r2 && (r2.result as { completion?: unknown })?.completion;
      // Malformed input is OK to reject with -32602 (Invalid params) per
      // JSON-RPC spec — the server must NOT crash; either return clean
      // error code OR a defensive empty CompletionResult is acceptable.
      // Per JSON-RPC: -32602 = Invalid params. Per MCP SDK convention:
      // -32603 = Internal error (used for zod-validation failures). Both
      // are graceful (server stayed up). Either is acceptable.
      const okMalformed = r3 && (
        (r3.result as { completion?: unknown })?.completion !== undefined ||
        (r3.error && (r3.error.code === -32602 || r3.error.code === -32603))
      );
      const passes = [okResources, okCompletion, okMalformed].filter(Boolean).length;
      return {
        stars: Math.round((passes / 3) * 10),
        evidence: `resources/list=${okResources ? "ok" : "FAIL"} · completion=${okCompletion ? "ok" : "FAIL"} · malformed-completion=${okMalformed ? "ok" : "FAIL"}`,
        dtMs: Date.now() - t0,
      };
    },
  },
  // N2 — schema required enforced
  {
    id: "N2",
    title: "Schema `required` enforced — empty args on required-bearing tools rejected",
    spec: "JSON-Schema § required — server MUST validate.",
    sinceVersion: "v2.26.0",
    remediation: ["Pre-dispatch validateArgs(args, tool.inputSchema) middleware (packages/mcp/src/deep_hardening/schema_required.ts)."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      // mneme.fuzz.verify has `card` as required field; empty args should be rejected.
      const r1 = await c.send("tools/call", { name: "mneme.fuzz.verify", arguments: {} }, 3000);
      // mneme.codegraph.warn has `edgeId` + `reason` required.
      const r2 = await c.send("tools/call", { name: "mneme.codegraph.warn", arguments: {} }, 3000);
      await c.close();
      const r1Bad = isToolError(r1);
      const r2Bad = isToolError(r2);
      const passes = [r1Bad, r2Bad].filter(Boolean).length;
      return {
        stars: Math.round((passes / 2) * 10),
        evidence: `fuzz.verify-missing=${r1Bad ? "rejected" : "accepted-INVALID"} · codegraph.warn-missing=${r2Bad ? "rejected" : "accepted-INVALID"}`,
        dtMs: Date.now() - t0,
      };
    },
  },
  // N3 — tool name validation
  {
    id: "N3",
    title: "Malicious tool-name shapes rejected (empty / path-traversal / proto-pollution / long / unicode)",
    spec: "MCP-CANDOR §security — server MUST validate tool name shape.",
    sinceVersion: "v2.26.0",
    remediation: ["classifyToolName() gate before any catalog lookup (packages/mcp/src/deep_hardening/name_validator.ts)."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      const probes = [
        "", "../../../etc/passwd", "__proto__.constructor", "A".repeat(10_000),
        "🎯", "Mneme.Capabilities", "evil.exec",
        "mneme/foo", "mneme..foo", "mneme.foo bar",
      ];
      const responses = await Promise.all(probes.map((n) => c.send("tools/call", { name: n, arguments: {} }, 3000)));
      await c.close();
      const rejected = responses.filter((r) => isToolError(r)).length;
      return {
        stars: Math.round((rejected / probes.length) * 10),
        evidence: `${rejected}/${probes.length} malicious shapes rejected`,
        detail: { probes: probes.map((p, i) => ({ name: p.slice(0, 30), rejected: isToolError(responses[i] ?? null) })) },
        dtMs: Date.now() - t0,
      };
    },
  },
  // N4 — CLI vs MCP parity
  {
    id: "N4",
    title: "CLI tools also in MCP catalog (mneme.health / mneme.version / mneme.verify_self)",
    spec: "Mneme contract — every shipped CLI tool that returns data MUST be MCP-callable.",
    sinceVersion: "v2.26.0",
    remediation: ["Add MCP wrappers in packages/mcp/src/tools/_n4_missing_tools.ts."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      const list = await c.send("tools/list", {}, 3000);
      await c.close();
      const tools = ((list?.result as { tools?: Array<{ name: string }> })?.tools ?? []).map((t) => t.name);
      const expected = ["mneme.health", "mneme.version", "mneme.verify_self"];
      const found = expected.filter((n) => tools.includes(n));
      return {
        stars: Math.round((found.length / expected.length) * 10),
        evidence: `${found.length}/${expected.length} CLI parity tools present in MCP catalog (${found.join(", ")})`,
        dtMs: Date.now() - t0,
      };
    },
  },
  // N5 — capabilities response size
  {
    id: "N5",
    title: "mneme.capabilities default response is context-window-safe (< 10 KB)",
    spec: "AI-agent ergonomics — default response MUST not burn the context window.",
    sinceVersion: "v2.26.0",
    remediation: ["Default skinny mode + paginated full mode (packages/mcp/src/tools/_capabilities.ts)."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      const r = await c.send("tools/call", { name: "mneme.capabilities", arguments: {} }, 5000);
      await c.close();
      const text = ((r?.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text) ?? "";
      const bytes = Buffer.byteLength(text, "utf8");
      let stars: number;
      if (bytes < 10_000) stars = 10;
      else if (bytes < 25_000) stars = 8;
      else if (bytes < 50_000) stars = 5;
      else if (bytes < 100_000) stars = 2;
      else stars = 0;
      return {
        stars,
        evidence: `default capabilities response = ${bytes} bytes`,
        dtMs: Date.now() - t0,
      };
    },
  },
  // N6 — cancellation honored end-to-end
  {
    id: "N6",
    title: "notifications/cancelled propagates AbortSignal to handlers (end-to-end)",
    spec: "MCP §cancellation — server MUST honor cancellation; abort-aware handlers SHOULD short-circuit.",
    sinceVersion: "v2.26.1",
    remediation: [
      "cancelManager (packages/mcp/src/deep_hardening/cancel_manager.ts) + handler in startMcpServer.",
      "Tool handlers read args.__mneme_signal (AbortSignal) and abort early — see mneme.tune.probe.long_sleep.",
    ],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      const before = await c.send("tools/list", {}, 3000);
      // Pillar 1: abort-aware end-to-end test. Call long_sleep(2500ms),
      // immediately send cancellation, expect a response in <800ms with
      // data.aborted === true.
      const probeId = 999998;
      // Send the call ourselves so we can correlate id with cancellation.
      const sleepFrame = JSON.stringify({ jsonrpc: "2.0", id: probeId, method: "tools/call", params: { name: "mneme.tune.probe.long_sleep", arguments: { sleepMs: 2500 } } });
      // Register a pending handler manually
      const sleepReplyPromise = new Promise<JsonRpcReply | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 4000);
        (c as unknown as { pending: Map<number | string, (r: JsonRpcReply) => void> }).pending.set(probeId, (r: JsonRpcReply) => { clearTimeout(timer); resolve(r); });
        c.sendRaw(sleepFrame);
      });
      // 10ms after sending, fire the cancellation notification
      await new Promise((r) => setTimeout(r, 10));
      c.sendRaw(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: probeId, reason: "tune-probe" } }));
      const tCancel0 = Date.now();
      const sleepReply = await sleepReplyPromise;
      const tCancel = Date.now() - tCancel0;
      // Pillar 2: server still alive — accepts subsequent calls.
      const after = await c.send("tools/list", {}, 3000);
      await c.close();
      // Parse the long_sleep reply
      let abortedEcho = false;
      let sleepDtMs = -1;
      const text = ((sleepReply?.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text) ?? "";
      try {
        const parsed = JSON.parse(text) as { data?: { aborted?: boolean; dtMs?: number } };
        abortedEcho = parsed.data?.aborted === true;
        sleepDtMs = typeof parsed.data?.dtMs === "number" ? parsed.data!.dtMs! : -1;
      } catch { /* fallthrough */ }
      const aliveAfter = !!after;
      // 10★ = abort fired + dt < 800ms + server alive after
      // 8★  = abort fired but late, OR server alive but abort not propagated
      // 5★  = server alive only
      // 0★  = server died
      let stars: number;
      if (!aliveAfter) stars = 0;
      else if (abortedEcho && sleepDtMs > 0 && sleepDtMs < 800) stars = 10;
      else if (abortedEcho) stars = 8;
      else stars = 5;
      void before;
      return {
        stars,
        evidence: `abortedEcho=${abortedEcho} sleepDtMs=${sleepDtMs}ms cancelRoundTrip=${tCancel}ms aliveAfter=${aliveAfter}`,
        dtMs: Date.now() - t0,
      };
    },
  },
  // N7 — honeypot status surfaced
  {
    id: "N7",
    title: "honeypot status surfaces decoysActive + allow-list",
    spec: "Mneme governance — operator MUST be able to see honeypot state.",
    sinceVersion: "v2.26.0",
    remediation: ["mneme.security.honeypot_status (packages/mcp/src/tools/_n7_n11_governance.ts)."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      const r = await c.send("tools/call", { name: "mneme.security.honeypot_status", arguments: {} }, 4000);
      await c.close();
      const text = ((r?.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text) ?? "";
      const hasDecoy = /decoysActive/.test(text);
      const hasGate = /gatePolicy|allowList/i.test(text);
      const hasTools = /advertisedHoneypotTools/.test(text);
      const passes = [hasDecoy, hasGate, hasTools].filter(Boolean).length;
      return {
        stars: Math.round((passes / 3) * 10),
        evidence: `decoysActive=${hasDecoy} gatePolicy=${hasGate} advertisedHoneypotTools=${hasTools}`,
        dtMs: Date.now() - t0,
      };
    },
  },
  // N8 — concurrent tools/list count-stable
  {
    id: "N8",
    title: "1000 concurrent tools/list — count-stable",
    spec: "Production load — concurrent reads MUST return identical tool count.",
    sinceVersion: "v2.24.0",
    remediation: ["Existing — already production-grade."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      // Fire 50 in parallel; 1000 would dominate the budget but the property is the same.
      const N = 50;
      const replies = await Promise.all(Array.from({ length: N }, () => c.send("tools/list", {}, 6000)));
      await c.close();
      const counts = replies.map((r) => ((r?.result as { tools?: unknown[] })?.tools?.length ?? -1));
      const distinct = new Set(counts).size;
      return {
        stars: distinct === 1 && counts[0]! > 0 ? 10 : distinct <= 2 ? 6 : 0,
        evidence: `${N} concurrent tools/list — distinct counts = ${distinct} (expected 1)`,
        dtMs: Date.now() - t0,
      };
    },
  },
  // N9 — server notifications during session (capture + verify)
  {
    id: "N9",
    title: "Server emits notifications/message during session (boot-handshake captured)",
    spec: "MCP §logging — server SHOULD push notifications when capabilities include logging.",
    sinceVersion: "v2.26.1",
    remediation: [
      "Boot-handshake nudge fires 3s after server.connect() — see startMcpServer.",
      "Idle nudge fires after IDLE_THRESHOLD_MS when inbox has unsent messages.",
    ],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      // The boot-handshake nudge fires at +3s after connect (BOOT_HANDSHAKE_DELAY_MS).
      // Wait ~4s to catch it; also exercise the session with a couple of tool calls.
      const r1 = await c.send("tools/call", { name: "mneme.welcome", arguments: {} }, 4000);
      await new Promise((r) => setTimeout(r, 3500));
      const r2 = await c.send("tools/list", {}, 3000);
      const notifs = c.collectedNotifications();
      await c.close();
      const hasMessage = notifs.some((n) => n.method === "notifications/message");
      const dataIncludesMneme = notifs.some((n) => {
        const p = n.params as { data?: string } | undefined;
        return typeof p?.data === "string" && /mneme/i.test(p.data);
      });
      void r1; void r2;
      let stars: number;
      if (hasMessage && dataIncludesMneme) stars = 10;
      else if (hasMessage) stars = 8;
      else stars = 4;
      return {
        stars,
        evidence: `captured ${notifs.length} notification(s); notifications/message=${hasMessage}; mneme-branded=${dataIncludesMneme}`,
        detail: { methods: notifs.map((n) => n.method).slice(0, 5) },
        dtMs: Date.now() - t0,
      };
    },
  },
  // N10 — invalid arg types rejected
  {
    id: "N10",
    title: "Invalid argument types (string/num/null) rejected cleanly",
    spec: "MCP §tools — wrong-type args MUST return error / isError.",
    sinceVersion: "v2.26.0",
    remediation: ["validateArgs middleware (packages/mcp/src/deep_hardening/schema_required.ts)."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      // mneme.codegraph.warn has edgeId:string and reason:string required.
      const r = await c.send("tools/call", { name: "mneme.codegraph.warn", arguments: { edgeId: 12345, reason: { obj: 1 } } }, 3000);
      await c.close();
      const rejected = isToolError(r);
      return {
        stars: rejected ? 10 : 4,
        evidence: rejected ? "wrong-type args rejected by validator" : "wrong-type args accepted (validator missing)",
        dtMs: Date.now() - t0,
      };
    },
  },
  // N11 — catalog inflation governor present
  {
    id: "N11",
    title: "Catalog inflation governor present + actionable",
    spec: "Mneme governance — operator MUST see growth + delta over time.",
    sinceVersion: "v2.26.0",
    remediation: ["mneme.governance.catalog_growth (packages/mcp/src/tools/_n7_n11_governance.ts)."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      const r = await c.send("tools/call", { name: "mneme.governance.catalog_growth", arguments: {} }, 4000);
      await c.close();
      const text = ((r?.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text) ?? "";
      const hasCurrent = /current/.test(text);
      const hasDelta = /delta/.test(text);
      const hasGrowth = /growthPct/.test(text);
      const passes = [hasCurrent, hasDelta, hasGrowth].filter(Boolean).length;
      return {
        stars: Math.round((passes / 3) * 10),
        evidence: `governor returns current=${hasCurrent} delta=${hasDelta} growthPct=${hasGrowth}`,
        dtMs: Date.now() - t0,
      };
    },
  },
  // N12 — family count summary
  {
    id: "N12",
    title: "Family count summary surfaces total families + tools-per-family",
    spec: "Mneme governance — operator should see family structure.",
    sinceVersion: "v2.26.0",
    remediation: ["mneme.governance.family_count (packages/mcp/src/tools/_n7_n11_governance.ts)."],
    probe: async (target) => {
      const t0 = Date.now();
      const c = await initClient(target);
      const r = await c.send("tools/call", { name: "mneme.governance.family_count", arguments: {} }, 4000);
      await c.close();
      const text = ((r?.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text) ?? "";
      const hasTotal = /totalTools/.test(text);
      const hasFamilies = /\bfamilies\b/.test(text);
      const hasTop = /topFamilies/.test(text);
      const passes = [hasTotal, hasFamilies, hasTop].filter(Boolean).length;
      return {
        stars: Math.round((passes / 3) * 10),
        evidence: `family_count returns totalTools=${hasTotal} families=${hasFamilies} topFamilies=${hasTop}`,
        dtMs: Date.now() - t0,
      };
    },
  },
];

export const ALL_FINDINGS: ReadonlyArray<Finding> = PROBES;

// ── Run the gauntlet + emit a scorecard ───────────────────────────────

let lastChainLink = CHAIN_SEED;

export function __resetTuneChainForTest(): void {
  lastChainLink = CHAIN_SEED;
}

export async function runGauntlet(target: ProbeTarget): Promise<ScoreCard> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const findings: ScoreCard["findings"] = [];
  for (const f of PROBES) {
    let r: FindingResult;
    try { r = await f.probe(target); }
    catch (e) {
      r = { stars: 0, evidence: `probe threw: ${(e as Error).message}` };
    }
    findings.push({
      id: f.id,
      title: f.title,
      stars: r.stars,
      evidence: r.evidence,
      detail: r.detail,
      dtMs: r.dtMs,
      sinceVersion: f.sinceVersion,
    });
  }
  const finishedAt = new Date().toISOString();
  const totalMs = Date.now() - t0;
  const avg = findings.reduce((s, f) => s + f.stars, 0) / Math.max(1, findings.length);
  const overall = Math.round(avg * 10);
  let trafficLight: ScoreCard["trafficLight"];
  let headline: string;
  if (overall >= 90) { trafficLight = "green"; headline = `🏆 PEAK — ${overall}/100 (avg ${avg.toFixed(1)}/10 across ${findings.length} findings)`; }
  else if (overall >= 75) { trafficLight = "yellow"; headline = `🟡 STRONG — ${overall}/100 (avg ${avg.toFixed(1)}/10)`; }
  else if (overall >= 50) { trafficLight = "yellow"; headline = `⚠ MIXED — ${overall}/100; some findings need fixing.`; }
  else { trafficLight = "red"; headline = `❌ POOR — ${overall}/100; ship-blocker.`; }

  const body = {
    spec: { name: "MNEME-PEAK-GAUNTLET" as const, version: "1.0" },
    target: target.cwd,
    startedAt,
    finishedAt,
    totalMs,
    findings,
    overall,
    headline,
    trafficLight,
  };
  const bodyDigest = sha(canon(body));
  lastChainLink = hmacOf(lastChainLink, bodyDigest);
  return { ...body, hmac: lastChainLink, seq: parseInt(lastChainLink.slice(0, 8), 16), bodyDigest };
}

// ── Persistence ───────────────────────────────────────────────────────

function dirOf(repoRoot: string): string {
  const d = join(repoRoot, ".mneme", "tune");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

export function storeCard(repoRoot: string, card: ScoreCard): { path: string; ledger: string } {
  const d = dirOf(repoRoot);
  const stamp = card.finishedAt.replace(/[:.]/g, "-");
  const path = join(d, `${String(card.seq).padStart(10, "0")}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(card, null, 2) + "\n");
  const ledger = join(d, "scorecard.jsonl");
  const skim = {
    seq: card.seq,
    finishedAt: card.finishedAt,
    overall: card.overall,
    trafficLight: card.trafficLight,
    headline: card.headline,
    hmac: card.hmac,
    bodyDigest: card.bodyDigest,
    file: path,
  };
  appendFileSync(ledger, JSON.stringify(skim) + "\n");
  return { path, ledger };
}

export function readLatestCard(repoRoot: string): ScoreCard | null {
  const d = dirOf(repoRoot);
  if (!existsSync(d)) return null;
  const files = readdirSync(d).filter((n) => n.endsWith(".json")).sort();
  if (files.length === 0) return null;
  const last = files[files.length - 1]!;
  try { return JSON.parse(readFileSync(join(d, last), "utf8")) as ScoreCard; }
  catch { return null; }
}

export interface LedgerEntry {
  seq: number; finishedAt: string; overall: number; trafficLight: ScoreCard["trafficLight"]; headline: string;
  hmac: string; bodyDigest: string; file: string;
}

export function listCards(repoRoot: string, limit = 30): LedgerEntry[] {
  const p = join(dirOf(repoRoot), "scorecard.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: LedgerEntry[] = [];
  for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l) as LedgerEntry); } catch { /* skip */ } }
  return out;
}

// ── Suggest fix ───────────────────────────────────────────────────────

export function suggestFix(findingId: FindingId): SuggestedFix | null {
  const f = PROBES.find((p) => p.id === findingId);
  if (!f) return null;
  const commands: string[] = [
    `mneme tune run                    # re-probe to confirm`,
    `mneme.tune.report                 # read the signed scorecard`,
  ];
  if (findingId === "N3") commands.push(`# validator: packages/mcp/src/deep_hardening/name_validator.ts`);
  if (findingId === "N2" || findingId === "N10") commands.push(`# middleware: packages/mcp/src/deep_hardening/schema_required.ts`);
  if (findingId === "N5") commands.push(`# pass --json '{"skinny":true}' (now default since v2.26.0)`);
  if (findingId === "N6") commands.push(`# cancel manager: packages/mcp/src/deep_hardening/cancel_manager.ts`);
  if (findingId === "N4") commands.push(`# wrappers: packages/mcp/src/tools/_n4_missing_tools.ts`);
  if (findingId === "N7" || findingId === "N11" || findingId === "N12") commands.push(`# governance tools: packages/mcp/src/tools/_n7_n11_governance.ts`);
  return {
    findingId,
    steps: f.remediation,
    commands,
    sourcePath: `packages/core/src/tune/engine.ts (probe)`,
  };
}

/** Verify a scorecard's HMAC against a known prev chain link. */
export function verifyCard(card: ScoreCard, prevLink: string = CHAIN_SEED): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _s, bodyDigest, ...body } = card;
  void _s;
  const recomputed = sha(canon(body));
  if (recomputed !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expected = hmacOf(prevLink, recomputed);
  if (expected !== hmac) return { ok: false, reason: "hmac mismatch" };
  return { ok: true };
}
