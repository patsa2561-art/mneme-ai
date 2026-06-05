/**
 * mneme.attest.verify — verify the proof-carrying commit trail (v2.192.0).
 *
 * Read-only (`.verify` → probe-coverage exempt). Lets any MCP agent confirm OFFLINE
 * that a repo's git history carries a genuine, untampered, Ed25519-signed AI audit
 * trail — which agent made which commit, what was screened, chain intact — without
 * trusting anyone. The underlying crypto is measured by attestGauntlet (100).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { commitAttest } from "@mneme-ai/core";
import type { MnemeTool, ToolRuntime, ToolResponse } from "./_types.js";

export const ATTEST_TOOLS: MnemeTool[] = [
  {
    name: "mneme.attest.verify",
    category: "audit",
    description:
      "Verify the proof-carrying commit trail OFFLINE: every commit's Ed25519-signed CANON " +
      "attestation (which AI agent made it · what changed · the deterministic screen that ran) " +
      "+ tamper-evident binding + chain lineage. Turns `git log` into a verifiable AI audit trail " +
      "anyone re-checks with the public key alone — no trust required. Example user asks: 'is this " +
      "repo's AI-commit history genuine?', 'which agents committed here?', 'prove these commits weren't tampered'.",
    whenToUse:
      "The user (or you, before relying on the history) wants to confirm the AI-commit audit trail is genuine + untampered, or see which agents authored commits.",
    triggers: [
      "verify the commit trail", "is the git history genuine", "which agents committed", "prove the commits",
      "audit trail", "commit provenance", "ตรวจ commit", "ใครเป็นคน commit",
    ],
    inputSchema: { type: "object", properties: {} },
    handler: async (runtime: ToolRuntime): Promise<ToolResponse> => {
      const p = join(runtime.cwd, ".mneme", "attest", "chain.jsonl");
      if (!existsSync(p)) return { data: { attested: 0, note: "no attestations yet" }, wisdom: "This repo has no AI-commit attestation trail yet. Install it once: `mneme attest install-hook` — then every commit is auto-signed into a verifiable trail." };
      let chain: commitAttest.AttestEntry[] = [];
      try { chain = readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as commitAttest.AttestEntry); }
      catch { return { data: { error: "attestation chain unreadable" }, wisdom: "The attestation chain file is corrupt." }; }
      const v = commitAttest.verifyAttestChain(chain);
      const wisdom = v.ok
        ? `✓ ${v.valid}/${v.checked} commits carry a genuine, untampered, Ed25519-signed attestation; chain lineage intact. By agent: ${Object.entries(v.agents).map(([k, n]) => `${k} ${n}`).join(", ")}. Anyone can re-verify offline — relay this with confidence.`
        : `⚠ The trail has ${v.broken.length} issue(s) — ${v.chainIntact ? "" : "chain lineage BROKEN; "}${v.valid}/${v.checked} verified. Do NOT trust the unverified commits: ${v.broken.slice(0, 3).map((b) => `${b.sha.slice(0, 8)} (${b.reason})`).join("; ")}.`;
      return { data: { ok: v.ok, checked: v.checked, valid: v.valid, chainIntact: v.chainIntact, agents: v.agents, broken: v.broken.slice(0, 10) }, wisdom };
    },
  },
];
