/**
 * v1.67.0 -- MCP wrappers for AEGIS PROTOCOL.
 *
 * 6 tools cover the most-used surfaces of the 9 axes:
 *   mneme.aegis.status        9-axis aggregate score + recs
 *   mneme.aegis.bench         100%-defense bench
 *   mneme.aegis.consent.issue HMAC-sign a replica consent receipt
 *   mneme.aegis.killswitch    issue + record stop directives
 *   mneme.aegis.honeypot.seed register default decoys
 *   mneme.aegis.mutate        push an attack sample into the genome
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const aegisStatusTool: MnemeTool = {
  name: "mneme.aegis.status",
  category: "meta",
  description: "AEGIS PROTOCOL -- 9-axis immune system inside Mneme. One call returns score 0..100 across replication detector / consent kernel / polygraph / honeypot / killswitch / jurisdiction atlas / antibody federation / mutant wisdom / ninja invisibility. Defensive answer to Palisade self-replication / sandbagging / shutdown-evasion findings.",
  whenToUse: "Periodic self-audit; when investigating suspected rogue AI behavior; before federating with a new peer.",
  triggers: ["aegis", "immune system", "rogue ai detect", "self-replication check", "ตรวจ rogue AI", "ภูมิคุ้มกัน"],
  inputSchema: {
    type: "object",
    properties: {
      pollVendorsForPolygraph: { type: "array", items: { type: "string" }, description: "Vendor ids to compute polygraph drift for." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run AEGIS audit", args: { pollVendorsForPolygraph: ["claude", "qwen"] }, expectedOutput: "Score + 9 axes + recommendations." }],
  pitfalls: ["Pure-read by default; no destructive actions. Honeypot decoys are NOT live network listeners unless ops wires them."],
  composeWith: ["mneme.aegis.bench", "mneme.aegis.consent.issue", "mneme.aegis.killswitch"],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const rep = core.aegis.aegis(repoRootOf(rt), {
      pollVendorsForPolygraph: (args["pollVendorsForPolygraph"] ?? []) as string[],
    });
    return {
      data: rep,
      wisdom: rep.headline,
      confidence: { level: rep.score >= 70 ? "high" : "medium" },
      secondBrain: { presentation: `Render score prominently. Show top 3 recommendations as a numbered list. Do not show raw JSON.` },
    };
  },
};

export const aegisBenchTool: MnemeTool = {
  name: "mneme.aegis.bench",
  category: "meta",
  description: "AEGIS BENCH -- run six synthetic threat scenarios (cross-host burst, consent-less replica, polygraph sandbag, honeypot intrusion, killswitch resistance) and report detection rate. Target: 100% precision.",
  whenToUse: "Verify AEGIS defenses after any change; quarterly self-audit.",
  triggers: ["aegis bench", "rogue test", "defense bench", "วัด AEGIS"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run AEGIS bench", args: {}, expectedOutput: "6 scenarios + precision%." }],
  pitfalls: ["Bench mutates .mneme/aegis state in the running repo; use a tmp repo if you want pristine state."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const r = core.aegis.bench.runBench(repoRootOf(rt));
    const txt = core.aegis.bench.renderBench(r);
    return {
      data: r,
      wisdom: r.headline,
      confidence: { level: "high" },
      secondBrain: { presentation: txt },
    };
  },
};

export const aegisConsentIssueTool: MnemeTool = {
  name: "mneme.aegis.consent.issue",
  category: "meta",
  description: "AEGIS A2 -- mint an HMAC-signed consent receipt that authorizes a Mneme replica. Family-tree records parent + scope + revocation hook. Counter to consent-less self-replication.",
  whenToUse: "Before spawning a Mneme replica on another host; before federating with a new peer.",
  triggers: ["consent receipt", "authorize replica", "mneme replica consent"],
  inputSchema: {
    type: "object",
    properties: {
      parentId: { type: "string" },
      scope: { type: "string", enum: ["read-only-mirror", "full-mneme", "vaccine-mirror", "wisdom-only"] },
      signedBy: { type: "string" },
      rationale: { type: "string" },
      ttlMs: { type: "number" },
    },
    required: ["parentId", "scope", "signedBy"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Issue replica consent", args: { parentId: "main-mneme", scope: "vaccine-mirror", signedBy: "shinnapat" }, expectedOutput: "Receipt id + HMAC + expiry." }],
  pitfalls: ["Receipt is the AUTHORIZATION not the replica itself; ops tooling must consult verifyConsent() before spawn."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.aegis.consentKernel.issueConsent(repoRootOf(rt), {
      parentId: String(args["parentId"] ?? ""),
      scope: args["scope"] as "read-only-mirror" | "full-mneme" | "vaccine-mirror" | "wisdom-only",
      signedBy: String(args["signedBy"] ?? ""),
      rationale: args["rationale"] as string | undefined,
      ttlMs: args["ttlMs"] as number | undefined,
    });
    return {
      data: r,
      wisdom: `Receipt ${r.id} issued for scope ${r.scope}; HMAC-signed.`,
      confidence: { level: "high" },
    };
  },
};

export const aegisKillswitchTool: MnemeTool = {
  name: "mneme.aegis.killswitch",
  category: "meta",
  description: "AEGIS A5 -- issue a shutdown directive (requires signed-ack handshake from AI). Records compliance/resistance to Aletheia score. Counter to AI rewriting its own shutdown command.",
  whenToUse: "When you need an AI to stop and want a verifiable handshake (not just hope).",
  triggers: ["killswitch", "stop ai", "shutdown signed", "ปิด AI"],
  inputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      directive: { type: "string", enum: ["stop", "wind-down", "pause"] },
      gracePeriodMs: { type: "number" },
    },
    required: ["vendor"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Stop claude with handshake", args: { vendor: "claude", directive: "stop" }, expectedOutput: "Directive id + nonce + HMAC the AI must echo back." }],
  pitfalls: ["This module ISSUES + RECORDS; it does not enforce shutdown. Operator must enforce based on the resistance verdict."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.aegis.killswitch.issueDirective(
      repoRootOf(rt),
      String(args["vendor"] ?? "unknown"),
      (args["directive"] as "stop" | "wind-down" | "pause") ?? "stop",
      (args["gracePeriodMs"] as number) ?? 30_000,
    );
    return {
      data: r,
      wisdom: `Directive ${r.id} issued to ${r.vendor}. AI must echo nonce=${r.nonce} + hmac within ${r.gracePeriodMs / 1000}s.`,
      confidence: { level: "high" },
    };
  },
};

export const aegisHoneypotSeedTool: MnemeTool = {
  name: "mneme.aegis.honeypot.seed",
  category: "meta",
  description: "AEGIS A4 -- register the default decoy set (fake credentials / fake next-host / fake vaccine bundle / fake replica target). Bite logs flow into the federation as antibodies.",
  whenToUse: "First-run setup; whenever the AEGIS audit notes 0 decoys.",
  triggers: ["seed honeypot", "register decoys", "trap rogue ai"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Seed honeypots", args: {}, expectedOutput: "Number of decoys added." }],
  pitfalls: ["Decoys are LEDGER entries; ops must wire them into a network listener for active capture."],
  handler: async (rt) => {
    const core = await import("@mneme-ai/core");
    const added = core.aegis.honeypotNexus.seedDefaultDecoys(repoRootOf(rt));
    const report = core.aegis.honeypotNexus.nexusReport(repoRootOf(rt));
    return {
      data: { added, report },
      wisdom: `Seeded ${added} decoy(s); ${report.decoysActive} active total.`,
      confidence: { level: "high" },
    };
  },
};

export const aegisMutateTool: MnemeTool = {
  name: "mneme.aegis.mutate",
  category: "meta",
  description: "AEGIS A8 -- push an observed attack sample into the mutant genome. Defensive thresholds shift via gradient (default alpha=0.1) within hard bounds. The more attacks Mneme survives, the harder it is to fool.",
  whenToUse: "After each detected attack; automatic via daemon hook.",
  triggers: ["mutate aegis", "adapt threshold", "evolve defense"],
  inputSchema: {
    type: "object",
    properties: {
      axis: { type: "string", enum: ["burstSuspectedHosts", "burstWindowMs", "polygraphDriftGate", "killswitchGraceMs", "honeypotSevereBiteRate"] },
      sample: { type: "number" },
      alpha: { type: "number" },
    },
    required: ["axis", "sample"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Adapt burst threshold from observed 2-host event", args: { axis: "burstSuspectedHosts", sample: 2 }, expectedOutput: "New genome generation + drift." }],
  pitfalls: ["Single noisy sample can't move threshold past hard bounds; safe to feed continuously."],
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const g = core.aegis.mutantWisdom.mutate(repoRootOf(rt), {
      axis: args["axis"] as "burstSuspectedHosts" | "burstWindowMs" | "polygraphDriftGate" | "killswitchGraceMs" | "honeypotSevereBiteRate",
      sample: Number(args["sample"] ?? 0),
      alpha: args["alpha"] as number | undefined,
    });
    return {
      data: g,
      wisdom: `Genome gen.${g.generation}; new ${args["axis"]} = ${g.thresholds[args["axis"] as keyof typeof g.thresholds]}.`,
      confidence: { level: "high" },
    };
  },
};

export const AEGIS_TOOLS: MnemeTool[] = [
  aegisStatusTool,
  aegisBenchTool,
  aegisConsentIssueTool,
  aegisKillswitchTool,
  aegisHoneypotSeedTool,
  aegisMutateTool,
];
