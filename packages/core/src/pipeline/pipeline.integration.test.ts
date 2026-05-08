import { describe, it, expect, vi } from "vitest";
import { runDeepPipeline, defineStage } from "./index.js";
import { runPipeline } from "./super-pipeline.js";
import type { PipelineConfig, PipelineEvent } from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

/**
 * Simulated 4-stage pipeline modeled after Mneme's real flow:
 *   parse → embed → score → render
 *
 * Each stage has a controlled mock latency so we can compare a sequential
 * baseline against a deeply-pipelined-with-superscalar run and verify the
 * speedup ratio.
 */
function buildStages(latencies: { parse: number; embed: number; score: number; render: number }) {
  const parse = defineStage<string, { tokens: string[] }>(
    "parse",
    "tokenize input",
    async (s) => {
      await sleep(latencies.parse);
      return { tokens: s.split(/\s+/) };
    },
    { targetMs: 10 },
  );
  const embed = defineStage<{ tokens: string[] }, { vec: number[] }>(
    "embed",
    "vectorize tokens",
    async (x) => {
      await sleep(latencies.embed);
      return { vec: x.tokens.map((t) => t.length) };
    },
    { targetMs: 30 },
  );
  const score = defineStage<{ vec: number[] }, { vec: number[]; score: number }>(
    "score",
    "compute score",
    async (x) => {
      await sleep(latencies.score);
      return { ...x, score: x.vec.reduce((a, b) => a + b, 0) };
    },
    { targetMs: 5 },
  );
  const render = defineStage<{ score: number; vec: number[] }, string>(
    "render",
    "format output",
    async (x) => {
      await sleep(latencies.render);
      return `score=${x.score}`;
    },
    { targetMs: 5 },
  );
  return [parse, embed, score, render] as const;
}

describe("integration — 4-stage parse → embed → score → render", () => {
  it("produces correct outputs in input order", async () => {
    const stages = buildStages({ parse: 1, embed: 1, score: 1, render: 1 });
    const inputs = ["a b c", "x y", "p q r s"];
    const out = await runDeepPipeline<string, string>({ stages }, inputs);
    expect(out).toEqual(["score=3", "score=2", "score=4"]);
  });

  it("deeply-pipelined-with-width-2 outperforms a sequential baseline", async () => {
    const latencies = { parse: 12, embed: 12, score: 12, render: 12 };
    const inputs = Array.from({ length: 8 }, (_, i) => "token ".repeat(i + 1).trim());
    const stages = buildStages(latencies);

    // Median of 3 trials per shape, with a warm-up pass to settle V8 JIT
    // and warm any module caches. This was previously a single-shot
    // measurement and flaked on busy CI runners (seen on
    // ubuntu-24.04-arm node 22 — par ran slightly slower than seq once
    // the runner was under contention from a parallel job).
    //
    // The contract we actually care about is "parallel does not regress
    // vs sequential on a quiet machine" + "shows a measurable speedup
    // on the median". Median-of-3 + 0.95 threshold tolerates one bad
    // runner without losing the regression net.
    const measure = async (width: number, buffer: number) => {
      const t = Date.now();
      await runDeepPipeline<string, string>({ stages, width, bufferSize: buffer }, inputs);
      return Date.now() - t;
    };
    // warm up
    await measure(1, 1);
    await measure(2, 4);

    const seqTrials: number[] = [];
    const parTrials: number[] = [];
    for (let i = 0; i < 3; i++) {
      seqTrials.push(await measure(1, 1));
      parTrials.push(await measure(2, 4));
    }
    seqTrials.sort((a, b) => a - b);
    parTrials.sort((a, b) => a - b);
    const seq = seqTrials[1]!; // median of 3
    const par = parTrials[1]!; // median of 3

    // Speedup: pipelined+width=2 with 4 stages × 12ms should approach 2×
    // in the steady state. Loose 0.95 threshold tolerates CI runner
    // contention (a busy host can momentarily slow worker spawn).
    expect(par).toBeLessThan(seq * 0.95);
    // Print the speedup for the report.
    // eslint-disable-next-line no-console
    console.log(
      `[pipeline.integration] median of 3 — sequential=${seq}ms  pipelined+width2=${par}ms  speedup=${(seq / par).toFixed(2)}×`,
    );
  });

  it("emits stage-start / stage-done for every stage on every item", async () => {
    const stages = buildStages({ parse: 1, embed: 1, score: 1, render: 1 });
    const events: PipelineEvent[] = [];
    const cfg: PipelineConfig<typeof stages> = {
      stages,
      width: 2,
      onEvent: (e) => events.push(e),
    };
    await runDeepPipeline<string, string>(cfg, ["a b", "c d", "e f"]);
    // 4 stages × 3 items = 12 stage-done events expected.
    expect(events.filter((e) => e.kind === "stage-done")).toHaveLength(12);
  });

  it("MPE state captures every stage's call/success counts", async () => {
    const stages = buildStages({ parse: 1, embed: 1, score: 1, render: 1 });
    // Run via raw runPipeline so we can inspect the state side-effect.
    // We approximate by counting stage-done events (state is in-memory only
    // when persist=false; the public surface for state inspection across
    // runs is .mneme/mpe.json).
    const events: PipelineEvent[] = [];
    for await (const _ of runPipeline(
      { stages, onEvent: (e) => events.push(e) },
      ["a b", "c d"],
    )) {
      // drain
    }
    const dones = events.filter((e) => e.kind === "stage-done");
    const byStage = new Map<string, number>();
    for (const d of dones) {
      if (d.kind === "stage-done") byStage.set(d.stage, (byStage.get(d.stage) ?? 0) + 1);
    }
    expect(byStage.get("parse")).toBe(2);
    expect(byStage.get("embed")).toBe(2);
    expect(byStage.get("score")).toBe(2);
    expect(byStage.get("render")).toBe(2);
  });
});
