/**
 * @mneme-ai/sdk/truth — TRUTH GATE in-process surface.
 *
 * The CLI shells out to `mneme truth_gate run` which spawns the MCP
 * server + walks all probes. The SDK calls the probe runner directly
 * — same probes, no subprocess, type-safe results.
 */

import { truthGate } from "@mneme-ai/core";
import type { SdkEnvelope } from "./types.js";

const { ALL_PROBES, probeById } = truthGate;
type ProbeResultLike = Awaited<ReturnType<typeof ALL_PROBES[number]["run"]>>;

export interface ProbeRunInput {
  probeId: string;
  cwd?: string;
}

export async function runProbe(input: ProbeRunInput): Promise<SdkEnvelope<ProbeResultLike & { probeId: string; latencyMs: number }>> {
  const p = probeById(input.probeId);
  if (!p) return { ok: false, reason: `unknown probe: ${input.probeId}` };
  const t0 = performance.now();
  try {
    const r = await p.run({ cwd: input.cwd ?? process.cwd() });
    const latencyMs = +(performance.now() - t0).toFixed(2);
    return { ok: true, data: { ...r, probeId: input.probeId, latencyMs }, latencyMs };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, latencyMs: +(performance.now() - t0).toFixed(2) };
  }
}

export function listProbes(): ReadonlyArray<{ id: string; kind: string; description: string }> {
  return ALL_PROBES.map((p) => ({ id: p.id, kind: p.kind, description: p.description }));
}

export async function runAllProbes(opts: { cwd?: string } = {}): Promise<SdkEnvelope<{
  total: number;
  passed: number;
  failed: number;
  results: Array<{ probeId: string; value: unknown; evidence: string; latencyMs: number }>;
}>> {
  const cwd = opts.cwd ?? process.cwd();
  const t0 = performance.now();
  const results: Array<{ probeId: string; value: unknown; evidence: string; latencyMs: number }> = [];
  let passed = 0, failed = 0;
  for (const p of ALL_PROBES) {
    const start = performance.now();
    try {
      const r = await p.run({ cwd });
      const latency = +(performance.now() - start).toFixed(2);
      const ok = r.value === 1;
      if (ok) passed++; else failed++;
      results.push({ probeId: p.id, value: r.value, evidence: r.evidence, latencyMs: latency });
    } catch (e) {
      failed++;
      results.push({ probeId: p.id, value: null, evidence: `threw: ${(e as Error).message}`, latencyMs: +(performance.now() - start).toFixed(2) });
    }
  }
  const latencyMs = +(performance.now() - t0).toFixed(2);
  return {
    ok: failed === 0,
    data: { total: results.length, passed, failed, results },
    latencyMs,
  };
}
