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
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** Run a git command; returns "" on any failure (total — never throws). */
function git(repoRoot: string, args: string[]): string {
  try { return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim(); }
  catch { return ""; }
}

/** Deterministic corpus = the HEAD tree snapshot (mode type sha\tpath per
 *  line). Changes exactly when the tracked content changes. "" if no repo. */
function gitTreeCorpus(repoRoot: string): string {
  return git(repoRoot, ["ls-tree", "-r", "HEAD"]);
}

function headMeta(repoRoot: string): Record<string, string> {
  const commit = git(repoRoot, ["rev-parse", "HEAD"]);
  const subject = git(repoRoot, ["log", "-1", "--pretty=%s"]);
  const meta: Record<string, string> = {};
  if (commit) meta.commit = commit;
  if (subject) meta.subject = subject.slice(0, 120);
  return meta;
}

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
  forgeCodebook: (corpus: string, opts?: Record<string, unknown>) => { codebook: unknown };
  appendToChain: (repoRoot: string, chain: unknown[], next: unknown, at: number, meta?: Record<string, string>) => { chain: unknown[]; delta: { seq: number; added: unknown[]; removed: unknown[]; resultHash?: string } };
  verifyChain: (chain: unknown[]) => { ok: boolean; length: number; brokenAt: number; reason: string };
  chainGauntlet: (chain: unknown[]) => { verified: boolean; replayExact: boolean; tamperCaught: boolean; length: number; score: number };
  guardedReplay: (chain: unknown[], index: number, halfLifeDeltas: number) => { ok: boolean; codebook: { entries: Array<{ sym: string; phrase: string }> } | null; trust: { trustMap: Record<string, string>; freshCount: number; staleCount: number; atIndex: number }; reason: string };
  guardedChainGauntlet: (chain: unknown[], halfLifeDeltas: number) => { deterministic: boolean; freshAtTip: boolean; provenOnly: boolean; stable: boolean; score: number };
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

  h.command("chain")
    .description("PROVENANCE CHAIN: forge the current corpus's codebook and append a SIGNED delta to .mneme/hydra/chain.json, then verify the WHOLE history offline (Ed25519 sigs + prev→result links + byte-exact replay to every step). With --git the corpus is the HEAD tree snapshot and the delta is ANCHORED to the commit sha+subject (signed) — a portable, offline-verifiable record of Mneme's context at each commit (complements git; not a replacement). Idempotent: re-running on the same HEAD appends a no-change delta only if content moved.")
    .option("--file <path>", "corpus file (default: the rendered manifest)")
    .option("--git", "use the HEAD git-tree snapshot as the corpus + anchor the delta to the commit")
    .option("--note <text>", "extra note recorded (signed) in the delta meta")
    .option("--skip-unchanged", "do not append if the corpus codebook is identical to the chain tip")
    .option("--json", "JSON output.")
    .action(async (opts: { file?: string; git?: boolean; note?: string; skipUnchanged?: boolean; json?: boolean }) => {
      const core = await resolveCore();
      if (!core) { writeText("✗ @mneme-ai/core hydra unavailable."); process.exitCode = 1; return; }
      const repoRoot = process.cwd();
      try {
        const dir = join(repoRoot, ".mneme", "hydra");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const chainPath = join(dir, "chain.json");
        let chain: unknown[] = [];
        if (existsSync(chainPath)) {
          try { const parsed = JSON.parse(readFileSync(chainPath, "utf8")); if (Array.isArray(parsed)) chain = parsed; } catch { chain = []; }
        }
        // Build corpus + anchor metadata.
        let corpus: string;
        let meta: Record<string, string> = {};
        if (opts.git) {
          corpus = gitTreeCorpus(repoRoot);
          if (!corpus) { if (opts.json) { writeJson({ ok: false, reason: "no git HEAD / not a repo" }); } else { writeText("· skipped: not a git repo (or empty HEAD)"); } return; }
          meta = headMeta(repoRoot);
        } else {
          corpus = corpusFor(opts.file, core.agentManifest);
        }
        if (opts.note) meta.note = String(opts.note).slice(0, 200);
        const cb = core.hydra.forgeCodebook(corpus, {}).codebook;
        // Idempotency: skip when the new codebook == the chain tip's result.
        if (opts.skipUnchanged && chain.length > 0) {
          const tip = core.hydra.verifyChain(chain);
          const replay = core.hydra.chainGauntlet(chain);
          const next = core.hydra.appendToChain(repoRoot, [], cb, 1).delta;
          const tipResult = (chain[chain.length - 1] as { resultHash?: string }).resultHash;
          if (tip.ok && replay.score === 100 && (next as { resultHash?: string }).resultHash === tipResult) {
            if (opts.json) { writeJson({ ok: true, skipped: true, reason: "unchanged since tip", length: chain.length }); } else { writeText(`· unchanged since tip — chain stays ${chain.length} link(s)`); }
            return;
          }
        }
        const appended = core.hydra.appendToChain(repoRoot, chain, cb, Date.now(), Object.keys(meta).length ? meta : undefined);
        writeFileSync(chainPath, JSON.stringify(appended.chain, null, 2));
        const g = core.hydra.chainGauntlet(appended.chain);
        const v = core.hydra.verifyChain(appended.chain);
        if (opts.json) { writeJson({ gauntlet: g, verify: v, meta, delta: { seq: appended.delta.seq, added: appended.delta.added.length, removed: appended.delta.removed.length }, chainPath }); process.exitCode = g.score === 100 ? 0 : 1; return; }
        writeText(`HYDRA provenance chain — ${g.length} link(s)`);
        writeText(``);
        if (meta.commit) writeText(`  anchor: commit ${meta.commit.slice(0, 10)} "${meta.subject ?? ""}"`);
        writeText(`  new delta #${appended.delta.seq}: +${appended.delta.added.length} phrases · -${appended.delta.removed.length} phrases (signed)`);
        writeText(`  verified(offline): ${g.verified ? "✓" : "✗"}  ·  replay-exact: ${g.replayExact ? "✓" : "✗"}  ·  tamper-caught: ${g.tamperCaught ? "✓" : "✗"}`);
        writeText(`  → ${chainPath}`);
        writeText(``);
        writeText(g.score === 100 ? `  ✓ CHAIN 100/100 — ${v.reason}` : `  ✗ CHAIN ${g.score}/100 — broken at delta ${v.brokenAt}: ${v.reason}`);
        process.exitCode = g.score === 100 ? 0 : 1;
      } catch (e) {
        // 108-error rule: provenance must never crash the host (or a commit).
        if (opts.json) { writeJson({ ok: false, reason: (e as Error).message }); } else { writeText(`· hydra chain skipped (non-fatal): ${(e as Error).message}`); }
      }
    });

  h.command("replay <index>")
    .description("TEMPORAL GUARDED REPLAY (Guard × Chain fusion): replay the codebook at a past chain step. With --guard, staleness is derived from the chain's OWN history (atrophy) and cold entries would expand only to a signed abstract — the AI gets the shape of old knowledge, not rotten detail. Reads .mneme/hydra/chain.json.")
    .option("--guard", "derive temporal staleness from chain history + report what would be redacted")
    .option("--halflife <n>", "atrophy half-life in deltas (entries older than 2× → stale)", (v) => parseInt(v, 10), 3)
    .option("--json", "JSON output.")
    .action(async (indexArg: string, opts: { guard?: boolean; halflife?: number; json?: boolean }) => {
      const core = await resolveCore();
      if (!core) { writeText("✗ @mneme-ai/core hydra unavailable."); process.exitCode = 1; return; }
      const chainPath = join(process.cwd(), ".mneme", "hydra", "chain.json");
      if (!existsSync(chainPath)) { writeText("✗ no chain yet — run `mneme hydra chain --git` first."); process.exitCode = 1; return; }
      let chain: unknown[] = [];
      try { const p = JSON.parse(readFileSync(chainPath, "utf8")); if (Array.isArray(p)) chain = p; } catch { writeText("✗ chain.json unreadable"); process.exitCode = 1; return; }
      const index = Number.isFinite(parseInt(indexArg, 10)) ? parseInt(indexArg, 10) : chain.length - 1;
      const hl = opts.halflife ?? 3;
      const r = core.hydra.guardedReplay(chain, index, hl);
      if (!r.ok || !r.codebook) { if (opts.json) { writeJson(r); } else { writeText(`✗ replay failed: ${r.reason}`); } process.exitCode = 1; return; }
      if (opts.json) { writeJson({ atIndex: r.trust.atIndex, entries: r.codebook.entries.length, guard: !!opts.guard, fresh: r.trust.freshCount, stale: r.trust.staleCount, halflife: hl }); return; }
      writeText(`HYDRA replay — codebook at chain step ${r.trust.atIndex} (${r.codebook.entries.length} entries)`);
      if (opts.guard) {
        writeText(``);
        writeText(`  temporal guard (half-life ${hl} deltas): ${r.trust.freshCount} fresh · ${r.trust.staleCount} stale (redacted)`);
        const staleSyms = Object.keys(r.trust.trustMap);
        const sample = r.codebook.entries.filter((e) => staleSyms.includes(e.sym)).slice(0, 3);
        for (const e of sample) writeText(`    ⊘ redacted (cold): "${e.phrase.slice(0, 40).replace(/\n/g, " ")}…"`);
        writeText(``);
        writeText(`  ✓ cold knowledge is redacted to a signed abstract — the AI sees its shape, not rotten detail.`);
      }
    });

  h.command("install-hook")
    .description("Install a git post-commit hook that runs `mneme hydra chain --git` after every commit — anchoring a signed HYDRA context delta to each commit. Non-blocking + fail-open (never breaks a commit). Sentinel-bracketed: re-installs cleanly, composes with an existing hook.")
    .option("--uninstall", "remove the Mneme block from the post-commit hook instead")
    .action(async (opts: { uninstall?: boolean }) => {
      const repoRoot = process.cwd();
      const gitDir = git(repoRoot, ["rev-parse", "--git-dir"]);
      if (!gitDir) { writeText("✗ not a git repo (no .git)"); process.exitCode = 1; return; }
      const hooksDir = join(repoRoot, gitDir, "hooks");
      const hookPath = join(hooksDir, "post-commit");
      const BEGIN = "# >>> mneme hydra chain >>>";
      const END = "# <<< mneme hydra chain <<<";
      const block = [
        BEGIN,
        "# Auto-anchor a signed HYDRA context delta to this commit. Fail-open + non-blocking.",
        "# Honors MNEME_CLI_BIN (a path to mneme's bin, run via node) for CI / monorepo / testing.",
        `if [ -n "$MNEME_CLI_BIN" ]; then node "$MNEME_CLI_BIN" hydra chain --git --skip-unchanged >/dev/null 2>&1 || true;`,
        `else mneme hydra chain --git --skip-unchanged >/dev/null 2>&1 || true; fi`,
        END,
      ].join("\n");
      let existing = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : "";
      // Strip any prior Mneme block.
      const bi = existing.indexOf(BEGIN), ei = existing.indexOf(END);
      if (bi >= 0 && ei > bi) existing = (existing.slice(0, bi) + existing.slice(ei + END.length)).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
      if (opts.uninstall) {
        if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
        writeFileSync(hookPath, existing.trim() ? existing : "#!/bin/sh\n");
        writeText("✓ removed the Mneme block from post-commit hook"); return;
      }
      if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
      const head = existing.startsWith("#!") ? "" : "#!/bin/sh\n";
      const next = (head + existing).trimEnd() + "\n\n" + block + "\n";
      writeFileSync(hookPath, next);
      try { chmodSync(hookPath, 0o755); } catch { /* windows: no-op */ }
      writeText(`✓ installed post-commit hook → ${hookPath}`);
      writeText(`  every commit now appends a signed HYDRA delta anchored to its sha (fail-open, non-blocking).`);
      writeText(`  remove with: mneme hydra install-hook --uninstall`);
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
