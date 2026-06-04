/**
 * `mneme xray` (v2.187.0) — the Repo X-Ray, from the CLI. Runs the deterministic,
 * signed, raw-free audit (deps · secrets · bus-factor · age · complexity · hotspots
 * · coupling · security) on a local repo or a public git URL, and prints the grade +
 * the team-intelligence gems (Keystone risk · Action plan · Momentum · Onboarding).
 *
 *   mneme xray                     # analyse the current repo
 *   mneme xray ./path/to/repo      # analyse a local path
 *   mneme xray https://github.com/owner/repo [--branch main]
 *   mneme xray --json              # the full signed report
 *
 * The xray engine lives in @mneme-ai/xray (bundled with the CLI). Lazy-imported +
 * fail-open so the core CLI still runs if the optional analysis package is absent.
 */
import type { Command } from "commander";
import { existsSync } from "node:fs";

function out(s: string): void { process.stdout.write(s + "\n"); }

interface XRayApi {
  buildXRay: (opts: { repoPath?: string; gitUrl?: string; branch?: string; maxFiles?: number }) => Promise<XRayReportLike>;
  sealXRay: (repoRoot: string, report: XRayReportLike) => { report: XRayReportLike; receipt: unknown };
  buildKeystones: (r: unknown, max?: number) => { keystones: Array<{ file: string; partners: number; ownerPct: number; expert: string | null }>; note: string };
  buildActionPlan: (r: unknown, max?: number) => { items: Array<{ sev: string; icon: string; title: string; detail: string; source: string }>; note: string };
  buildMomentum: (r: unknown) => { verdict: string; note: string };
  buildOnboarding: (r: unknown, max?: number) => { steps: Array<{ file: string; why: string }>; note: string };
}
interface XRayReportLike {
  subject: { repoName: string; ref: string; commitHash: string; branch?: string };
  summary: { grade: string; headline: string; signalsRun: number; bullets: string[] };
  fingerprint: string;
}

async function load(): Promise<XRayApi | null> {
  try { return (await import("@mneme-ai/xray" as string)) as unknown as XRayApi; }
  catch { out("🩻 the X-Ray engine needs @mneme-ai/xray — install it: npm i @mneme-ai/xray"); return null; }
}

const base = (f: string): string => { const p = String(f).split("/"); return p[p.length - 1] || f; };

export function registerXrayCommands(program: Command): void {
  program
    .command("xray [target]")
    .description("🩻 REPO X-RAY — a signed, deterministic audit of any repo (deps · secrets · bus-factor · age · complexity · coupling · security) + the team-intelligence gems (Keystone risk · Action plan · Momentum · Onboarding). No LLM guesses any number; the report is offline-verifiable. Pass a local path (default: current repo) or a public git URL.")
    .option("--branch <name>", "branch to analyse (git-URL target)")
    .option("--max-files <n>", "cap files scanned (perf bound)")
    .option("--json", "print the full signed report as JSON")
    .action(async (target: string | undefined, opts: { branch?: string; maxFiles?: string; json?: boolean }) => {
      const api = await load(); if (!api) { process.exitCode = 2; return; }
      const isUrl = !!target && /^(https?:\/\/|git@)/.test(target);
      const repoPath = isUrl ? undefined : (target || process.cwd());
      if (repoPath && !existsSync(repoPath)) { out(`path not found: ${repoPath}`); process.exitCode = 2; return; }
      const maxFiles = opts.maxFiles ? parseInt(opts.maxFiles, 10) : undefined;

      let report: XRayReportLike;
      try {
        report = await api.buildXRay(isUrl ? { gitUrl: target, branch: opts.branch, maxFiles } : { repoPath, maxFiles });
      } catch (e) { out(`🩻 X-Ray failed: ${(e as Error).message}`); process.exitCode = 2; return; }

      if (opts.json) {
        try { const signed = api.sealXRay(repoPath || process.cwd(), report); out(JSON.stringify(signed, null, 2)); }
        catch { out(JSON.stringify(report, null, 2)); }
        return;
      }

      const s = report.summary;
      out("");
      out(`🩻 X-RAY · ${report.subject.repoName}${report.subject.branch ? ` @ ${report.subject.branch}` : ""}   [ ${s.grade} ]`);
      out(`   ${s.headline} · ${s.signalsRun} deterministic signals · @ ${String(report.subject.commitHash).slice(0, 10)}`);
      for (const b of s.bullets.slice(0, 6)) out(`   • ${b}`);

      const mo = api.buildMomentum(report);
      if (mo.verdict !== "unknown") out(`\n📈 Momentum: ${mo.verdict} — ${mo.note}`);

      const ks = api.buildKeystones(report, 3).keystones;
      if (ks.length) {
        out(`\n🔑 Keystone risk (single point of catastrophe):`);
        for (const k of ks) out(`   ${base(k.file)} — ripples to ${k.partners} file(s), ${Math.round(k.ownerPct * 100)}% one author${k.expert ? ` · ask ${k.expert}` : ""}`);
      }

      const plan = api.buildActionPlan(report, 8).items;
      if (plan.length) {
        out(`\n✅ Action plan (ranked, each traceable):`);
        for (const it of plan) out(`   [${it.sev.toUpperCase()}] ${it.icon} ${it.title}  (${it.source})`);
      }

      const onb = api.buildOnboarding(report, 6).steps;
      if (onb.length) {
        out(`\n📖 Onboarding — read in this order:`);
        onb.forEach((st, i) => out(`   ${i + 1}. ${base(st.file)} — ${st.why}`));
      }

      out(`\n🔒 deterministic · Ed25519-signable · fingerprint ${String(report.fingerprint).slice(0, 16)}…`);
      out(`   full signed report: mneme xray${target ? ` ${target}` : ""} --json`);
    });
}
