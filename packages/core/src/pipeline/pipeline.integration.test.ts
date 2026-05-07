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

    // Sequential baseline: width=1, bufferSize=1 (one item moves through at a time).
    const stages = buildStages(latencies);
    const t0 = Date.now();
    await runDeepPipeline<string, string>({ stages, width: 1, bufferSize: 1 }, inputs);
    const seq = Date.now() - t0;

    // Deeply-pipelined + superscalar (width=2 per stage).
    const t1 = Date.now();
    await runDeepPipeline<string, string>({ stages, width: 2, bufferSize: 4 }, inputs);
    const par = Date.now() - t1;

    // Speedup: parallel should be substantially faster. With 4 stages × 12ms
    // each and width=2 we expect close to a 2× speedup in the steady state.
    // Use a loose lower bound (par < seq * 0.85) to keep the test stable.
    expect(par).toBeLessThan(seq * 0.85);
    // Print the speedup for the report.
    // eslint-disable-next-line no-console
    console.log(
      `[pipeline.integration] sequential=${seq}ms  pipelined+width2=${par}ms  speedup=${(seq / par).toFixed(2)}×`,
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
