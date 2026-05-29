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

export const savantRepairTool: MnemeTool = {
  name: "mneme.savant.repair",
  category: "meta",
  description:
    "💎② SAVANT SYMBIOSIS — hand the savant your DRAFT answer; it fact-checks every checkable claim and returns a REPAIRED draft: FALSE claims annotated with the correction + evidence, UNKNOWN claims flagged 'unverified — do not assert as fact', TRUE claims kept, non-claim prose untouched. The before-assert prosthesis: run this on your reply BEFORE it reaches the user, then send the repaired version. If `changed` is true, you should revise.",
  whenToUse: "Right before you send a factual answer to the user. Pass your full draft; send back the `repaired` text (and never assert the UNKNOWN-flagged parts as fact).",
  triggers: ["savant repair", "fact-check my answer", "check before sending", "repair draft"],
  inputSchema: { type: "object", required: ["draft"], properties: { draft: { type: "string", description: "your draft answer (prose + claims)" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = await core.aletheiaSymbiosis.repairDraft(cwd, String(args["draft"] ?? ""));
      return { data: r, wisdom: `${r.changed ? "⚠ revise — " : "✓ "}${r.summary}`, followUp: r.changed ? ["mneme.savant.verify"] : [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "repair failed — send draft unchanged", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantCompoundTool: MnemeTool = {
  name: "mneme.savant.compound",
  category: "meta",
  description:
    "💎③ IDLE COMPOUNDING — consolidate the Axiom Lattice's ACTIVE truths into higher-support axioms (the savant sharpens in its sleep): subjects whose active truths agree become signed axioms (crystallised once support ≥ 2); subjects whose active truths conflict are quarantined as contested (NOT axioms). Read-only + deterministic + idempotent; returns the savant's current, attestable axiom base.",
  whenToUse: "On a daemon idle tick, or to report 'what the savant currently holds as proven'. Crystallised axioms are the high-confidence facts you can cite without re-proving.",
  triggers: ["savant compound", "consolidate truths", "axiom base", "what is proven"],
  inputSchema: { type: "object", properties: { minSupport: { type: "number", description: "min corroborating truths to crystallise an axiom (default 2)" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const minSupport = typeof args["minSupport"] === "number" ? args["minSupport"] as number : undefined;
      const r = core.aletheiaCompound.compoundLattice(cwd, minSupport !== undefined ? { minSupport } : {});
      return { data: r, wisdom: r.summary, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "compound failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantGauntletPublicTool: MnemeTool = {
  name: "mneme.savant.gauntlet_public",
  category: "meta",
  description:
    "💎④ PUBLIC SAVANT GAUNTLET — run the pinned, reproducible public corpus (provable truths · provable falsehoods · genuinely-unprovable claims) through the savant and return a SIGNED report card: false-assertion rate (target 0%), forget rate (0%), provability (100%), abstention (100%). Anyone can rerun it and verify the signed result offline — the falsifiable proof that the savant abstains instead of hallucinating.",
  whenToUse: "To demonstrate / audit the savant's honesty to a third party. The receipt verifies offline with the public key alone (mneme.notary.verify or verifyGauntletReport).",
  triggers: ["savant gauntlet public", "prove honesty", "benchmark the savant"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = await core.aletheiaGauntlet.runPublicGauntlet(cwd);
      return { data: { passed: r.passed, falseAssertionRate: r.falseAssertionRate, forgetRate: r.forgetRate, provability: r.provability, abstentionRate: r.abstentionRate, corpusSize: r.corpusSize, receiptId: r.receipt?.receiptId }, wisdom: r.headline + (r.passed ? " · ✓ PASS (signed)" : " · ✗ did not pass"), followUp: ["mneme.notary.verify"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "public gauntlet failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantMeshExportTool: MnemeTool = {
  name: "mneme.savant.mesh_export",
  category: "meta",
  description:
    "💎⑤ CROSS-AGENT TRUTH MESH — export this savant's ACTIVE truths as a SIGNED, portable bundle (each truth carries its own signature). Hand it to a peer agent; they merge it after verifying every signature offline. The federated, vendor-neutral, tamper-evident fact substrate of the AI multiverse.",
  whenToUse: "To share your proven facts with another agent/instance without a central server.",
  triggers: ["savant mesh export", "export truths", "share proven facts"],
  inputSchema: { type: "object", properties: { agent: { type: "string", description: "your agent id (shown in the bundle)" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const b = core.aletheiaMesh.exportTruths(cwd, String(args["agent"] ?? "anon"));
      return { data: b, wisdom: `exported ${b.truths.length} signed truth(s) from "${b.agent}"`, followUp: ["mneme.savant.mesh_merge"], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "mesh export failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantMeshMergeTool: MnemeTool = {
  name: "mneme.savant.mesh_merge",
  category: "meta",
  description:
    "💎⑤ CROSS-AGENT TRUTH MESH — merge a peer's signed truth bundle into your Axiom Lattice. Verifies the bundle + every per-truth signature OFFLINE (forged/unsigned truths DROPPED + a swapped claim that doesn't match its signature is dropped), SURFACES any truth that contradicts a local ACTIVE truth (never silently resolved), and skips duplicates (idempotent + commutative). Returns added/duplicate/forged-dropped/conflicts.",
  whenToUse: "When another agent hands you a truth bundle. Trust only what verifies; review the surfaced conflicts.",
  triggers: ["savant mesh merge", "merge truths", "import peer facts"],
  inputSchema: { type: "object", required: ["bundle"], properties: { bundle: { type: "object", description: "a TruthBundle from mneme.savant.mesh_export" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const bundle = args["bundle"] as Parameters<typeof core.aletheiaMesh.mergeTruths>[1];
      const r = core.aletheiaMesh.mergeTruths(cwd, bundle);
      return { data: r, wisdom: r.summary, followUp: r.conflicts.length ? ["mneme.savant.contradictions"] : [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "mesh merge failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantRecollectTool: MnemeTool = {
  name: "mneme.savant.recollect",
  category: "meta",
  description:
    "💎⑥ ANAMNESIS — 'compute once, recollect forever.' Verify a claim, but RECOLLECT a signed proof instead of re-deriving when one is fresh: the FIRST agent to prove a fact pays inference; every agent after (this session or any other) pays ~0 — it re-verifies the Ed25519-signed lineage (a hash check) instead of full inference. Every hit is RE-VERIFIED (signature + freshness + not-invalidated) so a stale/forged proof is NEVER served. Paraphrases collapse to the same proof (2+2=4 ≡ 'two plus two equals four' ≡ '4 = 2 + 2') via meaning-preserving canonicalisation. Returns { verdict, source: recollect|recompute, energySavedTokens, lineage }.",
  whenToUse: "Use INSTEAD of mneme.savant.verify when you want the energy-saving cache: ask any factual claim; if the multiverse already proved it, you get the signed answer for ~0 inference. Cite the lineage; the verdict is re-verified, never stale.",
  triggers: ["savant recollect", "anamnesis", "recollect or recompute", "cached proof", "have we proven this"],
  inputSchema: { type: "object", required: ["claim"], properties: { claim: { type: "string" }, agent: { type: "string", description: "your agent id (first-prover attribution)" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const now = Date.now();
      const r = await core.aletheiaAnamnesis.recollectAssertion(cwd, String(args["claim"] ?? ""), { now, agent: typeof args["agent"] === "string" ? args["agent"] as string : undefined });
      const icon = r.verdict === "TRUE" ? "🟢" : r.verdict === "FALSE" ? "🔴" : "⚪";
      return {
        data: { verdict: r.verdict, source: r.source, energySavedTokens: r.energySavedTokens, lineage: r.lineage, claimKey: r.claimKey, reason: r.reason },
        wisdom: `${icon} ${r.verdict} · ${r.source === "recollect" ? `♻ recollected (saved ~${r.energySavedTokens} inference tokens)` : "computed + signed for everyone after"}`,
        followUp: [], confidence: { level: r.verdict === "UNKNOWN" ? ("low" as const) : ("high" as const) },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "recollect failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantAnamnesisTool: MnemeTool = {
  name: "mneme.savant.anamnesis",
  category: "meta",
  description:
    "💎⑥ ANAMNESIS — status of the truth cache: how many signed proofs are stored, how many recollections (reuses) happened, and the total inference tokens AVOIDED across the multiverse (the energy layer). The most-recollected proofs are the highest-leverage cached truths.",
  whenToUse: "To report how much energy the savant has saved by recollecting instead of recomputing, or to see which facts the multiverse asks for most.",
  triggers: ["savant anamnesis", "anamnesis status", "energy saved", "cache stats"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const s = core.aletheiaAnamnesis.anamnesisStats(cwd);
      return { data: s, wisdom: `${s.records} signed proof(s) · ${s.recollections} recollection(s) · ~${s.totalEnergySavedTokens} inference tokens avoided · chain ${s.chainValid ? "intact" : "TAMPERED"}`, followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "anamnesis status failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const savantInvalidateTool: MnemeTool = {
  name: "mneme.savant.invalidate",
  category: "meta",
  description:
    "💎⑥ ANAMNESIS — hard-invalidate a cached proof because the world changed (a version shipped, a fact was superseded). The next ask of that claim is forced to RECOMPUTE instead of recollect. The freshness escape hatch that keeps the cache honest.",
  whenToUse: "When you know a previously-true fact is now out of date (new release, changed config, superseded data). Composes with mneme.savant.retract on the lattice.",
  triggers: ["savant invalidate", "this fact changed", "force recompute", "expire proof"],
  inputSchema: { type: "object", required: ["claim"], properties: { claim: { type: "string" }, reason: { type: "string" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const ok = core.aletheiaAnamnesis.invalidate(cwd, String(args["claim"] ?? ""), String(args["reason"] ?? "world changed"));
      return { data: { invalidated: ok }, wisdom: ok ? "proof invalidated — next ask will recompute" : "no cached proof matched that claim", followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "invalidate failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const SAVANT_TOOLS: MnemeTool[] = [
  savantVerifyTool, savantGauntletTool, savantCreedTool, savantWhyTool, savantContradictionsTool, savantRetractTool, savantLatticeTool,
  savantRepairTool, savantCompoundTool, savantGauntletPublicTool, savantMeshExportTool, savantMeshMergeTool,
  savantRecollectTool, savantAnamnesisTool, savantInvalidateTool,
];
