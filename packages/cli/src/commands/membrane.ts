/**
 * `mneme membrane` (v2.164.0) — THE MEMBRANE: the capstone that fuses the three
 * pillars into ONE signed packet an agent crosses at session start.
 *
 *   CAPABILITY (STELE) + ACTIVATION (BOOT) + VALUE (AXIA), sealed with one
 *   Ed25519 receipt that verifies the whole thing offline.
 *
 *   mneme membrane                      # build + seal the fused packet (human)
 *   mneme membrane --held <root>        # capability delta vs what you hold
 *   mneme membrane --held-file held.json
 *   mneme membrane --price-per-1k 3     # report USD from tokens-saved
 *   mneme membrane --json               # the signed packet as JSON
 */
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { membrane, agentManifest, treasury, type axia } from "@mneme-ai/core";
import { getVersion } from "../version.js";

function out(s: string): void { process.stdout.write(s + "\n"); }

/** Gather AXIA value events: AXIA's own ledger + treasury tokens-saved (live). */
function gatherAxiaEvents(cwd: string): Array<Partial<axia.AxiaEvent>> {
  const events: Array<Partial<axia.AxiaEvent>> = [];
  try {
    const ap = join(cwd, ".mneme", "axia", "ledger.jsonl");
    if (existsSync(ap)) {
      for (const line of readFileSync(ap, "utf8").split("\n")) {
        const t = line.trim(); if (!t) continue;
        try { const e = JSON.parse(t) as { kind?: string; count?: number; source?: string; at?: number }; if (e && e.kind) events.push({ kind: e.kind as axia.AxiaKind, count: Number(e.count) || 0, source: String(e.source ?? "unknown"), ...(Number.isFinite(e.at) ? { at: e.at } : {}) }); } catch { /* skip */ }
      }
    }
  } catch { /* */ }
  try {
    const tp = join(cwd, ".mneme", "treasury", "ledger.jsonl");
    if (existsSync(tp)) {
      const tokensSaved = treasury.aggregate(treasury.parseLedger(readFileSync(tp, "utf8"))).tokensSaved;
      if (tokensSaved > 0) events.push({ kind: "tokens-saved", count: tokensSaved, source: "treasury" });
    }
  } catch { /* */ }
  return events;
}

export function registerMembraneCommands(program: Command): void {
  program
    .command("membrane")
    .description("🧬 THE MEMBRANE — the capstone that FUSES Mneme's three pillars into ONE signed packet an AI agent crosses at session start: CAPABILITY (STELE — merkle delta-sync), ACTIVATION (BOOT — when→tool table), VALUE (AXIA — hash-chained, offline-verifiable ledger). One Ed25519 receipt verifies the whole packet offline. The honest fix for the three reasons an installed tool stays idle: you don't KNOW what exists, don't know WHEN to use it, can't PROVE the value created.")
    .option("--held <root>", "the STELE merkle root your agent currently holds (for a capability delta).")
    .option("--held-file <p>", "JSON file: {\"root\":\"…\",\"leaves\":{\"name\":\"hash\"}}.")
    .option("--task <t>", "task hint to lightly rank the activation table (never drops rows).")
    .option("--price-per-1k <usd>", "your vendor's price per 1k tokens — only then is USD reported.")
    .option("--json", "the signed packet as JSON.")
    .action((opts: { held?: string; heldFile?: string; task?: string; pricePer1k?: string; json?: boolean }) => {
      const cwd = process.cwd();
      let heldRoot = opts.held ?? "";
      let heldLeaves: Record<string, string> | undefined;
      if (opts.heldFile && existsSync(opts.heldFile)) {
        try { const j = JSON.parse(readFileSync(opts.heldFile, "utf8")) as { root?: string; leaves?: Record<string, string> }; if (typeof j.root === "string") heldRoot = j.root; if (j.leaves && typeof j.leaves === "object") heldLeaves = j.leaves; } catch { /* */ }
      }
      const price = opts.pricePer1k !== undefined ? Number(opts.pricePer1k) : undefined;

      const packet = membrane.buildMembrane({
        version: getVersion(),
        heldRoot: heldRoot || undefined,
        heldLeaves,
        task: opts.task,
        axiaEvents: gatherAxiaEvents(cwd),
        pricePer1k: Number.isFinite(price) ? price : undefined,
        catalog: agentManifest.MNEME_COMMAND_CATALOG,
      });
      const signed = membrane.sealMembrane(cwd, packet);

      if (opts.json) { out(JSON.stringify(signed, null, 2)); return; }

      const c = packet.capability, v = packet.value;
      out(`🧬 THE MEMBRANE — Mneme v${packet.version} · one signed packet, three pillars`);
      out(`   receipt ${signed.receipt.receiptId ? signed.receipt.receiptId.slice(0, 16) + "…" : "(signed)"} · verify offline with the NOTARY public key`);
      out("");
      out(`  ① CAPABILITY (STELE)  — ${c.count} tools · root ${c.root.slice(0, 16)}…`);
      out(c.upToDate
        ? `       ✓ a held root matching this pulls 0 tokens (provably current + complete).`
        : `       a cold agent pulls the full surface (~${c.fullTokenEstimate} tok); pass --held <root> next time for the delta.`);
      out(`  ② ACTIVATION (BOOT)   — ${packet.activation.decisionTable.length} when→tool signals (≤2KB instructions ready for an MCP instructions field).`);
      out(`  ③ VALUE (AXIA)        — ${v.tokensSaved.toLocaleString()} tokens saved · ${v.totalEvents} gated/redacted/corrected events · chain ${v.chainValid ? "✓ valid" : "✗ broken"}${v.usdSaved !== null ? ` · $${v.usdSaved}` : ""}`);
      out("");
      out(`   Honest: counts are FACTS of events Mneme did — never 'attacks prevented', never an invented $ damage; USD only from tokens-saved × your price.`);
    });
}
