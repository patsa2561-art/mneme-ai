/**
 * `mneme hydra` (v2.96.0) — forge / audit / verify the SIGNED, lossless,
 * vendor-neutral context codebook Mneme mines from its own corpus.
 *
 *   mneme hydra forge [--file F]   forge a codebook (default: the manifest),
 *                                  run the live gauntlet, sign it, write the
 *                                  portable artifact to .mneme/hydra/.
 *   mneme hydra gauntlet [--file F] just audit: lossless ∧ collision-free ∧
 *                                  portable → score /100 (CI exit code).
 *   mneme hydra verify <artifact>  offline-verify a portable artifact (sig +
 *                                  codebook binding + re-prove round-trip).
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function writeJson(p: unknown): void { process.stdout.write(JSON.stringify(p, null, 2) + "\n"); }
function writeText(l: string): void { process.stdout.write(l + "\n"); }

interface GauntletShape { lossless: boolean; collisions: number; portable: boolean; score: number; entries: number; bytesOriginal: number; bytesCompressed: number; codebookBytes: number; ratio: number; netRatio: number }
interface CodebookShape { entries: Array<{ sym: string; phrase: string }> }
interface GuardedShape { freshLossless: boolean; redactionSound: boolean; freshPreserved: boolean; deterministic: boolean; redactedCount: number; freshCount: number; score: number }
interface HydraShape {
  hydraForge: (repoRoot: string, corpus: string, at: number, opts?: Record<string, unknown>) => {
    forge: { codebook: CodebookShape; rounds: unknown[]; converged: boolean };
    gauntlet: GauntletShape;
    receipt: unknown; energy: { bytesSaved: number }; portable: unknown; axioms: unknown[];
  };
  verifyCodebook: (receipt: unknown, cb: unknown) => { valid: boolean; bound: boolean; reason: string };
  compress: (text: string, cb: unknown) => string;
  guardedGauntlet: (original: string, encoded: string, cb: unknown, trustMap: Record<string, string>) => GuardedShape;
  expandGuarded: (encoded: string, cb: unknown, trustOf: (sym: string) => string) => string;
  trustFromMap: (map: Record<string, string>) => (sym: string) => string;
}
interface ManifestShape { renderManifestMarkdown: (c?: unknown, v?: string) => string }

async function resolveCore(): Promise<{ hydra: HydraShape; agentManifest: ManifestShape } | null> {
  try {
    const core = (await import("@mneme-ai/core")) as { hydra?: HydraShape; agentManifest?: ManifestShape };
    if (core.hydra && core.agentManifest) return { hydra: core.hydra, agentManifest: core.agentManifest };
  } catch { /* */ }
  return null;
}

function corpusFor(file: string | undefined, am: ManifestShape): string {
  if (file && existsSync(file)) return readFileSync(file, "utf8");
  return am.renderManifestMarkdown(undefined, "current");  // default: the manifest itself
}

export function registerHydraCommands(program: Command): void {
  const h = program
    .command("hydra")
    .description("HYDRA — forge/audit/verify Mneme's SIGNED, provably-lossless, vendor-neutral context codebook (the self-mined gem). compress→expand is byte-identical (SHA-256 proof), Ed25519-signed (verify offline), tokenizer-independent by construction.");

  h.command("forge")
    .description("Forge a codebook from the corpus (default: the command manifest), run the live gauntlet, sign it, and write the portable artifact to .mneme/hydra/.")
    .option("--file <path>", "corpus file to forge over (default: the rendered manifest)")
    .option("--max-entries <n>", "cap codebook entries", (v) => parseInt(v, 10))
    .option("--json", "JSON output.")
    .action(async (opts: { file?: string; maxEntries?: number; json?: boolean }) => {
      const core = await resolveCore();
      if (!core) { writeText("✗ @mneme-ai/core hydra unavailable. Upgrade: `npm install -g mneme-ai@latest`."); process.exitCode = 1; return; }
      const repoRoot = process.cwd();
      const corpus = corpusFor(opts.file, core.agentManifest);
      const r = core.hydra.hydraForge(repoRoot, corpus, Date.now(), opts.maxEntries ? { maxEntries: opts.maxEntries } : {});
      const g = r.gauntlet;
      const dir = join(repoRoot, ".mneme", "hydra");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const artifactPath = join(dir, "codebook.json");
      writeFileSync(artifactPath, JSON.stringify(r.portable, null, 2));
      if (opts.json) { writeJson({ gauntlet: g, converged: r.forge.converged, artifactPath, bytesSaved: r.energy.bytesSaved }); process.exitCode = g.score === 100 ? 0 : 1; return; }
      writeText(`HYDRA forge — self-mined signed codebook`);
      writeText(``);
      writeText(`  rounds: ${r.forge.rounds.length} · converged: ${r.forge.converged}`);
      writeText(`  L4 lossless: ${g.lossless ? "✓" : "✗"}  ·  L7 collisions: ${g.collisions}  ·  L6 portable: ${g.portable ? "✓" : "✗"}`);
      writeText(`  entries: ${g.entries} · codebook ${g.codebookBytes}B`);
      writeText(`  text-ratio ${g.ratio.toFixed(3)}x (codebook pre-shared) · net-ratio ${g.netRatio.toFixed(3)}x (single-shot bundle, honest)`);
      writeText(`  L5 signed + written → ${artifactPath}`);
      writeText(``);
      writeText(g.score === 100 ? `  ✓ GAUNTLET 100/100 — lossless ∧ collision-free ∧ portable. No lie.` : `  ✗ GAUNTLET ${g.score}/100 — refused (would lose a byte or collide).`);
      process.exitCode = g.score === 100 ? 0 : 1;
    });

  h.command("gauntlet")
    .description("Audit only: forge + prove lossless ∧ collision-free ∧ portable → score /100. CI-friendly exit code (1 if < 100).")
    .option("--file <path>", "corpus file (default: the rendered manifest)")
    .option("--json", "JSON output.")
    .action(async (opts: { file?: string; json?: boolean }) => {
      const core = await resolveCore();
      if (!core) { writeText("✗ @mneme-ai/core hydra unavailable."); process.exitCode = 1; return; }
      const corpus = corpusFor(opts.file, core.agentManifest);
      const r = core.hydra.hydraForge(process.cwd(), corpus, Date.now(), {});
      const g = r.gauntlet;
      if (opts.json) { writeJson(g); process.exitCode = g.score === 100 ? 0 : 1; return; }
      writeText(`HYDRA gauntlet: L4 lossless=${g.lossless} L7 collisions=${g.collisions} L6 portable=${g.portable} → ${g.score}/100`);
      writeText(`  ${g.bytesOriginal}B → ${g.bytesCompressed}B (${g.ratio.toFixed(3)}x text · ${g.netRatio.toFixed(3)}x net) · ${g.entries} entries`);
      process.exitCode = g.score === 100 ? 0 : 1;
    });

  h.command("guard")
    .description("Time-To-Trust demo: forge a codebook, mark a fraction of entries STALE, then prove the guarded expansion is lossless for fresh content but provably REDACTS stale content to a signed abstract (an AI can't hallucinate from expired memory). Prints the guarded gauntlet /100.")
    .option("--file <path>", "corpus file (default: the rendered manifest)")
    .option("--stale-fraction <f>", "fraction of entries to mark stale (0..1)", (v) => parseFloat(v), 0.25)
    .option("--json", "JSON output.")
    .action(async (opts: { file?: string; staleFraction?: number; json?: boolean }) => {
      const core = await resolveCore();
      if (!core) { writeText("✗ @mneme-ai/core hydra unavailable."); process.exitCode = 1; return; }
      const corpus = corpusFor(opts.file, core.agentManifest);
      const r = core.hydra.hydraForge(process.cwd(), corpus, Date.now(), {});
      const cb = r.forge.codebook;
      const encoded = core.hydra.compress(corpus, cb);
      const frac = Math.min(1, Math.max(0, opts.staleFraction ?? 0.25));
      const nStale = Math.floor(cb.entries.length * frac);
      const trustMap: Record<string, string> = {};
      for (let i = 0; i < nStale; i++) { const e = cb.entries[i]; if (e) trustMap[e.sym] = "stale"; }
      const g = core.hydra.guardedGauntlet(corpus, encoded, cb, trustMap);
      if (opts.json) { writeJson(g); process.exitCode = g.score === 100 ? 0 : 1; return; }
      writeText(`HYDRA guard — Time-To-Trust (stale fraction ${frac})`);
      writeText(``);
      writeText(`  fresh-lossless: ${g.freshLossless ? "✓" : "✗"}  ·  redaction-sound: ${g.redactionSound ? "✓" : "✗"}  ·  fresh-preserved: ${g.freshPreserved ? "✓" : "✗"}  ·  deterministic: ${g.deterministic ? "✓" : "✗"}`);
      writeText(`  fresh ${g.freshCount} · redacted ${g.redactedCount}`);
      writeText(``);
      writeText(g.score === 100 ? `  ✓ GUARDED GAUNTLET 100/100 — lossless when trusted, provably redacted when stale. No leak, no lie.` : `  ✗ GUARDED GAUNTLET ${g.score}/100`);
      process.exitCode = g.score === 100 ? 0 : 1;
    });

  h.command("verify <artifact>")
    .description("Offline-verify a portable artifact: Ed25519 signature + codebook binding + re-prove the round-trip is lossless. No network, public key alone.")
    .option("--json", "JSON output.")
    .action(async (artifact: string, opts: { json?: boolean }) => {
      const core = await resolveCore();
      if (!core) { writeText("✗ @mneme-ai/core hydra unavailable."); process.exitCode = 1; return; }
      if (!existsSync(artifact)) { writeText(`✗ artifact not found: ${artifact}`); process.exitCode = 1; return; }
      let parsed: { codebook?: unknown; receipt?: unknown };
      try { parsed = JSON.parse(readFileSync(artifact, "utf8")); } catch { writeText("✗ artifact is not valid JSON"); process.exitCode = 1; return; }
      const v = core.hydra.verifyCodebook(parsed.receipt, parsed.codebook);
      if (opts.json) { writeJson(v); process.exitCode = v.bound ? 0 : 1; return; }
      writeText(v.bound ? `✓ VERIFIED (offline) — ${v.reason}` : `✗ NOT VERIFIED — ${v.reason}`);
      process.exitCode = v.bound ? 0 : 1;
    });
}
