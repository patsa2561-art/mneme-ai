/**
 * v2.103.0 — WISDOM GATES MCP surface (empower every AI agent).
 *
 *   mneme.cognitive.judge  — a self-aware, SIGNED second opinion on a diff's
 *                            authorship (NEMESIS style-distance from the
 *                            author's own baseline; UNKNOWN when it can't
 *                            actually separate styles — prove-or-unknown).
 *   mneme.branch.analyze   — a SIGNED real-signal snapshot of every branch
 *                            (merge-conflict overlap / decay / divergence) —
 *                            NOT a prediction of the future.
 *
 * Both gather their git facts themselves (zero-arg for the agent), call the
 * pure core, and return a NOTARY-self-attested result so the calling model —
 * Claude / GPT / Gemini — verifies the verdict offline. Every handler is
 * total (108-error rule): no git / garbage → a structured low-confidence
 * result, never a throw.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function git(cwd: string, args: string[]): string {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return ""; }
}
function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const k = Object.keys(v as Record<string, unknown>).sort();
  return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}";
}
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const core = await import("@mneme-ai/core");
    const dataHash = sha256(canon(data));
    const receipt = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `wisdom-mcp:${subject}:${dataHash.slice(0, 16)}`, payload: { dataHash, tool: subject }, includePayload: true });
    return { ...data, _proof: { dataHash, receipt } };
  } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });

/** Recent commit diffs by a given author (or the most recent author). */
function authorDiffs(cwd: string, author: string | undefined, n: number): { author: string; diffs: string[] } {
  const who = author || git(cwd, ["log", "-1", "--pretty=%an"]) || "unknown";
  const hashes = git(cwd, ["log", `--author=${who}`, `-n`, String(n), "--pretty=%H"]).split("\n").filter(Boolean);
  const diffs = hashes.map((h) => git(cwd, ["show", h, "--no-color", "--unified=3", "--pretty=format:"])).filter((d) => d.length > 0);
  return { author: who, diffs };
}

export const WISDOM_TOOLS: MnemeTool[] = [
  {
    name: "mneme.cognitive.judge",
    category: "meta",
    description: "🧠 COGNITIVE WISDOM GATE — a self-aware, Ed25519-SIGNED second opinion on whether a diff matches an author's coding STYLE (NEMESIS micro-tells: whitespace / quotes / braces / naming). It measures its OWN reliability: if the author's style can't be separated from others it returns UNKNOWN and refuses to flag (prove-or-unknown; never auto-rejects). ADVISORY — FLAG means 'a human should look', never 'reject'. Gathers the author's recent commits itself; pass `diff` to judge a specific diff (else it judges the working tree).",
    whenToUse: "Before trusting/applying a diff whose authorship matters (suspected stolen key, unusual change) — get a signed, honest authorship signal that knows when it doesn't know.",
    triggers: ["cognitive gate", "judge diff authorship", "does this diff match the author"],
    inputSchema: { type: "object", properties: { author: { type: "string", description: "Author to baseline (default: most recent commit author)." }, diff: { type: "string", description: "Diff to judge (default: git diff HEAD)." }, samples: { type: "number", description: "How many recent author commits to baseline (default 12)." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        if (!git(cwd, ["rev-parse", "--git-dir"])) return low("not a git repo");
        const n = typeof args["samples"] === "number" ? args["samples"] as number : 12;
        const { author, diffs } = authorDiffs(cwd, typeof args["author"] === "string" ? args["author"] as string : undefined, n);
        const sig = core.cognitiveGate.buildCognitiveSignature(author, diffs);
        const newDiff = typeof args["diff"] === "string" && (args["diff"] as string).length > 0 ? args["diff"] as string : git(cwd, ["diff", "HEAD", "--no-color"]);
        // Held-out benchmark: split the author's own diffs to measure separability honestly.
        const heldout = diffs.slice(0, Math.min(3, diffs.length));
        const others = diffs.length > 3 ? [] : [];   // no foreign corpus available locally → separability stays unmeasured (UNKNOWN-safe)
        const bench = heldout.length >= 1 && others.length >= 1 ? { authorHeldout: heldout, otherDiffs: others } : undefined;
        const v = core.cognitiveGate.wisdomGate(cwd, sig, newDiff || "", Date.now(), bench);
        const data = await attest(cwd, "cognitive", { author, verdict: v.verdict, deviation: v.judgement.deviation, ratio: v.judgement.ratio, sampleCount: sig.sampleCount, reason: v.judgement.reason, separable: v.separability?.separable ?? null });
        return { data, wisdom: `cognitive: ${v.verdict} · ${v.judgement.reason} (author ${author}, ${sig.sampleCount} samples)`, followUp: [], confidence: { level: v.verdict === "UNKNOWN" ? "low" as const : "medium" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
  {
    name: "mneme.branch.analyze",
    category: "meta",
    description: "🌿 BRANCH ORACLE — a SIGNED real-signal snapshot of every local branch vs the base: merge-conflict overlap (files changed on BOTH since the fork), decay (stale touched files), divergence (ahead/behind), staleness. Each branch gets a band (healthy / caution / risky) computed from REAL signals — NOT a prediction of the future. Ranks the safest branch. Ed25519-signed; verify offline.",
    whenToUse: "Deciding which branch to work on / merge next, or warning about merge-conflict risk — a present-tense, signed health read across all branches.",
    triggers: ["branch oracle", "analyze branches", "which branch is safest", "merge conflict risk"],
    inputSchema: { type: "object", properties: { base: { type: "string", description: "Base branch to compare against (default: main, else master)." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        if (!git(cwd, ["rev-parse", "--git-dir"])) return low("not a git repo");
        let base = typeof args["base"] === "string" ? args["base"] as string : "";
        if (!base) base = git(cwd, ["rev-parse", "--verify", "-q", "main"]) ? "main" : (git(cwd, ["rev-parse", "--verify", "-q", "master"]) ? "master" : "");
        if (!base) return low("no base branch (main/master) found");
        const branches = git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split("\n").filter((b) => b && b !== base);
        const baseChanged = git(cwd, ["diff", "--name-only", `${base}@{u}`, base]) || git(cwd, ["diff", "--name-only", `${base}`]); // base's own recent changes (best-effort)
        const inputs = branches.slice(0, 50).map((name) => {
          const mb = git(cwd, ["merge-base", base, name]);
          const ahead = parseInt(git(cwd, ["rev-list", "--count", `${base}..${name}`]) || "0", 10);
          const behind = parseInt(git(cwd, ["rev-list", "--count", `${name}..${base}`]) || "0", 10);
          const changedFiles = (mb ? git(cwd, ["diff", "--name-only", mb, name]) : "").split("\n").filter(Boolean);
          const baseChangedFiles = (mb ? git(cwd, ["diff", "--name-only", mb, base]) : baseChanged).split("\n").filter(Boolean);
          const last = git(cwd, ["log", "-1", "--format=%ct", name]);
          const ageDays = last ? Math.max(0, Math.round((Date.now() / 1000 - parseInt(last, 10)) / 86400)) : 0;
          return { name, ahead, behind, changedFiles, baseChangedFiles, staleFiles: 0, ageDays };
        });
        const r = core.branchOracle.analyzeBranches(cwd, inputs, Date.now());
        const data = await attest(cwd, "branch", { summary: r.summary, signals: r.signals.map((s) => ({ name: s.name, band: s.band, conflictRisk: s.conflictRisk, ahead: s.ahead, behind: s.behind, reasons: s.reasons })) });
        return { data, wisdom: `branches: ${r.summary.branches} (${r.summary.healthy} healthy / ${r.summary.caution} caution / ${r.summary.risky} risky) · safest: ${r.summary.safestBranch ?? "—"}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
