/**
 * v2.142.0 — CRUCIBLE MCP surface (the File-level Settlement Gate).
 * mneme.crucible.settle — apply a diff in a shadow git worktree, run the verify
 * command there, and return the settlement verdict (+ merge to the real tree on
 * PASS when merge:true). Self-attesting. The real tree is written iff MERGE.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
function canon(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"; if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; const k = Object.keys(v as Record<string, unknown>).sort(); return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}"; }
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try { const core = await import("@mneme-ai/core"); const h = sha256(canon(data)); const r = core.notary.issueReceipt(cwd, { kind: "claim-verdict", subject, payload: { dataHash: h }, includePayload: true }); return { ...data, _proof: { dataHash: h, receipt: r } }; } catch { return data; }
}
const low = (m: string) => ({ data: { ok: false, error: m }, wisdom: m, followUp: [] as string[], confidence: { level: "low" as const } });
function git(args: string[], cwd: string): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

export const CRUCIBLE_TOOLS: MnemeTool[] = [
  {
    name: "mneme.crucible.settle",
    category: "forensics",
    description: "💎 CRUCIBLE — the File-level Settlement Gate. Apply a unified `diff` in a SHADOW git worktree (shares .git, not a kernel sandbox), run your `verify` command (build/test) THERE, and return the settlement verdict — MERGE (passed) / ROLLBACK (failed) / REVIEW. The real tree is written ONLY if the verdict is MERGE *and* `merge:true`; a failing diff never touches the real disk. Signed. HONEST: proves YOUR verify command passed in a shadow with the diff applied — not bug-free code; it's a shadow (worktree), not a security sandbox (a malicious build script still runs — pair with mneme.heph).",
    whenToUse: "BEFORE writing a non-trivial AI-authored diff to disk: settle it in the shadow first. If ROLLBACK, do NOT apply — surface the failure brief. Pass merge:true only when you want a passing diff written to the real tree automatically.",
    triggers: ["crucible", "settlement gate", "shadow build", "test before apply", "try this diff safely", "build and test the patch", "dry-run the diff"],
    inputSchema: { type: "object", required: ["diff", "verify"], properties: { diff: { type: "string", description: "the unified diff/patch to settle" }, verify: { type: "string", description: "build/test command to run in the shadow, e.g. \"npm test\"" }, merge: { type: "boolean", description: "on PASS, apply the diff to the REAL tree (default false = report only)" }, review: { type: "boolean", description: "even on PASS, hold for human merge (never auto-write)" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const diff = typeof args["diff"] === "string" ? args["diff"] as string : "";
        const verifyCmd = typeof args["verify"] === "string" ? args["verify"] as string : "";
        if (!diff.trim() || !verifyCmd.trim()) return low("both diff and verify are required");
        if (git(["rev-parse", "--is-inside-work-tree"], cwd).code !== 0) return low("not a git repository — CRUCIBLE needs git for the shadow worktree");

        const shadow = mkdtempSync(join(tmpdir(), "mneme-crucible-"));
        const patchFile = join(shadow, "_mneme.patch");
        let verify: import("@mneme-ai/core").crucible.VerifyResult = { exitCode: 1 };
        try {
          const wt = git(["worktree", "add", "--detach", shadow, "HEAD"], cwd);
          if (wt.code !== 0) return low("could not create shadow worktree: " + wt.out.slice(0, 160));
          writeFileSync(patchFile, diff);
          let ap = git(["apply", "--whitespace=nowarn", patchFile], shadow);
          if (ap.code !== 0) ap = git(["apply", "--3way", "--whitespace=nowarn", patchFile], shadow);
          if (ap.code !== 0) { verify = { exitCode: 1, output: "diff did not apply cleanly in shadow:\n" + ap.out.slice(0, 400) }; }
          else { const t0 = Date.now(); const r = spawnSync(verifyCmd, { cwd: shadow, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 }); verify = { exitCode: r.status ?? 1, durationMs: Date.now() - t0, output: ((r.stdout ?? "") + "\n" + (r.stderr ?? "")).slice(-4000) }; }
        } finally {
          try { git(["worktree", "remove", "--force", shadow], cwd); } catch { /* */ }
          try { if (existsSync(shadow)) rmSync(shadow, { recursive: true, force: true }); } catch { /* */ }
          try { git(["worktree", "prune"], cwd); } catch { /* */ }
        }

        const decision = core.crucible.decideSettlement(verify, { requireHumanMerge: args["review"] === true });
        let realWritten = false;
        if (decision.verdict === "MERGE" && args["merge"] === true) {
          const realPatch = join(tmpdir(), `mneme-merge-${process.pid}.patch`);
          try { writeFileSync(realPatch, diff); let ap = git(["apply", "--whitespace=nowarn", realPatch], cwd); if (ap.code !== 0) ap = git(["apply", "--3way", "--whitespace=nowarn", realPatch], cwd); realWritten = ap.code === 0; } catch { /* */ } finally { try { rmSync(realPatch, { force: true }); } catch { /* */ } }
        }
        const body = { ...core.crucible.crucibleReceiptBody(diff, verify, decision), realTreeWritten: realWritten, reason: decision.reason };
        const data = await attest(cwd, `crucible:${decision.verdict}`, body as unknown as Record<string, unknown>);
        return { data, wisdom: `${decision.verdict === "MERGE" ? "🟢" : decision.verdict === "REVIEW" ? "🟡" : "🛑"} CRUCIBLE ${decision.verdict} — ${decision.reason}${realWritten ? " · merged to real tree" : " · real tree untouched"}.`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return low((e as Error).message); }
    },
  },
];
