/**
 * CHANGE GATE — the single call an AI agent makes before it commits.
 *
 * The productized surface of the AI-native trust SaaS: instead of remembering to run the scar vaccine,
 * the firewall, and the regression check separately, an agent (or CI) asks ONE question — "is this change
 * safe to commit?" — and gets ONE verdict (PASS / WARN / BLOCK) that fuses:
 *   • PREVENT — the SCAR VACCINE (does this repeat a past mistake without the fix?)
 *   • VERIFY  — the ARCHITECTURAL FIREWALL (does this break a load-bearing contract?)
 *
 * This module owns the pure COMPOSITION (given the two sub-verdicts → one verdict + the reasons). The
 * CLI/MCP gather the inputs (the staged diff for the vaccine, the baseline for the firewall) and run the
 * two engines; this fuses them so the agent has a single, honest gate.
 *
 * Composition: a firewall BLOCK blocks (a load-bearing contract is broken — the hard stop). A firewall
 * WARN, or any scar that fires, is a WARN (heed it, but it doesn't hard-block — a young contract or a
 * past-mistake-shape is advice, not a wall). Otherwise PASS.
 *
 * ★HONEST (DIAKRISIS): the gate is exactly as strong as its inputs — the firewall's verdict is
 * re-checkable (but a violation can be an intended evolution, hence waivers) and the scar match is a
 * lexical-shape heuristic (a candidate, not proof). BLOCK = a load-bearing contract is broken and not
 * waived; WARN = look before you commit; PASS = neither gate objected (not a proof the change is correct).
 */
import { type FirewallVerdict } from "../arch_firewall/index.js";
import { type ScarVerdict } from "../scar_vaccine/index.js";

export interface GateVerdict {
  verdict: "PASS" | "WARN" | "BLOCK";
  reasons: string[];
  firewall: { verdict: string; blocking: number; findings: number } | null;
  scar: { fires: boolean; firing: number } | null;
}

export function composeGate(fw: FirewallVerdict | null, scar: ScarVerdict | null): GateVerdict {
  const reasons: string[] = [];
  const fwBlock = fw?.verdict === "BLOCK";
  const fwWarn = fw?.verdict === "WARN";
  const scarFires = !!scar?.fires;

  if (fwBlock) for (const f of (fw?.blockedBy ?? [])) reasons.push(`🛑 BLOCK · contract "${f.rule}" (${f.finalSeverity})${f.counterexample ? ` — ${f.counterexample}` : ""}`);
  if (fwWarn) for (const f of (fw?.findings ?? []).filter((x) => !x.waived).slice(0, 3)) reasons.push(`🟠 WARN · contract "${f.rule}" (${f.finalSeverity})`);
  if (scarFires) for (const h of (scar?.firing ?? [])) reasons.push(`🧬 SCAR · ${h.scar.id} (${h.scar.severity}) — ${h.scar.lesson}`);

  const verdict: GateVerdict["verdict"] = fwBlock ? "BLOCK" : (fwWarn || scarFires) ? "WARN" : "PASS";
  if (verdict === "PASS") reasons.push("✅ no scar repeated, no load-bearing contract broken");
  return {
    verdict, reasons,
    firewall: fw ? { verdict: fw.verdict, blocking: fw.blockedBy?.length ?? 0, findings: fw.findings?.length ?? 0 } : null,
    scar: scar ? { fires: scar.fires, firing: scar.firing?.length ?? 0 } : null,
  };
}

export function gateReport(g: GateVerdict): string {
  const head = g.verdict === "BLOCK" ? "🛑 CHANGE GATE — BLOCK (do not commit)" : g.verdict === "WARN" ? "🟠 CHANGE GATE — WARN (look before you commit)" : "✅ CHANGE GATE — PASS";
  return [head, ...g.reasons.map((r) => "  " + r)].join("\n");
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ChangeGateGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function changeGateGauntlet(): ChangeGateGauntlet {
  const fwBlock = { verdict: "BLOCK", blockedBy: [{ rule: "table wallet single-writer", finalSeverity: "critical", counterexample: "2 writers: a, b" }], findings: [{ rule: "table wallet single-writer", finalSeverity: "critical", waived: false }] } as unknown as FirewallVerdict;
  const fwWarn = { verdict: "WARN", blockedBy: [], findings: [{ rule: "table x single-writer", finalSeverity: "high", waived: false }] } as unknown as FirewallVerdict;
  const fwPass = { verdict: "PASS", blockedBy: [], findings: [] } as unknown as FirewallVerdict;
  const scarFire = { fires: true, firing: [{ scar: { id: "SCAR-double-charge", severity: "critical", lesson: "use idempotency key" } }], immune: [], report: "" } as unknown as ScarVerdict;
  const scarQuiet = { fires: false, firing: [], immune: [], report: "" } as unknown as ScarVerdict;

  const block = composeGate(fwBlock, scarQuiet).verdict === "BLOCK";
  const warnFromFw = composeGate(fwWarn, scarQuiet).verdict === "WARN";
  const warnFromScar = composeGate(fwPass, scarFire).verdict === "WARN" && composeGate(fwPass, scarFire).reasons.some((r) => /SCAR-double-charge/.test(r));
  const pass = composeGate(fwPass, scarQuiet).verdict === "PASS";
  const blockWins = composeGate(fwBlock, scarFire).verdict === "BLOCK";   // a hard block dominates
  const total = (() => { try { composeGate(null, null); gateReport(composeGate(null, null)); return true; } catch { return false; } })();
  const checks = [
    { name: "FIREWALL-BLOCK⇒BLOCK", pass: block, detail: "a broken load-bearing contract hard-blocks the commit" },
    { name: "FIREWALL-WARN⇒WARN", pass: warnFromFw, detail: "a non-blocking firewall finding is a WARN" },
    { name: "SCAR-FIRE⇒WARN", pass: warnFromScar, detail: "a fired scar (past mistake) is a WARN with the lesson surfaced" },
    { name: "CLEAN⇒PASS", pass: pass, detail: "no scar + no contract break → PASS" },
    { name: "BLOCK-DOMINATES", pass: blockWins, detail: "BLOCK wins over a co-occurring scar/warn" },
    { name: "TOTAL", pass: total, detail: "null inputs never throw" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
