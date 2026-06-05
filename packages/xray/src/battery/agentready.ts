/**
 * AGENT-READINESS — is this repo SAFE for an autonomous AI agent to work in?
 *
 * Before you point Claude Code / Cursor / a Grok agent at a repo and walk away, you want to
 * know it has the guardrails that catch an agent's mistakes: CI to run tests, a test suite,
 * a lockfile for reproducible installs, CODEOWNERS / review gates, lint, and a security
 * policy. This scores those GOVERNANCE SIGNALS (0–100) from the cloned repo's files alone.
 *
 * ★HONEST: these are SIGNALS that the safety nets EXIST — not a proof the repo is safe or
 * that the nets are enforced (branch protection isn't visible from a clone). Deterministic,
 * no LLM. A high score = "an agent's slip is more likely to be caught here."
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface AgentReadySignal { key: string; label: string; present: boolean; weight: number }
export interface AgentReadyBlock {
  score: number;            // 0–100
  band: "ready" | "caution" | "risky";
  signals: AgentReadySignal[];
  present: string[];
  missing: string[];
  note: string;
}

const has = (root: string, rel: string): boolean => { try { return existsSync(join(root, rel)); } catch { return false; } };
function hasAny(root: string, rels: string[]): boolean { return rels.some((r) => has(root, r)); }
function dirHasFiles(root: string, rel: string): boolean { try { return existsSync(join(root, rel)) && readdirSync(join(root, rel)).length > 0; } catch { return false; } }
function pkgHasTestScript(root: string): boolean { try { const p = join(root, "package.json"); if (!existsSync(p)) return false; const j = JSON.parse(readFileSync(p, "utf8")) as { scripts?: Record<string, string> }; const t = j.scripts?.test ?? ""; return !!t && !/no test specified/i.test(t); } catch { return false; } }
function hasTests(root: string): boolean {
  if (pkgHasTestScript(root)) return true;
  if (["test", "tests", "spec", "__tests__"].some((d) => dirHasFiles(root, d))) return true;
  // shallow scan for *.test.* / *_test.* / test_*.py at the top two levels
  try {
    const scan = (dir: string, depth: number): boolean => {
      if (depth < 0) return false;
      for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isFile() && /(\.|_)(test|spec)\.|^test_.*\.py$/i.test(e.name)) return true;
        if (e.isDirectory() && depth > 0 && scan(rel, depth - 1)) return true;
      }
      return false;
    };
    return scan("", 2);
  } catch { return false; }
}

export function analyzeAgentReadiness(repoPath: string): AgentReadyBlock {
  const signals: AgentReadySignal[] = [
    { key: "ci", label: "CI pipeline", weight: 25, present: dirHasFiles(repoPath, ".github/workflows") || hasAny(repoPath, [".gitlab-ci.yml", "azure-pipelines.yml", ".circleci/config.yml", ".travis.yml", "Jenkinsfile", ".github/workflows"]) },
    { key: "tests", label: "Test suite", weight: 25, present: hasTests(repoPath) },
    { key: "lockfile", label: "Dependency lockfile", weight: 15, present: hasAny(repoPath, ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "go.sum", "Gemfile.lock", "composer.lock", "requirements.txt"]) },
    { key: "codeowners", label: "CODEOWNERS / review gate", weight: 12, present: hasAny(repoPath, ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"]) },
    { key: "lint", label: "Lint / format config", weight: 10, present: hasAny(repoPath, [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", ".prettierrc", ".prettierrc.json", "ruff.toml", ".flake8", ".rubocop.yml", "rustfmt.toml"]) },
    { key: "security", label: "Security policy", weight: 7, present: hasAny(repoPath, ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md"]) },
    { key: "agentguide", label: "Agent guidance (AGENTS.md / CLAUDE.md)", weight: 6, present: hasAny(repoPath, ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".cursor/rules", "GEMINI.md", ".windsurfrules"]) },
  ];
  const score = Math.round(signals.reduce((s, x) => s + (x.present ? x.weight : 0), 0));
  const band: AgentReadyBlock["band"] = score >= 70 ? "ready" : score >= 40 ? "caution" : "risky";
  const present = signals.filter((s) => s.present).map((s) => s.label);
  const missing = signals.filter((s) => !s.present).map((s) => s.label);
  const note = band === "ready"
    ? "Strong guardrails — an autonomous agent's mistakes are likely to be caught here (CI + tests + review)."
    : band === "caution"
      ? "Some guardrails present, but gaps remain — review what's missing before letting an agent run unattended."
      : "Few safety nets — an autonomous agent could break things silently here. Add CI + tests before unattended runs.";
  return { score, band, signals, present, missing, note };
}
