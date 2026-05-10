/**
 * Self-modifying NUCLEUS proposal engine. Reads local telemetry,
 * produces markdown PR proposals stored at `.mneme/proposals/<id>.md`.
 *
 * Three signal sources today:
 *
 *   1. selfcheck FAILs (the conscience loop) -- recurring failures
 *      across audit runs deserve a code fix, not a daily nag.
 *   2. antivirus infection ledger -- recurring strains caught at high
 *      rate suggest the underlying tool produces them; investigate.
 *   3. PRECOG predictions that NEVER hit -- the AI is calling tools the
 *      cache thought it wouldn't. Either fix the prediction model or
 *      add a tool that bridges the gap.
 *
 * No remote telemetry. No auto-merge. The proposal is markdown a human
 * (or CI agent) can review and turn into a PR by hand.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type { EvolveSignal, EvolveProposal, EvolveStats } from "./types.js";

const DIR = ".mneme/proposals";

function ensureDir(repoRoot: string): void {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ─── signal collectors ──────────────────────────────────────────────────

function collectSelfcheckSignals(repoRoot: string): EvolveSignal[] {
  const lastPath = join(repoRoot, ".mneme/selfcheck/last.json");
  if (!existsSync(lastPath)) return [];
  try {
    const r = JSON.parse(readFileSync(lastPath, "utf8")) as {
      ranAt?: string;
      verdicts?: Array<{ name: string; status: string; evidence: string; fixHint?: string }>;
    };
    return (r.verdicts ?? [])
      .filter((v) => v.status === "fail" || v.status === "warn")
      .map((v) => ({
        kind: "selfcheck-fail",
        pattern: `selfcheck:${v.name}:${v.status}`,
        occurrences: 1, // we only have last.json -- treat as 1 occurrence
        firstSeen: r.ranAt ?? new Date().toISOString(),
        lastSeen: r.ranAt ?? new Date().toISOString(),
        evidence: `${v.evidence}${v.fixHint ? ` -- fix hint: ${v.fixHint}` : ""}`,
      }));
  } catch {
    return [];
  }
}

function collectAntivirusSignals(repoRoot: string): EvolveSignal[] {
  const statsPath = join(repoRoot, ".mneme/antivirus/stats.json");
  if (!existsSync(statsPath)) return [];
  try {
    const s = JSON.parse(readFileSync(statsPath, "utf8")) as {
      byStrain?: Record<string, { caught?: number; lastCaughtAt?: string }>;
      totalScans?: number;
    };
    const out: EvolveSignal[] = [];
    for (const [strain, slot] of Object.entries(s.byStrain ?? {})) {
      const caught = slot.caught ?? 0;
      // Only signal when a strain was caught >=3 times -- avoids one-off
      // noise.
      if (caught < 3) continue;
      out.push({
        kind: "antivirus-recurrence",
        pattern: `antivirus:${strain}`,
        occurrences: caught,
        firstSeen: slot.lastCaughtAt ?? new Date().toISOString(),
        lastSeen: slot.lastCaughtAt ?? new Date().toISOString(),
        evidence: `Strain ${strain} caught ${caught} times across ${s.totalScans ?? 0} scans`,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function collectPrecogMissSignals(repoRoot: string): EvolveSignal[] {
  // A "miss" is a prediction that expired without `hit: true`. We sample
  // the cache.jsonl and group by toTool.
  const cachePath = join(repoRoot, ".mneme/oracle/cache.jsonl");
  if (!existsSync(cachePath)) return [];
  try {
    const lines = readFileSync(cachePath, "utf8").trim().split("\n").filter(Boolean);
    const now = Date.now();
    const missesByTool = new Map<string, { count: number; firstSeen: string; lastSeen: string }>();
    for (const ln of lines) {
      try {
        const p = JSON.parse(ln) as { toTool?: string; expiresAt?: string; hit?: boolean; predictedAt?: string };
        if (!p.toTool || !p.expiresAt || !p.predictedAt) continue;
        const expired = Date.parse(p.expiresAt) < now;
        if (!expired || p.hit) continue;
        const cur = missesByTool.get(p.toTool);
        if (cur) {
          cur.count++;
          if (p.predictedAt < cur.firstSeen) cur.firstSeen = p.predictedAt;
          if (p.predictedAt > cur.lastSeen) cur.lastSeen = p.predictedAt;
        } else {
          missesByTool.set(p.toTool, { count: 1, firstSeen: p.predictedAt, lastSeen: p.predictedAt });
        }
      } catch { /* skip */ }
    }
    return Array.from(missesByTool.entries())
      .filter(([, v]) => v.count >= 5) // only worth reporting when miss-count is real
      .map(([tool, v]) => ({
        kind: "precog-miss",
        pattern: `precog:miss:${tool}`,
        occurrences: v.count,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
        evidence: `PRECOG predicted ${tool} ${v.count} times but the AI never called it. Either lower the prediction weight or add the missing follow-up tool.`,
      }));
  } catch {
    return [];
  }
}

/** Aggregate every signal collector. */
export function scanSignals(repoRoot: string): EvolveSignal[] {
  return [
    ...collectSelfcheckSignals(repoRoot),
    ...collectAntivirusSignals(repoRoot),
    ...collectPrecogMissSignals(repoRoot),
  ];
}

// ─── proposal generator ─────────────────────────────────────────────────

function patternToHumanTitle(pattern: string, occurrences: number): string {
  const m = /^selfcheck:([^:]+):/.exec(pattern);
  if (m) return `Self-heal: selfcheck "${m[1]}" keeps failing (${occurrences}x)`;
  const a = /^antivirus:(.+)$/.exec(pattern);
  if (a) return `Vaccine miss: ${a[1]} caught ${occurrences} times -- harden upstream tool`;
  const p = /^precog:miss:(.+)$/.exec(pattern);
  if (p) return `PRECOG: predicted ${p[1]} ${occurrences}x but no hit -- adjust weighting or wire missing tool`;
  return `Recurring pattern: ${pattern} (${occurrences}x)`;
}

function suggestionFor(signal: EvolveSignal): EvolveProposal["suggestion"] {
  const m = /^selfcheck:([^:]+):/.exec(signal.pattern);
  if (m) {
    return {
      files: ["packages/core/src/selfcheck/checks.ts"],
      direction: `Inspect the "${m[1]}" check. If the failure is environmental (missing dep, bad config), make the check skip gracefully instead of warn. If it's a real defect, fix the root cause cited in the evidence.`,
      similarPriorPRs: ["v1.26.0 selfcheck conscience loop initial 12 checks"],
    };
  }
  if (signal.pattern.startsWith("antivirus:")) {
    const strain = signal.pattern.split(":")[1] ?? "?";
    return {
      files: ["packages/core/src/antivirus/vaccines.ts"],
      direction: `Examine the upstream that produces strain "${strain}" hits. If the source is a Mneme tool (mneme.*), tighten the verifier in that tool. If it's an external AI agent, propose a sharper vaccine signature in pharmacopoeia.`,
      similarPriorPRs: ["v1.24.x antivirus pharmacopoeia + bench cycles"],
    };
  }
  if (signal.pattern.startsWith("precog:miss:")) {
    return {
      files: ["packages/core/src/oracle/oracle.ts", "packages/core/src/oracle/types.ts"],
      direction: "Reduce alpha (markov weight) or beta (pheromone weight) for transitions involving this tool, OR add a tool that bridges the predicted gap so future predictions can hit.",
      similarPriorPRs: ["v1.26.3 PRECOG launch"],
    };
  }
  return undefined;
}

function confidenceFor(signals: EvolveSignal[]): number {
  // Simple model: more occurrences + more sources = higher confidence.
  const totalOccurrences = signals.reduce((s, x) => s + x.occurrences, 0);
  const sources = new Set(signals.map((s) => s.kind)).size;
  const occScore = Math.min(1, totalOccurrences / 20); // saturate at 20
  const srcScore = Math.min(1, sources / 3);            // saturate at 3 kinds
  return 0.7 * occScore + 0.3 * srcScore;
}

function buildBody(p: { signals: EvolveSignal[]; confidence: number; suggestion?: EvolveProposal["suggestion"] }): string {
  const lines: string[] = [];
  lines.push(`## Evidence (collected from local telemetry)\n`);
  for (const s of p.signals) {
    lines.push(`- **${s.kind}** \`${s.pattern}\` -- ${s.occurrences} occurrence${s.occurrences === 1 ? "" : "s"}`);
    lines.push(`  - First seen: ${s.firstSeen}`);
    lines.push(`  - Last seen:  ${s.lastSeen}`);
    if (s.evidence) lines.push(`  - Evidence:   ${s.evidence}`);
    if (s.filePath) lines.push(`  - File:       \`${s.filePath}\``);
  }
  lines.push("");
  lines.push(`## Suggestion`);
  if (p.suggestion) {
    lines.push(`- **Touch files:** ${p.suggestion.files.map((f) => `\`${f}\``).join(", ")}`);
    lines.push(`- **Direction:** ${p.suggestion.direction}`);
    if (p.suggestion.similarPriorPRs && p.suggestion.similarPriorPRs.length > 0) {
      lines.push(`- **Similar prior work:** ${p.suggestion.similarPriorPRs.join("; ")}`);
    }
  } else {
    lines.push(`No automatic suggestion. Review evidence above + write a fix.`);
  }
  lines.push("");
  lines.push(`## Confidence: ${(p.confidence * 100).toFixed(0)}%`);
  lines.push("");
  lines.push(`> Generated by Mneme self-modifying NUCLEUS (v1.26.4+). NOT auto-merged.`);
  lines.push(`> A human (or CI agent) must open the actual PR.`);
  return lines.join("\n");
}

/**
 * Group signals by pattern, build one EvolveProposal per group.
 * Returns the proposals (also writes them to disk).
 */
export function generateProposals(repoRoot: string, signals?: EvolveSignal[]): EvolveProposal[] {
  const sigs = signals ?? scanSignals(repoRoot);
  if (sigs.length === 0) return [];

  // Group by pattern. (Multiple signals with same pattern stack their counts.)
  const groups = new Map<string, EvolveSignal[]>();
  for (const s of sigs) {
    const arr = groups.get(s.pattern) ?? [];
    arr.push(s);
    groups.set(s.pattern, arr);
  }

  const proposals: EvolveProposal[] = [];
  for (const [pattern, group] of groups) {
    const totalOcc = group.reduce((sum, s) => sum + s.occurrences, 0);
    const firstSeen = group.map((s) => s.firstSeen).sort()[0]!;
    const id = createHash("sha256").update(pattern).update(firstSeen).digest("hex").slice(0, 12);
    const confidence = confidenceFor(group);
    const suggestion = suggestionFor(group[0]!);
    const proposal: EvolveProposal = {
      id,
      generatedAt: new Date().toISOString(),
      title: patternToHumanTitle(pattern, totalOcc),
      body: buildBody({ signals: group, confidence, suggestion }),
      confidence,
      signals: group,
      suggestion,
    };
    proposals.push(proposal);
  }

  // Persist each as `<id>.md`.
  ensureDir(repoRoot);
  for (const p of proposals) {
    const path = join(repoRoot, DIR, `${p.id}.md`);
    const md = `# ${p.title}\n\n${p.body}\n`;
    try { writeFileSync(path, md, "utf8"); } catch { /* best-effort */ }
    // Also persist a JSON sidecar so `mneme evolve list/view` can parse.
    try { writeFileSync(join(repoRoot, DIR, `${p.id}.json`), JSON.stringify(p, null, 2), "utf8"); } catch { /* */ }
  }

  return proposals;
}

/** List every persisted proposal. v1.27.2 fix: skip *.synth.json
 *  sidecars (Phase-3 synthesis output) which were leaking into the
 *  list as `[id] (??%) undefined` entries. */
export function listProposals(repoRoot: string): EvolveProposal[] {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".synth.json"))
      .map((f) => {
        try { return JSON.parse(readFileSync(join(dir, f), "utf8")) as EvolveProposal; }
        catch { return null; }
      })
      .filter((p): p is EvolveProposal => p !== null)
      .sort((a, b) => b.confidence - a.confidence);
  } catch {
    return [];
  }
}

/**
 * View one proposal by id (returns markdown).
 *
 * v1.27.2 -- accepts THREE id forms:
 *   1. proposalId (12 hex chars)        -> reads <id>.md
 *   2. proposalId + has synth.json      -> appends Phase-3 status header + patch
 *   3. synthesisId (16 hex chars)       -> resolves to its proposalId + behaves as case 2
 *
 * This way `mneme evolve view <anything>` always returns the right
 * artifact. No more "no proposal at id" when the user copies an id
 * from `mneme evolve synthesize` output.
 */
export function viewProposal(repoRoot: string, id: string): string | null {
  const dir = join(repoRoot, DIR);

  // Try direct: <id>.md (proposal form)
  const md = join(dir, `${id}.md`);
  let proposalId: string | null = null;
  if (existsSync(md)) {
    proposalId = id;
  } else {
    // Maybe `id` is a synthesisId. Walk every .synth.json and look up.
    if (existsSync(dir)) {
      try {
        for (const f of readdirSync(dir)) {
          if (!f.endsWith(".synth.json")) continue;
          try {
            const s = JSON.parse(readFileSync(join(dir, f), "utf8")) as { id?: string; proposalId?: string };
            if (s.id === id && s.proposalId) { proposalId = s.proposalId; break; }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }
  if (!proposalId) return null;

  // Read the proposal markdown.
  let body = "";
  const proposalMd = join(dir, `${proposalId}.md`);
  if (existsSync(proposalMd)) {
    try { body = readFileSync(proposalMd, "utf8"); } catch { /* */ }
  }

  // Append Phase-3 status if a synthesis sidecar exists.
  const synthPath = join(dir, `${proposalId}.synth.json`);
  const patchPath = join(dir, `${proposalId}.patch`);
  if (existsSync(synthPath)) {
    try {
      const synth = JSON.parse(readFileSync(synthPath, "utf8")) as {
        id?: string; templateId?: string; verified?: boolean;
        confidence?: number; signature?: string;
      };
      const verifiedTag = synth.verified ? "VERIFIED ✓" : "NOT verified ✗";
      const header = [
        ``,
        `---`,
        ``,
        `## Phase-3 synthesis status: ${verifiedTag}`,
        ``,
        `- synthesisId: \`${synth.id ?? "?"}\``,
        `- template:    \`${synth.templateId ?? "?"}\``,
        `- confidence:  ${synth.confidence != null ? (synth.confidence * 100).toFixed(0) + "%" : "?"}`,
        `- signature:   \`${synth.signature?.slice(0, 16) ?? "?"}...\``,
        ``,
      ].join("\n");
      body += header;
      if (synth.verified && existsSync(patchPath)) {
        try {
          const patchBody = readFileSync(patchPath, "utf8");
          body += `### Verified .patch (run \`mneme evolve apply ${proposalId}\` to apply)\n\n\`\`\`diff\n${patchBody}\n\`\`\`\n`;
        } catch { /* */ }
      }
    } catch { /* */ }
  }
  return body || null;
}

/** Aggregate stats. */
export function evolveStats(repoRoot: string): EvolveStats {
  const sigs = scanSignals(repoRoot);
  const proposals = listProposals(repoRoot);
  const byKind: Record<string, number> = {};
  for (const s of sigs) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  const topPattern = sigs.length === 0 ? null
    : sigs.slice().sort((a, b) => b.occurrences - a.occurrences)[0]!.pattern;
  return {
    totalSignals: sigs.length,
    totalProposals: proposals.length,
    byKind,
    topPattern,
  };
}
