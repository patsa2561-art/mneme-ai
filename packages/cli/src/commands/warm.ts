/**
 * `mneme warm` (v2.196.0) — the ALWAYS-WARM ACCOUNTABILITY STATE.
 *   warm           — O(1) read of the maintained snapshot (never recomputed)
 *   warm verify    — prove warm == cold: rebuild from the signed event log + check the chain
 *   warm rebuild   — rebuild the state from full git history (recovery / first run)
 *
 * Maintained automatically: `mneme attest commit` (the post-commit hook) folds each
 * commit into the warm state as it happens, so the answers are always ready.
 */
import type { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { awarm } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function git(args: string[], cwd: string): string { try { return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }
const DIR = ".mneme/awarm";
const evPath = (cwd: string) => join(cwd, DIR, "events.jsonl");
const snapPath = (cwd: string) => join(cwd, DIR, "state.json");

function loadEvents(cwd: string): awarm.WarmEvent[] {
  const p = evPath(cwd); if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as awarm.WarmEvent; } catch { return null; } }).filter(Boolean) as awarm.WarmEvent[];
}
function loadSnapshot(cwd: string): awarm.WarmState {
  const p = snapPath(cwd); if (!existsSync(p)) return awarm.emptyState();
  try { return JSON.parse(readFileSync(p, "utf8")) as awarm.WarmState; } catch { return awarm.emptyState(); }
}
function agentBySha(cwd: string): Map<string, string> {
  const m = new Map<string, string>(); const p = join(cwd, ".mneme", "attest", "chain.jsonl");
  if (!existsSync(p)) return m;
  try { for (const l of readFileSync(p, "utf8").trim().split("\n").filter(Boolean)) { const e = JSON.parse(l) as { record?: { subject?: string }; facts?: { agent?: string } }; const sha = String(e.record?.subject ?? "").replace("commit:", ""); if (sha) m.set(sha, String(e.facts?.agent ?? "unknown")); } } catch { /* */ }
  return m;
}
function gatherInput(cwd: string, ref: string, agent?: string): awarm.WarmInput | null {
  const sha = git(["rev-parse", ref], cwd); if (!sha) return null;
  const meta = git(["show", "--no-patch", "--format=%ct%x1f%s%x1f%b", sha], cwd).split("\x1f");
  const files = git(["show", "--name-only", "--format=", sha], cwd).split("\n").map((s) => s.trim()).filter(Boolean);
  return { sha, agent: agent ?? agentBySha(cwd).get(sha) ?? "unknown", ts: (Number(meta[0]) || 0) * 1000, subject: meta[1] ?? "", body: meta[2] ?? "", files };
}

/** Fold a new commit into the warm state (called by `mneme attest commit`). Total + idempotent. */
export function updateWarm(cwd: string, ref: string, agent?: string): void {
  try {
    const input = gatherInput(cwd, ref, agent); if (!input) return;
    const snap = loadSnapshot(cwd);
    if (snap.bySha && snap.bySha[input.sha]) return; // already folded — idempotent
    const events = loadEvents(cwd);
    const ev = awarm.chainEvent(events.length ? events[events.length - 1] : null, input);
    mkdirSync(join(cwd, DIR), { recursive: true });
    appendFileSync(evPath(cwd), JSON.stringify(ev) + "\n", "utf8");
    writeFileSync(snapPath(cwd), JSON.stringify(awarm.applyCommit(snap, input)), "utf8");
  } catch { /* best-effort: warm state never blocks a commit */ }
}

export function registerWarmCommands(program: Command): void {
  const w = program.command("warm").description("🔥 ALWAYS-WARM ACCOUNTABILITY STATE — O(1) read of the maintained survival/reliability state (never recomputed from scratch). Maintained automatically by `mneme attest`.");
  w.command("show", { isDefault: true }).description("O(1) read of the warm snapshot.").action(() => {
    const q = awarm.queryWarm(loadSnapshot(process.cwd()));
    if (!q.commits) { out("warm state empty — `mneme attest install-hook` to maintain it automatically, or `mneme warm rebuild`."); return; }
    out(`🔥 Always-warm accountability (O(1) read · ${q.commits} commits):`);
    out(`   survival ${q.survivalPct}% · ${q.stability.didNotSurvive} undone (${q.stability.explicitReverts} explicit reverts · ${q.stability.hotfixSignals} hotfix signals)`);
    for (const a of q.agents) out(`   ${a.agent.padEnd(12)} · ${Math.round(a.survivalRate * 100)}% survived · ${a.survived}/${a.commits}`);
  });
  w.command("verify").description("Prove WARM == COLD: rebuild from the signed event log + check the hash chain (exit 2 if mismatch/tamper).").action(() => {
    const cwd = process.cwd(); const events = loadEvents(cwd);
    if (!events.length) { out("no warm events yet"); return; }
    const chain = awarm.verifyEventChain(events);
    const rebuilt = awarm.foldCommits(events);
    const snap = loadSnapshot(cwd);
    const match = JSON.stringify(awarm.queryWarm(rebuilt)) === JSON.stringify(awarm.queryWarm(snap));
    out(`🔥 chain ${chain.ok ? "intact ✓" : `BROKEN at seq ${chain.brokenAt} ✗`} · warm==cold ${match ? "✓ (the maintained snapshot equals a from-scratch rebuild)" : "✗ MISMATCH — run `mneme warm rebuild`"}`);
    if (!chain.ok || !match) process.exitCode = 2;
  });
  w.command("rebuild").description("Rebuild the warm state from full git history (recovery / first run).").option("--limit <n>", "commits", "2000").action((opts: { limit?: string }) => {
    const cwd = process.cwd(); if (!existsSync(join(cwd, ".git"))) { out("not a git repo"); process.exitCode = 2; return; }
    const byAgent = agentBySha(cwd);
    const raw = git(["log", `-n`, String(parseInt(opts.limit ?? "2000", 10)), "--no-merges", "--reverse", "--pretty=format:%x01%H%x1f%ct%x1f%s%x1f%b%x02", "--name-only"], cwd);
    const inputs: awarm.WarmInput[] = [];
    for (const block of raw.split("\x01").filter(Boolean)) {
      const [head = "", filesPart = ""] = block.split("\x02");
      const [sha = "", ct = "0", subject = "", body = ""] = head.split("\x1f");
      if (!sha) continue;
      inputs.push({ sha, agent: byAgent.get(sha) ?? "unknown", ts: (Number(ct) || 0) * 1000, subject, body, files: filesPart.split("\n").map((s) => s.trim()).filter(Boolean) });
    }
    mkdirSync(join(cwd, DIR), { recursive: true });
    let prev: awarm.WarmEvent | null = null; const lines: string[] = [];
    for (const inp of inputs) { prev = awarm.chainEvent(prev, inp); lines.push(JSON.stringify(prev)); }
    writeFileSync(evPath(cwd), lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
    writeFileSync(snapPath(cwd), JSON.stringify(awarm.foldCommits(inputs)), "utf8");
    const q = awarm.queryWarm(loadSnapshot(cwd));
    out(`🔥 rebuilt warm state from ${inputs.length} commits · survival ${q.survivalPct}% · ${q.agents.length} agent(s). Now O(1) to read.`);
  });
}
