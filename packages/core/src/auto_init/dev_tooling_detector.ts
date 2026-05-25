/**
 * v2.45.0 — DEV-TOOLING DETECTOR (closes caveat #3).
 *
 * The bug: user's own `D:\typecrypt\` scratch folder has CLAUDE.md +
 * AGENTS.md + .cursorrules + .windsurfrules + .mneme/ but is NOT a git
 * repo. AUTO-INIT shouldn't poison such folders with a fake .gitignore.
 *
 * Heuristic: "this folder is an AI-dev scratch dir" when:
 *   - NOT a git repo (no .git/HEAD)
 *   - AND has ≥ 3 AI-tooling fingerprint files at the root
 *
 * Pure read; no I/O writes.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const FINGERPRINTS = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".windsurfrules",
  ".windsurf",
  ".cursor",
  ".aider.conf.yml",
  ".continuerc",
  "GEMINI.md",
  ".mneme",
];

export interface DevToolingVerdict {
  isDevTooling: boolean;
  isGitRepo: boolean;
  fingerprints: string[];
  reason: string;
}

export function detectDevTooling(cwd: string): DevToolingVerdict {
  // Defensive: bad path → not a tooling folder (autoInit will fail elsewhere).
  if (!cwd || !existsSync(cwd)) {
    return { isDevTooling: false, isGitRepo: false, fingerprints: [], reason: "path does not exist" };
  }
  const isGitRepo = existsSync(join(cwd, ".git")) || existsSync(join(cwd, ".git", "HEAD"));
  const fingerprints: string[] = [];
  for (const f of FINGERPRINTS) {
    if (existsSync(join(cwd, f))) fingerprints.push(f);
  }
  // Rule: NOT a git repo + ≥3 AI fingerprints → tooling folder.
  if (!isGitRepo && fingerprints.length >= 3) {
    return {
      isDevTooling: true,
      isGitRepo: false,
      fingerprints,
      reason: `not a git repo + ${fingerprints.length} AI-fingerprint files (${fingerprints.slice(0, 3).join(", ")}...) — looks like an AI-dev scratch folder, not a customer repo`,
    };
  }
  return {
    isDevTooling: false,
    isGitRepo,
    fingerprints,
    reason: isGitRepo
      ? "is a git repo (customer-facing)"
      : `not a git repo but only ${fingerprints.length} fingerprint(s) — too few to flag as tooling`,
  };
}
