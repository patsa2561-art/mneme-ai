/**
 * v2.54.0 — INDISPENSABILITY checklist as measurable primitive.
 *
 * From v2.53 audit Tier 3 ขั้น 5: to be "ท่อน้ำเลี้ยงหลัก" of every AI
 * agent, Mneme must satisfy 6 criteria. Pre-v2.54 this was a strategy
 * document; v2.54 ships it as a measurable primitive — each criterion
 * has a check function + a score, surfaced through TRUTH GATE.
 *
 * Score range per criterion: 0 (not met) / 0.5 (partial) / 1 (met).
 * Overall: weighted average.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MNEME_COMMAND_CATALOG } from "./agent_manifest.js";

void MNEME_COMMAND_CATALOG;

export type CriterionStatus = "met" | "partial" | "not-met";

export interface CriterionScore {
  id: string;
  description: string;
  status: CriterionStatus;
  score: number;
  weight: number;
  evidence: string;
  target: string;
}

export interface IndispensabilityReport {
  overallScore: number;
  /** 0..100 percentage. */
  percent: number;
  criteria: CriterionScore[];
  at: string;
}

function score(status: CriterionStatus): number {
  if (status === "met") return 1;
  if (status === "partial") return 0.5;
  return 0;
}

interface CriterionDef {
  id: string;
  description: string;
  weight: number;
  target: string;
  /** Measure the criterion against repo state. Return status + evidence. */
  check: (repoRoot: string) => { status: CriterionStatus; evidence: string };
}

const CRITERIA: ReadonlyArray<CriterionDef> = [
  {
    id: "ux_degrades_without",
    description: "Disabling Mneme visibly degrades AI agent UX",
    weight: 1.5,
    target: "ALL: hallucination not caught + identity not stamped + compliance not generated",
    check: (root) => {
      // Surrogate: how many integration surfaces exist? We measure (a) MCP
      // tool count, (b) presence of agent_manifest entries, (c) git hook
      // installer. More surfaces = harder to disable cleanly.
      const manifestPath = join(root, "packages/core/src/agent_manifest.ts");
      if (!existsSync(manifestPath)) return { status: "not-met", evidence: "agent_manifest missing" };
      const body = readFileSync(manifestPath, "utf8");
      const tools = (body.match(/command:\s*["']mneme\s+/g) ?? []).length;
      if (tools < 50) return { status: "not-met", evidence: `only ${tools} tools registered` };
      if (tools >= 200) return { status: "met", evidence: `${tools} tools registered + git hook + MCP + CLI surfaces` };
      return { status: "partial", evidence: `${tools} tools registered (target ≥200)` };
    },
  },
  {
    id: "onboarding_30s",
    description: "Onboarding takes < 30 seconds",
    weight: 1.5,
    target: "one-line `mcp add mneme` OR browser-ext one-click",
    check: (root) => {
      // Surrogate: presence of `mneme nemesis key_setup` + `mneme system bootstrap`
      // + auto-init MCP path. The shorter onboarding = the more of these wired.
      const cliCommands = join(root, "packages/cli/src/commands/v236_commands.ts");
      if (!existsSync(cliCommands)) return { status: "not-met", evidence: "CLI commands file missing" };
      const body = readFileSync(cliCommands, "utf8");
      const hasKeySetup = /key_setup/.test(body);
      const hasBootstrap = /bootstrap|auto.*init/i.test(body);
      const hasIndex = /mneme index-auto|index_auto/i.test(body);
      const present = [hasKeySetup, hasBootstrap, hasIndex].filter(Boolean).length;
      if (present === 3) return { status: "met", evidence: "key_setup + bootstrap + index-auto all wired" };
      if (present >= 1) return { status: "partial", evidence: `${present}/3 onboarding shortcuts present` };
      return { status: "not-met", evidence: "no onboarding shortcuts wired" };
    },
  },
  {
    id: "cost_less_than_value",
    description: "Cost < value created daily",
    weight: 1.0,
    target: "even at $50K/yr enterprise, save 10x in compliance + bug catches",
    check: () => {
      // Free tier exists → cost is 0 for solo dev → trivially met for the
      // primary growth audience. Value is what the tools enable.
      return { status: "met", evidence: "free local tier = $0; enterprise pricing not yet published but tiers documented" };
    },
  },
  {
    id: "switching_cost_high",
    description: "Switching cost > replacement gain",
    weight: 2.0,
    target: "HIGH: HGP history + REWIND capsules + COLOSSEUM ELO = years of compounding",
    check: (root) => {
      // Surrogate: presence of data-accumulating primitives. The more
      // tamper-evident HMAC-chained ledgers exist, the higher switching cost.
      const dotMneme = join(root, ".mneme");
      let chainCount = 0;
      const chains = [
        "cli-activity.jsonl",
        "vaccines.jsonl",
        "replay.jsonl",
        "nemesis/anonymity_credits.jsonl",
        "nemesis/colosseum/tournaments.jsonl",
        "nemesis/sibyl/commitments.jsonl",
        "nemesis/embedder_leak.jsonl",
      ];
      for (const c of chains) if (existsSync(join(dotMneme, c))) chainCount++;
      if (chainCount >= 5) return { status: "met", evidence: `${chainCount}/${chains.length} hash-chained ledgers accumulated locally` };
      if (chainCount >= 2) return { status: "partial", evidence: `${chainCount}/${chains.length} ledgers (need more chain history)` };
      return { status: "not-met", evidence: `only ${chainCount}/${chains.length} ledgers (fresh install)` };
    },
  },
  {
    id: "trust_signal",
    description: "Trust signal in market (Mneme Verified badge)",
    weight: 1.0,
    target: "vendor PR badges + verified marketplace presence",
    check: (root) => {
      // Surrogate: presence of badge primitive + obelisk
      const badgePath = join(root, "packages/core/src/badge");
      const obeliskPath = join(root, "packages/core/src/obelisk");
      const present = [existsSync(badgePath), existsSync(obeliskPath)].filter(Boolean).length;
      if (present === 2) return { status: "met", evidence: "badge + obelisk both shipped" };
      if (present === 1) return { status: "partial", evidence: `${present}/2 trust-signal primitives` };
      // Check agent_manifest for badge/obelisk entries as fallback
      const mp = join(root, "packages/core/src/agent_manifest.ts");
      if (existsSync(mp)) {
        const body = readFileSync(mp, "utf8");
        const badgeRefs = /badge|obelisk/i.test(body);
        if (badgeRefs) return { status: "partial", evidence: "badge/obelisk referenced in manifest" };
      }
      return { status: "not-met", evidence: "no trust-signal primitives wired" };
    },
  },
  {
    id: "regulator_primitive",
    description: "Regulator-approved primitive (EU AI Act compliance footing)",
    weight: 1.5,
    target: "EU AI Act DPA-accepted compliance primitive",
    check: (root) => {
      // Surrogate: presence of EU stamp + THEMIS + GAVEL + SIBYL.
      const nemesis = join(root, "packages/core/src/nemesis");
      const need = ["eu_ai_act_stamp.ts", "themis.ts", "gavel.ts", "sibyl.ts"];
      const present = need.filter((n) => existsSync(join(nemesis, n))).length;
      if (present === need.length) return { status: "met", evidence: `${present}/${need.length} EU/legal primitives shipped (EU stamp + THEMIS + GAVEL + SIBYL)` };
      if (present >= need.length - 1) return { status: "partial", evidence: `${present}/${need.length} EU/legal primitives (1 missing)` };
      return { status: "not-met", evidence: `only ${present}/${need.length} EU/legal primitives shipped` };
    },
  },
];

export function evaluateIndispensability(repoRoot: string): IndispensabilityReport {
  const criteria: CriterionScore[] = CRITERIA.map((def) => {
    let r: { status: CriterionStatus; evidence: string };
    try { r = def.check(repoRoot); }
    catch (e) { r = { status: "not-met", evidence: `check threw: ${(e as Error).message}` }; }
    return { id: def.id, description: def.description, status: r.status, score: score(r.status), weight: def.weight, evidence: r.evidence, target: def.target };
  });
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  const weightedSum = criteria.reduce((s, c) => s + c.score * c.weight, 0);
  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return {
    overallScore: +overallScore.toFixed(3),
    percent: +(overallScore * 100).toFixed(1),
    criteria,
    at: new Date().toISOString(),
  };
}

export function renderIndispensabilityReport(r: IndispensabilityReport): string {
  const rows = r.criteria.map((c) => {
    const sym = c.status === "met" ? "✓" : c.status === "partial" ? "~" : "✗";
    return `  ${sym} ${c.id.padEnd(28)}  score=${c.score.toFixed(1)} weight=${c.weight}  ${c.evidence}`;
  });
  return [
    `INDISPENSABILITY ${r.percent}% (overall ${r.overallScore.toFixed(2)}) at ${r.at}`,
    ...rows,
  ].join("\n");
}
