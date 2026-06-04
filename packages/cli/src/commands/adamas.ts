/**
 * `mneme adamas` (v2.168.0) — ADAMAS (ἀδάμας, "unbreakable / diamond"):
 * QEC-inspired self-healing memory. A fact is encoded with a real MDS erasure
 * code (Cauchy/GF(256), the Reed-Solomon family) into K data + M parity shards;
 * a per-shard SHA-256 syndrome locates corruption; the code recovers the
 * original BYTE-IDENTICAL while >= K of K+M shards survive (tolerates up to M
 * bad shards), and returns UNRECOVERABLE past that — it never guesses.
 *
 *   mneme adamas                         # live self-test (gauntlet 100/100)
 *   mneme adamas encode "x=42" [--k 6 --m 3] > block.json   # signed block
 *   mneme adamas check  --block block.json                  # syndrome
 *   mneme adamas heal   --block block.json                  # decode + auto-correct
 */
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { adamas, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

function sign(block: adamas.AdamasBlock): adamas.AdamasBlock & { _proof?: unknown } {
  try {
    const receipt = notary.issueReceipt(process.cwd(), { kind: "memory-capsule", subject: `adamas:${block.root.slice(0, 12)}`, payload: { root: block.root, k: block.k, m: block.m }, includePayload: true });
    return { ...block, _proof: receipt };
  } catch { return block; }
}

export function registerAdamasCommands(program: Command): void {
  const a = program
    .command("adamas")
    .description("💎 ADAMAS — QEC-inspired SELF-HEALING MEMORY. Encode a fact into K data + M parity shards (real MDS erasure code, Cauchy/GF(256)); a per-shard syndrome locates corruption/tamper/loss and the code recovers it BYTE-IDENTICAL while ≥K shards survive (tolerates up to M bad), else UNRECOVERABLE — never a guess (prove-or-unknown). The classical algorithm behind quantum error correction (stabilizer codes), runnable today; composes with NOTARY + HYDRA. NOT a qubit — a textbook code that makes long-term AI memory provably survive corruption.")
    .action(() => {
      const g = adamas.adamasGauntlet();
      out(`💎 ADAMAS — self-healing memory self-test  (gauntlet ${g.score}/100)`);
      for (const c of g.checks) out(`  ${c.pass ? "✓" : "✗"} ${c.name.padEnd(13)} ${c.detail}`);
      process.exitCode = g.score === 100 ? 0 : 2;
    });

  a.command("encode")
    .description("encode a fact into a signed, self-healing ADAMAS block.")
    .argument("<text>", "the fact to protect")
    .option("--k <n>", "data shards (default 6)", (v) => parseInt(v, 10))
    .option("--m <n>", "parity shards = max bad shards tolerated (default 3)", (v) => parseInt(v, 10))
    .action((text: string, opts: { k?: number; m?: number }) => {
      const block = adamas.encodeFact(text, { k: opts.k, m: opts.m });
      out(JSON.stringify(sign(block), null, 2));
    });

  a.command("check")
    .description("measure the syndrome: which shards are corrupt/missing + recoverable? (exit 2 if not healthy)")
    .requiredOption("--block <file>", "ADAMAS block JSON ('-' for stdin)")
    .option("--json", "JSON output")
    .action((opts: { block: string; json?: boolean }) => {
      let blk: adamas.AdamasBlock;
      try { blk = JSON.parse(opts.block === "-" ? readFileSync(0, "utf8") : readFileSync(opts.block, "utf8")); } catch { out("✗ could not read/parse block"); process.exitCode = 2; return; }
      const syn = adamas.checkSyndrome(blk);
      if (opts.json) { out(JSON.stringify(syn, null, 2)); process.exitCode = syn.healthy ? 0 : 2; return; }
      out(`${syn.healthy ? "✓ HEALTHY" : syn.recoverable ? "⚠ DEGRADED (recoverable)" : "🛑 UNRECOVERABLE"}`);
      out(`   bad shards: [${syn.badShards.join(", ")}] · tolerates M=${syn.m} · root-seal ${syn.rootOk ? "ok" : "BROKEN"}`);
      process.exitCode = syn.healthy ? 0 : 2;
    });

  a.command("heal")
    .description("decode + auto-correct: recover the fact byte-identical if ≤M shards bad, else UNRECOVERABLE (exit 2).")
    .requiredOption("--block <file>", "ADAMAS block JSON ('-' for stdin)")
    .option("--json", "JSON output")
    .action((opts: { block: string; json?: boolean }) => {
      let blk: adamas.AdamasBlock;
      try { blk = JSON.parse(opts.block === "-" ? readFileSync(0, "utf8") : readFileSync(opts.block, "utf8")); } catch { out("✗ could not read/parse block"); process.exitCode = 2; return; }
      const d = adamas.decodeFact(blk);
      if (opts.json) { out(JSON.stringify(d, null, 2)); process.exitCode = d.ok ? 0 : 2; return; }
      if (!d.ok) { out(`🛑 ${d.reason}`); process.exitCode = 2; return; }
      out(`${d.recovered ? `✓ HEALED (corrected shards [${d.corrected.join(", ")}])` : "✓ HEALTHY"}`);
      out(d.value ?? "");
    });
}
