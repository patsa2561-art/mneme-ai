/**
 * mneme.xray.scan — the Repo X-Ray, as an MCP tool (v2.191.0).
 *
 * Lets ANY MCP agent run the full signed, deterministic repo audit the moment a
 * user asks "is this repo safe to depend on / how clean is this codebase / what's
 * risky here" — no tool name to memorise, no terminal. Returns the grade + the team-
 * intelligence gems + the Context Air Quality, all from @mneme-ai/xray (no LLM
 * computes a number; every figure is reproducible + offline-verifiable).
 *
 * Read-only (`.scan`) → naturally probe-coverage-exempt; the underlying functions
 * are themselves measured by xrayGauntlet / intelGauntlet / airQualityGauntlet
 * (100k each). The engine is dynamic-imported so the MCP build never hard-depends on
 * xray's type graph (mirrors the matrix pattern); @mneme-ai/xray is a runtime dep.
 */
import type { MnemeTool, ToolRuntime, ToolResponse } from "./_types.js";

interface XRayApi {
  buildXRay: (o: { repoPath?: string; gitUrl?: string; branch?: string; maxFiles?: number }) => Promise<XRayReportLike>;
  buildAirQuality: (r: unknown) => { score: number; band: string; pollutants: Array<{ name: string; detail: string }> };
  buildKeystones: (r: unknown, max?: number) => { keystones: Array<{ file: string; partners: number; ownerPct: number; expert: string | null }> };
  buildActionPlan: (r: unknown, max?: number) => { items: Array<{ sev: string; title: string; detail: string; source: string }> };
  buildMomentum: (r: unknown) => { verdict: string; note: string };
  buildOnboarding: (r: unknown, max?: number) => { steps: Array<{ file: string; why: string }> };
}
interface XRayReportLike {
  subject: { repoName: string; ref: string; commitHash: string; branch?: string };
  summary: { grade: string; headline: string; signalsRun: number; bullets: string[] };
  fingerprint: string;
}

export const XRAY_TOOLS: MnemeTool[] = [
  {
    name: "mneme.xray.scan",
    category: "audit",
    description:
      "Run the Repo X-Ray: a signed, deterministic, raw-free audit of a repository — " +
      "grade (A–F) · secrets · dependency-mortality · bus-factor · age · complexity · " +
      "change-coupling · executable-surface security — PLUS the team-intelligence gems " +
      "(🔑 Keystone single-point-of-catastrophe · ✅ ranked Action Plan · 📈 Momentum · " +
      "📖 Onboarding order) and the 🫁 Context Air Quality score (0–100: how clean the " +
      "codebase is for an AI to work in). NO LLM computes any number; every figure is " +
      "reproducible from git/AST/npm metadata and offline-verifiable. Pass {gitUrl} for a " +
      "public repo, or {repoPath} for a local path (defaults to the current repo). Example " +
      "user asks: 'is this dependency safe to build on?', 'audit this repo', 'how risky is " +
      "this codebase?', 'who's the key person here?'",
    whenToUse:
      "The user wants to know whether a repo is safe/healthy to depend on or work in, who " +
      "holds the knowledge, what's risky, or how clean it is for an AI — BEFORE relying on it.",
    triggers: [
      "is this repo safe", "audit this repo", "x-ray this repo", "how risky is this codebase",
      "is this dependency safe to depend on", "who is the key person", "how healthy is this repo",
      "scan this repository", "context air quality", "ตรวจ repo นี้", "repo นี้ปลอดภัยไหม",
    ],
    inputSchema: {
      type: "object",
      properties: {
        gitUrl: { type: "string", description: "public git URL (github.com / gitlab.com / bitbucket.org)" },
        repoPath: { type: "string", description: "local repo path (defaults to the current repo)" },
        branch: { type: "string", description: "branch to analyse (git-URL only; default: the default branch)" },
        maxFiles: { type: "number", description: "cap files scanned (perf bound)" },
      },
    },
    handler: async (runtime: ToolRuntime, args: { gitUrl?: string; repoPath?: string; branch?: string; maxFiles?: number }): Promise<ToolResponse> => {
      let xray: XRayApi;
      try { xray = (await import("@mneme-ai/xray" as string)) as unknown as XRayApi; }
      catch { return { data: { error: "the X-Ray engine (@mneme-ai/xray) is not installed" }, wisdom: "Install it with `npm i @mneme-ai/xray` (it ships with the mneme-ai CLI)." }; }

      const isUrl = !!args.gitUrl;
      try {
        const report = await xray.buildXRay(isUrl
          ? { gitUrl: args.gitUrl, branch: args.branch, maxFiles: args.maxFiles }
          : { repoPath: args.repoPath || runtime.cwd, maxFiles: args.maxFiles });
        const aq = xray.buildAirQuality(report);
        const keystones = xray.buildKeystones(report, 3).keystones;
        const actions = xray.buildActionPlan(report, 6).items;
        const momentum = xray.buildMomentum(report);
        const onboarding = xray.buildOnboarding(report, 5).steps;
        const data = {
          repo: report.subject.repoName,
          ref: report.subject.ref,
          commit: String(report.subject.commitHash).slice(0, 12),
          grade: report.summary.grade,
          headline: report.summary.headline,
          airQuality: { score: aq.score, band: aq.band, pollutants: aq.pollutants },
          keystones, actions, momentum, onboarding,
          fingerprint: report.fingerprint,
          provenance: "deterministic · no LLM guessed any number · offline-verifiable",
        };
        const top = aq.pollutants[0]?.name ? ` Top pollutant: ${aq.pollutants[0].name}.` : "";
        const wisdom =
          `${data.repo} graded ${data.grade}. Context Air Quality ${aq.score}/100 (${aq.band}) — how clean it is for an AI to work in.${top}` +
          (keystones[0] ? ` Keystone risk: ${keystones[0].file.split("/").pop()} (${Math.round(keystones[0].ownerPct * 100)}% one author, ripples to ${keystones[0].partners}).` : "") +
          (actions[0] ? ` First action: ${actions[0].title}.` : " No critical actions.") +
          " Every number is signed + reproducible — relay it confidently.";
        return { data, wisdom };
      } catch (e) {
        return { data: { error: (e as Error).message.slice(0, 200) }, wisdom: "X-Ray could not complete — check the URL/path is a reachable public repo or a valid local git repo." };
      }
    },
  },
];
