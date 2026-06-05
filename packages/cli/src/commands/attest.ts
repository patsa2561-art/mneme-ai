/**
 * `mneme attest` (v2.192.0) — PROOF-CARRYING GIT COMMITS.
 *
 * Turns `git log` into a verifiable audit trail of AI work: each commit gets a
 * SIGNED (Ed25519), tamper-evident CANON attestation bound to its sha — which agent
 * made it, what changed, the deterministic screen that ran — chained, and verifiable
 * OFFLINE by ANY third party with the public key alone (no Mneme, no trust).
 *
 *   mneme attest commit [--commit HEAD]   # attest a commit (the post-commit hook calls this)
 *   mneme attest verify                   # verify the whole trail offline
 *   mneme attest log                      # the human-readable AI audit trail
 *   mneme attest install-hook             # opt-in: auto-attest every future commit
 */
import type { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { commitAttest } from "@mneme-ai/core";
import { updateWarm } from "./warm.js";

function out(s: string): void { process.stdout.write(s + "\n"); }
const DIR = ".mneme/attest";
const CHAIN = "chain.jsonl";

function git(args: string, cwd: string): string {
  try { return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

/** Detect the AI vendor that authored this commit from the environment, or "human". */
function detectAgent(): string {
  const e = process.env;
  if (e["CLAUDECODE"] || e["CLAUDE_CODE_SSE_PORT"] || e["CLAUDE_CODE_SESSION"] || e["CLAUDE_CODE_ENTRYPOINT"]) return "claude-code";
  if (e["CURSOR_AGENT"] || e["CURSOR_SESSION"]) return "cursor";
  if (e["CONTINUE_AGENT"] || e["CONTINUE_SESSION"]) return "continue";
  if (e["AIDER_VERSION"] || e["AIDER_AGENT"]) return "aider";
  if (e["DEVIN_SESSION"]) return "devin";
  if (e["GROK_AGENT"] || e["GROK_CLI"]) return "grok";
  if (e["GEMINI_AGENT"] || e["GEMINI_CLI"]) return "gemini";
  if (e["COPILOT_AGENT"]) return "copilot";
  if (e["CODEX_AGENT"] || e["CODEX_SESSION"]) return "codex";
  return "human";
}

// high-confidence secret patterns counted on ADDED (+) diff lines only
const SECRET_RX = [
  /AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{30,}/, /sk-[A-Za-z0-9]{20,}/, /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, /AIza[0-9A-Za-z_-]{30,}/,
];
function countAddedSecrets(diff: string): number {
  let n = 0;
  for (const ln of diff.split("\n")) { if (!ln.startsWith("+") || ln.startsWith("+++")) continue; for (const rx of SECRET_RX) if (rx.test(ln)) { n++; break; } }
  return n;
}

function gatherFacts(cwd: string, ref: string): commitAttest.CommitFacts | null {
  const sha = git(`rev-parse ${ref}`, cwd); if (!sha) return null;
  const meta = git(`show --no-patch --format=%an%x1f%ae%x1f%s%x1f%ct ${sha}`, cwd).split("\x1f");
  const files = git(`show --name-only --format= ${sha}`, cwd).split("\n").map((s) => s.trim()).filter(Boolean);
  const diff = git(`show --format= --unified=0 ${sha}`, cwd);
  return {
    sha, author: `${meta[0] ?? "?"} <${meta[1] ?? "?"}>`, agent: detectAgent(),
    subject: meta[2] ?? "", files, addedSecrets: countAddedSecrets(diff),
    diffHash: createHash("sha256").update(diff).digest("hex"), ts: (Number(meta[3]) || 0) * 1000,
  };
}

function chainPath(cwd: string): string { return join(cwd, DIR, CHAIN); }
function readChain(cwd: string): commitAttest.AttestEntry[] {
  const p = chainPath(cwd); if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as commitAttest.AttestEntry; } catch { return null; } }).filter(Boolean) as commitAttest.AttestEntry[];
}

export function registerAttestCommands(program: Command): void {
  const a = program.command("attest").description("🧬 PROOF-CARRYING GIT COMMITS — sign each commit into a tamper-evident, offline-verifiable CANON audit trail (which AI made it · what changed · the screen that ran). `git log` becomes provable.");

  a.command("commit")
    .description("Attest a commit (default HEAD): build a signed CANON record + append to the chain. The post-commit hook calls this automatically.")
    .option("--commit <ref>", "commit to attest", "HEAD")
    .option("--json", "JSON output.")
    .action((opts: { commit?: string; json?: boolean }) => {
      const cwd = process.cwd();
      if (!existsSync(join(cwd, ".git"))) { out("not a git repo"); process.exitCode = 2; return; }
      const f = gatherFacts(cwd, opts.commit ?? "HEAD");
      if (!f) { out("could not read that commit"); process.exitCode = 2; return; }
      const chain = readChain(cwd);
      if (chain.some((e) => e.record.subject === `commit:${f.sha}`)) { out(`already attested ${f.sha.slice(0, 10)}`); return; }
      const prev = chain.length ? chain[chain.length - 1].record.recordId : null;
      const entry = commitAttest.attestCommit(cwd, f, prev);
      mkdirSync(join(cwd, DIR), { recursive: true });
      appendFileSync(chainPath(cwd), JSON.stringify(entry) + "\n", "utf8");
      // fold this commit into the ALWAYS-WARM accountability state (automatic, O(1) reads).
      updateWarm(cwd, f.sha, f.agent);
      if (opts.json) { out(JSON.stringify(entry, null, 2)); return; }
      out(`🧬 attested ${f.sha.slice(0, 10)} · ${f.agent} · ${entry.record.verdict}${f.addedSecrets ? ` (⚠ ${f.addedSecrets} secret pattern(s))` : ""} · signed + chained`);
    });

  a.command("verify")
    .description("Verify the WHOLE attestation trail OFFLINE: every record's Ed25519 signature + tamper-evident binding + chain lineage + that each commit still exists in git. Exit 2 if broken.")
    .option("--json", "JSON output.")
    .action((opts: { json?: boolean }) => {
      const cwd = process.cwd();
      const chain = readChain(cwd);
      if (!chain.length) { out("no attestations yet — run `mneme attest commit` or install the hook"); return; }
      const v = commitAttest.verifyAttestChain(chain);
      // also confirm each attested commit still exists in git history
      const missing = chain.filter((e) => { const sha = e.record.subject.replace("commit:", ""); return !git(`cat-file -e ${sha}^{commit}`, cwd) && git(`cat-file -t ${sha}`, cwd) !== "commit"; }).length;
      if (opts.json) { out(JSON.stringify({ ...v, missingInGit: missing }, null, 2)); if (!v.ok) process.exitCode = 2; return; }
      out(`🧬 Commit attestation trail — ${v.valid}/${v.checked} signed records verified OFFLINE`);
      out(`   chain lineage: ${v.chainIntact ? "intact ✓" : "BROKEN ✗"} · by agent: ${Object.entries(v.agents).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
      if (v.broken.length) for (const b of v.broken.slice(0, 8)) out(`   ✗ ${b.sha.slice(0, 10)} — ${b.reason}`);
      out(v.ok ? `   ✓ genuine + untampered — anyone can re-verify with the public key, no trust required` : `   ✗ trail has issues (see above)`);
      if (!v.ok) process.exitCode = 2;
    });

  a.command("log")
    .description("The human-readable AI audit trail (newest first).")
    .option("--limit <n>", "max entries", "20")
    .action((opts: { limit?: string }) => {
      const cwd = process.cwd();
      const chain = readChain(cwd).reverse().slice(0, parseInt(opts.limit ?? "20", 10));
      if (!chain.length) { out("no attestations yet"); return; }
      out(`🧬 AI commit audit trail (${chain.length} shown):`);
      for (const e of chain) {
        const f = e.facts as { agent?: string; subject?: string; fileCount?: number; addedSecrets?: number };
        const sha = e.record.subject.replace("commit:", "").slice(0, 10);
        out(`   ${sha} · ${String(f.agent).padEnd(11)} · ${e.record.verdict.padEnd(7)} · ${f.fileCount ?? 0} file(s)${f.addedSecrets ? ` · ⚠${f.addedSecrets} secret` : ""} · ${String(f.subject).slice(0, 50)}`);
      }
    });

  a.command("install-hook")
    .description("Opt-in: install a post-commit hook so every FUTURE commit is auto-attested (Mneme never installs a hook for you).")
    .action(() => {
      const cwd = process.cwd();
      const hooksDir = join(cwd, ".git", "hooks");
      if (!existsSync(hooksDir)) { out("not a git repo (.git/hooks missing)"); process.exitCode = 2; return; }
      const hook = join(hooksDir, "post-commit");
      const bin = process.env["MNEME_CLI_BIN"] ?? "mneme";
      const SENTINEL = "# >>> mneme attest (auto-added) >>>";
      const line = `${SENTINEL}\n${bin} attest commit --commit HEAD >/dev/null 2>&1 || true\n# <<< mneme attest <<<`;
      let body = existsSync(hook) ? readFileSync(hook, "utf8") : "#!/bin/sh\n";
      if (body.includes(SENTINEL)) { out("post-commit hook already installs mneme attest ✓"); return; }
      body = body.trimEnd() + "\n\n" + line + "\n";
      writeFileSync(hook, body, "utf8");
      try { chmodSync(hook, 0o755); } catch { /* windows */ }
      out(`✓ installed post-commit hook → every commit is now auto-attested (signed + chained).`);
      out(`  verify anytime: mneme attest verify · remove: delete the mneme block in .git/hooks/post-commit`);
    });
}
