/**
 * Mneme Antivirus -- MCP tool surface.
 *
 *   mneme.antivirus.scan          -- scan a draft for hallucination strains
 *   mneme.antivirus.immunize      -- session middleware (returns auto-action)
 *   mneme.antivirus.lab.strains   -- list known strains (taxonomy)
 *   mneme.antivirus.lab.vaccines  -- list pharmacopoeia
 *   mneme.antivirus.cert.benchmark-- run benchmark on one or all vaccines
 *   mneme.antivirus.stats         -- realtime stats snapshot
 *   mneme.antivirus.cure          -- apply suggested cures to a draft
 */

import { antivirus } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

const ROOT = (rt: { meta: { rootPath: string } }) => rt.meta.rootPath;

export const antivirusScanTool: MnemeTool = {
  name: "mneme.antivirus.scan",
  category: "meta",
  description:
    "Scan a draft for HALLUCINATION STRAINS. Runs the full pharmacopoeia of " +
    "vaccines (8 by default) against every suspect claim found in the text. " +
    "Returns confirmed infections with evidence + suggested cures + a 0..1 " +
    "risk score. Use BEFORE delivering any user-facing answer that contains " +
    "commit hashes, author names, function calls, package names, dates, " +
    "counts, or file paths -- those are the surfaces hallucinations attack.",
  whenToUse:
    "You have a draft answer ready and want to catch hallucinations BEFORE the user sees them.",
  triggers: ["scan for hallucinations", "antivirus scan", "check my draft", "verify claims"],
  inputSchema: {
    type: "object",
    required: ["draft"],
    properties: {
      draft: { type: "string", description: "The text to scan (your draft answer)." },
      strains: {
        type: "array", items: { type: "string" },
        description: "Optional: limit to specific strain ids. Default: all.",
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      scanId: { type: "string" }, ranAt: { type: "string" },
      claimsExamined: { type: "number" }, infections: { type: "number" },
      riskScore: { type: "number" }, byStrain: { type: "object" },
      totalMs: { type: "number" }, vaccinesUsed: { type: "array" },
      details: { type: "array" },
    },
  },
  examples: [
    {
      userQuery: "Scan my draft answer for hallucinations.",
      expectedOutput: "Returns the count of confirmed infections + per-strain breakdown + risk score 0..1.",
    },
  ],
  pitfalls: [
    "Surface patterns are intentionally noisy (high recall); the assay confirms infection. False positives are still possible -- review evidence.",
    "Some assays shell out to git/npm; first scan takes longer (~1-3s) while the cache builds.",
  ],
  composeWith: ["mneme.antivirus.cure", "mneme.confess", "mneme.adversary.cross_examine"],
  handler: async (rt, args) => {
    const draft = String(args["draft"] ?? "");
    const wantStrains = Array.isArray(args["strains"]) ? args["strains"] as string[] : null;
    const vaccines = wantStrains
      ? antivirus.SEED_VACCINES.filter((v) => wantStrains.includes(v.strain))
      : undefined;
    const result = await antivirus.scan(ROOT(rt), draft, { vaccines });
    return {
      data: {
        scanId: result.scanId, ranAt: result.ranAt,
        claimsExamined: result.assays.length, infections: result.infections.length,
        riskScore: Number(result.riskScore.toFixed(3)),
        byStrain: result.byStrain, totalMs: result.totalMs,
        vaccinesUsed: result.vaccinesUsed,
        details: result.assays.map((a) => ({
          strain: a.claim.strain, match: a.claim.match, offset: a.claim.offset,
          infected: a.infected, evidence: a.evidence, cure: a.cure ?? null,
          assayMs: a.assayMs,
        })),
      },
      wisdom: result.infections.length === 0
        ? `No hallucinations detected (${result.assays.length} claim${result.assays.length === 1 ? "" : "s"} examined, riskScore ${result.riskScore.toFixed(2)}).`
        : `Caught ${result.infections.length} hallucination${result.infections.length === 1 ? "" : "s"} of ${result.assays.length} claims (riskScore ${result.riskScore.toFixed(2)}). Top strain: ${Object.entries(result.byStrain).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "n/a"}.`,
      confidence: { level: "high" },
      followUp: result.infections.length > 0 ? ["mneme.antivirus.cure"] : [],
    };
  },
};

export const antivirusImmunizeTool: MnemeTool = {
  name: "mneme.antivirus.immunize",
  category: "meta",
  description:
    "Activate antivirus protection for the current session. Returns the " +
    "current pharmacopoeia + an [AUTO-ACTION] instructing the AI agent to " +
    "call mneme.antivirus.scan on every draft answer before delivery.",
  whenToUse: "Session start, OR after `mneme.welcome` (auto-action protocol).",
  triggers: ["immunize", "enable antivirus", "antivirus on"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      activeVaccines: { type: "number" }, strainCoverage: { type: "number" },
      avgF1: { type: ["number", "null"] },
    },
  },
  examples: [{ userQuery: "Turn on antivirus for this session." }],
  pitfalls: ["Immunization is per-session; the AI must remember to invoke scan() on each draft (the auto-action enforces it)."],
  composeWith: ["mneme.antivirus.scan", "mneme.welcome"],
  handler: async (rt) => {
    const p = antivirus.readPharmacopoeia(ROOT(rt));
    const efficacies = p.vaccines.map((v) => v.efficacy?.f1).filter((f): f is number => typeof f === "number");
    const avgF1 = efficacies.length === 0 ? null : efficacies.reduce((s, x) => s + x, 0) / efficacies.length;
    const distinctStrains = new Set(p.vaccines.map((v) => v.strain));
    return {
      data: {
        activeVaccines: p.vaccines.length,
        strainCoverage: distinctStrains.size,
        avgF1: avgF1 == null ? null : Number(avgF1.toFixed(3)),
      },
      wisdom: `Antivirus activated: ${p.vaccines.length} vaccines covering ${distinctStrains.size} strains${avgF1 != null ? ` (avg F1: ${avgF1.toFixed(2)})` : ""}.`,
      confidence: { level: "high" },
      secondBrain: {
        autoActions: [{
          id: "antivirus-scan-on-draft",
          tool: "mneme.antivirus.scan",
          args: { draft: "<DRAFT_TEXT_GOES_HERE>" },
          announceBefore: "Scanning draft for hallucinations...",
          announceAfter: "Antivirus scan complete.",
        }],
      },
    };
  },
};

export const antivirusLabStrainsTool: MnemeTool = {
  name: "mneme.antivirus.lab.strains",
  category: "meta",
  description:
    "List the known taxonomy of hallucination strains. Each strain has a " +
    "scientific name, common name, severity 1..5, and surface signature.",
  whenToUse: "User asks 'what kinds of hallucinations does Mneme catch?' or you want pedagogy.",
  triggers: ["list strains", "antivirus taxonomy", "what hallucinations"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { strains: { type: "array" } } },
  examples: [{ userQuery: "What hallucination types does Mneme detect?" }],
  pitfalls: [],
  composeWith: ["mneme.antivirus.lab.vaccines", "mneme.antivirus.scan"],
  handler: async () => {
    const strains = antivirus.listStrains();
    return {
      data: { strains: strains.map((s) => ({
        id: s.id, scientificName: s.scientificName, commonName: s.commonName,
        pathogenesis: s.pathogenesis, severity: s.severity,
      })) },
      wisdom: `${strains.length} strains catalogued. Top severity: ${strains.filter((s) => s.severity >= 4).map((s) => s.commonName).join(", ")}.`,
      confidence: { level: "high" },
    };
  },
};

export const antivirusLabVaccinesTool: MnemeTool = {
  name: "mneme.antivirus.lab.vaccines",
  category: "meta",
  description:
    "List the vaccines in the active pharmacopoeia (seed + locally-developed " +
    "+ inherited via MneMeiosis). Each entry includes its current efficacy " +
    "(precision/recall/F1) -- HMAC-signed, verifiable.",
  whenToUse: "User asks 'what vaccines do I have?' or you need to inspect the inventory.",
  triggers: ["list vaccines", "pharmacopoeia", "antivirus inventory"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { vaccines: { type: "array" } } },
  examples: [{ userQuery: "Show me the pharmacopoeia." }],
  pitfalls: ["efficacy is null for vaccines that haven't been benchmarked yet -- run mneme.antivirus.cert.benchmark first."],
  composeWith: ["mneme.antivirus.cert.benchmark"],
  handler: async (rt) => {
    const p = antivirus.readPharmacopoeia(ROOT(rt));
    return {
      data: { vaccines: p.vaccines },
      wisdom: `${p.vaccines.length} vaccines registered (${p.vaccines.filter((v) => v.efficacy).length} benchmarked).`,
      confidence: { level: "high" },
    };
  },
};

export const antivirusCertBenchmarkTool: MnemeTool = {
  name: "mneme.antivirus.cert.benchmark",
  category: "meta",
  description:
    "Run the labeled benchmark suite for one vaccine (or all). Returns " +
    "precision/recall/F1 with an HMAC-SHA256 signature anyone can " +
    "re-verify. Updates the pharmacopoeia with the latest efficacy " +
    "snapshot. This is the CERTIFICATION endpoint -- numbers reported " +
    "here are honest, no rounding up.",
  whenToUse: "You want to certify the current vaccines before relying on them, OR a CI gate before publish.",
  triggers: ["benchmark vaccines", "certify antivirus", "vaccine efficacy"],
  inputSchema: {
    type: "object",
    properties: {
      vaccineId: { type: "string", description: "Optional: benchmark just this one vaccine. Default: all." },
    },
  },
  outputSchema: { type: "object", properties: { results: { type: "object" } } },
  examples: [{ userQuery: "Benchmark all vaccines and tell me their F1 scores." }],
  pitfalls: [
    "Benchmarks shell out to git/npm and may take 5-30 seconds.",
    "Some negative cases require a real repo with git history -- the harness is honest about that.",
  ],
  composeWith: ["mneme.antivirus.lab.vaccines"],
  handler: async (rt, args) => {
    const wantId = typeof args["vaccineId"] === "string" ? args["vaccineId"] as string : null;
    const vaccines = wantId
      ? antivirus.SEED_VACCINES.filter((v) => v.id === wantId)
      : antivirus.SEED_VACCINES;
    if (vaccines.length === 0) {
      return { data: { results: {} }, wisdom: `No vaccine matched id "${wantId}".`, confidence: { level: "high" } };
    }
    const results = await antivirus.runAllBenchmarks(ROOT(rt), vaccines);
    antivirus.refreshEfficacies(ROOT(rt));
    const lines: string[] = [];
    for (const [id, eff] of Object.entries(results)) {
      const f1 = eff.f1 == null ? "n/a" : eff.f1.toFixed(2);
      lines.push(`${id}: F1 ${f1} (TP ${eff.tp}/${eff.tp + eff.fn}, FP ${eff.fp})`);
    }
    return {
      data: { results },
      wisdom: `Certified ${vaccines.length} vaccine${vaccines.length === 1 ? "" : "s"}. ${lines.join(" | ")}`,
      confidence: { level: "high" },
    };
  },
};

export const antivirusStatsTool: MnemeTool = {
  name: "mneme.antivirus.stats",
  category: "meta",
  description:
    "Realtime stats snapshot: total scans, total infections caught, per-strain " +
    "counts, recent scan summaries. Powers the web Lab dashboard.",
  whenToUse: "User asks 'how many hallucinations has Mneme blocked?' or for the Lab dashboard.",
  triggers: ["antivirus stats", "how many hallucinations", "lab metrics"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      totalScans: { type: "number" },
      totalInfectionsCaught: { type: "number" },
      byStrain: { type: "object" },
    },
  },
  examples: [{ userQuery: "How many hallucinations has Mneme caught?" }],
  pitfalls: [],
  composeWith: ["mneme.antivirus.lab.vaccines"],
  handler: async (rt) => {
    const stats = antivirus.readStats(ROOT(rt));
    const m = antivirus.deriveMetrics(stats);
    return {
      data: { ...stats, derived: { ...m, catchRate: Number(m.catchRate.toFixed(3)), avgScanMs: Math.round(m.avgScanMs) } },
      wisdom: `Lifetime: ${stats.totalScans} scans, ${stats.totalInfectionsCaught} infections caught (${(m.catchRate * 100).toFixed(1)}% catch rate). Top strain: ${m.topStrain ?? "none"}.`,
      confidence: { level: "high" },
    };
  },
};

export const antivirusCureTool: MnemeTool = {
  name: "mneme.antivirus.cure",
  category: "meta",
  description:
    "Apply suggested cures from a previous scan to produce a cleaned draft. " +
    "Replaces / removes infected substrings according to each assay's cure field.",
  whenToUse: "After mneme.antivirus.scan returned infections; you want a clean version.",
  triggers: ["cure draft", "remove hallucinations", "fix flagged claims"],
  inputSchema: {
    type: "object",
    required: ["draft"],
    properties: {
      draft: { type: "string" },
      strategy: { type: "string", enum: ["redact", "annotate"], description: "redact: remove infected text. annotate: keep + add [SUSPECT] tag." },
    },
  },
  outputSchema: {
    type: "object",
    properties: { cleaned: { type: "string" }, replaced: { type: "number" } },
  },
  examples: [{ userQuery: "Clean my draft of all flagged hallucinations." }],
  pitfalls: ["Cures are heuristic; review the cleaned output before delivery."],
  composeWith: ["mneme.antivirus.scan"],
  handler: async (rt, args) => {
    const draft = String(args["draft"] ?? "");
    const strategy = (args["strategy"] === "annotate" ? "annotate" : "redact") as "redact" | "annotate";
    const result = await antivirus.scan(ROOT(rt), draft, { recordStats: false });
    let cleaned = draft;
    let replaced = 0;
    // Replace from longest match first to avoid offset shifts.
    const sorted = [...result.infections].sort((a, b) => b.claim.match.length - a.claim.match.length);
    for (const inf of sorted) {
      const replacement = strategy === "annotate"
        ? `[SUSPECT: ${inf.claim.strain}] ${inf.claim.match} [/SUSPECT]`
        : "[redacted]";
      const before = cleaned;
      cleaned = cleaned.split(inf.claim.match).join(replacement);
      if (cleaned !== before) replaced++;
    }
    return {
      data: { cleaned, replaced, strategy },
      wisdom: replaced === 0
        ? `No infections to cure (draft already clean).`
        : `Cured ${replaced} infection${replaced === 1 ? "" : "s"} via ${strategy}.`,
      confidence: { level: "medium", notes: "Cures are heuristic; final review by you." },
    };
  },
};

export const antivirusTools: MnemeTool[] = [
  antivirusScanTool,
  antivirusImmunizeTool,
  antivirusLabStrainsTool,
  antivirusLabVaccinesTool,
  antivirusCertBenchmarkTool,
  antivirusStatsTool,
  antivirusCureTool,
];
