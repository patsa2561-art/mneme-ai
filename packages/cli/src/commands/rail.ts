/**
 * `mneme rail` + `mneme policy` (v2.131.0) — THE CONTEXT RAIL.
 * The single governed pipe every payload crosses between a local workspace and a
 * hosted model — the "Visa rail" of AI context. Composes policy · firewall ·
 * blind (ingress) and egress · settlement (egress) into one signed receipt.
 *
 *   cat src/billing.ts | mneme rail ingress --path src/billing.ts   # safe-to-send form + local map
 *   echo "$MODEL_OUTPUT"  | mneme rail egress                        # leak-screened + metered to the ledger
 *   mneme policy check --path config/.env                           # ALLOW | DENY (deterministic gate)
 *   mneme policy init                                                # write a default mneme.policy.json
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, rmdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { rail, policy, settlement, notary } from "@mneme-ai/core";

const SETTLEMENT_LEDGER = ".mneme/settlement/ledger.jsonl";
const GENESIS = "0".repeat(64);
function readSettlementLedger(cwd: string): settlement.LedgerRecord[] {
  try {
    const p = join(cwd, SETTLEMENT_LEDGER);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as settlement.LedgerRecord);
  } catch { return []; }
}
function appendSettlementLedger(cwd: string, rec: settlement.LedgerRecord): void {
  const p = join(cwd, SETTLEMENT_LEDGER);
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(rec) + "\n");
}
/**
 * Run a critical section under a best-effort atomic mutex (mkdir is atomic on
 * every OS). Closes the read-then-append race between two concurrent
 * `rail egress` processes that would otherwise fork the chain. Total: a stale
 * lock (>10s) is reclaimed, and any failure falls back to running unlocked
 * rather than hanging (metering is never allowed to block the verdict).
 */
function withLedgerLock<T>(cwd: string, fn: () => T): T {
  const lockDir = join(cwd, ".mneme/settlement/.ledger.lock");
  try { if (!existsSync(dirname(lockDir))) mkdirSync(dirname(lockDir), { recursive: true }); } catch { /* */ }
  let held = false;
  for (let i = 0; i < 100; i++) {
    try { mkdirSync(lockDir); held = true; break; }
    catch {
      try { const age = Date.now() - statSync(lockDir).mtimeMs; if (age > 10_000) { rmdirSync(lockDir); continue; } } catch { /* */ }
      // brief synchronous spin (≤~50ms total); never blocks indefinitely.
      const until = Date.now() + 5; while (Date.now() < until) { /* spin */ }
    }
  }
  try { return fn(); }
  finally { if (held) { try { rmdirSync(lockDir); } catch { /* */ } } }
}

function out(s: string): void { process.stdout.write(s + "\n"); }
function err(s: string): void { process.stderr.write(s + "\n"); }

const STDIN_CAP = 64_000_000; // 64MB — a security scan must not silently drop the tail.
function readStdin(): Promise<string> {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res("");
    let d = ""; let done = false; let truncated = false;
    const fin = () => {
      if (done) return; done = true;
      if (truncated) err(`⚠️  rail: stdin exceeded ${STDIN_CAP / 1_000_000}MB and was truncated — the scan is PARTIAL; pass --file for a complete scan of large inputs.`);
      res(d);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { d += c; if (d.length > STDIN_CAP) { truncated = true; fin(); } });
    process.stdin.on("end", fin); process.stdin.on("error", fin); setTimeout(fin, 4000);
  });
}
async function getPayload(opts: { text?: string; file?: string }): Promise<string> {
  if (typeof opts.text === "string") return opts.text;
  if (opts.file && existsSync(opts.file)) { try { return readFileSync(opts.file, "utf8"); } catch { /* */ } }
  return readStdin();
}
function loadPolicy(cwd: string): policy.PolicyRule {
  try {
    const p = resolve(cwd, "mneme.policy.json");
    if (existsSync(p)) return policy.normalizePolicy(JSON.parse(readFileSync(p, "utf8")));
  } catch { /* fall through to default */ }
  return policy.defaultPolicy();
}

export function registerRailCommands(program: Command): void {
  // ───────────────────────────── mneme rail ─────────────────────────────
  const r = program.command("rail").description("🛤  THE CONTEXT RAIL — the single governed pipe between your workspace and a model (the 'Visa rail' of AI context). ingress = policy→firewall→blind before sending; egress = leak-guard→settlement before writing. Each crossing leaves a signed receipt.");

  r.command("ingress")
    .description("Local context → wire. Policy-gate, neutralize injection + wrap as untrusted data, blind names/secrets. Prints the safe-to-send payload; the reverse map stays local. Exit 2 if the policy gate BLOCKs.")
    .option("--text <t>", "inline content.")
    .option("--file <p>", "read from a file.")
    .option("--path <p>", "logical path for the policy gate (e.g. src/billing.ts).")
    .option("--agent <id>", "agent id (for an allow-list policy).")
    .option("--aggressive", "mask ALL user identifiers (default: sensitive only).")
    .option("--map <p>", "write the local reverse map to this file (NEVER send it).")
    .option("--json", "JSON output (full receipt).")
    .action(async (opts: { text?: string; file?: string; path?: string; agent?: string; aggressive?: boolean; map?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const payload = await getPayload(opts);
      const rec = rail.traverseIngress(payload, {
        ...(opts.path ? { path: opts.path } : {}),
        ...(opts.agent ? { agent: opts.agent } : {}),
        policy: loadPolicy(cwd),
        blindMode: opts.aggressive ? "aggressive" : "sensitive",
      });
      const receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "rail.ingress", payload: { contentHash: rec.contentHash, safeHash: rec.safeHash, verdict: rec.verdict }, includePayload: true });
      if (opts.map && rec.map) { try { writeFileSync(resolve(cwd, opts.map), JSON.stringify(rec.map, null, 2)); } catch { /* */ } }
      if (opts.json) { out(JSON.stringify({ ...rec, receipt }, null, 2)); }
      else {
        if (rec.allowed) out(rec.safePayload);
        const icon = rec.verdict === "BLOCK" ? "🛑" : rec.verdict === "REDACT" ? "🛡" : "✓";
        err(`${icon} rail ingress: ${rec.verdict} — ${rec.layers.map((l) => `${l.layer}${l.ok ? "✓" : "✗"}`).join(" · ")}`);
        err(`   ${rec.note}`);
        if (rec.map && Object.keys(rec.map).length) err(`   ${Object.keys(rec.map).length} name(s) masked${opts.map ? ` → map written to ${opts.map}` : " (use --map to save the reverse map)"}`);
        err(`   receipt ${receipt.receiptId ?? "(signed)"}`);
      }
      if (rec.verdict === "BLOCK") process.exitCode = 2;
    });

  r.command("egress")
    .description("Model output → local disk. Screen for secret leakage (canary/bloom/pattern/entropy), then meter the transaction into the signed settlement ledger. Exit 2 if a leak BLOCKs the write.")
    .option("--text <t>", "inline content.")
    .option("--file <p>", "read from a file.")
    .option("--agent <id>", "agent id.")
    .option("--canary <list>", "comma-separated honeytoken canaries to trip on.")
    .option("--verified", "mark that a LOCAL verify (compile/test) passed.")
    .option("--json", "JSON output (full receipt).")
    .action(async (opts: { text?: string; file?: string; agent?: string; canary?: string; verified?: boolean; json?: boolean }) => {
      const cwd = process.cwd();
      const payload = await getPayload(opts);
      const canaries = (opts.canary ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const rec = rail.traverseEgress(payload, {
        ...(canaries.length ? { canaries } : {}),
        ...(opts.agent ? { agent: opts.agent } : {}),
        localVerified: opts.verified === true,
      });
      // settle the transaction into the signed hash-chained ledger (side-effect).
      let settled: { seq: number; chainHash: string } | null = null;
      if (rec.allowed && rec.txDraft) {
        try {
          const draft = rec.txDraft;
          settled = withLedgerLock(cwd, () => {
            const records = readSettlementLedger(cwd);
            const prev = records.length ? records[records.length - 1]!.chainHash : GENESIS;
            // seq = records.length + 1 to match settlement's own convention
            // (settlement CLI + buildLedger start at 1) so the SHARED ledger chain
            // verifies. map localVerified: boolean → "pass"/"na" (never "fail" —
            // an unverified op is not a known failure).
            const r2 = settlement.recordTx(prev, {
              kind: draft.kind,
              sentHash: draft.sentHash,
              namesHidden: draft.namesHidden,
              secretsRemoved: draft.secretsRemoved,
              localVerified: draft.localVerified ? "pass" : "na",
              tokensSent: draft.tokensSent,
              tokensSaved: draft.tokensSaved,
            }, records.length + 1);
            appendSettlementLedger(cwd, r2);
            return { seq: records.length + 1, chainHash: r2.chainHash };
          });
        } catch { /* metering is best-effort; never block the verdict */ }
      }
      const receipt = notary.issueReceipt(cwd, { kind: "claim-verdict", subject: "rail.egress", payload: { contentHash: rec.contentHash, verdict: rec.verdict, settledSeq: settled?.seq ?? -1 }, includePayload: true });
      if (opts.json) { out(JSON.stringify({ ...rec, settled, receipt }, null, 2)); }
      else {
        if (rec.allowed) out(rec.safePayload);
        const icon = rec.verdict === "BLOCK" ? "🛑" : rec.verdict === "REDACT" ? "🛡" : "✓";
        err(`${icon} rail egress: ${rec.verdict} — ${rec.layers.map((l) => `${l.layer}${l.ok ? "✓" : "✗"}`).join(" · ")}`);
        err(`   ${rec.note}`);
        if (settled) err(`   settled → ledger seq ${settled.seq} (${settled.chainHash.slice(0, 12)}…)`);
        err(`   receipt ${receipt.receiptId ?? "(signed)"}`);
      }
      if (rec.verdict === "BLOCK") process.exitCode = 2;
    });

  // ──────────────────────────── mneme policy ────────────────────────────
  const p = program.command("policy").description("📜 DYNAMIC POLICY ENFORCEMENT — the deterministic access gate the rail consults before any context crosses. Configured via mneme.policy.json (deny-path globs, deny-content patterns, agent allow-list, byte cap). Fail-closed.");

  p.command("check")
    .description("Check a path/content/agent against the active policy. Verdict ALLOW | DENY + violations. Exit 2 on DENY.")
    .option("--path <p>", "path to test.")
    .option("--text <t>", "inline content to test.")
    .option("--file <p>", "file whose path AND content to test.")
    .option("--agent <id>", "agent id to test against the allow-list.")
    .option("--json", "JSON output.")
    .action(async (opts: { path?: string; text?: string; file?: string; agent?: string; json?: boolean }) => {
      const cwd = process.cwd();
      let content = typeof opts.text === "string" ? opts.text : "";
      let path = opts.path;
      if (opts.file) { path = path ?? opts.file; if (existsSync(opts.file)) { try { content = readFileSync(opts.file, "utf8"); } catch { /* */ } } }
      const d = policy.checkPolicy({ ...(path ? { path } : {}), ...(content ? { content } : {}), ...(opts.agent ? { agent: opts.agent } : {}) }, loadPolicy(cwd));
      if (opts.json) { out(JSON.stringify(d, null, 2)); }
      else {
        out(`${d.verdict === "ALLOW" ? "✓ ALLOW" : "🛑 DENY"} — ${d.reason}`);
        for (const v of d.violations) out(`   • [${v.kind}] ${v.detail} (rule: ${v.rule})`);
      }
      if (!d.allowed) process.exitCode = 2;
    });

  p.command("init")
    .description("Write a default mneme.policy.json to the repo root (denies .env / secrets / keys / PII content). Edit to taste.")
    .option("--force", "overwrite an existing policy file.")
    .action((opts: { force?: boolean }) => {
      const cwd = process.cwd();
      const dest = resolve(cwd, "mneme.policy.json");
      if (existsSync(dest) && !opts.force) { err(`mneme.policy.json already exists — pass --force to overwrite.`); process.exitCode = 1; return; }
      try {
        writeFileSync(dest, JSON.stringify(policy.defaultPolicy(), null, 2) + "\n");
        out(`✓ wrote ${dest}`);
        err(`   the rail will consult this on every ingress crossing. Add agent allow-lists / size caps as needed.`);
      } catch (e) { err(`failed to write policy: ${(e as Error).message}`); process.exitCode = 1; }
    });

  p.command("show")
    .description("Print the active policy (the loaded mneme.policy.json, or the built-in default).")
    .action(() => { out(JSON.stringify(loadPolicy(process.cwd()), null, 2)); });
}
