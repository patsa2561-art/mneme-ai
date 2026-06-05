/**
 * `mneme engagement` / `mneme revert` / `mneme bench` (v2.193.0) — the Accountability Layer.
 *   engagement init|show|check  — robots.txt for AI agents (signed policy + gate verdict)
 *   revert scan                 — the regret flywheel (what got reverted/hotfixed, per-agent survival)
 *   bench                       — cross-vendor reliability ranking (Wilson-LB on survival)
 */
import type { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { revertRadar, agentBenchmark, engagement } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function git(args: string, cwd: string): string { try { return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }

function agentBySha(cwd: string): Map<string, string> {
  const m = new Map<string, string>(); const p = join(cwd, ".mneme", "attest", "chain.jsonl");
  if (!existsSync(p)) return m;
  try { for (const l of readFileSync(p, "utf8").trim().split("\n").filter(Boolean)) { const e = JSON.parse(l) as { record?: { subject?: string }; facts?: { agent?: string } }; const sha = String(e.record?.subject ?? "").replace("commit:", ""); if (sha) m.set(sha, String(e.facts?.agent ?? "unknown")); } } catch { /* */ }
  return m;
}
function readCommits(cwd: string, limit = 400): revertRadar.CommitLite[] {
  const byAgent = agentBySha(cwd);
  const raw = git(`log -n ${limit} --no-merges --pretty=format:%x01%H%x1f%ct%x1f%s%x1f%b%x02 --name-only`, cwd);
  if (!raw) return [];
  const out2: revertRadar.CommitLite[] = [];
  for (const block of raw.split("\x01").filter(Boolean)) {
    const [head, filesPart = ""] = block.split("\x02");
    const [sha = "", ct = "0", subject = "", body = ""] = head.split("\x1f");
    if (!sha) continue;
    out2.push({ sha, subject, body, agent: byAgent.get(sha) ?? "unknown", files: filesPart.split("\n").map((s) => s.trim()).filter(Boolean), ts: (Number(ct) || 0) * 1000 });
  }
  return out2;
}

export function registerAccountabilityCommands(program: Command): void {
  const e = program.command("engagement").description("🤖 ROBOTS.TXT FOR AI AGENTS — a signed, cross-vendor policy (forbidden paths · cosign actions · forbidden licenses · size ceiling) Mneme enforces at the gate.");
  e.command("init").description("Write a default .mneme/engagement.json you can edit to your org's rules.").action(() => {
    const cwd = process.cwd(); const p = join(cwd, ".mneme", "engagement.json");
    if (existsSync(p)) { out(`already exists: ${p}`); return; }
    mkdirSync(join(cwd, ".mneme"), { recursive: true });
    writeFileSync(p, JSON.stringify(engagement.defaultPolicy(), null, 2) + "\n", "utf8");
    out(`✓ wrote ${p} — edit it to your org's rules. Agents check it via mneme.engagement.scan.`);
  });
  e.command("show").description("Print the active engagement policy.").action(() => {
    const p = join(process.cwd(), ".mneme", "engagement.json");
    out(JSON.stringify(existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : engagement.defaultPolicy(), null, 2));
  });
  e.command("check").description("Evaluate an action against the policy (exit 2 on BLOCK).")
    .option("--kind <k>", "action: write | push:main | deploy:prod | add-dep …", "write")
    .option("--paths <list>", "comma-separated paths").option("--license <l>", "dependency license")
    .action((opts: { kind?: string; paths?: string; license?: string }) => {
      const cwd = process.cwd(); const pp = join(cwd, ".mneme", "engagement.json");
      const policy = { ...engagement.defaultPolicy(), ...(existsSync(pp) ? JSON.parse(readFileSync(pp, "utf8")) : {}) };
      const paths = opts.paths ? opts.paths.split(",").map((s) => s.trim()).filter(Boolean) : git("diff --cached --name-only", cwd).split("\n").filter(Boolean);
      const v = engagement.evaluateEngagement(policy, { kind: opts.kind ?? "write", paths, license: opts.license, fileCount: paths.length });
      out(`${v.decision === "BLOCK" ? "🛑" : v.decision === "NEEDS_COSIGN" ? "✋" : "✓"} ${v.decision} — ${v.reasons.join("; ")}`);
      if (v.decision === "BLOCK") process.exitCode = 2;
    });

  program.command("revert").description("🔄 THE REGRET FLYWHEEL — what work survived vs got reverted/hotfixed.")
    .command("scan", { isDefault: true }).description("Scan git for reverts/hotfixes + per-agent survival.")
    .option("--window <days>", "hotfix window", "14")
    .action((opts: { window?: string }) => {
      const cwd = process.cwd(); const commits = readCommits(cwd);
      if (!commits.length) { out("no git history"); return; }
      const reverts = revertRadar.detectReverts(commits, { windowDays: parseInt(opts.window ?? "14", 10) });
      const survival = revertRadar.survivalByAgent(commits, reverts);
      out(`🔄 ${reverts.length} commit(s) did not survive (of ${commits.length} scanned)`);
      for (const r of reverts.slice(0, 12)) out(`   ${r.sha.slice(0, 10)} · ${r.agent.padEnd(11)} · ${r.kind}${r.kind === "hotfix-window" ? " (weak signal)" : ""} · survived ${r.ageDays}d`);
      out(`   survival by agent: ${survival.map((s) => `${s.agent} ${Math.round(s.survivalRate * 100)}% (${s.regretted}/${s.commits})`).join(" · ")}`);
    });

  program.command("agentbench").description("📊 CROSS-VENDOR RELIABILITY — rank agents by Wilson-LB survival (small samples are 'unmeasured').")
    .action(() => {
      const cwd = process.cwd(); const commits = readCommits(cwd);
      const ranked = agentBenchmark.rankAgents(revertRadar.survivalByAgent(commits, revertRadar.detectReverts(commits)));
      if (!ranked.length) { out("no attested commits — run `mneme attest install-hook` first"); return; }
      out(`📊 Agent reliability (from this repo's real outcomes):`);
      for (const r of ranked) out(`   ${r.agent.padEnd(12)} · ${r.band.padEnd(11)}${r.band === "unmeasured" ? "" : ` · ${Math.round(r.wilsonLB * 100)}% Wilson-LB`} · ${r.survived}/${r.commits} survived`);
    });
}
