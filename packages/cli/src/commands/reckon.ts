/**
 * `mneme reckon <commit>` (v2.199.0) — the signed accountability dossier.
 * Assembles the signed evidence (attestation · secret-screen · engagement policy ·
 * survival) for a commit into a verdict — EXONERATED / ACCOUNTABLE / INSUFFICIENT —
 * signed (NOTARY) so a court/auditor/insurer verifies it offline. The permanent record
 * as a shield, not a threat.
 */
import type { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reckoning, commitAttest, engagement, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function git(args: string[], cwd: string): string { try { return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }

function gatherEvidence(cwd: string, ref: string): reckoning.Evidence {
  const sha = git(["rev-parse", ref], cwd) || ref;
  // attestation
  let attested = false, attestVerified = false, secretsClean = true;
  const ap = join(cwd, ".mneme", "attest", "chain.jsonl");
  if (existsSync(ap)) {
    try {
      for (const l of readFileSync(ap, "utf8").trim().split("\n").filter(Boolean)) {
        const e = JSON.parse(l) as commitAttest.AttestEntry;
        if (e.record?.subject === `commit:${sha}`) { attested = true; attestVerified = commitAttest.verifyAttest(e).valid; secretsClean = Number((e.facts as { addedSecrets?: number })?.addedSecrets ?? 0) === 0; break; }
      }
    } catch { /* */ }
  }
  // engagement: evaluate the commit's files against the repo policy
  let policy = engagement.defaultPolicy();
  const pp = join(cwd, ".mneme", "engagement.json");
  if (existsSync(pp)) { try { policy = { ...policy, ...(JSON.parse(readFileSync(pp, "utf8")) as object) }; } catch { /* */ } }
  const files = git(["show", "--name-only", "--format=", sha], cwd).split("\n").map((s) => s.trim()).filter(Boolean);
  const eng = engagement.evaluateEngagement(policy, { kind: "write", paths: files, fileCount: files.length });
  // survival: was it explicitly reverted later? (the reliable signed-message signal)
  const reverted = !!git(["log", "--all", `--grep=This reverts commit ${sha}`, "--oneline"], cwd);
  return { subject: sha, attested, attestVerified, secretsClean, engagement: eng.decision, cosigned: false, customsClean: true, reverted };
}

export function registerReckonCommands(program: Command): void {
  program.command("reckon [commit]").description("⚖️ ACCOUNTABILITY DOSSIER — assemble the signed evidence for a commit into a verdict (EXONERATED / ACCOUNTABLE / INSUFFICIENT), signed + offline-verifiable. The permanent record as a shield.")
    .option("--json", "the full signed dossier")
    .action((commit: string | undefined, opts: { json?: boolean }) => {
      const cwd = process.cwd();
      if (!existsSync(join(cwd, ".git"))) { out("not a git repo"); process.exitCode = 2; return; }
      const ev = gatherEvidence(cwd, commit ?? "HEAD");
      const r = reckoning.buildReckoning(ev);
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `reckon:${ev.subject.slice(0, 12)}`, payload: r, includePayload: true }); } catch { /* */ }
      if (opts.json) { out(JSON.stringify({ evidence: ev, reckoning: r, receipt }, null, 2)); return; }
      const icon = r.verdict === "EXONERATED" ? "🟢" : r.verdict === "ACCOUNTABLE" ? "🔴" : "⚪";
      out(`⚖️ Reckoning · ${ev.subject.slice(0, 10)} → ${icon} ${r.verdict}`);
      for (const f of r.findings) out(`   ${f.severity === "violation" ? "✗" : f.severity === "clear" ? "✓" : "·"} ${f.text}`);
      out(`   ${receipt ? "signed — anyone can verify this verdict offline (mneme notary verify)" : "(unsigned)"}`);
      if (r.verdict === "ACCOUNTABLE") process.exitCode = 2;
    });
}
