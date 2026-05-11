/**
 * `mneme embeddings` (v1.30.0) -- transparency + one-command upgrade
 * for the embedder tier.
 *
 * Sub-commands:
 *   status    -- print which tier is active, with a REAL similarity test
 *                so the user can see for themselves whether semantic
 *                search works (hash tier shows ~random scores; bundled
 *                tier shows fox/dog ~0.7+, fox/car ~0.1).
 *   upgrade   -- force-download the bundled MiniLM model now (eager,
 *                progress bar) so the next `mneme index` lands on the
 *                ★★★ tier instead of falling back to ★★ hash.
 *   tier      -- alias for status (terse)
 *
 * The whole point: kill the "memory layer = hash embedder = degraded"
 * criticism by making the tier visible + the upgrade a one-liner.
 */

import type { Command } from "commander";
// v1.30.0 -- BULLETPROOF: memoryTier was added in v1.30.0; older core
// versions don't have it. Resolve dynamically + stub-fallback so a
// CLI/core version mismatch never crashes load.
interface MemoryTierShape {
  classifyEmbedderName: (s: string | null | undefined) => string;
  tierInfo: (name: string) => { name: string; display: string; stars: number; semantic: boolean };
  readMemoryTier: (repoRoot: string) => { name: string; display: string; stars: number; semantic: boolean };
}
async function resolveMemoryTier(): Promise<MemoryTierShape> {
  try {
    const core = (await import("@mneme-ai/core")) as { memoryTier?: MemoryTierShape };
    if (core.memoryTier && typeof core.memoryTier.readMemoryTier === "function") return core.memoryTier;
  } catch { /* */ }
  const stubInfo = { name: "unknown", display: "(memory_tier helper unavailable in this core)", stars: 0, semantic: false };
  return {
    classifyEmbedderName: () => "unknown",
    tierInfo: () => stubInfo,
    readMemoryTier: () => stubInfo,
  };
}

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

/** Cosine similarity between two equal-length vectors. */
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function registerEmbeddingsCommands(program: Command): void {
  const emb = program
    .command("embeddings")
    .alias("emb")
    .description("Inspect + upgrade the memory-layer embedder. `status` shows which tier is active with a real similarity test; `upgrade` pre-downloads the bundled MiniLM model so the next `mneme index` runs on real semantic embeddings.");

  emb.command("status")
    .alias("tier")
    .description("Show active embedder tier + run a REAL similarity test (so you can see whether semantic search actually works on your machine).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const repoRoot = process.cwd();
      const memoryTierModule = await resolveMemoryTier();
      const persisted = memoryTierModule.readMemoryTier(repoRoot);
      // Resolve a live embedder via the cascade so we can run the real test.
      const { resolveEmbedder } = await import("@mneme-ai/embeddings");
      const live = await resolveEmbedder({ provider: "auto" });
      const liveTier = memoryTierModule.classifyEmbedderName(live.name);
      const liveInfo = memoryTierModule.tierInfo(liveTier);

      // The honest similarity test.
      const probes: Array<[string, string]> = [
        ["the quick brown fox", "a fast brown dog"],          // semantic similar
        ["the quick brown fox", "a parked red car"],          // semantic distant
        ["unit test passes", "test cases all green"],         // technical similar
        ["unit test passes", "database schema migration"],    // technical distant
      ];
      const results: Array<{ pair: [string, string]; cosine: number; expected: "similar" | "distant" }> = [];
      for (let i = 0; i < probes.length; i++) {
        const [a, b] = probes[i]!;
        try {
          const [va, vb] = await live.embed([a, b]);
          results.push({
            pair: [a, b],
            cosine: cosine(va!, vb!),
            expected: i % 2 === 0 ? "similar" : "distant",
          });
        } catch {
          results.push({ pair: [a, b], cosine: NaN, expected: i % 2 === 0 ? "similar" : "distant" });
        }
      }

      // Sanity: a real semantic embedder rates "similar" pairs noticeably
      // above "distant" pairs. Hash embedder rates them ~the same.
      const sims = results.filter((r) => r.expected === "similar").map((r) => r.cosine);
      const dists = results.filter((r) => r.expected === "distant").map((r) => r.cosine);
      const avgSim = sims.reduce((s, x) => s + x, 0) / Math.max(1, sims.length);
      const avgDist = dists.reduce((s, x) => s + x, 0) / Math.max(1, dists.length);
      const margin = avgSim - avgDist;
      const verdict =
        margin > 0.30 ? "EXCELLENT semantic separation"
        : margin > 0.15 ? "OK semantic separation"
        : margin > 0.05 ? "WEAK semantic separation -- bundled model recommended"
        : "DEGRADED -- looks like hash trick. Run `mneme embeddings upgrade`.";

      const payload = {
        persistedTier: { name: persisted.name, display: persisted.display, stars: persisted.stars, semantic: persisted.semantic },
        liveTier: { name: liveTier, display: liveInfo.display, stars: liveInfo.stars, embedderName: live.name, dimensions: live.dimensions },
        similarityTest: results.map((r) => ({ a: r.pair[0], b: r.pair[1], cosine: Number.isFinite(r.cosine) ? Number(r.cosine.toFixed(3)) : null, expected: r.expected })),
        margin: Number(margin.toFixed(3)),
        verdict,
      };
      if (opts.json) { writeJson(payload); return; }

      writeText(`Mneme memory layer -- embedder status`);
      writeText(``);
      writeText(`Persisted tier (last index): ${persisted.display} ${"★".repeat(persisted.stars)}${"☆".repeat(5 - persisted.stars)}`);
      writeText(`Live tier (right now):       ${liveInfo.display} ${"★".repeat(liveInfo.stars)}${"☆".repeat(5 - liveInfo.stars)}`);
      writeText(`Embedder model:              ${live.name} (${live.dimensions} dims)`);
      writeText(``);
      writeText(`Real similarity test (cosine, higher = more similar):`);
      for (const r of results) {
        const score = Number.isFinite(r.cosine) ? r.cosine.toFixed(3) : "n/a";
        writeText(`  [${r.expected.padEnd(7)}] ${score}   "${r.pair[0]}" <-> "${r.pair[1]}"`);
      }
      writeText(``);
      writeText(`Avg similar:   ${avgSim.toFixed(3)}`);
      writeText(`Avg distant:   ${avgDist.toFixed(3)}`);
      writeText(`Margin:        ${margin.toFixed(3)}`);
      writeText(``);
      writeText(`Verdict: ${verdict}`);
    });

  emb.command("upgrade")
    .description("Eagerly download the bundled MiniLM-L6 model (~25MB) so the next `mneme index` runs on real ★★★ semantic embeddings instead of falling back to the ★★ hash trick. Idempotent -- safe to re-run.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const { resolveEmbedder } = await import("@mneme-ai/embeddings");
      const log: Array<{ status: string; pct?: number; mb?: string }> = [];
      const t0 = Date.now();
      const emb = await resolveEmbedder({
        provider: "bundled",
        onBundledProgress: (info: { status: string; loaded?: number; total?: number; file?: string }) => {
          if (info.status === "progress" && info.loaded != null && info.total != null && info.total > 0) {
            const pct = Math.round((info.loaded / info.total) * 100);
            const mb = (info.loaded / 1024 / 1024).toFixed(1);
            const tot = (info.total / 1024 / 1024).toFixed(1);
            log.push({ status: "downloading", pct, mb: `${mb}/${tot} MB` });
            if (!opts.json) process.stdout.write(`\r  downloading ${pct}% (${mb}/${tot} MB)     `);
          } else if (info.status === "ready" || info.status === "done") {
            log.push({ status: "done" });
          }
        },
      });
      // Force a real verify by embedding something.
      let ok = false; let reason = "";
      try {
        const v = await emb.embed(["hello world"]);
        ok = !!(v && v[0] && v[0].length > 0);
      } catch (e) { reason = (e as Error).message; }

      const summary = {
        ok, model: emb.name, dimensions: emb.dimensions,
        elapsedMs: Date.now() - t0,
        reason: ok ? null : reason,
        nextStep: ok
          ? "Re-run `mneme index` to populate the store with real semantic embeddings."
          : "Bundled model failed to load. Either run `ollama serve && ollama pull nomic-embed-text` for ★★★★ tier, or set OPENAI_API_KEY for ★★★★★.",
      };
      if (opts.json) { writeJson(summary); return; }
      if (!opts.json) process.stdout.write(`\n`);
      writeText(``);
      writeText(`Mneme embeddings upgrade`);
      writeText(``);
      writeText(`Model:        ${summary.model}`);
      writeText(`Dimensions:   ${summary.dimensions}`);
      writeText(`Elapsed:      ${summary.elapsedMs}ms`);
      writeText(`Status:       ${ok ? "OK -- bundled tier ready" : `FAIL -- ${reason}`}`);
      writeText(``);
      writeText(`Next: ${summary.nextStep}`);
    });
}
