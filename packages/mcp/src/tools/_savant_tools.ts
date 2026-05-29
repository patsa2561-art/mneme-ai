/**
 * v2.88.0 — ALETHEIA / SAVANT MCP tools · the Prove-or-Unknown surface.
 *
 * The Symbiosis before-assert hook: BEFORE an LLM asserts a fact, it asks
 * ALETHEIA. The savant returns exactly TRUE / FALSE / UNKNOWN + a signed lineage
 * proof tree — and on UNKNOWN it NEVER fills the gap. The LLM repairs its answer
 * before it reaches the user. (The code spine lives in core's truth_kernel/;
 * `aletheia/` the module is taken by vendor reputation, so the MCP family is
 * `mneme.savant.*` — the savant identity, free namespace.)
 */

import type { MnemeTool } from "./_types.js";

export const savantVerifyTool: MnemeTool = {
  name: "mneme.savant.verify",
  category: "meta",
  description:
    "🧠 ALETHEIA (savant) — verify a factual claim through the Prove-or-Unknown spine. Returns exactly TRUE / FALSE / UNKNOWN: TRUE/FALSE only when the evidence clears a HIGH bar with low sensor conflict (each carries a signed lineage proof tree); otherwise UNKNOWN — and UNKNOWN NEVER fills the gap. This is the anti-hallucination prosthesis: BEFORE you assert a fact to the user, ask the savant and repair your answer if it says FALSE or refuse to assert if it says UNKNOWN.",
  whenToUse: "BEFORE asserting any specific factual claim (a number, version, API signature, date, file/symbol name). Use TRUE→assert with the lineage; FALSE→correct yourself + cite the evidence; UNKNOWN→say you don't know, NEVER guess.",
  triggers: ["savant verify", "aletheia verify", "prove this claim", "is this true", "verify before asserting"],
  inputSchema: {
    type: "object",
    required: ["claim"],
    properties: {
      claim: { type: "string", description: "the factual claim to verify (verbatim)" },
      record: { type: "boolean", description: "persist the verdict to the Axiom Lattice (living proof graph) + surface any contradictions with existing truths" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = await core.aletheiaSpine.assertClaim(cwd, String(args["claim"] ?? ""), { record: args["record"] === true });
      const icon = r.verdict === "TRUE" ? "🟢" : r.verdict === "FALSE" ? "🔴" : "⚪";
      const contra = (r.contradictions && r.contradictions.length) ? ` · ⚠ ${r.contradictions.length} contradiction(s)` : "";
      return {
        data: { verdict: r.verdict, pTrue: r.pTrue, disagreement: r.disagreement, evidence: r.evidence, lineage: r.lineage, refusalApplied: r.refusalApplied, receiptId: r.receipt?.receiptId, informational: r.informational, contradictions: r.contradictions, latticeNodeId: r.latticeNodeId },
        wisdom: `${icon} ${r.verdict} — ${r.evidence}${contra}`,
        followUp: r.verdict === "UNKNOWN" ? [] : ["mneme.notary.verify"],
        confidence: { level: r.verdict === "UNKNOWN" ? ("low" as const) : ("high" as const) },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "savant verify failed → treat as UNKNOWN (never guess)", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantWhyTool: MnemeTool = {
  name: "mneme.savant.why",
  category: "meta",
  description:
    "💎 AXIOM LATTICE — `whyTrue`: walk the proof of a recorded claim back toward bedrock. Returns the proof tree (this claim ← the sensors that proved it ← any dependency claims ← deterministic axioms), each step marked signed/unsigned. The savant can always show its work — no LLM can produce a depth-of-inference receipt like this.",
  whenToUse: "When the user asks 'why is X true?' or 'prove it' about a claim ALETHEIA recorded. Read the proof path back to them.",
  triggers: ["savant why", "why is this true", "show the proof", "prove it"],
  inputSchema: { type: "object", required: ["claim"], properties: { claim: { type: "string", description: "claim text or lattice node id" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const w = core.aletheiaLattice.whyTrue(cwd, String(args["claim"] ?? ""));
      return { data: w, wisdom: w.found ? w.proof.join("\n") : "no recorded assertion for that claim", followUp: [], confidence: { level: w.found ? ("high" as const) : ("low" as const) } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "why failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantContradictionsTool: MnemeTool = {
  name: "mneme.savant.contradictions",
  category: "meta",
  description:
    "💎 AXIOM LATTICE — detect (without recording) whether a claim CONTRADICTS the savant's existing ACTIVE truths: opposite-verdict (same subject, one TRUE one FALSE), negation-pair (X vs not-X both TRUE), or value-conflict (subject = two different values, both TRUE). A savant cannot hold two opposing truths — this is the loudest honesty signal.",
  whenToUse: "Before recording a new fact, or to audit whether something you're about to assert clashes with what's already proven.",
  triggers: ["savant contradictions", "does this contradict", "conflict check"],
  inputSchema: { type: "object", required: ["claim", "verdict"], properties: { claim: { type: "string" }, verdict: { type: "string", description: "TRUE | FALSE | UNKNOWN" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const v = String(args["verdict"] ?? "TRUE") as "TRUE" | "FALSE" | "UNKNOWN";
      const c = core.aletheiaLattice.detectContradictions(cwd, String(args["claim"] ?? ""), v);
      return { data: { contradictions: c }, wisdom: c.length ? `⚠ ${c.length} contradiction(s): ${c.map((x) => x.kind).join(", ")}` : "no contradiction with existing truths", followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "contradiction check failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantRetractTool: MnemeTool = {
  name: "mneme.savant.retract",
  category: "meta",
  description:
    "💎 AXIOM LATTICE — retract a previously-recorded claim and CASCADE: every claim whose proof DEPENDED on it is automatically marked PENDING_REVERIFY (its foundation was refuted, so it can no longer be trusted until re-proven). Writes a signed retraction frame. Truth-maintenance: change one fact and the whole graph self-corrects.",
  whenToUse: "When a fact ALETHEIA had recorded as TRUE turns out to be false (new evidence). Retract it; everything that rested on it is flagged for re-verification.",
  triggers: ["savant retract", "this turned out false", "retract claim"],
  inputSchema: { type: "object", required: ["claim"], properties: { claim: { type: "string", description: "claim text or lattice node id" }, reason: { type: "string" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.aletheiaLattice.retract(cwd, String(args["claim"] ?? ""), String(args["reason"] ?? "refuted"));
      return { data: r, wisdom: r.retracted.length ? `retracted ${r.retracted.length}; ${r.cascade.length} dependent(s) → PENDING_REVERIFY` : "no matching active claim to retract", followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "retract failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantLatticeTool: MnemeTool = {
  name: "mneme.savant.lattice",
  category: "meta",
  description:
    "💎 AXIOM LATTICE — status of the savant's living proof graph: total/active/retracted/pending nodes, open contradictions among active truths, and whether the whole hash-chain re-verifies OFFLINE (every node's Ed25519 signature valid + body matches the signed payload + chain intact). The savant's 'Trust Nothing, including itself'.",
  whenToUse: "To report the health of the recorded truth graph, or to prove tamper-evidence (verifyLattice).",
  triggers: ["savant lattice", "lattice status", "proof graph status", "verify lattice"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const s = core.aletheiaLattice.latticeStatus(cwd);
      return { data: s, wisdom: `${s.nodes} nodes (${s.active} active · ${s.retracted} retracted · ${s.pending} pending) · ${s.openContradictions} open contradiction(s) · chain ${s.chainValid ? "INTACT ✓" : "TAMPERED ✗"}`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "lattice status failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantGauntletTool: MnemeTool = {
  name: "mneme.savant.gauntlet",
  category: "meta",
  description:
    "🧠 ALETHEIA (savant) — run the Savant Gauntlet over labeled cases ({claim, truth: TRUE|FALSE|UNPROVABLE}) and report the three falsifiable numbers a savant beats every LLM on: false-assertion rate (target 0% — says UNKNOWN instead of guessing), forget rate (target 0% — every verdict is signed + re-verifiable), provability (target 100% — a signed lineage on every definite verdict).",
  whenToUse: "To prove (falsifiably) that the savant abstains rather than hallucinates. Feed it true facts, false facts, and genuinely-unprovable claims; a healthy savant asserts the provable ones, refutes the false ones, and says UNKNOWN on the unprovable ones.",
  triggers: ["savant gauntlet", "aletheia gauntlet", "prove savant beats llm"],
  inputSchema: {
    type: "object",
    required: ["cases"],
    properties: {
      cases: { type: "array", description: "array of { claim: string, truth: 'TRUE'|'FALSE'|'UNPROVABLE' }" },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const cases = Array.isArray(args["cases"]) ? args["cases"] as Array<{ claim: string; truth: "TRUE" | "FALSE" | "UNPROVABLE" }> : [];
      const rep = await core.aletheiaSpine.runSavantGauntlet(cwd, cases);
      return {
        data: rep,
        wisdom: rep.headline,
        followUp: [],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "savant gauntlet failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantCreedTool: MnemeTool = {
  name: "mneme.savant.creed",
  category: "meta",
  description:
    "🧠 ALETHEIA (savant) — the creed: the Six Refusals (what the savant deliberately gives up — the 'lesion') + the Three Vows (Prove-or-Unknown · Never Forget · Trust Nothing) + the savant thesis. Read it to understand what ALETHEIA is and, crucially, what it refuses to be (a chatbot / a guesser / general intelligence).",
  whenToUse: "When you need to understand or explain ALETHEIA's identity, or to remind yourself of the discipline before relaying a fact.",
  triggers: ["savant creed", "aletheia creed", "six refusals", "three vows", "what is aletheia"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    try {
      const core = await import("@mneme-ai/core");
      const c = core.aletheiaSpine.creed();
      return { data: c, wisdom: `ALETHEIA — ${c.refusals.length} refusals · ${c.vows.length} vows · Prove-or-Unknown`, followUp: ["mneme.savant.verify"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "creed unavailable", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const SAVANT_TOOLS: MnemeTool[] = [savantVerifyTool, savantGauntletTool, savantCreedTool, savantWhyTool, savantContradictionsTool, savantRetractTool, savantLatticeTool];
