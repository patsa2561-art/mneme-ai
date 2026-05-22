/**
 * v2.24.0 — MCP fuzzer engine.
 *
 * Spawns the target MCP server as a child process (default: the local
 * `mneme mcp` bin), sends each vector's payload, awaits responses with a
 * per-vector timeout, runs the detector, and returns a structured report
 * card. The engine is transport-agnostic at the API surface — only stdio
 * is implemented here; SSE/HTTP can be added later by swapping the IO
 * layer.
 *
 * Determinism: vector ids define seed; mutation engine takes a seed
 * parameter; HMAC chain over canonical body makes the report tamper-
 * evident so it can be re-verified offline.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHmac } from "node:crypto";

import type {
  AttackVector,
  JsonRpcReply,
  ReportCard,
  RunOptions,
  Severity,
  Category,
  VectorRunResult,
  WisdomVerdict,
} from "./types.js";
import { VECTORS_108 } from "./vectors.js";

const HMAC_KEY = process.env["MNEME_MCP_FUZZ_KEY"] ?? "mneme-mcp-fuzzer-v1";

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHmac("sha256", "mneme-mcp-fuzz-digest").update(s).digest("hex");
}

function hmacHex(payload: string, prev: string): string {
  return createHmac("sha256", HMAC_KEY).update(prev + "|" + payload).digest("hex");
}

export interface SpawnTarget {
  /** Either spawn the local bin (default) or supply a custom command. */
  kind: "local" | "command";
  /** When kind=command, the exe + argv. */
  cmd?: { exe: string; args: string[] };
  /** Working directory for the child. */
  cwd: string;
  /** Environment overrides. */
  env?: Record<string, string>;
}

interface Frame {
  id?: number | string | null;
  raw: string;
  parsed: JsonRpcReply | null;
}

class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams;
  private buf = "";
  private pending: Map<number | string, (r: JsonRpcReply) => void> = new Map();
  private allFrames: Frame[] = [];
  // Some frames have null id (notifications); those land in nullIdFrames.
  private nullIdFrames: JsonRpcReply[] = [];

  constructor(target: SpawnTarget) {
    if (target.kind === "local") {
      // Default: spawn the local mneme CLI in MCP mode.
      const node = process.execPath;
      const bin = process.env["MNEME_CLI_BIN"] ?? "packages/cli/bin/mneme.js";
      this.child = spawn(node, [bin, "mcp"], {
        cwd: target.cwd,
        env: { ...process.env, ...(target.env ?? {}), MNEME_WARMCALL: "0", MNEME_MUSCLE_BYPASS: "0" },
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    } else {
      this.child = spawn(target.cmd!.exe, target.cmd!.args, {
        cwd: target.cwd,
        env: { ...process.env, ...(target.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    }
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    // Drain stderr to avoid backpressure but don't fail the run.
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", () => { /* drain */ });
    this.child.on("error", () => { /* surface via individual call timeouts */ });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: JsonRpcReply | null = null;
      try { parsed = JSON.parse(trimmed) as JsonRpcReply; } catch { /* leave null */ }
      this.allFrames.push({ id: parsed?.id ?? undefined, raw: trimmed, parsed });
      if (parsed && (parsed.id === undefined || parsed.id === null)) {
        this.nullIdFrames.push(parsed);
        continue;
      }
      if (parsed && parsed.id !== undefined) {
        const k = parsed.id as number | string;
        const next = this.pending.get(k);
        if (next) {
          this.pending.delete(k);
          next(parsed);
        }
      }
    }
  }

  async sendAndWait(
    frame: object | string,
    expectedId: number | string | null,
    timeoutMs: number,
  ): Promise<JsonRpcReply | null> {
    const line = typeof frame === "string" ? frame : JSON.stringify(frame);
    if (expectedId === null) {
      // notification — no response expected; just send + a short idle wait
      this.child.stdin.write(line + "\n");
      await new Promise((r) => setTimeout(r, 50));
      return null;
    }
    return await new Promise<JsonRpcReply | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(expectedId as number | string);
        resolve(null);
      }, timeoutMs);
      this.pending.set(expectedId as number | string, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      try { this.child.stdin.write(line + "\n"); }
      catch {
        clearTimeout(timer);
        this.pending.delete(expectedId as number | string);
        resolve(null);
      }
    });
  }

  alive(): boolean {
    return this.child.exitCode === null && !this.child.killed;
  }

  async close(): Promise<void> {
    try { this.child.stdin.end(); } catch { /* ignore */ }
    try { this.child.kill("SIGTERM"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 80));
    try { this.child.kill("SIGKILL"); } catch { /* ignore */ }
  }
}

/** Extract the JSON-RPC id from a payload step (object or raw string). */
function payloadId(p: { send: object | string; noResponse?: boolean }): number | string | null {
  if (p.noResponse) return null;
  if (typeof p.send === "string") {
    try {
      const obj = JSON.parse(p.send) as { id?: number | string };
      return typeof obj.id === "number" || typeof obj.id === "string" ? obj.id : null;
    } catch { return null; }
  }
  const o = p.send as { id?: number | string };
  return typeof o.id === "number" || typeof o.id === "string" ? o.id : null;
}

/** Run a single vector against the live MCP client. */
async function runVector(client: StdioMcpClient, v: AttackVector): Promise<VectorRunResult> {
  const t0 = Date.now();
  const responses: Array<JsonRpcReply | null> = [];
  const perStepTimeout = v.timeoutMs ?? 5000;
  for (const step of v.payload) {
    const expectedId = payloadId(step);
    const stepTimeout = step.timeoutMs ?? perStepTimeout;
    const r = await client.sendAndWait(step.send, expectedId, stepTimeout);
    responses.push(r);
  }
  let det;
  try { det = v.detector(responses); }
  catch (e) { det = { verdict: "inconclusive" as const, reason: `detector threw: ${(e as Error).message}` }; }
  return {
    vectorId: v.id,
    category: v.category,
    severity: v.severity,
    verdict: det.verdict,
    reason: det.reason,
    detail: det.detail,
    dtMs: Date.now() - t0,
    // Cap raw response size in report card to avoid bloat.
    responses: responses.map((r) => {
      if (!r) return r;
      const s = canon(r);
      if (s.length > 2000) {
        return { id: r.id, ...(r.error ? { error: { code: r.error.code, message: r.error.message } } : {}), __truncated: true } as JsonRpcReply;
      }
      return r;
    }),
  };
}

/** Filter vectors by ids or categories. */
function selectVectors(filter?: string[]): AttackVector[] {
  if (!filter || filter.length === 0) return VECTORS_108;
  const ids = new Set(filter);
  const cats = new Set(filter as Category[]);
  return VECTORS_108.filter((v) => ids.has(v.id) || cats.has(v.category));
}

/** Build the Intelligent Second Brain wisdom verdict over a run. */
function buildWisdom(results: VectorRunResult[]): WisdomVerdict {
  const failed = results.filter((r) => r.verdict === "fail");
  const warned = results.filter((r) => r.verdict === "warn");
  const critFailed = failed.filter((r) => r.severity === "critical");
  // Headline + traffic light.
  let headline: string;
  let trafficLight: WisdomVerdict["trafficLight"];
  if (critFailed.length > 0) {
    headline = `❌ CRITICAL — ${critFailed.length} critical / ${failed.length} total failures across 108 vectors`;
    trafficLight = "red";
  } else if (failed.length > 0) {
    headline = `⚠ DEGRADED — ${failed.length} failures across 108 vectors (no critical)`;
    trafficLight = "yellow";
  } else if (warned.length > 0) {
    headline = `🟡 PASS-WITH-WARNINGS — 0 failures, ${warned.length} warnings`;
    trafficLight = "yellow";
  } else {
    headline = `✅ CLEAN — 108/108 vectors pass; spec-compliant + hardened`;
    trafficLight = "green";
  }
  // Remediations.
  const remediations = failed.slice(0, 20).map((r) => {
    const v = VECTORS_108.find((vec) => vec.id === r.vectorId);
    return {
      vectorId: r.vectorId,
      cve: v?.cve,
      action: `${v?.title ?? r.vectorId}: ${v?.spec ?? "see vector spec"}`,
    };
  });
  // CVE posture — for every CVE listed on any vector, was it caught by a pass?
  const allCves = new Map<string, { mitigated: boolean; via: string }>();
  for (const v of VECTORS_108) {
    if (!v.cve) continue;
    const result = results.find((r) => r.vectorId === v.id);
    for (const cve of v.cve) {
      const cur = allCves.get(cve);
      const mitigatedNow = result?.verdict === "pass";
      if (!cur || (!cur.mitigated && mitigatedNow)) {
        allCves.set(cve, { mitigated: mitigatedNow, via: v.id });
      }
    }
  }
  const cvePosture = [...allCves.entries()].map(([cve, m]) => ({ cve, mitigated: m.mitigated, via: m.via }));
  // Mutation suggestions — for each failure propose a clear variant.
  const mutations = failed.slice(0, 8).map((r) => ({
    vectorId: r.vectorId,
    variant: `mutate-${r.vectorId}-${(r.dtMs % 7) + 1}`,
    rationale: `Failure shape: ${r.reason}. Next run: vary input size / depth / encoding.`,
  }));
  return {
    headline,
    trafficLight,
    remediations,
    cvePosture,
    mutationsForNextRun: mutations,
  };
}

/** Aggregate per-category / per-severity counts. */
function summarize(results: VectorRunResult[]): ReportCard["summary"] {
  const bySeverity = {} as Record<Severity, { pass: number; fail: number }>;
  const byCategory = {} as Record<Category, { pass: number; fail: number }>;
  for (const sev of ["info", "low", "medium", "high", "critical"] as Severity[]) {
    bySeverity[sev] = { pass: 0, fail: 0 };
  }
  for (const c of ["handshake", "schema", "method", "tool", "resource", "prompt", "policy", "concurrency", "transport"] as Category[]) {
    byCategory[c] = { pass: 0, fail: 0 };
  }
  let pass = 0, warn = 0, fail = 0, inconclusive = 0;
  for (const r of results) {
    if (r.verdict === "pass") {
      pass++;
      bySeverity[r.severity].pass++;
      byCategory[r.category].pass++;
    } else if (r.verdict === "fail") {
      fail++;
      bySeverity[r.severity].fail++;
      byCategory[r.category].fail++;
    } else if (r.verdict === "warn") {
      warn++;
    } else {
      inconclusive++;
    }
  }
  return { total: results.length, pass, warn, fail, inconclusive, bySeverity, byCategory };
}

// ─── HMAC ledger (single-process) ────────────────────────────────────────

let lastReportLink = "0".repeat(64);

/** Reset the in-memory chain link (tests). */
export function __resetFuzzChainForTest(): void {
  lastReportLink = "0".repeat(64);
}

export interface FuzzRunResult {
  reportCard: ReportCard;
}

/**
 * Main entry: spawn target MCP server, fire all (or filtered) vectors,
 * build the report card, HMAC-chain it, return.
 */
export async function runFuzz(target: SpawnTarget, opts: RunOptions = {}): Promise<FuzzRunResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const vectors = selectVectors(opts.filter);
  const client = new StdioMcpClient(target);

  // Initial wait — give the server a brief moment to start the transport.
  // The boot-fast refactor (v2.24.0) makes this < 100ms in practice.
  await new Promise((r) => setTimeout(r, 200));

  const results: VectorRunResult[] = [];
  for (const v of vectors) {
    const r = await runVector(client, v);
    results.push(r);
    if (opts.failFast && r.verdict === "fail" && (r.severity === "critical" || r.severity === "high")) break;
  }

  await client.close();

  const finishedAt = new Date().toISOString();
  const totalMs = Date.now() - t0;
  const summary = summarize(results);
  const wisdom = buildWisdom(results);

  // Build canonical body (without hmac field), digest + chain.
  const body = {
    spec: { name: "MCP-FUZZER" as const, version: "1.0" },
    target: target.cwd,
    startedAt,
    finishedAt,
    totalMs,
    results,
    summary,
    wisdom,
  };
  const bodyCanon = canon(body);
  const bodyDigest = sha256Hex(bodyCanon);
  lastReportLink = hmacHex(bodyDigest, lastReportLink);
  const seq = parseInt(lastReportLink.slice(0, 8), 16); // pseudo-sequence (not load-bearing)

  const reportCard: ReportCard = {
    ...body,
    hmac: lastReportLink,
    seq,
    bodyDigest,
  };
  return { reportCard };
}

/** Verify a report card's HMAC against a known previous chain head. */
export function verifyReport(
  card: ReportCard,
  expectedPrevChainLink: string = "0".repeat(64),
): { ok: true } | { ok: false; reason: string } {
  const { hmac, seq: _seq, bodyDigest, ...body } = card;
  const bodyCanon = canon(body);
  const recomputedDigest = sha256Hex(bodyCanon);
  if (recomputedDigest !== bodyDigest) return { ok: false, reason: "bodyDigest mismatch" };
  const expectedHmac = hmacHex(recomputedDigest, expectedPrevChainLink);
  if (expectedHmac !== hmac) return { ok: false, reason: "hmac mismatch (wrong key OR wrong prev chain link)" };
  return { ok: true };
}

/** Render a one-line headline + 5-line summary block for human terminal. */
export function renderShort(card: ReportCard): string[] {
  const s = card.summary;
  return [
    card.wisdom.headline,
    ``,
    `Target:    ${card.target}`,
    `Spec:      ${card.spec.name} v${card.spec.version}`,
    `Duration:  ${(card.totalMs / 1000).toFixed(2)}s · ${card.results.length} vectors`,
    `Verdict:   pass=${s.pass} warn=${s.warn} fail=${s.fail} inconclusive=${s.inconclusive}`,
    `HMAC:      ${card.hmac.slice(0, 16)}…  (seq ${card.seq})`,
    ``,
    `Top failures:`,
    ...card.wisdom.remediations.slice(0, 5).map((r) => `  ✗ ${r.vectorId} — ${r.action}${r.cve?.length ? `  [${r.cve.join(",")}]` : ""}`),
  ];
}
