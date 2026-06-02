/**
 * `mneme haunt <file>` (v2.141.0) — "Code Haunting" / Git Telepathy. Surface the
 * ghost of the commit that last touched a region: who changed it, when, the
 * intent they recorded ("temporary fix" / "แก้ขัดไปก่อน"), the safeguards it
 * lacks for the symptom you gave, and the team knowledge already shared about it.
 *
 *   mneme haunt src/payment.ts --line 40-92 --symptom "slow under traffic peak"
 *   mneme haunt src/auth.ts                 # whole-file haunting
 *   mneme haunt src/payment.ts --json
 *
 * HONEST: surfaces + correlates REAL git facts + recorded intent — a candidate to
 * look at, never a proven cause; UNKNOWN when there is no history.
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { haunt, git, cortex, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

function parseRange(s?: string): { start: number; end: number } | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d+)\s*[-:,]\s*(\d+)$/);
  if (m) return { start: parseInt(m[1]!, 10), end: parseInt(m[2]!, 10) };
  const one = s.match(/^(\d+)$/);
  if (one) { const n = parseInt(one[1]!, 10); return { start: n, end: n }; }
  return undefined;
}

function snippet(cwd: string, file: string, region?: { start: number; end: number }): string {
  try {
    const p = join(cwd, file);
    if (!existsSync(p)) return "";
    const lines = readFileSync(p, "utf8").split("\n");
    if (region) return lines.slice(Math.max(0, region.start - 1), region.end).join("\n");
    return lines.slice(0, 160).join("\n");
  } catch { return ""; }
}

/** Best-effort JIT knowledge pull from the Cortex (#2 Knowledge Osmosis). Total. */
function relatedKnowledge(cwd: string, file: string, symptom?: string): haunt.HauntKnowledge[] {
  try {
    const p = join(cwd, ".mneme", "cortex", "store.json");
    if (!existsSync(p)) return [];
    const store = JSON.parse(readFileSync(p, "utf8"));
    const base = file.split("/").pop()?.replace(/\.[a-z]+$/i, "") ?? file;
    const query = `${base} ${file} ${symptom ?? ""}`.trim();
    const hits = cortex.recall(store as Parameters<typeof cortex.recall>[0], query, 3) ?? [];
    return hits.map((h) => ({ source: h.entry?.agent, value: h.entry?.value })).filter((k) => typeof k.value === "string" && k.value.length > 0);
  } catch { return []; }
}

export function registerHauntCommands(program: Command): void {
  program
    .command("haunt")
    .description("👻 CODE HAUNTING (Git Telepathy) — when a region acts up, surface the ghost of the commit that last touched it: who changed it, when, the intent they recorded ('temporary fix' / 'แก้ขัดไปก่อน'), the safeguards it lacks for your symptom, and the team knowledge already shared about it — one plain-language report instead of a manual git-blame dig. Detects intent in EN + TH. HONEST: surfaces + correlates REAL git facts — a candidate to look at, never a proven cause; UNKNOWN when there's no history.")
    .argument("<file>", "the file to investigate (repo-relative)")
    .option("--line <a-b>", "line range to focus on (e.g. 40-92)")
    .option("--symptom <text>", "the symptom from the alert (e.g. \"slow under traffic peak\")")
    .option("--json", "JSON output (signed)")
    .action(async (file: string, opts: { line?: string; symptom?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const region = parseRange(opts.line);
      let blameLines: haunt.HauntBlame[] = [];
      let commits: haunt.HauntCommit[] = [];
      try {
        const bl = await git.blame(cwd, file, region?.start, region?.end);
        blameLines = bl.map((b) => ({ commitHash: b.commitHash, authorName: b.authorName, authorTime: b.authorTime, lineNumber: b.lineNumber, content: b.content }));
      } catch { /* */ }
      try {
        const cs = await git.readCommits({ cwd, paths: [file], maxCount: 10 });
        commits = cs.map((c) => ({ hash: c.hash, authorName: c.authorName, authorDate: c.authorDate, subject: c.subject, body: c.body }));
      } catch { /* */ }

      const report = haunt.buildHauntReport({
        file, region, blame: blameLines, commits,
        codeSnippet: snippet(cwd, file, region),
        symptom: opts.symptom,
        knowledge: relatedKnowledge(cwd, file, opts.symptom),
        nowMs: Date.now(),
      });

      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `haunt:${report.verdict}:${file}`, payload: { verdict: report.verdict, temporaryFix: report.intent.temporaryFix, risks: report.riskFlags.length }, includePayload: true }); } catch { /* */ }

      if (opts.json) { out(JSON.stringify({ ...report, signed: receipt }, null, 2)); process.exitCode = report.verdict === "HAUNTED" ? 2 : 0; return; }

      const icon = report.verdict === "HAUNTED" ? "👻" : report.verdict === "CLEAR" ? "🟢" : "❔";
      out(`${icon} CODE HAUNTING — ${report.verdict}`);
      out("");
      out(report.narrative);
      if (report.intent.signals.length) { out(""); out("Recorded intent:"); for (const s of report.intent.signals) out(`   • [${s.label}] ${s.quote}`); }
      if (report.riskFlags.length) { out(""); out("Missing safeguards (lexical signals — look, don't assume):"); for (const f of report.riskFlags) out(`   • ${f}`); }
      if (report.relatedKnowledge.length) { out(""); out("💡 Team knowledge for this area:"); for (const k of report.relatedKnowledge) out(`   • ${k.source ? k.source + ": " : ""}${k.value}`); }
      out("");
      out(`   ${receipt ? "✓ signed (verify offline with the NOTARY public key) · " : ""}surfaced from real git history — a candidate, not a proven cause.`);
      process.exitCode = report.verdict === "HAUNTED" ? 2 : 0;
    });
}
