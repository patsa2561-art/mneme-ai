/**
 * Phase 3 orchestrator. Takes a Phase-2 EvolveProposal, runs the
 * template library against its signals, applies + verifies, and
 * returns a SynthesisResult with HMAC signature.
 *
 * The orchestrator is the ONLY place that talks to disk (other than
 * verify.ts which writes the patched file in-place during gating).
 * Templates are pure functions; gates are pure subprocess wrappers;
 * synthesize.ts wires them together.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import type { EvolveProposal } from "../types.js";
import type { SynthesisResult, ApplyResult, AutoPrResult } from "./types.js";
import { matchTemplate } from "./templates.js";
import { applyAndVerify } from "./verify.js";

const PROPOSALS_DIR = ".mneme/proposals";
const SECRET_FILE = ".mneme/.evolve-secret";

function ensureDir(repoRoot: string, relPath: string): void {
  const d = join(repoRoot, relPath);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/** Read or create the per-repo HMAC secret. 32 random bytes, hex-encoded. */
function readOrCreateSecret(repoRoot: string): string {
  const path = join(repoRoot, SECRET_FILE);
  if (existsSync(path)) {
    try { return readFileSync(path, "utf8").trim(); } catch { /* fall through */ }
  }
  ensureDir(repoRoot, ".mneme");
  const secret = randomBytes(32).toString("hex");
  try { writeFileSync(path, secret, "utf8"); } catch { /* best-effort */ }
  return secret;
}

/** HMAC-SHA256 over a stable subset of the SynthesisResult. */
function signResult(secret: string, partial: Omit<SynthesisResult, "signature">): string {
  const payload = JSON.stringify({
    id: partial.id,
    proposalId: partial.proposalId,
    templateId: partial.templateId,
    synthesizedAt: partial.synthesizedAt,
    filePath: partial.filePath,
    patchText: partial.patchText,
    gates: partial.gates,
    verified: partial.verified,
    confidence: partial.confidence,
  });
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Re-verify a saved SynthesisResult's signature. */
export function verifySignature(repoRoot: string, result: SynthesisResult): boolean {
  const secret = readOrCreateSecret(repoRoot);
  const expected = signResult(secret, result);
  return expected === result.signature;
}

/**
 * Read a Phase-2 proposal by id.
 */
function readProposal(repoRoot: string, proposalId: string): EvolveProposal | null {
  const path = join(repoRoot, PROPOSALS_DIR, `${proposalId}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as EvolveProposal; }
  catch { return null; }
}

/**
 * Synthesize a verified patch from a Phase-2 proposal.
 *
 * Pipeline:
 *   1. Load proposal.
 *   2. For each signal, try every template -- first match wins.
 *   3. If no template matches: return synthesizedAt + verified:false.
 *   4. If a template matches: apply + run gates.
 *   5. Build SynthesisResult with HMAC signature.
 *   6. Persist .patch + .synth.json sidecar in `.mneme/proposals/`.
 *
 * Returns SynthesisResult regardless of pass/fail (failures are
 * recorded so the user can see WHY it didn't pass).
 */
export function synthesize(repoRoot: string, proposalId: string): SynthesisResult | null {
  const proposal = readProposal(repoRoot, proposalId);
  if (!proposal) return null;

  for (const signal of proposal.signals) {
    const match = matchTemplate(repoRoot, signal);
    if (!match) continue;

    const synthesizedAt = new Date().toISOString();
    const id = createHash("sha256")
      .update(proposalId).update(match.templateId).update(match.filePath).update(synthesizedAt)
      .digest("hex").slice(0, 16);

    const verifyResult = applyAndVerify(repoRoot, match);
    const verified = verifyResult.kept;

    // Confidence bump: Phase-2 baseline + 0.50 if all gates green.
    // Saturates at 0.99.
    const baseConf = proposal.confidence;
    const bump = verified ? 0.5 : 0;
    const confidence = Math.min(0.99, baseConf + bump);

    const partial: Omit<SynthesisResult, "signature"> = {
      id,
      proposalId,
      templateId: match.templateId,
      synthesizedAt,
      filePath: match.filePath,
      patchText: verifyResult.patchText,
      gates: verifyResult.gates,
      verified,
      confidence,
    };
    const secret = readOrCreateSecret(repoRoot);
    const signature = signResult(secret, partial);
    const result: SynthesisResult = { ...partial, signature };

    // Persist BOTH the .patch (human-readable, git-apply-friendly)
    // AND the .synth.json (machine-readable, with signature).
    ensureDir(repoRoot, PROPOSALS_DIR);
    if (verified && verifyResult.patchText) {
      try {
        writeFileSync(join(repoRoot, PROPOSALS_DIR, `${proposalId}.patch`), verifyResult.patchText, "utf8");
      } catch { /* best-effort */ }
    }
    try {
      writeFileSync(
        join(repoRoot, PROPOSALS_DIR, `${proposalId}.synth.json`),
        JSON.stringify(result, null, 2),
        "utf8",
      );
    } catch { /* best-effort */ }

    return result;
  }

  // No template matched any signal.
  return null;
}

/**
 * Apply a verified .patch via `git apply`. Refuses if the synthesis
 * sidecar isn't present, or if its signature doesn't verify, or if
 * the proposal wasn't verified.
 */
export function applyPatch(repoRoot: string, proposalId: string): ApplyResult {
  const synthPath = join(repoRoot, PROPOSALS_DIR, `${proposalId}.synth.json`);
  const patchPath = join(repoRoot, PROPOSALS_DIR, `${proposalId}.patch`);
  if (!existsSync(synthPath)) return { ok: false, appliedAt: new Date().toISOString(), reason: "no synthesis sidecar" };
  if (!existsSync(patchPath)) return { ok: false, appliedAt: new Date().toISOString(), reason: "no .patch file" };
  let synth: SynthesisResult;
  try { synth = JSON.parse(readFileSync(synthPath, "utf8")) as SynthesisResult; }
  catch (e) { return { ok: false, appliedAt: new Date().toISOString(), reason: `cannot parse synth.json: ${(e as Error).message}` }; }

  if (!synth.verified) return { ok: false, appliedAt: new Date().toISOString(), reason: "patch was not verified at synthesis time" };
  if (!verifySignature(repoRoot, synth)) return { ok: false, appliedAt: new Date().toISOString(), reason: "HMAC signature mismatch -- patch tampered or secret changed" };

  // Run `git apply --check` first.
  const check = spawnSync("git", ["apply", "--check", patchPath], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
  if (check.status !== 0) {
    return { ok: false, appliedAt: new Date().toISOString(), reason: `git apply --check failed: ${(check.stderr || check.stdout || "").slice(0, 300)}` };
  }
  const apply = spawnSync("git", ["apply", patchPath], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
  if (apply.status !== 0) {
    return { ok: false, appliedAt: new Date().toISOString(), reason: `git apply failed: ${(apply.stderr || apply.stdout || "").slice(0, 300)}` };
  }
  return { ok: true, appliedAt: new Date().toISOString() };
}

/**
 * Phase 5 helper -- the daemon calls this on a 6h tick.
 * Scans every persisted Phase-2 proposal, tries to synthesize a Phase-3
 * patch for each, returns a summary of what was newly verified.
 */
export function evolutionPass(repoRoot: string): {
  scanned: number;
  synthesized: number;
  verified: number;
  results: SynthesisResult[];
} {
  const dir = join(repoRoot, PROPOSALS_DIR);
  if (!existsSync(dir)) return { scanned: 0, synthesized: 0, verified: 0, results: [] };
  const ids = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".synth.json"))
    .map((f) => f.slice(0, -5));
  const results: SynthesisResult[] = [];
  let synthesized = 0;
  let verified = 0;
  for (const id of ids) {
    // Skip proposals that already have a synth sidecar (idempotent).
    if (existsSync(join(dir, `${id}.synth.json`))) continue;
    const r = synthesize(repoRoot, id);
    if (r) {
      synthesized++;
      if (r.verified) verified++;
      results.push(r);
    }
  }
  return { scanned: ids.length, synthesized, verified, results };
}

/**
 * Phase 4 helper -- wraps `gh pr create` for a verified patch.
 * Refuses if `gh` is missing or if the patch isn't verified.
 *
 * Convention: creates a branch named `mneme/evolve/<id>`, applies
 * the patch, commits with a deterministic message, pushes, opens PR.
 */
export function autoPr(repoRoot: string, proposalId: string, opts: { dryRun?: boolean } = {}): AutoPrResult {
  const synthPath = join(repoRoot, PROPOSALS_DIR, `${proposalId}.synth.json`);
  const patchPath = join(repoRoot, PROPOSALS_DIR, `${proposalId}.patch`);
  if (!existsSync(synthPath) || !existsSync(patchPath)) {
    return { ok: false, reason: "no synthesis artifacts -- run `mneme evolve synthesize <id>` first" };
  }
  let synth: SynthesisResult;
  try { synth = JSON.parse(readFileSync(synthPath, "utf8")) as SynthesisResult; }
  catch (e) { return { ok: false, reason: `cannot parse synth.json: ${(e as Error).message}` }; }
  if (!synth.verified) return { ok: false, reason: "patch was not verified" };

  // Detect gh.
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["gh"],
    { encoding: "utf8", timeout: 3_000 });
  if (which.status !== 0) {
    return { ok: false, reason: "`gh` CLI not on PATH -- install from https://cli.github.com" };
  }

  if (opts.dryRun) {
    return { ok: true, reason: "dry-run -- no branch/commit/push/PR was created" };
  }

  const branch = `mneme/evolve/${proposalId}`;
  // Create branch
  let r = spawnSync("git", ["checkout", "-b", branch], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) return { ok: false, reason: `git checkout -b ${branch}: ${(r.stderr || "").slice(0, 200)}` };

  // Apply patch
  r = spawnSync("git", ["apply", patchPath], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) return { ok: false, reason: `git apply: ${(r.stderr || "").slice(0, 200)}` };

  // Stage + commit
  r = spawnSync("git", ["add", synth.filePath], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) return { ok: false, reason: `git add: ${(r.stderr || "").slice(0, 200)}` };
  const commitMsg = `mneme evolve: ${synth.templateId} (${proposalId})\n\nGenerated by Mneme EVOLVE Phase 3.\nVerified: tsc + vitest gates passed.\nHMAC: ${synth.signature.slice(0, 16)}\n`;
  r = spawnSync("git", ["commit", "-m", commitMsg], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) return { ok: false, reason: `git commit: ${(r.stderr || "").slice(0, 200)}` };

  // Push
  r = spawnSync("git", ["push", "-u", "origin", branch], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return { ok: false, reason: `git push: ${(r.stderr || "").slice(0, 200)}` };

  // Open PR
  const prTitle = `mneme evolve: ${synth.templateId}`;
  const prBody = `Auto-generated by Mneme EVOLVE Phase 3 (HMAC ${synth.signature.slice(0, 16)})\n\nProposal id: \`${proposalId}\`\nTemplate: \`${synth.templateId}\`\nFile: \`${synth.filePath}\`\nVerified: tsc + vitest gates passed at ${synth.synthesizedAt}.\n`;
  r = spawnSync("gh", ["pr", "create", "--title", prTitle, "--body", prBody], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return { ok: false, reason: `gh pr create: ${(r.stderr || "").slice(0, 200)}` };
  const url = (r.stdout || "").trim().split("\n").reverse().find((l) => l.startsWith("https://"));
  return { ok: true, prUrl: url };
}
