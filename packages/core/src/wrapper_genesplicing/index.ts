/**
 * v2.19.9 — MNEME WRAPPER GENESPLICING (runtime chimera composition)
 *
 *   "Every MCP server in the field treats its tool catalog as a static
 *    array baked in at boot. Mneme inverts the contract: an AI agent
 *    can request a NEW tool at runtime by passing a RECIPE of existing
 *    tool names; we compose them into a CHIMERA, sign the recipe with
 *    HMAC, set a TTL, and return the chimera as a callable. The chimera
 *    name is content-addressed (same recipe → same name → free dedup).
 *
 *    Sequential composition (A→B→C) pipes outputs; fan-out runs all in
 *    parallel; first-success cascades through fallbacks. Popular chimeras
 *    (high call count after TTL) auto-flag for promotion to permanent
 *    catalog status. Re-callable in the next turn without rebuilding."
 *
 * Honest scope:
 *   - We do NOT inject the chimera into the live MCP server's catalog
 *     dynamically (the MCP transport doesn't support catalog mutation).
 *     We DO expose a stable `executeChimera(name, inputs)` entry point
 *     that the AI agent calls via a static MCP tool (`mneme.genome.execute_chimera`).
 *   - The execute step requires the CALLER to supply a tool-handler
 *     registry (Map<name, handler>) so we don't take a hard dependency
 *     on the MCP package. The MCP wrapper provides this registry from
 *     `buildAllTools()`.
 *   - Partial failures: sequential aborts at first error; fan-out
 *     returns all results (some may error); first-success continues until
 *     the first non-error.
 *   - TTL is wall-clock; expired chimeras GC on next gc() call or next
 *     splice (lazy cleanup).
 *
 * Pure orchestrator. Composes onto every existing MCP tool. ~300 LOC.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type ComposerKind = "sequential" | "fan_out" | "first_success";

export interface ChimeraDef {
  v: typeof PROTOCOL_VERSION;
  chimeraName: string;
  recipe: string[];        // ordered tool names
  composer: ComposerKind;
  /** Optional rename: maps step output keys to the next step's input keys.
   *  e.g., {"0.output": "1.input"} — for sequential mode. */
  argMapping: Record<string, string>;
  /** TTL in seconds. */
  ttlSec: number;
  /** Wall-clock expiry timestamp. */
  expiresAt: string;
  /** Number of times this chimera has been executed. */
  callCount: number;
  /** Last-call timestamp. */
  lastCalledAt: string | null;
  /** True iff caller registered this as permanent. */
  promoted: boolean;
  createdAt: string;
  /** HMAC over the canonical body (excluding callCount + lastCalledAt + promoted, since those mutate). */
  sig: string;
}

export interface SpliceInput {
  recipe: string[];
  composer?: ComposerKind;
  argMapping?: Record<string, string>;
  ttlSec?: number;
  nowMs?: number;
  secret?: string;
}

export interface ExecutionStep {
  step: number;
  toolName: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface ExecutionResult {
  v: typeof PROTOCOL_VERSION;
  executionId: string;
  chimeraName: string;
  composer: ComposerKind;
  steps: ExecutionStep[];
  /** Final value (sequential: last step's output; fan_out: array; first_success: first ok). */
  finalOutput: unknown;
  /** Overall ok = sequential: all ok; fan_out: any ok; first_success: any ok */
  ok: boolean;
  totalDurationMs: number;
  executedAt: string;
  sig: string;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;
export type ToolRegistry = Map<string, ToolHandler>;

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_GENESPLICE_SECRET"] || `mneme-genesplicing-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Content-addressed chimera name: same (recipe + composer + argMapping)
 * → same name. Recipe-deduplication for free.
 */
function chimeraIdFor(recipe: string[], composer: ComposerKind, argMapping: Record<string, string>): string {
  return createHmac("sha256", "mneme-chimera-id")
    .update(canon({ recipe, composer, argMapping }))
    .digest("hex").slice(0, 16);
}

export interface GenespliceOptions {
  /** Minimum call count before promotion is suggested. */
  promotionThreshold?: number;
}

export class WrapperGenesplicing {
  private chimeras: Map<string, ChimeraDef> = new Map();
  private secret: string;
  private promotionThreshold: number;

  constructor(opts: GenespliceOptions & { secret?: string } = {}) {
    this.secret = opts.secret ?? defaultSecret();
    this.promotionThreshold = opts.promotionThreshold ?? 10;
  }

  // ─── splice — create chimera (or return existing on dedup) ────────────
  splice(input: SpliceInput): ChimeraDef {
    if (!input.recipe || input.recipe.length < 1) {
      throw new Error("GENESPLICE: recipe must contain at least 1 tool name");
    }
    if (input.recipe.length > 16) {
      throw new Error("GENESPLICE: recipe length > 16 — split into smaller chimeras");
    }
    const composer: ComposerKind = input.composer ?? "sequential";
    const argMapping = input.argMapping ?? {};
    const ttlSec = input.ttlSec ?? 600;
    const now = input.nowMs ?? Date.now();
    const id = chimeraIdFor(input.recipe, composer, argMapping);
    const chimeraName = `mneme.chimera.${id}`;
    // Lazy GC of expired chimeras
    this.gcExpired(now);
    // Dedup: same content + still alive → return existing
    const existing = this.chimeras.get(chimeraName);
    if (existing && Date.parse(existing.expiresAt) > now) {
      return existing;
    }
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlSec * 1000).toISOString();
    const body = {
      v: PROTOCOL_VERSION,
      chimeraName,
      recipe: input.recipe.slice(),
      composer,
      argMapping,
      ttlSec,
      expiresAt,
      createdAt,
    };
    const sig = hmac(body, input.secret ?? this.secret);
    const chimera: ChimeraDef = {
      ...body,
      callCount: 0,
      lastCalledAt: null,
      promoted: false,
      sig,
    };
    this.chimeras.set(chimeraName, chimera);
    return chimera;
  }

  // ─── execute — run a chimera with a tool registry ─────────────────────
  async execute(input: {
    chimeraName: string;
    inputs: Record<string, unknown>;
    registry: ToolRegistry;
    nowMs?: number;
  }): Promise<ExecutionResult> {
    const now = input.nowMs ?? Date.now();
    const chimera = this.chimeras.get(input.chimeraName);
    if (!chimera) throw new Error(`GENESPLICE: chimera '${input.chimeraName}' not found (may have expired)`);
    if (Date.parse(chimera.expiresAt) <= now) {
      this.chimeras.delete(input.chimeraName);
      throw new Error(`GENESPLICE: chimera '${input.chimeraName}' expired at ${chimera.expiresAt}`);
    }
    const startedAt = Date.now();
    const steps: ExecutionStep[] = [];
    let finalOutput: unknown = undefined;
    let overallOk = true;

    if (chimera.composer === "sequential") {
      let prev: Record<string, unknown> = { ...input.inputs };
      for (let i = 0; i < chimera.recipe.length; i++) {
        const toolName = chimera.recipe[i]!;
        const handler = input.registry.get(toolName);
        const t0 = Date.now();
        if (!handler) {
          steps.push({ step: i, toolName, ok: false, error: `tool '${toolName}' not in registry`, durationMs: 0 });
          overallOk = false;
          break;
        }
        try {
          const out = await handler(prev);
          steps.push({ step: i, toolName, ok: true, output: out, durationMs: Date.now() - t0 });
          // Pipe: if output is object, use as next input; else wrap in { prev }
          prev = (typeof out === "object" && out !== null && !Array.isArray(out))
            ? { ...prev, ...(out as Record<string, unknown>) }
            : { ...prev, prev: out };
          finalOutput = out;
        } catch (e) {
          steps.push({ step: i, toolName, ok: false, error: (e as Error).message, durationMs: Date.now() - t0 });
          overallOk = false;
          break; // abort on first error
        }
      }
    } else if (chimera.composer === "fan_out") {
      const promises = chimera.recipe.map(async (toolName, i) => {
        const handler = input.registry.get(toolName);
        const t0 = Date.now();
        if (!handler) {
          return { step: i, toolName, ok: false, error: `tool '${toolName}' not in registry`, durationMs: 0 };
        }
        try {
          const out = await handler({ ...input.inputs });
          return { step: i, toolName, ok: true, output: out, durationMs: Date.now() - t0 };
        } catch (e) {
          return { step: i, toolName, ok: false, error: (e as Error).message, durationMs: Date.now() - t0 };
        }
      });
      const all = await Promise.all(promises);
      steps.push(...all);
      finalOutput = all.map((s) => s.ok ? s.output : { error: s.error });
      overallOk = all.some((s) => s.ok); // fan_out is ok if AT LEAST ONE succeeded
    } else if (chimera.composer === "first_success") {
      let succeeded = false;
      for (let i = 0; i < chimera.recipe.length; i++) {
        const toolName = chimera.recipe[i]!;
        const handler = input.registry.get(toolName);
        const t0 = Date.now();
        if (!handler) {
          steps.push({ step: i, toolName, ok: false, error: `tool '${toolName}' not in registry`, durationMs: 0 });
          continue;
        }
        try {
          const out = await handler({ ...input.inputs });
          steps.push({ step: i, toolName, ok: true, output: out, durationMs: Date.now() - t0 });
          finalOutput = out;
          succeeded = true;
          break;
        } catch (e) {
          steps.push({ step: i, toolName, ok: false, error: (e as Error).message, durationMs: Date.now() - t0 });
        }
      }
      overallOk = succeeded;
    }

    // Update call count + last-called
    chimera.callCount++;
    chimera.lastCalledAt = new Date(now).toISOString();

    const executionId = "exe-" + createHmac("sha256", "mneme-chimera-exec-id")
      .update(`${input.chimeraName}|${chimera.callCount}|${now}`)
      .digest("hex").slice(0, 14);
    const totalDurationMs = Date.now() - startedAt;
    const body: Omit<ExecutionResult, "sig"> = {
      v: PROTOCOL_VERSION,
      executionId,
      chimeraName: input.chimeraName,
      composer: chimera.composer,
      steps,
      finalOutput,
      ok: overallOk,
      totalDurationMs,
      executedAt: new Date(now).toISOString(),
    };
    const sig = hmac(body, this.secret);
    return { ...body, sig };
  }

  // ─── promotion — flag popular chimeras for permanent catalog status ───
  promotionCandidates(): ChimeraDef[] {
    return Array.from(this.chimeras.values()).filter((c) => c.callCount >= this.promotionThreshold && !c.promoted);
  }

  promote(chimeraName: string): ChimeraDef | null {
    const c = this.chimeras.get(chimeraName);
    if (!c) return null;
    c.promoted = true;
    // Extend TTL by 100x once promoted
    const extended = new Date(Date.parse(c.expiresAt) + c.ttlSec * 100 * 1000).toISOString();
    c.expiresAt = extended;
    return c;
  }

  // ─── GC ─────────────────────────────────────────────────────────────────
  gc(nowMs?: number): { removed: number; remaining: number } {
    const now = nowMs ?? Date.now();
    return this.gcExpired(now);
  }
  private gcExpired(now: number): { removed: number; remaining: number } {
    let removed = 0;
    for (const [name, c] of this.chimeras) {
      // Don't GC promoted chimeras even if expiresAt past
      if (c.promoted) continue;
      if (Date.parse(c.expiresAt) <= now) {
        this.chimeras.delete(name);
        removed++;
      }
    }
    return { removed, remaining: this.chimeras.size };
  }

  // ─── Introspection ──────────────────────────────────────────────────────
  list(): ChimeraDef[] {
    return Array.from(this.chimeras.values());
  }
  get(chimeraName: string): ChimeraDef | undefined {
    return this.chimeras.get(chimeraName);
  }
  stats(): {
    total: number;
    promoted: number;
    expired: number;
    avgCallCount: number;
    mostUsed: { name: string; count: number } | null;
  } {
    const all = Array.from(this.chimeras.values());
    const now = Date.now();
    const expired = all.filter((c) => Date.parse(c.expiresAt) <= now).length;
    const promoted = all.filter((c) => c.promoted).length;
    const totalCalls = all.reduce((a, c) => a + c.callCount, 0);
    const mostUsed = all.length === 0 ? null : all.reduce(
      (best, c) => (best.callCount >= c.callCount ? best : c)
    );
    return {
      total: all.length,
      promoted,
      expired,
      avgCallCount: all.length === 0 ? 0 : Math.round((totalCalls / all.length) * 100) / 100,
      mostUsed: mostUsed ? { name: mostUsed.chimeraName, count: mostUsed.callCount } : null,
    };
  }

  // ─── Verify ───────────────────────────────────────────────────────────
  verifyChimera(c: ChimeraDef): boolean {
    const { sig, callCount: _cc, lastCalledAt: _lca, promoted: _p, ...body } = c;
    return safeEqHex(hmac(body, this.secret), sig);
  }
  verifyExecution(r: ExecutionResult): boolean {
    const { sig, ...body } = r;
    return safeEqHex(hmac(body, this.secret), sig);
  }
}

export function formatChimeraLine(c: ChimeraDef): string {
  const icon = c.promoted ? "🌟" : "🧬";
  return `${icon} CHIMERA · ${c.chimeraName.slice(15)} · ${c.recipe.length}-step ${c.composer} · calls=${c.callCount} · expires ${c.expiresAt.slice(11, 19)}`;
}
export function formatExecutionLine(r: ExecutionResult): string {
  const okSteps = r.steps.filter((s) => s.ok).length;
  return `🧬 EXEC · ${r.chimeraName.slice(15)} · ${r.composer} · ${okSteps}/${r.steps.length} ok · ${r.totalDurationMs}ms`;
}

let _instance: WrapperGenesplicing | null = null;
export function defaultGenesplicing(): WrapperGenesplicing {
  if (!_instance) _instance = new WrapperGenesplicing();
  return _instance;
}
