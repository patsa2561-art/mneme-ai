/**
 * `mneme crucible` (v2.142.0) — the File-level Settlement Gate. Apply an AI's
 * diff in a SHADOW git worktree, build/test it THERE, and only merge to the real
 * tree if the shadow verification PASSES — signed receipt either way. A failing
 * diff never touches your real disk.
 *
 *   git diff > change.patch
 *   mneme crucible --diff change.patch --verify "npm test"          # dry: report only
 *   mneme crucible --diff change.patch --verify "npm test" --merge  # write real tree on PASS
 *
 * Exit 2 on ROLLBACK/REVIEW (not merged). HONEST: proves YOUR build/test passed
 * in a shadow with the diff applied — not that the code is bug-free; it's a
 * shadow (git worktree), not a security sandbox (pair with the HEPHAESTUS gate).
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { crucible, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }
function git(args: string[], cwd: string): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

export function registerCrucibleCommands(program: Command): void {
  program
    .command("crucible")
    .description("💎 CRUCIBLE — the File-level Settlement Gate. Apply an AI's diff in a SHADOW git worktree (shares .git, no full copy), build/test it THERE, and merge to your real tree ONLY if the shadow verification PASSES — signed receipt either way. A failing diff never touches your real disk. `mneme crucible --diff change.patch --verify \"npm test\" [--merge]`. Exit 2 if not merged. HONEST: proves YOUR build/test passed in a shadow with the diff applied — not bug-free code; it's a shadow (git worktree), not a security sandbox (pair with the command gate).")
    .requiredOption("--diff <file>", "unified diff/patch to settle (use '-' for stdin)")
    .requiredOption("--verify <cmd>", "build/test command to run IN the shadow (e.g. \"npm test\")")
    .option("--merge", "on PASS, apply the diff to the REAL tree (default: report only)")
    .option("--review", "even on PASS, hold for human merge (never auto-write)")
    .option("--json", "JSON output (signed)")
    .action((opts: { diff: string; verify: string; merge?: boolean; review?: boolean; json?: boolean }) => {
      const cwd = process.cwd();
      // read diff
      let diffText = "";
      try { diffText = opts.diff === "-" ? readFileSync(0, "utf8") : (existsSync(opts.diff) ? readFileSync(opts.diff, "utf8") : ""); } catch { /* */ }
      if (!diffText.trim()) { out("✗ empty diff"); process.exitCode = 2; return; }

      // is this a git repo?
      if (git(["rev-parse", "--is-inside-work-tree"], cwd).code !== 0) { out("✗ not a git repository — CRUCIBLE needs git for the shadow worktree"); process.exitCode = 2; return; }

      const plan = crucible.planSettlement(diffText);
      const shadow = mkdtempSync(join(tmpdir(), "mneme-crucible-"));
      const patchFile = join(shadow, "_mneme.patch");
      let verify: crucible.VerifyResult = { exitCode: 1 };
      let stage = "init";
      try {
        // 1) shadow worktree at current HEAD (detached) — shares .git, cheap
        stage = "worktree-add";
        const wt = git(["worktree", "add", "--detach", shadow, "HEAD"], cwd);
        if (wt.code !== 0) { out(`✗ could not create shadow worktree: ${wt.out.slice(0, 200)}`); process.exitCode = 2; return; }

        // 2) apply the diff IN the shadow
        stage = "apply";
        writeFileSync(patchFile, diffText);
        let ap = git(["apply", "--whitespace=nowarn", patchFile], shadow);
        if (ap.code !== 0) ap = git(["apply", "--3way", "--whitespace=nowarn", patchFile], shadow);
        if (ap.code !== 0) {
          verify = { exitCode: 1, output: "diff did not apply cleanly in the shadow:\n" + ap.out.slice(0, 400) };
        } else {
          // 3) run the verify command IN the shadow
          stage = "verify";
          const t0 = Date.now();
          const r = spawnSync(opts.verify, { cwd: shadow, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 });
          verify = { exitCode: r.status ?? 1, durationMs: Date.now() - t0, output: ((r.stdout ?? "") + "\n" + (r.stderr ?? "")).slice(-4000) };
        }
      } finally {
        // 4) ALWAYS remove the shadow worktree (real tree untouched so far)
        try { git(["worktree", "remove", "--force", shadow], cwd); } catch { /* */ }
        try { if (existsSync(shadow)) rmSync(shadow, { recursive: true, force: true }); } catch { /* */ }
        try { git(["worktree", "prune"], cwd); } catch { /* */ }
      }

      const decision = crucible.decideSettlement(verify, { requireHumanMerge: opts.review });

      // 5) write the REAL tree ONLY on MERGE *and* explicit --merge
      let realWritten = false;
      if (decision.verdict === "MERGE" && opts.merge) {
        const realPatch = join(tmpdir(), `mneme-merge-${process.pid}.patch`);
        try {
          writeFileSync(realPatch, diffText);
          let ap = git(["apply", "--whitespace=nowarn", realPatch], cwd);
          if (ap.code !== 0) ap = git(["apply", "--3way", "--whitespace=nowarn", realPatch], cwd);
          realWritten = ap.code === 0;
          if (!realWritten) decision.reason += " — but applying to the real tree failed (it changed since the shadow); re-run.";
        } catch { /* */ } finally { try { rmSync(realPatch, { force: true }); } catch { /* */ } }
      }

      const body = { ...crucible.crucibleReceiptBody(diffText, verify, decision), realTreeWritten: realWritten, stage };
      let receipt: unknown = null;
      try { receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: `crucible:${decision.verdict}`, payload: { verdict: decision.verdict, realTreeWritten: realWritten, exitCode: body.exitCode }, includePayload: true }); } catch { /* */ }

      if (opts.json) { out(JSON.stringify({ ...body, decision, signed: receipt }, null, 2)); process.exitCode = decision.verdict === "MERGE" ? 0 : 2; return; }

      const icon = decision.verdict === "MERGE" ? "🟢" : decision.verdict === "REVIEW" ? "🟡" : "🛑";
      out(`${icon} CRUCIBLE — ${decision.verdict}`);
      out(`   shadow: ${plan.touchedPaths.length} file(s), +${plan.addedLines}/-${plan.removedLines} lines · verify exit ${body.exitCode}${body.durationMs ? ` (${body.durationMs}ms)` : ""}`);
      out(`   ${decision.reason}`);
      if (decision.failureBrief) out(`   ↳ ${decision.failureBrief}`);
      if (decision.verdict === "MERGE") out(opts.merge ? (realWritten ? "   ✅ merged to the real tree." : "   ⚠ merge to real tree did not apply — re-run.") : "   (dry-run — pass --merge to write the real tree; real tree untouched.)");
      else out("   ✋ real tree untouched.");
      if (receipt) out("   ✓ signed (verify offline with the NOTARY public key)");
      process.exitCode = decision.verdict === "MERGE" ? 0 : 2;
    });
}
