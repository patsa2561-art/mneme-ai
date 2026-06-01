/**
 * `mneme exec` (v2.120.0) — the EXECUTIVE surface. Each subcommand frames a REAL
 * Mneme signal for a CXO/CRO/CISO buyer. Nothing is fabricated: the signals come
 * from git history (key-person risk, talent map, governance/promise-debt), a
 * signed savings ledger (capital/value), and live MCP config (attack surface).
 * Dollar figures appear ONLY when the user supplies their own rate, and are
 * always labelled as "your rate × measured signal".
 *
 *   mneme exec keyperson [--replacement-cost N]   # bus-factor / flight risk
 *   mneme exec talent                              # collaboration / talent map
 *   mneme exec governance [--debt-cost N]          # promise-debt / tech-debt liability
 *   mneme exec burn [--price-per-1k N]             # realized token value (asset)
 *   mneme exec roi --team N --per-dev M [--price-per-1k P] [--months H]
 *   mneme exec mcp-audit [--budget N]              # agent MCP attack surface (CISO)
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git, store, people, util, stigmergy, treasury, exec as execCore, skeletonKey, notary } from "@mneme-ai/core";
import { dbPath } from "../paths.js";

const TREASURY_LEDGER = ".mneme/treasury/ledger.jsonl";
function out(s: string): void { process.stdout.write(s + "\n"); }
function outJson(o: unknown): void { process.stdout.write(JSON.stringify(o, null, 2) + "\n"); }
function usd(n: number): string { return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function rate(n: number): string { return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 5 }); }
function sign(cwd: string, subject: string, payload: Record<string, unknown>): unknown {
  try { return notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload, includePayload: false }); } catch { return null; }
}
async function openStore(cwd: string): Promise<{ s: InstanceType<typeof store.MnemeStore>; root: string } | { error: string }> {
  if (!(await git.isGitRepo(cwd))) return { error: "Not in a git repo." };
  const meta = await git.getRepoMeta(cwd);
  const s = new store.MnemeStore(dbPath(meta.rootPath));
  if (s.countCommits() === 0) { s.close(); return { error: "Memory is empty. Run `mneme index` first." }; }
  return { s, root: meta.rootPath };
}

export function registerExecCommands(program: Command): void {
  const ex = program.command("exec").description("🏛 EXECUTIVE surface — real Mneme signals framed for a CXO/CRO/CISO. $ figures only from YOUR supplied rate, always labelled. Honest by design (DIAKRISIS): present-tense signals from real history/ledgers, never a forecast.");

  // ── 1. KEY-PERSON RISK (bus-factor / flight risk) — wraps atrophy ──
  ex.command("keyperson")
    .description("Key-person dependency & flight risk: files with NO live expert (bus-factor=1) + knowledge concentration, from git history. --replacement-cost gives a labelled exposure estimate.")
    .option("--replacement-cost <usd>", "your est. cost to re-derive one at-risk file's knowledge (USD).", (v) => parseFloat(v))
    .option("--json", "JSON output.")
    .action(async (opts: { replacementCost?: number; json?: boolean }) => {
      const cwd = process.cwd();
      const o = await openStore(cwd); if ("error" in o) { out(`✗ ${o.error}`); process.exitCode = 1; return; }
      try {
        const r = people.atrophy(o.s);
        const ghosted = r.stats.ghostedFiles ?? 0;
        const atRisk = r.atRiskFiles.filter((f) => f.tier === "at-risk").length;
        const warn = r.atRiskFiles.filter((f) => f.tier === "warn").length;
        const top = [...r.authors].sort((a, b) => b.knowledgeMass - a.knowledgeMass).slice(0, 5);
        const exposure = typeof opts.replacementCost === "number" ? (ghosted + atRisk) * opts.replacementCost : undefined;
        const receipt = sign(cwd, "exec:keyperson", { ghosted, atRisk, warn, fileCount: r.stats.fileCount });
        if (opts.json) { outJson({ ghostedFiles: ghosted, atRiskFiles: atRisk, warnFiles: warn, fileCount: r.stats.fileCount, topConcentration: top.map((a) => ({ name: a.name, email: a.email, knowledgeMass: Math.round(a.knowledgeMass), filesKnown: a.filesKnown })), exposureUSD: exposure, basis: "bus-factor + knowledge-concentration from git history (Ebbinghaus forgetting curve); exposure = YOUR replacement-cost × (ghosted + at-risk file count), not a forecast", signed: receipt }); return; }
        out(`🔑 KEY-PERSON RISK — ${ghosted} ghosted file(s) (no live expert), ${atRisk} at-risk, ${warn} warning, of ${r.stats.fileCount} files`);
        out(`   Top knowledge concentration (single points of failure):`);
        for (const a of top) out(`   • ${a.name || a.email} — knowledge mass ${Math.round(a.knowledgeMass)} across ${a.filesKnown} files`);
        if (exposure !== undefined) out(`   💸 exposure estimate: ${usd(exposure)}  (your ${usd(opts.replacementCost!)}/file × ${ghosted + atRisk} ghosted+at-risk — labelled, not a forecast)`);
        if (receipt) out(`   ✓ signed`);
      } finally { o.s.close(); }
    });

  // ── 2. TALENT MAP (collaboration) — wraps stigmergy ──
  ex.command("talent")
    .description("Talent map: who actually collaborates with whom, derived from git traces (shared files + synchrony + carry-on). Org-chart truth, not self-report.")
    .option("--top <n>", "show top N pairs.", (v) => parseInt(v, 10), 10)
    .option("--json", "JSON output.")
    .action(async (opts: { top?: number; json?: boolean }) => {
      const cwd = process.cwd();
      if (!(await git.isGitRepo(cwd))) { out("✗ Not in a git repo."); process.exitCode = 1; return; }
      const r = stigmergy.analyze(cwd);
      const pairs = r.pairs.slice(0, opts.top ?? 10);
      const receipt = sign(cwd, "exec:talent", { commitsAnalysed: r.commitsAnalysed, pairs: pairs.length });
      if (opts.json) { outJson({ commitsAnalysed: r.commitsAnalysed, authorCount: r.authorCount, pairs, basis: "collaboration from git traces (shared files + commits ≤24h apart + carry-on contributions); a present signal, not a prediction", signed: receipt }); return; }
      out(`🤝 TALENT MAP — ${r.authorCount} authors over ${r.commitsAnalysed} commits, top ${pairs.length} collaborating pairs:`);
      for (const p of pairs) out(`   • ${p.authorA} ⇄ ${p.authorB} — score ${p.stigmergyScore} (shared ${p.sharedFiles}, sync ${p.synchronyHits}, carry-on ${p.carryOnHits})`);
      if (pairs.length === 0) out("   (no pairs above the surface threshold yet)");
      if (receipt) out(`   ✓ signed`);
    });

  // ── 3. GOVERNANCE / promise-debt (tech-debt liability) — wraps promise ──
  ex.command("governance")
    .description("Governance & tech-debt liability: open/stale promises mined from commit + PR text, tracked through git. --debt-cost gives a labelled exposure estimate.")
    .option("--debt-cost <usd>", "your est. carrying cost per open promise (USD).", (v) => parseFloat(v))
    .option("--json", "JSON output.")
    .action(async (opts: { debtCost?: number; json?: boolean }) => {
      const cwd = process.cwd();
      const o = await openStore(cwd); if ("error" in o) { out(`✗ ${o.error}`); process.exitCode = 1; return; }
      try {
        const commits = util.loadAllCommits(o.s);
        const r = people.buildPromiseReport(commits, {});
        const t = r.totals;
        const exposure = typeof opts.debtCost === "number" ? (t.open + t.stale) * opts.debtCost : undefined;
        const receipt = sign(cwd, "exec:governance", { open: t.open, stale: t.stale, kept: t.kept, total: t.total });
        if (opts.json) { outJson({ open: t.open, stale: t.stale, kept: t.kept, total: t.total, oldestStaleAgeDays: r.oldestStaleAgeDays, exposureUSD: exposure, basis: "promises regex-mined from commit/PR text, tracked through git history; exposure = YOUR carrying-cost × (open + stale), labelled, not a forecast", signed: receipt }); return; }
        out(`📜 GOVERNANCE / TECH-DEBT LIABILITY — ${t.open} open · ${t.stale} stale · ${t.kept} kept (of ${t.total} promises mined from git)`);
        if (exposure !== undefined) out(`   💸 exposure estimate: ${usd(exposure)}  (your ${usd(opts.debtCost!)}/promise × ${t.open + t.stale} open+stale — labelled, not a forecast)`);
        if (receipt) out(`   ✓ signed`);
      } finally { o.s.close(); }
    });

  // ── 4. CAPITAL / VALUE (realized token savings) — wraps treasury ──
  ex.command("burn")
    .description("Realized value: input-context tokens Mneme has actually saved (from the signed ledger) → USD at YOUR vendor price. The asset side of the ledger.")
    .option("--price-per-1k <usd>", "your vendor's price per 1k input tokens (USD).", (v) => parseFloat(v))
    .option("--json", "JSON output.")
    .action(async (opts: { pricePer1k?: number; json?: boolean }) => {
      const cwd = process.cwd();
      const p = join(cwd, TREASURY_LEDGER);
      const events = existsSync(p) ? treasury.parseLedger(readFileSync(p, "utf8")) : [];
      const agg = treasury.aggregate(events, opts.pricePer1k !== undefined ? { pricePer1kUSD: opts.pricePer1k } : undefined);
      const receipt = sign(cwd, "exec:burn", { tokensSaved: agg.tokensSaved, events: agg.events });
      if (opts.json) { outJson({ ...agg, signed: receipt }); return; }
      out(`💰 REALIZED VALUE — ${agg.tokensSaved.toLocaleString("en-US")} input tokens saved over ${agg.events} reductions (${agg.savedPct}% of fed context)`);
      if (typeof agg.usdSaved === "number") out(`   ≈ ${usd(agg.usdSaved)} at your ${rate(opts.pricePer1k!)}/1k  (labelled ≈chars/4 estimate of INPUT context — not a tokenizer count)`);
      else out(`   (pass --price-per-1k <usd> for a dollar figure at your vendor's price)`);
      if (receipt) out(`   ✓ signed`);
    });

  // ── 5. ROI projection (pillar 4) — wraps exec.projectRoi over the real ledger ──
  ex.command("roi")
    .description("ROI projection: extrapolate Mneme's MEASURED per-reduction saving rate to YOUR team & usage at YOUR price. Transparent: (measured rate) × (your volume) × (your price).")
    .option("--team <n>", "team size.", (v) => parseInt(v, 10), 0)
    .option("--per-dev <n>", "reduction-eligible events per dev per month.", (v) => parseInt(v, 10), 0)
    .option("--price-per-1k <usd>", "your vendor's price per 1k input tokens (USD).", (v) => parseFloat(v), 0)
    .option("--months <n>", "projection horizon (months).", (v) => parseInt(v, 10), 12)
    .option("--json", "JSON output.")
    .action(async (opts: { team?: number; perDev?: number; pricePer1k?: number; months?: number; json?: boolean }) => {
      const cwd = process.cwd();
      const p = join(cwd, TREASURY_LEDGER);
      const events = existsSync(p) ? treasury.parseLedger(readFileSync(p, "utf8")) : [];
      const agg = treasury.aggregate(events);
      const proj = execCore.projectRoi({
        measuredTokensSaved: agg.tokensSaved, measuredReductions: agg.events,
        teamSize: opts.team ?? 0, reductionsPerDevPerMonth: opts.perDev ?? 0,
        pricePer1kUSD: opts.pricePer1k ?? 0, months: opts.months ?? 12,
      });
      const receipt = sign(cwd, "exec:roi", { projectedUsdSaved: proj.projectedUsdSaved, months: proj.months });
      if (opts.json) { outJson({ ...proj, signed: receipt }); return; }
      out(`📈 ROI PROJECTION (${proj.months} months)`);
      out(`   measured rate: ${proj.avgTokensPerReduction} tokens saved per reduction (from ${agg.events} realized reductions)`);
      out(`   projected: ${proj.projectedReductions.toLocaleString("en-US")} reductions → ${proj.projectedTokensSaved.toLocaleString("en-US")} tokens → ${usd(proj.projectedUsdSaved)} saved`);
      out(`   realized so far: ${usd(proj.realizedUsdSaved)}`);
      if (agg.events === 0) out(`   ⚠ no realized reductions yet — run Mneme (distill/loopguard/nkl) to seed the measured rate; projection is 0 until then.`);
      out(`   basis: ${proj.basis}`);
      if (receipt) out(`   ✓ signed`);
    });

  // ── 6. MCP ATTACK SURFACE (pillar 3, CISO) — wraps skeleton_key ──
  ex.command("mcp-audit")
    .description("Agent MCP attack surface (CISO): discover the MCP servers wired into your agents, score per-server risk, compute the transitive bypass budget. The governed-boundary check.")
    .option("--budget <n>", "risk budget cap.", (v) => parseFloat(v), 5.0)
    .option("--json", "JSON output.")
    .action(async (opts: { budget?: number; json?: boolean }) => {
      const cwd = process.cwd();
      try {
        const a = await skeletonKey.auditMcpConfigs({ budgetCap: opts.budget ?? 5.0 });
        const receipt = sign(cwd, "exec:mcp-audit", { totalServers: a.totalServers, riskBudget: a.riskBudget, withinBudget: a.withinBudget });
        if (opts.json) { outJson({ totalServers: a.totalServers, riskBudget: a.riskBudget, budgetCap: a.budgetCap, withinBudget: a.withinBudget, findings: a.findings, summary: a.summary, signed: receipt }); return; }
        out(`🛂 MCP ATTACK SURFACE — ${a.totalServers} server(s), risk budget ${a.riskBudget.toFixed(1)} / ${a.budgetCap.toFixed(1)} ${a.withinBudget ? "✓ within" : "🛑 OVER"}`);
        for (const f of a.findings.slice(0, 10)) out(`   • ${f.server} — ${f.risk?.riskName ?? "unknown"} (severity ${f.risk?.severity ?? "?"}, ${f.source})`);
        if (a.totalServers === 0) out(`   (no MCP servers discovered in known agent configs)`);
        out(`   ${a.summary}`);
        if (!a.withinBudget) process.exitCode = 2;
        if (receipt) out(`   ✓ signed`);
      } catch (e) { out(`✗ ${(e as Error).message}`); process.exitCode = 1; }
    });
}
