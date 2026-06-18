/**
 * v3.103.0 — MORPH: the polymorphic MCP tool (the "ferrofluid plug").
 *
 * THE PROBLEM IT SOLVES (the load-bearing adoption weakness): an AI agent that
 * connects to Mneme — Cursor, Cline, Windsurf, Claude Code, anything — is faced
 * with 600+ static MCP tools it has never seen. It cannot know which verb serves
 * the moment, so most of Mneme sits installed-but-idle. Every other MCP server
 * dumps its whole tool surface and hopes the agent guesses right.
 *
 * THE IDEA (the honest realization of the "schema-morphing plug"): expose ONE
 * self-describing tool the agent learns once — `mneme.morph`. The agent states
 * its intent in free natural language (any language, EN/Thai); MORPH "morphs"
 * that intent into the RIGHT Mneme capability and hands back a typed CONTACT
 * SURFACE — the exact MCP tool to call next, a runnable CLI invocation, and the
 * args projected from the sentence — plus a CLARIFY when it is unsure. The agent
 * never memorizes the catalog; it describes what it wants and gets the shaped
 * next call. One plug that re-forms to fit whatever the caller needs.
 *
 * WHY IT IS NOVEL (and not just the Gateway again): the Intent Gateway resolves
 * NL → a command STRING. MORPH adds the three things that make a single tool an
 * agent's front door: (1) it resolves the concrete MCP TOOL name (not just the
 * CLI verb), (2) it PROJECTS the detected entities into a ready-to-send args
 * object — the "interface shaped to the request", and (3) the resolution is
 * bound into an offline-verifiable signed morph-receipt at the MCP boundary, so
 * the morph is auditable, not a black box. It composes the Gateway + the command
 * manifest — refinement, not a new silo.
 *
 * DIAKRISIS — the honest ceiling: the "morphing" is DETERMINISTIC intent →
 * capability resolution + entity projection (it reuses the measured Gateway
 * router and the manifest), NOT runtime code generation and NOT model magic.
 * MORPH never invents a capability the Gateway did not route to (the gauntlet
 * proves faithfulness), it ABSTAINS (CLARIFY/UNKNOWN) rather than misfire, and
 * the args projection is a best-effort starting point the agent maps onto the
 * target tool's own schema — not a guarantee of every arg name. The CLI→MCP map
 * is a curated, deterministic table (an unmapped command returns mcpTool=null and
 * the agent uses the CLI invocation). Pure + deterministic + total.
 */

import { route as gatewayRoute, type GatewayResult } from "../intent_gateway/index.js";
import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../agent_manifest.js";

/**
 * Curated, deterministic CLI-command → MCP-tool-name map for the high-value
 * capabilities (the same intents the Gateway concept-map curates). An agent over
 * MCP wants the tool NAME, not the shell verb. Best-effort: a command absent here
 * resolves to mcpTool=null and the agent falls back to the CLI invocation.
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
});

/** Resolve a CLI command to its MCP tool name (or null when unmapped). Total. */
export function toMcpTool(command: string | null | undefined): string | null {
  if (typeof command !== "string") return null;
  const key = command.trim().split(/\s+/).slice(0, 2).join(" ");
  return COMMAND_TO_MCP[key] ?? COMMAND_TO_MCP[command.trim()] ?? null;
}

export type MorphVerdict = "MORPHED" | "CLARIFY" | "UNKNOWN";

export interface MorphCapability {
  command: string;          // the resolved CLI command (e.g. "mneme telos")
  mcpTool: string | null;   // the concrete MCP tool to call (e.g. "mneme.drift.analyze")
  what: string;             // manifest summary of the capability
  when: string;             // manifest "when to use"
  since: string;
  group: string;
}

/** The typed contact surface — the "plug shaped to the request": the exact next
 *  call the agent should make, with args projected from the sentence. */
export interface MorphShape {
  mcpTool: string | null;
  cli: string | null;
  /** Best-effort args projected from the detected entities + the raw intent.
   *  The agent maps these onto the target tool's own input schema. */
  args: Record<string, unknown>;
}

export interface MorphCandidate { command: string; mcpTool: string | null; score: number }

export interface MorphResult {
  verdict: MorphVerdict;
  intent: string;
  capability: MorphCapability | null;
  confidence: number;
  candidates: MorphCandidate[];
  shape: MorphShape | null;
  entities: GatewayResult["entities"];
  note: string;
}

const NOTE =
  "MORPH is a single polymorphic surface: state an intent, get the shaped next call (MCP tool + CLI + projected args), signed. Deterministic intent→capability resolution over the measured Gateway + the manifest — it abstains (CLARIFY/UNKNOWN) rather than misfire, and never invents a capability the Gateway did not route to.";

function catalogEntry(command: string, catalog: ManifestCommand[]): ManifestCommand | null {
  // exact match first, then the 2-token CLI prefix (e.g. "mneme telos")
  const exact = catalog.find((c) => c.command === command);
  if (exact) return exact;
  const key = command.trim().split(/\s+/).slice(0, 2).join(" ");
  return catalog.find((c) => c.command === key) ?? catalog.find((c) => c.command.startsWith(key)) ?? null;
}

/** Project the detected entities + the raw intent into a best-effort args object. */
function projectArgs(intent: string, entities: GatewayResult["entities"]): Record<string, unknown> {
  const args: Record<string, unknown> = { intent: String(intent ?? "").slice(0, 500) };
  try {
    if (typeof entities?.budget === "number") args["budget"] = entities.budget;
    if (Array.isArray(entities?.forbidden) && entities.forbidden.length) args["forbidden"] = entities.forbidden;
    if (Array.isArray(entities?.scope) && entities.scope.length) args["scope"] = entities.scope;
  } catch { /* */ }
  return args;
}

/**
 * Morph a free-text intent into the right Mneme capability + a typed next-call
 * surface. Composes the Gateway router (resolution + abstention + entities) with
 * the manifest (the capability's what/when) and the CLI→MCP map. The verdict
 * mirrors the Gateway: ROUTED→MORPHED, CLARIFY→CLARIFY, UNKNOWN→UNKNOWN — MORPH
 * never routes to a capability the Gateway did not. Pure + deterministic + total.
 */
export function morph(intent: string, opts?: { catalog?: ManifestCommand[]; minConfidence?: number }): MorphResult {
  try {
    const catalog = Array.isArray(opts?.catalog) ? opts!.catalog! : MNEME_COMMAND_CATALOG;
    const r = gatewayRoute(intent, { catalog, ...(typeof opts?.minConfidence === "number" ? { minConfidence: opts.minConfidence } : {}) });
    const intentStr = String(intent ?? "");

    const candidates: MorphCandidate[] = (r.candidates ?? []).map((c) => ({ command: c.command, mcpTool: toMcpTool(c.command), score: c.score }));

    if (r.verdict !== "ROUTED" || !r.command) {
      return { verdict: r.verdict === "CLARIFY" ? "CLARIFY" : "UNKNOWN", intent: intentStr, capability: null, confidence: r.confidence, candidates, shape: null, entities: r.entities, note: NOTE };
    }

    const entry = catalogEntry(r.command, catalog);
    const mcpTool = toMcpTool(r.command);
    const capability: MorphCapability = {
      command: r.command,
      mcpTool,
      what: entry?.what ?? "",
      when: entry?.when ?? "",
      since: entry?.since ?? "",
      group: entry?.group ?? "",
    };
    const shape: MorphShape = { mcpTool, cli: r.invocation ?? r.command, args: projectArgs(intentStr, r.entities) };

    return { verdict: "MORPHED", intent: intentStr, capability, confidence: r.confidence, candidates, shape, entities: r.entities, note: NOTE };
  } catch {
    return { verdict: "UNKNOWN", intent: String(intent ?? ""), capability: null, confidence: 0, candidates: [], shape: null, entities: {}, note: NOTE };
  }
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface MorphGauntlet {
  morphsKnownIntents: boolean;     // EN+Thai intents resolve to the expected capability
  faithfulToGateway: boolean;      // MORPH never invents a capability the Gateway didn't route to
  resolvesMcpTool: boolean;        // a resolved capability carries its concrete MCP tool name
  projectsEntities: boolean;       // budget/forbidden land in the shaped args
  shapeIsActionable: boolean;      // a MORPHED result always carries a non-empty next call (mcpTool or cli)
  bilingual: boolean;              // same intent EN/Thai → same capability
  abstainsOnGibberish: boolean;    // garbage → CLARIFY/UNKNOWN, never MORPHED
  mapWellFormed: boolean;          // every CLI→MCP entry is a valid mneme.* tool name
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function morphGauntlet(): MorphGauntlet {
  // 1) morphs known EN + Thai intents to the expected capability
  const known: [string, string][] = [
    ["stop all the bots, something feels off", "mneme govern"],
    ["who wrote this function last and why", "mneme haunt"],
    ["ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม", "mneme haunt"],
    ["is this claim actually true", "mneme verify"],
    ["check if our agents are drifting from their mission", "mneme telos"],
  ];
  const morphsKnownIntents = known.every(([q, exp]) => { const m = morph(q); return m.verdict === "MORPHED" && m.capability?.command === exp; });

  // 2) faithful: for the same input, MORPH's command == the Gateway's routed command (no drift)
  const faithfulToGateway = known.every(([q]) => {
    const g = gatewayRoute(q); const m = morph(q);
    if (g.verdict !== "ROUTED") return m.verdict !== "MORPHED";
    return m.capability?.command === g.command;
  });

  // 3) resolves the concrete MCP tool name for a mapped capability
  const truth = morph("is this claim actually true");
  const resolvesMcpTool = truth.capability?.mcpTool === "mneme.truth.check" && truth.shape?.mcpTool === "mneme.truth.check";

  // 4) projects entities into the shaped args
  const gov = morph("ดูแลเรื่องงบ 50000 ห้ามโพสต์ด่าใคร");
  const projectsEntities = gov.verdict === "MORPHED" && gov.capability?.command === "mneme govern" && (gov.shape?.args["budget"] === 50000) && Array.isArray(gov.shape?.args["forbidden"]) && (gov.shape!.args["forbidden"] as string[]).length > 0;

  // 5) a MORPHED result always hands back an actionable next call
  const shapeIsActionable = known.every(([q]) => { const m = morph(q); return m.verdict !== "MORPHED" || !!(m.shape && (m.shape.mcpTool || m.shape.cli)); });

  // 6) bilingual
  const bilingual = morph("who wrote this function last and why").capability?.command === morph("ใครแก้ฟังก์ชันนี้ล่าสุดและทำไม").capability?.command;

  // 7) abstains on gibberish
  const gib = morph("asdfghjkl qwerty zzz");
  const abstainsOnGibberish = gib.verdict !== "MORPHED";

  // 8) the CLI→MCP map is well-formed (every value a valid mneme.* tool name)
  const mapWellFormed = Object.values(COMMAND_TO_MCP).every((t) => /^mneme\.[a-z_]+(\.[a-z_]+)?$/.test(t)) && Object.keys(COMMAND_TO_MCP).every((k) => k.startsWith("mneme "));

  // 9) deterministic
  const deterministic = JSON.stringify(morph("stop all the bots")) === JSON.stringify(morph("stop all the bots"));

  // 10) total — garbage never throws
  let total = true;
  try { morph(null as unknown as string); morph(""); morph(undefined as unknown as string); toMcpTool(null); }
  catch { total = false; }

  const all = morphsKnownIntents && faithfulToGateway && resolvesMcpTool && projectsEntities && shapeIsActionable && bilingual && abstainsOnGibberish && mapWellFormed && deterministic && total;
  return { morphsKnownIntents, faithfulToGateway, resolvesMcpTool, projectsEntities, shapeIsActionable, bilingual, abstainsOnGibberish, mapWellFormed, deterministic, total, score: all ? 100 : 0 };
}
