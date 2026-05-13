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
import { writeSecretFile } from "../../util/secret_store.js";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import type { EvolveProposal, EvolveSignal } from "../types.js";
import type { SynthesisResult, ApplyResult, AutoPrResult } from "./types.js";
import { matchTemplate } from "./templates.js";
import { applyAndVerify } from "./verify.js";
import { trackRecordFor, recordApply } from "./lineage.js";
import { computePatchRisk } from "./risk.js";

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
  // v2.4: secret lands at 0600 / locked ACL via the shared helper.
  try { writeSecretFile(path, secret); } catch { /* best-effort */ }
  return secret;
}

/** HMAC-SHA256 over a stable subset of the SynthesisResult. */
function signResult(secret: string, partial: Omit<SynthesisResult, "signature">): string {
  // v1.27.5: include risk in the signature so a tampered risk block
  // (which would change the displayed safety score) is detectable.
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
    risk: partial.risk ?? null,
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

    // v1.27.5 -- TRULY differentiated confidence formula. v1.27.4
    // formula was "differentiated" in theory but in practice every
    // selfcheck-template patch on the same checks.ts file got the
    // same 0.734 score. Reason: signal evidence + test_coverage
    // existence don't vary across signals that all hit the same file.
    //
    // The fix: add a per-PATCH RISK score from CODE METRICS. Two
    // signals on the same template now score differently if they hit
    // files with different risk profiles (LOC, fan-in, churn, age,
    // test density).
    //
    //   confidence = clip(0.05, 0.99,
    //     0.15 * signal_evidence       // occurrences + source diversity
    //   + 0.20 * template_track_record // from Provenance Chain
    //   + 0.20 * patch_safety          // from PatchRisk -- THE NEW ENTROPY
    //   + 0.05 * test_density_bonus    // co-located vitest test count
    //   + 0.40 * verification          // all gates green
    //   )

    const totalOcc = signal.occurrences;
    const sourceCount = new Set(proposal.signals.map((s: EvolveSignal) => s.kind)).size;
    const occScore = Math.min(1, totalOcc / 10);
    const srcScore = Math.min(1, sourceCount / 3);
    const signalEvidence = 0.7 * occScore + 0.3 * srcScore;

    const track = trackRecordFor(repoRoot, match.templateId);
    const trackRecord = track.score;

    // v1.27.5: per-patch risk from code metrics. THIS is where real
    // differentiation comes from. Two patches to the same file get
    // the same risk; patches to different files get different risk.
    const risk = computePatchRisk(repoRoot, match.filePath);
    const patchSafety = risk.safetyScore;

    // Test density bonus: 0.5 if no test, 1.0 saturating at 20+ tests.
    const testDensityBonus = verifyResult.gates.testsOk === true
      ? Math.min(1, 0.5 + risk.testDensity / 40)
      : verifyResult.gates.testsOk === null ? 0.4
      : 0;

    const verificationFactor = verified ? 1.0 : 0;

    const rawConfidence =
      0.15 * signalEvidence +
      0.20 * trackRecord +
      0.20 * patchSafety +
      0.05 * testDensityBonus +
      0.40 * verificationFactor;

    const confidence = Math.max(0.05, Math.min(0.99, rawConfidence));

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
      risk: {
        fileAgeDays: risk.fileAgeDays,
        churn30d: risk.churn30d,
        loc: risk.loc,
        testDensity: risk.testDensity,
        fanIn: risk.fanIn,
        riskScore: risk.riskScore,
        safetyScore: risk.safetyScore,
      },
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

  // v1.27.5: no template matched any signal -- write a placeholder
  // .md scaffold so the human writer has a structured starting
  // point, instead of silent skip ("No template matched"). The
  // placeholder includes the proposal's evidence + a stub for the
  // human to fill in. Returns null (no SynthesisResult), but the
  // file IS written.
  try {
    ensureDir(repoRoot, PROPOSALS_DIR);
    const placeholderPath = join(repoRoot, PROPOSALS_DIR, `${proposalId}.placeholder.md`);
    if (!existsSync(placeholderPath)) {
      const md = buildPlaceholderMd(proposal);
      writeFileSync(placeholderPath, md, "utf8");
    }
  } catch { /* best-effort */ }
  return null;
}

/**
 * Build a markdown scaffold when no template matches. Lifts the
 * proposal's evidence + signals into a structured fill-in-the-blank
 * format the human writer can convert into a real patch.
 */
function buildPlaceholderMd(proposal: EvolveProposal): string {
  const lines: string[] = [];
  lines.push(`# Phase-3 PLACEHOLDER -- no template matched\n`);
  lines.push(`**Proposal:** \`${proposal.id}\`  \n**Title:** ${proposal.title}\n`);
  lines.push(`> No deterministic template in the v1.27.5 library matched any of this proposal's signals.\n> A human writer (or future LLM-augmented template) is needed to turn this proposal into a verifiable patch.\n`);
  lines.push(`## Signals to address\n`);
  for (const s of proposal.signals) {
    lines.push(`- **\`${s.pattern}\`** (\`${s.kind}\`, ${s.occurrences} occurrence${s.occurrences === 1 ? "" : "s"})`);
    if (s.evidence) lines.push(`  - Evidence: ${s.evidence}`);
    if (s.filePath) lines.push(`  - File: \`${s.filePath}\``);
  }
  lines.push(``);
  if (proposal.suggestion) {
    lines.push(`## Suggested direction (from Phase-2)\n`);
    lines.push(`- Touch files: ${proposal.suggestion.files.map((f) => `\`${f}\``).join(", ")}`);
    lines.push(`- ${proposal.suggestion.direction}`);
    lines.push(``);
  }
  lines.push(`## Author the patch\n`);
  lines.push(`1. Open the file(s) above.`);
  lines.push(`2. Make the change. Keep it minimal -- one signal = one diff.`);
  lines.push(`3. Run \`tsc --noEmit\` and \`vitest run <co-located-test>\` locally.`);
  lines.push(`4. When green, save the .patch:\n`);
  lines.push(`   \`\`\`bash`);
  lines.push(`   git diff > .mneme/proposals/${proposal.id}.patch`);
  lines.push(`   \`\`\``);
  lines.push(`5. Then \`mneme evolve apply ${proposal.id}\` to record the lineage entry + run the gate verification.`);
  lines.push(``);
  lines.push(`> Generated by Mneme EVOLVE Phase-3 (v1.27.5+) when no deterministic template matched.\n> This file is a SCAFFOLD, not a verified patch -- no HMAC signature, no gate verification yet.`);
  return lines.join("\n");
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
  // Capture HEAD commit BEFORE the apply so the lineage entry can
  // reference what state the patch was applied on top of.
  let gitCommitBefore: string | null = null;
  try {
    const headRev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8", timeout: 5_000 });
    if (headRev.status === 0) gitCommitBefore = (headRev.stdout || "").trim() || null;
  } catch { /* */ }

  const apply = spawnSync("git", ["apply", patchPath], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
  if (apply.status !== 0) {
    return { ok: false, appliedAt: new Date().toISOString(), reason: `git apply failed: ${(apply.stderr || apply.stdout || "").slice(0, 300)}` };
  }

  // v1.27.4 -- record the apply in the Patch Provenance Chain so
  // future synthesis runs of the same template see prior-accept
  // history and confidence varies accordingly.
  try {
    // We only have synth here (no proposal). Read the proposal's first
    // signal evidence as the human signalSummary.
    const proposalPath = join(repoRoot, PROPOSALS_DIR, `${proposalId}.json`);
    let signalSummary: string = String(synth.templateId);
    if (existsSync(proposalPath)) {
      try {
        const p = JSON.parse(readFileSync(proposalPath, "utf8")) as { signals?: Array<{ pattern?: string; evidence?: string }> };
        const s0 = p.signals?.[0];
        if (s0?.pattern) signalSummary = `${s0.pattern}${s0.evidence ? ` -- ${s0.evidence.slice(0, 80)}` : ""}`;
      } catch { /* */ }
    }
    recordApply(repoRoot, {
      templateId: synth.templateId,
      proposalId,
      gitCommitBefore,
      signalSummary,
    });
  } catch { /* lineage is best-effort -- don't fail the apply */ }

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
