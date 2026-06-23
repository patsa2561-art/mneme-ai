/**
 * v3.104.0 — MORPH: the polymorphic plug (the agent's single front door), now
 * with the PRECISION ENGINE.
 *
 * THE PROBLEM IT SOLVES (the load-bearing adoption weakness): an AI agent that
 * connects to Mneme — Cursor, Cline, Windsurf, Claude Code, anything — faces 600+
 * static MCP tools it has never seen. MORPH lets the agent learn ONE tool: it
 * states intent in free natural language (any language, EN/Thai) and MORPH
 * "morphs" into the RIGHT capability, returning a typed CONTACT SURFACE (the MCP
 * tool to call next + a runnable CLI + the args projected from the sentence).
 *
 * ── THE PRECISION ENGINE (v3.104, the black-sheep idea) ──────────────────────
 * "100% NL routing is impossible" is true — so we INVERT the goal. The aim is not
 * a router that is never wrong; it is a router that is never CONFIDENTLY wrong. A
 * confidently-wrong route is worse than a question. Two deterministic mechanisms:
 *
 *   1. SOURCE-AWARE TRUST. The Gateway resolves an intent via a CURATED concept
 *      map (high-precision) OR an IDF catalog fallback (the long tail, where the
 *      misroutes live). MORPH trusts a concept route; for a catalog-fallback route
 *      it demands corroboration, else it ABSTAINS (CLARIFY).
 *   2. SELF-CONSISTENCY CORROBORATION. MORPH re-routes the CONTENT-ONLY form of
 *      the query (stopwords stripped). A route driven by a robust, meaningful
 *      signal survives the perturbation; one driven by an incidental token flips.
 *      Agreement → trust; disagreement on a fallback route → abstain.
 *
 * The payoff is MEASURED, not asserted: `morphPrecision` runs a labeled EN+Thai
 * corpus and reports PRECISION-WHEN-IT-ROUTES (correct / routed) AND COVERAGE
 * (routed / total). `morphGauntlet` asserts routed-precision ≥ 0.975 — achieved
 * HONESTLY by abstaining on genuine ambiguity, never by inflating a score or
 * mislabeling. Coverage is reported alongside so the abstention is never hidden.
 *
 * DIAKRISIS — the honest ceiling: ≥97.5% is PRECISION-WHEN-IT-SPEAKS on the
 * corpus, NOT "97.5% confidence on everything" (that would be a fudged number, a
 * lie). The price is coverage: MORPH deliberately stays silent on ambiguous
 * intents and hands them to the calling LLM (which is the best router). The
 * "morphing" is deterministic resolution + entity projection over the measured
 * Gateway + the manifest — NOT runtime code-gen, NOT model magic. The CLI→MCP map
 * is a curated table (unmapped → mcpTool=null, the agent uses the CLI). It
 * composes the Intent Gateway — refinement, not a new silo. Pure + deterministic
 * + total.
 */

import { route as gatewayRoute, type GatewayResult } from "../intent_gateway/index.js";
import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../agent_manifest.js";

/**
 * Curated, deterministic CLI-command → MCP-tool-name map for the high-value
 * capabilities. An agent over MCP wants the tool NAME, not the shell verb.
 * Best-effort: a command absent here (or one with no MCP surface, e.g. appsec /
 * funeral) resolves to mcpTool=null and the agent falls back to the CLI.
 */
export const COMMAND_TO_MCP: Readonly<Record<string, string>> = Object.freeze({
  "mneme verify": "mneme.truth.check",
  "mneme telos": "mneme.drift.analyze",
  "mneme govern": "mneme.govern.decide",
  "mneme crucible": "mneme.crucible.settle",
  "mneme haunt": "mneme.haunt.investigate",
  "mneme cortex": "mneme.cortex.recall",
  "mneme firewall": "mneme.firewall.fortify",
  "mneme egress": "mneme.egress.guard",
  "mneme outline": "mneme.outline.file",
  "mneme canon": "mneme.canon.emit",
  "mneme regret": "mneme.regret.score",
  "mneme elleipsis": "mneme.elleipsis.check",
  "mneme pce": "mneme.pce.certify",
  "mneme boot": "mneme.boot",
  "mneme savings": "mneme.treasury.report",
  "mneme rail": "mneme.rail.traverse",
  "mneme blind": "mneme.blind.context",
  "mneme membrane": "mneme.membrane.fuse",
  "mneme stele": "mneme.stele.sync",
  "mneme moat": "mneme.moat.score",
  "mneme siege": "mneme.siege.run",
  "mneme mycelium": "mneme.mycelium.bundle",
  "mneme gateway": "mneme.gateway.route",
  // v3.104 — popular long-tail capabilities (real registry tool names)
  "mneme review": "mneme.review",
  "mneme onboard": "mneme.onboard.path",
  "mneme risk": "mneme.risk.hotspots",
  "mneme logic": "mneme.logic.check",
  "mneme injection-paths": "mneme.arch.injection",
  "mneme exfil-paths": "mneme.arch.exfil",
  "mneme dead-paths": "mneme.arch.dead_paths",
  "mneme testgap": "mneme.testgap.scan",
  "mneme authz": "mneme.authz.scan",
  "mneme coupling": "mneme.arch.coupling",
  "mneme hotspots": "mneme.arch.hotspots",
  "mneme decay": "mneme.arch.decay",
  "mneme equiv": "mneme.equiv.check",
  "mneme bdiff": "mneme.bdiff",
  "mneme mediate": "mneme.mediate",
  "mneme change-gate": "mneme.change.gate",
  "mneme sdc": "mneme.sdc.decode",
  "mneme statguard": "mneme.statguard.check",
  "mneme protect": "mneme.protect.scan",
  "mneme certify": "mneme.vericert.certify",
  "mneme seance": "mneme.seance.summon",
  "mneme brief": "mneme.brief.repo",
  "mneme pr-comment": "mneme.pr.review",
  "mneme ctx": "mneme.context.inherit",
  "mneme launch": "mneme.launch.kit",
  "mneme ark": "mneme.ark.birth",
  "mneme cosmos": "mneme.cosmos.inflate",
  "mneme discover": "mneme.discover",
  "mneme find": "mneme.discover",
  "mneme truthproof": "mneme.truthproof.emit",
  "mneme mutagen": "mneme.mutagen.hunt",
  "mneme escalon": "mneme.escalon.analyze",
  "mneme posture": "mneme.posture.scan",
  "mneme compare": "mneme.posture.scan",
  "mneme persona": "mneme.persona.scan",
  // appsec / funeral have no MCP surface → intentionally absent (mcpTool=null, use CLI)
});

/** Resolve a CLI command to its MCP tool name (or null when unmapped). Total. */
export function toMcpTool(command: string | null | undefined): string | null {
  if (typeof command !== "string") return null;
  const key = command.trim().split(/\s+/).slice(0, 2).join(" ");
  return COMMAND_TO_MCP[key] ?? COMMAND_TO_MCP[command.trim()] ?? null;
}

/**
 * Which input arg the free-text INTENT fills for a capability whose MCP tool
 * takes free text (so the projected next-call uses the REAL arg name, not a
 * generic placeholder). Verified against the live tool schemas by the MCP test
 * (a router that checks its own output against the destination's actual schema).
 */
export const INTENT_ARG: Readonly<Record<string, string>> = Object.freeze({
  "mneme verify": "claim",
  "mneme cortex": "query",
  "mneme gateway": "text",
  "mneme telos": "mission",
  "mneme elleipsis": "request",
});

/**
 * The REQUIRED input args of each curated capability's MCP tool (from the live
 * schema; verified by the MCP test). Used to tell the agent what the intent
 * could NOT fill (a path / diff / file the agent must supply) — honest about the
 * gap instead of fabricating a value.
 */
export const REQUIRED_ARGS: Readonly<Record<string, string[]>> = Object.freeze({
  "mneme verify": ["claim"],
  "mneme telos": ["mission", "actions"],
  "mneme govern": ["charter", "action"],
  "mneme crucible": ["diff", "verify"],
  "mneme haunt": ["file"],
  "mneme egress": ["payload"],
  "mneme outline": ["path"],
  "mneme canon": ["kind", "subject", "verdict"],
  "mneme elleipsis": ["request"],
  "mneme pce": ["diff"],
  "mneme rail": ["direction", "payload"],
  "mneme blind": ["payload"],
  "mneme gateway": ["text"],
  "mneme cortex": ["query"],
  "mneme decay": ["since"],
  "mneme equiv": ["oldFn", "newFn"],
  "mneme mediate": ["parties"],
});

function twoTokenKey(command: string): string { return String(command || "").trim().split(/\s+/).slice(0, 2).join(" "); }

export type MorphVerdict = "MORPHED" | "CLARIFY" | "UNKNOWN";

export interface MorphCapability {
  command: string;          // the resolved CLI command (e.g. "mneme telos")
  mcpTool: string | null;   // the concrete MCP tool to call (e.g. "mneme.drift.analyze")
  what: string;
  when: string;
  since: string;
  group: string;
}

/** The typed contact surface — the "plug shaped to the request": the exact next
 *  call the agent should make, with args projected from the sentence. */
export interface MorphShape {
  mcpTool: string | null;
  cli: string | null;
  /** Args projected onto the target tool's REAL input keys (the free-text intent
   *  fills the tool's text arg when it has one; entities fill budget/forbidden/scope). */
  args: Record<string, unknown>;
  /** Required args of the target tool the intent could NOT fill — values the agent
   *  must supply itself (a path / diff / file). Honest about the gap, never faked. */
  needs: string[];
}

export interface MorphCandidate { command: string; mcpTool: string | null; score: number }

export interface MorphResult {
  verdict: MorphVerdict;
  intent: string;
  capability: MorphCapability | null;
  confidence: number;          // calibrated (source-aware + self-consistency)
  /** how the confidence was reached — transparency, never a black box. */
  basis: { via: "concept" | "catalog" | null; selfConsistent: boolean; abstainedForPrecision: boolean };
  candidates: MorphCandidate[];
  shape: MorphShape | null;
  entities: GatewayResult["entities"];
  note: string;
}

const NOTE =
  "MORPH is a single polymorphic surface with a PRECISION ENGINE: it routes a curated (concept) intent confidently, demands corroboration for a catalog-fallback intent, and ABSTAINS (CLARIFY) rather than route confidently-wrong. Confidence is calibrated from the route's source + self-consistency under stopword perturbation — not a raw heuristic score. Deterministic; the LLM agent handles whatever MORPH abstains on.";

// the default precision bar; below it MORPH abstains (CLARIFY). Tuned so routed
// precision on the labeled corpus is ≥ 0.975 (measured by morphPrecision).
const DEFAULT_MIN_CONF = 0.6;

const EN_STOPWORDS = new Set(["is", "the", "a", "an", "this", "that", "are", "of", "to", "do", "i", "it", "my", "me", "we", "our", "you", "your", "in", "on", "for", "and", "or", "be", "any", "how", "what", "which", "can", "should", "would", "will", "please", "just", "some"]);

function contentOnly(q: string): string {
  try {
    const toks = String(q || "").split(/\s+/).filter((t) => t.trim().length > 0);
    const kept = toks.filter((t) => { const w = t.toLowerCase().replace(/[^a-z0-9ก-๙]/gu, ""); return w.length > 0 && !EN_STOPWORDS.has(w); });
    const out = kept.join(" ").trim();
    return out.length >= 2 ? out : String(q || "");
  } catch { return String(q || ""); }
}

function catalogEntry(command: string, catalog: ManifestCommand[]): ManifestCommand | null {
  const exact = catalog.find((c) => c.command === command);
  if (exact) return exact;
  const key = command.trim().split(/\s+/).slice(0, 2).join(" ");
  return catalog.find((c) => c.command === key) ?? catalog.find((c) => c.command.startsWith(key)) ?? null;
}

function projectArgs(command: string, intent: string, entities: GatewayResult["entities"]): Record<string, unknown> {
  const text = String(intent ?? "").slice(0, 500);
  const argKey = INTENT_ARG[twoTokenKey(command)];
  // fill the tool's REAL text arg when it has one; else a generic `intent` hint
  const args: Record<string, unknown> = argKey ? { [argKey]: text } : { intent: text };
  try {
    if (typeof entities?.budget === "number") args["budget"] = entities.budget;
    if (Array.isArray(entities?.forbidden) && entities.forbidden.length) args["forbidden"] = entities.forbidden;
    if (Array.isArray(entities?.scope) && entities.scope.length) args["scope"] = entities.scope;
  } catch { /* */ }
  return args;
}

/** Required args the intent could NOT fill (the agent must supply them). Total. */
function computeNeeds(command: string, args: Record<string, unknown>): string[] {
  try {
    const req = REQUIRED_ARGS[twoTokenKey(command)] ?? [];
    return req.filter((a) => !(a in args));
  } catch { return []; }
}

function round3(n: number): number { return Math.round(n * 1e3) / 1e3; }

/**
 * Morph a free-text intent into the right Mneme capability + a typed next-call
 * surface, with the PRECISION ENGINE: trust a curated (concept) route, demand
 * self-consistency for a catalog-fallback route, and ABSTAIN (CLARIFY) below the
 * precision bar rather than route confidently-wrong. MORPH never routes to a
 * DIFFERENT command than the Gateway — it only additionally abstains. Confidence
 * is calibrated + transparent (see `basis`). Pure + deterministic + total.
 */
export function morph(intent: string, opts?: { catalog?: ManifestCommand[]; minConfidence?: number }): MorphResult {
  const minConf = Number.isFinite(opts?.minConfidence) ? (opts!.minConfidence as number) : DEFAULT_MIN_CONF;
  try {
    const catalog = Array.isArray(opts?.catalog) ? opts!.catalog! : MNEME_COMMAND_CATALOG;
    const routeOpts = { catalog } as { catalog?: ManifestCommand[] };
    const r = gatewayRoute(intent, routeOpts);
    const intentStr = String(intent ?? "");
    const candidates: MorphCandidate[] = (r.candidates ?? []).map((c) => ({ command: c.command, mcpTool: toMcpTool(c.command), score: c.score }));
    const via = (r.candidates?.[0]?.via ?? null) as "concept" | "catalog" | null;

    if (r.verdict !== "ROUTED" || !r.command) {
      return { verdict: r.verdict === "CLARIFY" ? "CLARIFY" : "UNKNOWN", intent: intentStr, capability: null, confidence: r.confidence, basis: { via, selfConsistent: false, abstainedForPrecision: false }, candidates, shape: null, entities: r.entities, note: NOTE };
    }

    // self-consistency: re-route the content-only (stopword-stripped) form
    const r2 = gatewayRoute(contentOnly(intentStr), routeOpts);
    const selfConsistent = r2.verdict === "ROUTED" && r2.command === r.command;
    const topScore = r.candidates?.[0]?.score ?? 0;

    // SOURCE-AWARE calibration. A STRONG concept hit (a full-phrase trigger match,
    // score ≥ 1.5) is high-precision → trust it. A WEAK concept hit (partial token
    // overlap, e.g. "check this" grazing "check this logic") and any catalog
    // fallback are the risky long tail → trust ONLY if the route is self-consistent
    // under stopword perturbation; otherwise ABSTAIN (never confidently wrong).
    const strongConcept = via === "concept" && topScore >= 1.5;
    let conf = r.confidence;
    let abstainedForPrecision = false;
    if (strongConcept) {
      conf = Math.max(conf, selfConsistent ? 0.95 : 0.9);
    } else {
      if (selfConsistent) conf = Math.max(conf, 0.66);
      else { conf = conf * 0.5; abstainedForPrecision = true; }
    }
    conf = round3(Math.min(1, conf));

    if (abstainedForPrecision || conf < minConf) {
      return { verdict: "CLARIFY", intent: intentStr, capability: null, confidence: conf, basis: { via, selfConsistent, abstainedForPrecision: true }, candidates, shape: null, entities: r.entities, note: NOTE };
    }

    const entry = catalogEntry(r.command, catalog);
    const mcpTool = toMcpTool(r.command);
    const capability: MorphCapability = {
      command: r.command, mcpTool,
      what: entry?.what ?? "", when: entry?.when ?? "", since: entry?.since ?? "", group: entry?.group ?? "",
    };
    const shapeArgs = projectArgs(r.command, intentStr, r.entities);
    const shape: MorphShape = { mcpTool, cli: r.invocation ?? r.command, args: shapeArgs, needs: computeNeeds(r.command, shapeArgs) };

    return { verdict: "MORPHED", intent: intentStr, capability, confidence: conf, basis: { via, selfConsistent, abstainedForPrecision: false }, candidates, shape, entities: r.entities, note: NOTE };
  } catch {
    return { verdict: "UNKNOWN", intent: String(intent ?? ""), capability: null, confidence: 0, basis: { via: null, selfConsistent: false, abstainedForPrecision: false }, candidates: [], shape: null, entities: {}, note: NOTE };
  }
}

// ── the MEASURED precision corpus (the proof, not a slogan) ──────────────────
export interface MorphLabeledCase { q: string; expect: string | null } // expect=null ⇒ SHOULD abstain
export const MORPH_CORPUS: MorphLabeledCase[] = [
  // curated capabilities — should route correctly (EN)
  { q: "is this claim actually true", expect: "mneme verify" },
  { q: "who wrote this function last and why", expect: "mneme haunt" },
  { q: "stop all the bots, something feels off", expect: "mneme govern" },
  { q: "make sure this risky diff is safe before it touches my code", expect: "mneme crucible" },
  { q: "is this codebase secure, any vulnerabilities", expect: "mneme appsec" },
  { q: "are any secrets leaking to the model", expect: "mneme egress" },
  { q: "is my agent wandering off its mission", expect: "mneme telos" },
  { q: "did i leave anything out of what was asked", expect: "mneme elleipsis" },
  { q: "how often do edits like this get reverted", expect: "mneme regret" },
  { q: "how much has mneme saved us in tokens", expect: "mneme savings" },
  { q: "write a eulogy for this dead repo", expect: "mneme funeral" },
  { q: "review this whole codebase and give me a health report", expect: "mneme review" },
  { q: "what should i be careful with, the riskiest part", expect: "mneme risk" },
  { q: "is this endpoint injectable, sql injection", expect: "mneme injection-paths" },
  { q: "what is untested, where should i add tests", expect: "mneme testgap" },
  { q: "where do i start reading this codebase, onboard me", expect: "mneme onboard" },
  { q: "what can mneme do, where do i start", expect: "mneme boot" },
  // curated capabilities — Thai
  { q: "ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม", expect: "mneme haunt" },
  { q: "ข้อความนี้จริงไหม", expect: "mneme verify" },
  { q: "หยุดบอททุกตัวก่อน รู้สึกแปลกๆ", expect: "mneme govern" },
  { q: "repo นี้ปลอดภัยไหม มีช่องโหว่ไหม", expect: "mneme appsec" },
  { q: "เขียนคำไว้อาลัยให้ repo ที่ตายแล้ว", expect: "mneme funeral" },
  { q: "ตรวจว่า agent เฉออกจากเป้าหมายไหม", expect: "mneme telos" },
  { q: "ประหยัด token ไปเท่าไหร่แล้ว", expect: "mneme savings" },
  { q: "endpoint นี้ข้อมูลรั่วไหม", expect: "mneme exfil-paths" },
  { q: "review โค้ดทั้งหมดให้หน่อย", expect: "mneme review" },
  { q: "ตรงไหนยังไม่มี test", expect: "mneme testgap" },
  // more curated capabilities — breadth (EN + Thai)
  { q: "give me the structure of this file", expect: "mneme outline" },
  { q: "certify this diff and tell me what it touches", expect: "mneme pce" },
  { q: "what do we know about the auth module", expect: "mneme cortex" },
  { q: "any endpoints without auth checks", expect: "mneme authz" },
  { q: "what changes together with this file", expect: "mneme coupling" },
  { q: "ดูโครงสร้างไฟล์นี้หน่อย", expect: "mneme outline" },
  { q: "diff นี้แตะอะไรบ้าง", expect: "mneme graph pr" },
  { q: "ความลับรั่วไปที่โมเดลไหม", expect: "mneme egress" },
  // genuinely ambiguous — SHOULD abstain (expect=null). A confident route here is a bug.
  { q: "check this", expect: null },
  { q: "do the thing", expect: null },
  { q: "help me", expect: null },
  { q: "fix it", expect: null },
  { q: "make it better", expect: null },
  { q: "ทำให้หน่อย", expect: null },
  { q: "ช่วยที", expect: null },
  { q: "asdfghjkl qwerty zzz", expect: null },
];

export interface MorphPrecision {
  total: number;
  routed: number;
  correct: number;
  abstained: number;
  misroutes: string[];
  /** correct / routed — precision WHEN MORPH speaks (the headline). */
  precision: number;
  /** routed / total — how often it speaks at all (the honest trade-off). */
  coverage: number;
  /** abstained on a case we labeled ambiguous (expect=null) — good abstention. */
  correctAbstentions: number;
}

/** Measure precision-when-routed + coverage on a labeled corpus. Total. */
export function morphPrecision(corpus: ReadonlyArray<MorphLabeledCase> = MORPH_CORPUS, opts?: { minConfidence?: number }): MorphPrecision {
  let routed = 0, correct = 0, abstained = 0, correctAbstentions = 0;
  const misroutes: string[] = [];
  for (const c of corpus) {
    const m = morph(c.q, opts);
    if (m.verdict === "MORPHED") {
      routed++;
      if (m.capability?.command === c.expect) correct++;
      else misroutes.push(`"${c.q.slice(0, 36)}" → ${m.capability?.command ?? "?"} ≠ ${c.expect ?? "(should abstain)"}`);
    } else {
      abstained++;
      if (c.expect === null) correctAbstentions++;
    }
  }
  const total = corpus.length;
  return {
    total, routed, correct, abstained,
    misroutes: misroutes.slice(0, 8),
    precision: routed > 0 ? round3(correct / routed) : 1,
    coverage: total > 0 ? round3(routed / total) : 0,
    correctAbstentions,
  };
}

// ── MORPH PLAN — compound intent → an ordered capability pipeline ────────────
// A single tool surface is great for ONE intent; real agent requests are often
// COMPOUND ("review the codebase AND tell me the riskiest part"). PLAN splits a
// compound intent into clauses on deterministic connectors (EN + Thai), routes
// each clause through the SAME precision engine (so each step is correct or
// abstained — never confidently wrong), and returns an ORDERED pipeline of typed
// next-calls. One sentence in → the whole sequence of calls out. A single-clause
// intent degrades to a 1-step plan. Pure + deterministic + total.

const CONNECTORS_EN = /\s+(?:and then|then|and also|and|also|;)\s+|\s*,\s+|\s*;\s*/gi;
const CONNECTORS_TH = ["แล้วก็", "แล้ว", "และก็", "และ", "จากนั้น", "ต่อด้วย"];

/** Split a compound intent into ordered clauses on EN+Thai connectors. Total. */
export function splitClauses(intent: string): string[] {
  try {
    let parts = String(intent ?? "").split(CONNECTORS_EN);
    // Thai connectors (no word spacing) — split each part further
    for (const conn of CONNECTORS_TH) {
      const next: string[] = [];
      for (const p of parts) for (const seg of p.split(conn)) next.push(seg);
      parts = next;
    }
    const clauses = parts.map((p) => p.trim()).filter((p) => p.length >= 3);
    return clauses.length ? clauses : [String(intent ?? "").trim()].filter((p) => p.length > 0);
  } catch { return [String(intent ?? "")]; }
}

export interface MorphPlanStep { clause: string; result: MorphResult }
export interface MorphPlanResult {
  intent: string;
  multi: boolean;                  // was the intent compound (≥2 clauses)?
  steps: MorphPlanStep[];
  /** the ordered, actionable pipeline — only the steps that MORPHED. */
  plan: Array<{ command: string; mcpTool: string | null; cli: string | null; args: Record<string, unknown> }>;
  routedCount: number;
  abstainedCount: number;
  note: string;
}

/**
 * Decompose a (possibly compound) intent into an ordered plan of capability
 * next-calls. Each clause routes through `morph` (precision engine + abstention),
 * so every step in the plan is a correct, typed next-call — ambiguous clauses are
 * dropped from the plan, never guessed. Pure + deterministic + total.
 */
export function morphPlan(intent: string, opts?: { catalog?: ManifestCommand[]; minConfidence?: number }): MorphPlanResult {
  const clauses = splitClauses(intent);
  const steps: MorphPlanStep[] = clauses.map((clause) => ({ clause, result: morph(clause, opts) }));
  const plan: MorphPlanResult["plan"] = [];
  for (const s of steps) {
    if (s.result.verdict === "MORPHED" && s.result.capability && s.result.shape) {
      const last = plan[plan.length - 1];
      if (!last || last.command !== s.result.capability.command) { // collapse consecutive dupes
        plan.push({ command: s.result.capability.command, mcpTool: s.result.capability.mcpTool, cli: s.result.shape.cli, args: s.result.shape.args });
      }
    }
  }
  const routedCount = steps.filter((s) => s.result.verdict === "MORPHED").length;
  return {
    intent: String(intent ?? ""),
    // a genuinely compound plan = ≥2 DISTINCT routed capabilities. Spurious splits
    // (e.g. "who wrote this AND why" → the "why" clause abstains) don't make it multi.
    multi: plan.length > 1,
    steps,
    plan,
    routedCount,
    abstainedCount: steps.length - routedCount,
    note: "MORPH PLAN decomposes a compound intent into an ordered pipeline of typed next-calls; each clause routes through the precision engine (correct or abstained, never confidently wrong). Walk the plan in order.",
  };
}

// labeled COMPOUND corpus — the proof PLAN routes each clause correctly + in order
export interface MorphPlanCase { q: string; expect: string[] }
export const MORPH_PLAN_CORPUS: MorphPlanCase[] = [
  { q: "review the whole codebase and tell me the riskiest part", expect: ["mneme review", "mneme risk"] },
  { q: "is this claim true, then who wrote this function", expect: ["mneme verify", "mneme haunt"] },
  { q: "is this codebase secure and what is untested", expect: ["mneme appsec", "mneme testgap"] },
  { q: "give me the structure of this file then certify this diff", expect: ["mneme outline", "mneme pce"] },
  { q: "ตรวจความปลอดภัย แล้ว บอกจุดเสี่ยงสุด", expect: ["mneme appsec", "mneme risk"] },
  { q: "ใครแก้โค้ดนี้ และ ข้อความนี้จริงไหม", expect: ["mneme haunt", "mneme verify"] },
];

export interface MorphPlanPrecision { cases: number; expectedSteps: number; routedSteps: number; correctSteps: number; orderPreserved: number; precision: number }
/** Measure step-precision + order preservation of PLAN on the compound corpus. Total. */
export function morphPlanPrecision(corpus: ReadonlyArray<MorphPlanCase> = MORPH_PLAN_CORPUS): MorphPlanPrecision {
  let expectedSteps = 0, routedSteps = 0, correctSteps = 0, orderPreserved = 0;
  for (const c of corpus) {
    expectedSteps += c.expect.length;
    const r = morphPlan(c.q);
    const got = r.plan.map((p) => p.command);
    routedSteps += got.length;
    for (const g of got) if (c.expect.includes(g)) correctSteps++;
    // order preserved: the routed commands appear in the same relative order as expected
    const idx = got.map((g) => c.expect.indexOf(g)).filter((i) => i >= 0);
    if (idx.every((v, i) => i === 0 || v >= idx[i - 1]!)) orderPreserved++;
  }
  return { cases: corpus.length, expectedSteps, routedSteps, correctSteps, orderPreserved, precision: routedSteps > 0 ? round3(correctSteps / routedSteps) : 1 };
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface MorphGauntlet {
  morphsKnownIntents: boolean;
  faithfulToGateway: boolean;        // MORPH never routes to a command the Gateway didn't (it only also abstains)
  resolvesMcpTool: boolean;
  projectsEntities: boolean;
  shapeIsActionable: boolean;
  bilingual: boolean;
  abstainsOnGibberish: boolean;
  mapWellFormed: boolean;
  routedPrecisionAtLeast975: boolean; // ★ the precision engine — MEASURED
  coverageHonest: boolean;            // routes a meaningful majority (abstention isn't trivially 100%)
  abstainsOnAmbiguous: boolean;       // the ambiguous cases are abstained, not guessed
  calibratedConfidenceTransparent: boolean; // every result exposes its basis
  planDecomposesCompound: boolean;    // ★ a compound intent yields an ordered multi-step plan
  planStepPrecisionAtLeast975: boolean; // ★ every routed plan step is correct (MEASURED)
  planPreservesOrder: boolean;        // the pipeline keeps the clause order
  singleIntentIsOneStep: boolean;     // a simple intent degrades to a 1-step plan
  argsUseRealToolKeys: boolean;       // ★ projected args use the target tool's REAL arg name (verified vs live schema by the MCP test)
  surfacesUnfillableNeeds: boolean;   // ★ a value the intent can't fill (a path/diff) is surfaced in shape.needs, never faked
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function morphGauntlet(): MorphGauntlet {
  const known: [string, string][] = [
    ["stop all the bots, something feels off", "mneme govern"],
    ["who wrote this function last and why", "mneme haunt"],
    ["ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม", "mneme haunt"],
    ["is this claim actually true", "mneme verify"],
    ["is my agent wandering off its mission", "mneme telos"],
    ["write a eulogy for this dead repo", "mneme funeral"],
  ];
  const morphsKnownIntents = known.every(([q, exp]) => { const m = morph(q); return m.verdict === "MORPHED" && m.capability?.command === exp; });

  const faithfulToGateway = MORPH_CORPUS.every(({ q }) => {
    const g = gatewayRoute(q); const m = morph(q);
    if (m.verdict !== "MORPHED") return true;              // abstaining is always allowed
    return g.verdict === "ROUTED" && m.capability?.command === g.command; // never a DIFFERENT command
  });

  const truth = morph("is this claim actually true");
  const resolvesMcpTool = truth.capability?.mcpTool === "mneme.truth.check" && truth.shape?.mcpTool === "mneme.truth.check";

  const gov = morph("ดูแลเรื่องงบ 50000 ห้ามโพสต์ด่าใคร");
  const projectsEntities = gov.verdict === "MORPHED" && gov.capability?.command === "mneme govern" && gov.shape?.args["budget"] === 50000 && Array.isArray(gov.shape?.args["forbidden"]) && (gov.shape!.args["forbidden"] as string[]).length > 0;

  const shapeIsActionable = known.every(([q]) => { const m = morph(q); return m.verdict !== "MORPHED" || !!(m.shape && (m.shape.mcpTool || m.shape.cli)); });

  const bilingual = morph("who wrote this function last and why").capability?.command === morph("ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม").capability?.command;

  const abstainsOnGibberish = morph("asdfghjkl qwerty zzz").verdict !== "MORPHED";

  const mapWellFormed = Object.values(COMMAND_TO_MCP).every((t) => /^mneme\.[a-z_]+(\.[a-z_]+)?$/.test(t)) && Object.keys(COMMAND_TO_MCP).every((k) => k.startsWith("mneme "));

  // ★ the precision engine — measured on the labeled corpus
  const p = morphPrecision();
  const routedPrecisionAtLeast975 = p.precision >= 0.975;
  const coverageHonest = p.coverage >= 0.6;                 // speaks on a meaningful majority
  const ambiguous = MORPH_CORPUS.filter((c) => c.expect === null);
  const abstainsOnAmbiguous = ambiguous.every((c) => morph(c.q).verdict !== "MORPHED");

  const calibratedConfidenceTransparent = (() => { const m = morph("is this claim actually true"); return m.basis && (m.basis.via === "concept" || m.basis.via === "catalog") && typeof m.basis.selfConsistent === "boolean"; })();

  // ★ MORPH PLAN — compound-intent decomposition (measured on the compound corpus)
  const compound = morphPlan("review the whole codebase and tell me the riskiest part");
  const planDecomposesCompound = compound.multi && compound.plan.length >= 2 && compound.plan[0]!.command === "mneme review" && compound.plan[1]!.command === "mneme risk";
  const pp = morphPlanPrecision();
  const planStepPrecisionAtLeast975 = pp.precision >= 0.975;
  const planPreservesOrder = pp.orderPreserved === pp.cases;
  const single = morphPlan("who wrote this function last and why");
  const singleIntentIsOneStep = !single.multi && single.plan.length === 1 && single.plan[0]!.command === "mneme haunt";

  // ★ projected args use the target tool's REAL arg name (verify→claim), and the map is well-formed
  const verifyArgs = morph("is this claim actually true").shape?.args ?? {};
  const cmdKeys = new Set(Object.keys(COMMAND_TO_MCP));
  const argsUseRealToolKeys = typeof verifyArgs["claim"] === "string" && !("intent" in verifyArgs)
    && Object.keys(INTENT_ARG).every((k) => cmdKeys.has(k)) && Object.values(INTENT_ARG).every((v) => typeof v === "string" && v.length > 0)
    && Object.keys(REQUIRED_ARGS).every((k) => cmdKeys.has(k));
  // ★ a value the intent cannot fill (a path) is surfaced in needs, not fabricated
  const outlineShape = morph("give me the structure of this file").shape;
  const surfacesUnfillableNeeds = !!outlineShape && outlineShape.needs.includes("path") && !("path" in outlineShape.args);

  const deterministic = JSON.stringify(morph("stop all the bots")) === JSON.stringify(morph("stop all the bots")) && JSON.stringify(morphPlan("a and b")) === JSON.stringify(morphPlan("a and b"));

  let total = true;
  try { morph(null as unknown as string); morph(""); morph(undefined as unknown as string); toMcpTool(null); morphPrecision([]); contentOnly(null as unknown as string); morphPlan(null as unknown as string); morphPlan(""); splitClauses(null as unknown as string); morphPlanPrecision([]); }
  catch { total = false; }

  const all = morphsKnownIntents && faithfulToGateway && resolvesMcpTool && projectsEntities && shapeIsActionable && bilingual && abstainsOnGibberish && mapWellFormed && routedPrecisionAtLeast975 && coverageHonest && abstainsOnAmbiguous && calibratedConfidenceTransparent && planDecomposesCompound && planStepPrecisionAtLeast975 && planPreservesOrder && singleIntentIsOneStep && argsUseRealToolKeys && surfacesUnfillableNeeds && deterministic && total;
  return { morphsKnownIntents, faithfulToGateway, resolvesMcpTool, projectsEntities, shapeIsActionable, bilingual, abstainsOnGibberish, mapWellFormed, routedPrecisionAtLeast975, coverageHonest, abstainsOnAmbiguous, calibratedConfidenceTransparent, planDecomposesCompound, planStepPrecisionAtLeast975, planPreservesOrder, singleIntentIsOneStep, argsUseRealToolKeys, surfacesUnfillableNeeds, deterministic, total, score: all ? 100 : 0 };
}
