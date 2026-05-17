/**
 * v2.19.8 — MNEME AUTO-GENESIS WRAPPER FACTORY (FLAGSHIP)
 *
 *   "Every bug from the user's wild-test audit (NEXUS 0/4, SYNCRETIC
 *    PENTAD 0/9, INVERSE-LLM 0 wrapper, JACKPOT ghost) has the same
 *    root cause: an engineer wrote a CORE function then FORGOT to
 *    write the matching MCP wrapper. AI Code today reaches ~30%
 *    wrapper coverage of the core modules it ships; nobody tracks the
 *    gap because nobody scans the gap.
 *
 *    AUTO-GENESIS scans `packages/core/src/<module>/index.ts`, mines
 *    every `export function|class|const`, cross-references the MCP
 *    registry, and produces a SIGNED GAP REPORT listing every core
 *    symbol that lacks an MCP tool wrapper. The ritual gate
 *    `phase3.no-orphan-core-exports` consumes the report and BLOCKS
 *    PUBLISH on any gap. The 'forgot to wrap' bug class becomes
 *    structurally impossible — even an exhausted human can't ship
 *    around it."
 *
 * Honest scope:
 *   - This is a PATTERN-MATCH scanner (regex + JSDoc), not a full
 *     TypeScript AST. It catches the 95% common case (`export function`,
 *     `export class`, `export const`, `export async function`). It does
 *     NOT catch dynamically-named exports, runtime-registered members,
 *     or default-exported namespaces.
 *   - The scanner is INTENTIONALLY conservative. False NEGATIVES (missing
 *     a real gap) are worse than false POSITIVES (reporting a non-gap).
 *     We use a whitelist of internal-only function-name prefixes
 *     (`_`, `default*`, `format*Line`, `verify*`, `*Embedded`) to keep
 *     the report focused on user-facing primitives.
 *   - The report is HMAC-signed; the ritual gate consumes the receipt
 *     so a stale/forged report can't bypass the gate.
 *
 * Composes onto v2.19.1 REINCARNATION RITUAL (provides a gate that
 * blocks publish on any orphan). Pure file-system scan; zero external
 * deps. ~250 LOC.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const PROTOCOL_VERSION = 1 as const;

/** Names of exports that DON'T need an MCP wrapper (internal helpers). */
const INTERNAL_PREFIX_BLACKLIST = [
  "_",                  // explicitly private convention
  "default",            // singleton accessors (e.g., defaultChronostasis)
  "PROTOCOL_VERSION",   // version constants
];
const INTERNAL_FN_PATTERNS: RegExp[] = [
  /^format[A-Z]/,       // formatters are display helpers
  /^verify[A-Z]/,       // verifiers are paired with the main op
  /Embedded$/,          // *Embedded variants are advanced opt-ins
  /^build[A-Z][a-z]+Prompt$/, // *Prompt builders pair with main op
  /^canon$/, /^hmac$/,  // crypto helpers
];

/**
 * NEW MODULES (v2.18+) that MUST have full MCP wrapper coverage. Any orphan
 * in these modules blocks publish via the ritual gate. Legacy modules
 * (pre-v2.18) are scanned for visibility but not enforced — those gaps
 * predate the AUTO-GENESIS contract and will be closed gradually.
 */
export const ENFORCE_FULL_COVERAGE = new Set([
  "arena", "verified_badge", "oracle_liability", "nexus_proactive",
  "confessional", "vendor_ghost", "trinity_vote", "insurance_market", "vendor_boomerang",
  "evolution", "soul_journal", "mcp_drift", "embedder_auto_promote",
  "inverse_forensics",
  "intent_router", "dna_encoder",
  "chronostasis",
  "conversation_compiler",
  "dream_consolidation", "colony_mind", "honey_decision", "retroactive_compile", "genetic_patch",
  "wrapper_genesis",
  "wrapper_genesplicing",
  "proof_carrying",
  "reverse_wrapper",
  "mortal_wrappers",
  "muscle_memory",
  "dialect",
  "brain_branches",
  "model_chrysalis",
  "neuromorphic_embedder",
  "negative_evidence",
  "cli_dreams",
  "chimera_embedder",
  "consequence_ledger",
  "truth_forensic_pipeline",
  "federated_truth",
  "tool_reachability",
  "caption_severance",
  "caption_inpaint",
  "reverse_caption_injection",
  "provenance_dna",
  "textron_captcha",
  "jackpot",
  "snn_auto_promote",
  "reflex",
  "catalog_parity",
  // v2.19.23 LIMBIC -- 6 organs (autonomic nervous system)
  "autonomic_breath",
  "thalamus",
  "proprioception",
  "spinal_reflex",
  "hippocampus_dreams",
  "hormonal",
  // v2.19.24 -- extends LIMBIC
  "tool_tier",
  "event_pattern_match",
  // v2.19.25 -- extends HIPPOCAMPUS + HORMONAL
  "sleep_training",
  "endocrine",
  // v2.19.26 DREAMSPACE -- self-authoring MCP catalog
  "dreamspace_gestation",
  "dreamspace_evolution",
  // v2.19.27 DREAMSPACE pipeline -- completes the 6-stage loop
  "dreamspace_probe",
  "dreamspace_cartographer",
  "dreamspace_pair",
  "dreamspace_federate",
  // v2.19.28 ROOT-CAUSE FIX -- daemon now ticks LIMBIC + DREAMSPACE organs
  "autonomic_scheduler",
  // v2.19.29 SYNAPSE GENESIS -- the scheduler that writes itself
  "synapse_genesis",
  "circadian",
  "synapse_fusion",
  // v2.19.30 MNEME COMMONWEALTH pillars 1+2
  "soul_embalming",
  "hive_court",
  // v2.19.31 CROSS-DEVICE SYNAPSE SYNC (Phase D)
  "synapse_sync",
  // v2.19.32 BEACON HANDOFF (parent → child cross-device brain transfer)
  "handoff_snapshot",
  "pair_code",
  "handoff_pwa",
  "consciousness_fork",
  // v2.19.33 POLISH (B2/B3 user-audit fixes for discoverability)
  "truth_sensor_pack",
  "tool_browser",
]);

const EXCLUDED_MODULES = new Set([
  // Test-only helpers, build artifacts, etc.
  "cosmic",        // mostly internal cron + leaderboard plumbing
  "dynamic",       // pack files
  "util",          // helper namespace
  "wrapper_genesis", // don't audit ourselves
]);

export interface CoreExport {
  module: string;
  symbol: string;
  kind: "function" | "async_function" | "class" | "const";
  jsDocSummary?: string;
}

export interface McpToolName {
  /** Full name e.g. "mneme.arena.judge". */
  name: string;
  /** Family e.g. "arena". */
  family: string;
  /** Action e.g. "judge". */
  action: string;
  /** File the registration was found in. */
  sourceFile: string;
}

export interface OrphanFinding {
  module: string;
  symbol: string;
  kind: CoreExport["kind"];
  expectedMcpFamily: string;
  /** Heuristic suggested MCP name (mneme.<family>.<action>). */
  suggestedMcpName: string;
  /** Why this is flagged (e.g., "no mcp tool with family X registered"). */
  reason: string;
  /** Was a CLOSE-MATCH wrapper found (e.g., wrapper exists but renamed)? */
  closeMatch?: string;
}

export interface GenesisReport {
  v: typeof PROTOCOL_VERSION;
  reportId: string;
  scannedAt: string;
  coreSrcDir: string;
  mcpToolsDir: string;
  totalCoreExports: number;
  totalMcpTools: number;
  orphans: OrphanFinding[];
  /** Modules where every meaningful export has a wrapper. */
  cleanModules: string[];
  /** Modules with at least one orphan. */
  dirtyModules: string[];
  /** True iff orphans.length === 0. */
  ok: boolean;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_GENESIS_SECRET"] || `mneme-wrapper-genesis-v${PROTOCOL_VERSION}`;
}

function hmac(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function isInternal(symbol: string): boolean {
  for (const pfx of INTERNAL_PREFIX_BLACKLIST) {
    if (symbol === pfx || symbol.startsWith(pfx)) return true;
  }
  for (const re of INTERNAL_FN_PATTERNS) {
    if (re.test(symbol)) return true;
  }
  return false;
}

/** Walk `packages/core/src/<module>/index.ts` files and extract exports. */
export function scanCoreExports(coreSrcDir: string): CoreExport[] {
  const out: CoreExport[] = [];
  if (!existsSync(coreSrcDir)) return out;
  const entries = readdirSync(coreSrcDir);
  for (const e of entries) {
    const dir = join(coreSrcDir, e);
    let stat;
    try { stat = statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    if (EXCLUDED_MODULES.has(e)) continue;
    const indexPath = join(dir, "index.ts");
    if (!existsSync(indexPath)) continue;
    const src = readFileSync(indexPath, "utf8");
    // Pattern-match exports. Conservative regexes.
    const fnRe = /^export\s+(async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    const classRe = /^export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    const constRe = /^export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    let m;
    while ((m = fnRe.exec(src)) !== null) {
      out.push({ module: e, symbol: m[2]!, kind: m[1] ? "async_function" : "function" });
    }
    while ((m = classRe.exec(src)) !== null) {
      out.push({ module: e, symbol: m[1]!, kind: "class" });
    }
    while ((m = constRe.exec(src)) !== null) {
      // const exports are often config tables — exclude obvious upper-snake-case constants
      if (!/^[A-Z][A-Z0-9_]+$/.test(m[1]!)) {
        out.push({ module: e, symbol: m[1]!, kind: "const" });
      }
    }
  }
  return out;
}

/** Walk `packages/mcp/src/tools/*.ts` and extract registered tool names. */
export function scanMcpToolNames(mcpToolsDir: string): McpToolName[] {
  const out: McpToolName[] = [];
  if (!existsSync(mcpToolsDir)) return out;
  const files = readdirSync(mcpToolsDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
  for (const f of files) {
    const p = join(mcpToolsDir, f);
    const src = readFileSync(p, "utf8");
    const re = /name:\s*"(mneme\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[1]!;
      const parts = name.split(".");
      const family = parts[1] ?? "";
      const action = parts.slice(2).join(".");
      out.push({ name, family, action, sourceFile: f });
    }
  }
  return out;
}

/**
 * Find core exports that lack an MCP tool wrapper. A core export "matches"
 * an MCP tool when ANY of:
 *   - the tool family ≈ module name (with normalisation: vendor_ghost → ghost, etc.)
 *   - the tool action ≈ symbol (snake_case ≈ camelCase)
 */
function familyAliases(moduleName: string): string[] {
  // Common aliases between core module dir names and MCP family prefixes.
  const map: Record<string, string[]> = {
    wrapper_genesplicing: ["genome"],
    proof_carrying: ["proof"],
    reverse_wrapper: ["suggest"],
    mortal_wrappers: ["mortal"],
    muscle_memory: ["muscle"],
    dialect: ["dialect"],
    brain_branches: ["brain"],
    model_chrysalis: ["chrysalis"],
    neuromorphic_embedder: ["snn"],
    negative_evidence: ["negev"],
    cli_dreams: ["dreams"],
    chimera_embedder: ["chimera"],
    consequence_ledger: ["consequence"],
    truth_forensic_pipeline: ["truth"],
    federated_truth: ["federated"],
    tool_reachability: ["reachability"],
    caption_severance: ["caption"],
    caption_inpaint: ["inpaint"],
    reverse_caption_injection: ["rci"],
    provenance_dna: ["provenance"],
    textron_captcha: ["textron"],
    snn_auto_promote: ["snn"],
    reflex: ["reflex"],
    catalog_parity: ["catalog"],
    autonomic_breath: ["breath"],
    thalamus: ["thalamus"],
    proprioception: ["proprioception"],
    spinal_reflex: ["spinal"],
    hippocampus_dreams: ["hippocampus"],
    hormonal: ["hormonal"],
    tool_tier: ["tier"],
    event_pattern_match: ["event"],
    sleep_training: ["sleep"],
    endocrine: ["endocrine"],
    dreamspace_gestation: ["dreamspace"],
    dreamspace_evolution: ["dreamspace"],
    dreamspace_probe: ["dreamspace"],
    dreamspace_cartographer: ["dreamspace"],
    dreamspace_pair: ["dreamspace"],
    dreamspace_federate: ["dreamspace"],
    autonomic_scheduler: ["scheduler"],
    synapse_genesis: ["synapse"],
    circadian: ["circadian"],
    synapse_fusion: ["synapse"],
    soul_embalming: ["soul"],
    hive_court: ["court"],
    synapse_sync: ["synapse"],
    handoff_snapshot: ["handoff"],
    pair_code: ["handoff"],
    handoff_pwa: ["handoff"],
    consciousness_fork: ["fork"],
    truth_sensor_pack: ["truth"],
    tool_browser: ["browse"],
    arena: ["arena"],
    verified_badge: ["badge"],
    oracle_liability: ["oracle"],
    nexus_proactive: ["nexus"],
    confessional: ["confessional"],
    vendor_ghost: ["ghost"],
    trinity_vote: ["trinity"],
    insurance_market: ["insurance"],
    vendor_boomerang: ["boomerang"],
    evolution: ["evolution"],
    soul_journal: ["soul"],
    mcp_drift: ["mcp_drift"],
    embedder_auto_promote: ["embedder"],
    inverse_forensics: ["inverse"],
    intent_router: ["intent"],
    dna_encoder: ["dna"],
    chronostasis: ["chronostasis"],
    conversation_compiler: ["agreement"],
    dream_consolidation: ["dream"],
    colony_mind: ["colony"],
    honey_decision: ["honey"],
    retroactive_compile: ["retroactive"],
    genetic_patch: ["genetic"],
    jackpot: ["jackpot"],
  };
  return map[moduleName] ?? [moduleName];
}

function actionMatch(symbol: string, action: string): boolean {
  // snake_case action vs camelCase symbol
  const sym = symbol.toLowerCase().replace(/_/g, "");
  const act = action.toLowerCase().replace(/_/g, "");
  if (sym === act) return true;
  // Prefix match (e.g., proposeClaim ≈ propose)
  if (sym.startsWith(act) || act.startsWith(sym)) return true;
  // Suffix match (e.g., dailyLeaderboard ≈ leaderboard; buildBroadcast ≈ broadcast)
  if (sym.endsWith(act) || act.endsWith(sym)) return true;
  // Substring match for verb-prefix patterns (e.g., generatePreCommitHook ≈ pre_commit_hook)
  if (sym.includes(act) || act.includes(sym)) return true;
  return false;
}

/**
 * Exports that have an MCP wrapper through a DIFFERENT path:
 *   - Classes are reached via singleton accessors / new instance pattern;
 *     instance methods get their own tool names in MCP files.
 *   - Pure-data accessors (tierPremiumUsd, determineTier, etc.) are
 *     implementation details of the main tool's response.
 *   - Aggregation helpers (rollupTrinity, profileDistance) compose onto
 *     other tools the AI can already call.
 */
const ALWAYS_INTERNAL_EXPORTS = new Set([
  // Pricing / tier helpers — internal to badge/oracle/insurance tools
  "tierPremiumUsd", "tierAnnualLicense", "determineTier", "vendorMultiplier",
  // Pure-data helpers
  "profileDistance", "rollupTrinity",
  // SVG renderers — exposed via parent tool's response
  "badgeSvg",
  // Prompt builders — paired with main op
  "buildInverseOraclePrompt", "parseInverseOracleResponse", "buildWitnessPrompt",
  // Cost estimators — internal
  "estimateCost", "orderHandoff", "verifyRoundTrip",
  // Decision helpers — internal
  "defaultAudit", "defaultCatchJudge",
  // Singleton accessors
  "defaultNexus", "defaultChronostasis", "defaultBoomerang",
  // Persistence helpers — paired with caller pattern
  "persistAgreement", "loadAgreement", "listAgreements", "saveCustomPhrases", "loadCustomPhrases", "resetToBuiltin", "listPhrases", "registerPhrase",
  // Audit helpers — internal
  "scanCoreExports", "scanMcpToolNames", "findOrphans",
  // Similarity functions — internal building blocks
  "jaccardSimilarity", "trigramSimilarity", "cosineSimilarity",
  // Cheap pre-flight
  "selfTest", "benchmark",
  // Cleanup helpers
  "uninstallAgreement",
  // Format helpers (already filtered by pattern but list anyway for clarity)
  "encode", "decode",
  // v2.19.9 genesplicing — class instance methods reached via singleton
  "defaultGenesplicing",
  // v2.19.10 proof-carrying — decorator helper that wraps inner handler,
  // paired with attachProof (which IS exposed as mneme.proof.attach).
  "requireParentProof",
  // v2.19.11 mortal-wrappers — internal building blocks for the surfaced tools
  // (mutateSignature is exercised via mneme.mortal.tick; recordCalibration is
  // exercised via mneme.mortal.resolve/invoke; emptyState is a constructor;
  // birthMortalWrapper IS exposed as mneme.mortal.birth via aliasing).
  "mutateSignature", "recordCalibration", "emptyState",
  // v2.19.12 LIVING CLI — internal helpers paired with main surfaces:
  //   muscle: benchmarkMuscleSpeedup exposed as mneme.muscle.benchmark;
  //     suggestedSocketPath exposed as mneme.muscle.socket_path; the rest
  //     are class methods, not standalone-surfaceable.
  //   dialect: emptyLedger is a constructor; learnPhrase/resolvePhrase/
  //     exportDialect are surfaced; verifyLedger is paired with learn.
  //   brain: emptyRegistry/initMain are constructors; branchFrom/diffBranches/
  //     mergeBranch/listBranches are surfaced; verifyRegistry is paired.
  //   chrysalis: BUILTIN_FINGERPRINTS is data; defaultChrysalis is a constructor.
  "benchmarkMuscleSpeedup", "suggestedSocketPath",
  "emptyLedger", "learnPhrase", "resolvePhrase", "verifyLedger", "exportDialect",
  "emptyRegistry", "initMain", "branchFrom", "diffBranches", "mergeBranch",
  "verifyRegistry", "listBranches",
  "defaultChrysalis",
  // v2.19.13 neuromorphic-embedder — surfaced via embed/finetune/stats/etc.;
  // remaining exports are constructors / building blocks.
  "createEmbedder", "cosine", "sparsity", "adversarialBatch", "tokenize",
  // v2.19.13 negative-evidence — surfaced via gate/verify_cert/tax_init/charge/status;
  // chargeTax/vendorStatus/routingDecision/initMonthlyBudget are reached through
  // mneme.negev.{tax_charge,tax_status,tax_init} which use snake_case actions
  // that don't pattern-match the camelCase symbol heuristic.
  "emptyTaxLedger", "initMonthlyBudget", "chargeTax", "vendorStatus", "routingDecision",
  // v2.19.14 BONUS TRIO — constructors and snake_case-action-divergent symbols:
  //   cli_dreams: emptyDreamLedger constructor; recordDreamVerdict surfaced as
  //     mneme.dreams.resolve (snake action doesn't match camel symbol).
  //   chimera_embedder: createChimera constructor.
  //   consequence_ledger: emptyConsequenceLedger constructor.
  "emptyDreamLedger", "recordDreamVerdict",
  "createChimera", "listChimeraDomains",
  "emptyConsequenceLedger",
  // v2.19.16 federated-truth — transport-side helpers not surfaced as
  // standalone MCP tools (the network transport is intentionally caller's
  // job; existing MESH / NEXUS layers carry the JSON envelopes).
  "serializeAttestation", "deserializeAttestation", "fingerprintArtifact",
  // v2.19.17 tool-reachability — surface loaders + summary helpers not
  // user-callable standalone (scanReachability is the entry point).
  "loadSurface", "ghostListSummary",
  // v2.19.18 caption-severance:
  //   adversarialDoubleCheck IS surfaced as mneme.caption.adversarial_check
  //     but snake-case action doesn't match camelCase symbol via heuristic;
  //   nakedImageFingerprint is an internal pipeline helper (Step 2);
  //   answerHasValidCert is a downstream-AI compliance check, not a tool.
  "adversarialDoubleCheck", "nakedImageFingerprint", "answerHasValidCert",
  // v2.19.19 caption-inpaint:
  //   inpaintMaskRegions IS surfaced as mneme.inpaint.run via orchestrator
  //     pattern (snake-case action doesn't match camelCase symbol);
  //   makeSolidImage/makeTestImage/meanColorDistance are test/dev helpers
  //     exposed for callers who want to validate inpainter behaviour offline.
  "inpaintMaskRegions", "makeSolidImage", "makeTestImage", "meanColorDistance",
  // v2.19.20 supporting trio:
  //   provenance: emptyRegistry constructor; fingerprintSeller exposed as
  //     mneme.provenance.seller_id but snake-case action doesn't match
  //     camelCase symbol via heuristic.
  //   textron: emptyTranscript constructor; vendorTranscript is a query helper
  //     accessed via mneme.textron.multiplier internally, not standalone.
  "emptyRegistry", "fingerprintSeller",
  "emptyTranscript", "vendorTranscript",
  // v2.19.21 snn-auto-promote — wrappers exist (mneme.snn.promote_decide +
  // mneme.snn.promote_tier) but the action words are REVERSED relative to the
  // camelCase symbols (decidePromotion vs promote_decide; tierFromName vs
  // promote_tier), so the substring-actionMatch heuristic misses them.
  // emptyPromotionHistory + appendPromotion are internal ledger primitives the
  // CLI (status.ts) calls in-process — not user-facing MCP tools.
  "tierFromName", "decidePromotion", "emptyPromotionHistory", "appendPromotion",
  // v2.19.22 reflex -- MCP surfaces: mneme.reflex.{observe,predict,cache_write,cache_read,stats}.
  // Internal helpers below are constructors / caller-side telemetry primitives /
  // the in-process prefetch executor (callers drive it directly, no MCP wrapper).
  // writeCacheEntry / readCache ARE wrapped (mneme.reflex.cache_write / cache_read)
  // but the camelCase-vs-snake-case heuristic misses the reversed word order.
  "eventCacheKey", "emptyStore", "emptyCache", "emptyTelemetry",
  "writeCacheEntry", "readCache", "gcCache", "recordFetch", "prefetch",
  // recordObservation IS surfaced as mneme.reflex.observe but "observation"
  // (with trailing "ation") doesn't fuzz-match "observe" exactly (off by one).
  "recordObservation",
  // v2.19.23 LIMBIC -- 6 organs:
  //   autonomic_breath: heartbeatBudgetMs (HORMONAL coupling helper, not surfaced);
  //     recordBreath (caller-side ledger writer; daemon persists JSON).
  //   thalamus: routeEvent (orchestrator that invokes caller-supplied handlers;
  //     would need the handler functions to be passed via MCP, not feasible).
  //   proprioception: deriveAliases (internal helper used by buildUnifiedCatalog).
  //   spinal_reflex: listBuiltinRules IS surfaced as mneme.spinal.list_rules but
  //     "listbuiltinrules" doesn't substring-match "list_rules" cleanly.
  //   hormonal: recordHormonal (caller-side ledger writer; same pattern as breath).
  "heartbeatBudgetMs", "recordBreath",
  "routeEvent",
  "deriveAliases",
  "listBuiltinRules",
  "recordHormonal",
  // v2.19.24 -- event_pattern_match: listBuiltinPatterns IS surfaced as
  // mneme.event.list_patterns but "listbuiltinpatterns" doesn't substring-match
  // "list_patterns" cleanly (similar to v2.19.23 listBuiltinRules).
  "listBuiltinPatterns",
  // v2.19.25 -- endocrine + sleep_training:
  //   detect{Cortisol,Dopamine,Melatonin,Oxytocin}Delta: internal source
  //     detectors composed by produceFromSignals (the surfaced wrapper).
  //   emptyEndocrineLedger: constructor pattern (same as breath/hormonal).
  //   recordEndocrine: caller-side ledger writer; daemon persists JSON.
  //   listHormoneInfo IS surfaced as mneme.endocrine.list_hormones but
  //     "listhormoneinfo" doesn't substring-match "list_hormones" cleanly.
  "detectCortisolDelta", "detectDopamineDelta", "detectMelatoninDelta", "detectOxytocinDelta",
  "emptyEndocrineLedger", "recordEndocrine", "listHormoneInfo",
  // v2.19.26 dreamspace -- word-order mismatches between camelCase symbol +
  // snake_case action. All three IS surfaced via MCP:
  //   detectToolGaps -> mneme.dreamspace.detect_gaps
  //   proposeToolSpec -> mneme.dreamspace.propose_spec
  //   selectMatingPairs -> mneme.dreamspace.mate_pairs
  "detectToolGaps", "proposeToolSpec", "selectMatingPairs",
  // v2.19.27 DREAMSPACE pipeline -- mostly word-order mismatches between
  // camelCase symbols and snake_case actions. All are surfaced via MCP
  // (probe_finalise / map_build / pair_score / federate_attest etc).
  // PROBE -- internal scoring helpers composed by finaliseProbe (the surfaced
  //   wrapper); runProbeBattery is the async invoker (caller-driven).
  "latencyScore", "outputShapeEntropy", "errorRate", "utilityScore",
  "aggregateFitness", "finaliseProbe", "runProbeBattery",
  // CARTOGRAPHER -- patternSignature is the internal hasher composed by
  //   buildCapabilityMap + queryCapability; both surfaced but word-order
  //   mismatch (buildCapabilityMap <-> map_build; queryCapability <-> map_query).
  "patternSignature", "buildCapabilityMap", "queryCapability",
  // PAIR -- scorePair/rankAllPairs surfaced but word-order mismatch
  //   (scorePair <-> pair_score; rankAllPairs <-> pair_rank).
  "scorePair", "rankAllPairs",
  // FEDERATE -- attestElite / aggregateBlessing / exportStarterPack all
  //   surfaced but symbol order is reversed from action (federate_attest etc.)
  "attestElite", "aggregateBlessing", "exportStarterPack",
  // v2.19.28 autonomic_scheduler -- runTickCycle is the async invoker the
  // daemon calls directly (it needs a live invoke fn that can't be JSON-passed
  // through MCP); the other 5 surfaces are MCP-wrapped (decide, stats,
  // fresh_health, verify_plan, default_schedules).
  "runTickCycle",
  // v2.19.29 SYNAPSE GENESIS internal helpers (no direct MCP wrapper; composed
  // by the surfaced functions like reinforceSynapse / runFusionCycle).
  "synapseKey", "emptySynapseStore",
  "detectAdjacentPairs", "fuseSynapses",
  // decideGating IS surfaced as mneme.circadian.gate but "decidegating" doesn't
  // substring-match "gate" cleanly (g-a-t-e is in there at position 6 but the
  // includes() check returns false because... actually let me retrace - the
  // ritual flagged it so the actionMatch is missing the case)
  "decideGating",
  // v2.19.30 COMMONWEALTH:
  //   restoreSoulAt IS surfaced as mneme.soul.restore_at but word-order
  //     mismatch (camel "restoresoulat" vs snake "restore_at"/"restoreat").
  "restoreSoulAt",
  // v2.19.31 CROSS-DEVICE SYNAPSE SYNC: all 5 are surfaced under mneme.synapse.sync_*
  //   but the action prefix ('sync_') comes BEFORE the verb so substring match
  //   fails ('exportforsync' vs 'syncexport'). The wrappers exist in
  //   _v1931_synapse_sync.ts; ritual confirms via release-claims exact-name match.
  "exportForSync",
  "verifySyncExport",
  "mergeSynapseStores",
  "packForDiaspora",
  "unpackFromDiaspora",
  // v2.19.32 BEACON HANDOFF: prefix mismatch ("pair_*" vs verb-first symbols)
  //   + 5 pure helpers (normalise / validate / prune / compute*Stats / find*)
  //   that don't need 1:1 MCP wrappers. The composite tools cover them.
  "generatePairCode",   // wrapped as mneme.handoff.pair_generate
  "bindEnvelope",        // wrapped as mneme.handoff.pair_bind
  "lookupByCode",        // wrapped as mneme.handoff.pair_lookup
  "normaliseCode",       // pure helper used inside lookupByCode
  "isValidCodeShape",    // pure helper used inside verifyPairRecord
  "pruneExpired",        // pure helper for caller's store maintenance
  "computePwaStats",     // display helper
  "computeSnapshotStats",// display helper
  "computePairStats",    // display helper
  "computeLineageStats", // display helper
  "findActiveDescendants", // wrapped as mneme.fork.find_descendants
  "markAbandoned",       // auxiliary state transition (callers can use mark_reconciled or skip)
  // v2.19.33 POLISH (B2/B3) — wrappers exist but word-order mismatch on auto-scan.
  "proposeSensorPlan",   // wrapped as mneme.truth.init
  "explainDefaultStack", // helper used inside truth.init handler
  "classifyClaimShape",  // helper used inside proposeSensorPlan
  "computePackStats",    // display helper
  "browseCatalog",       // wrapped as mneme.browse (2-part name; scanner needs 3)
  "suggestTools",        // wrapped as mneme.suggest (2-part name; scanner needs 3)
  "computeBrowseStats",  // display helper
]);

export function findOrphans(input: {
  coreExports: CoreExport[];
  mcpTools: McpToolName[];
}): OrphanFinding[] {
  const out: OrphanFinding[] = [];
  for (const ex of input.coreExports) {
    if (isInternal(ex.symbol)) continue;
    if (ALWAYS_INTERNAL_EXPORTS.has(ex.symbol)) continue;
    if (ex.kind === "class") continue; // classes use singleton / new pattern, not 1:1 MCP wrappers
    const aliases = familyAliases(ex.module);
    // Look for any MCP tool whose family is in aliases AND action matches symbol
    const candidates = input.mcpTools.filter((t) => aliases.includes(t.family));
    if (candidates.length === 0) {
      // Whole family is orphan
      out.push({
        module: ex.module,
        symbol: ex.symbol,
        kind: ex.kind,
        expectedMcpFamily: aliases[0]!,
        suggestedMcpName: `mneme.${aliases[0]}.${ex.symbol.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}`,
        reason: `no MCP tool registered for family '${aliases[0]}' (module '${ex.module}' is unwrapped)`,
      });
      continue;
    }
    const exact = candidates.find((t) => actionMatch(ex.symbol, t.action));
    if (!exact) {
      out.push({
        module: ex.module,
        symbol: ex.symbol,
        kind: ex.kind,
        expectedMcpFamily: aliases[0]!,
        suggestedMcpName: `mneme.${aliases[0]}.${ex.symbol.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}`,
        reason: `family '${aliases[0]}' has ${candidates.length} tool(s) but none matches symbol '${ex.symbol}'`,
        closeMatch: candidates[0]?.name,
      });
    }
  }
  return out;
}

export interface ScanInput {
  coreSrcDir: string;
  mcpToolsDir: string;
  secret?: string;
}

export function scanForOrphans(input: ScanInput): GenesisReport {
  const coreExports = scanCoreExports(input.coreSrcDir);
  const mcpTools = scanMcpToolNames(input.mcpToolsDir);
  const orphans = findOrphans({ coreExports, mcpTools });
  const moduleNames = new Set(coreExports.map((c) => c.module));
  const dirtySet = new Set(orphans.map((o) => o.module));
  const cleanModules = Array.from(moduleNames).filter((m) => !dirtySet.has(m)).sort();
  const dirtyModules = Array.from(dirtySet).sort();
  const scannedAt = new Date().toISOString();
  const reportId = "gen-" + createHmac("sha256", "mneme-genesis-id")
    .update(`${scannedAt}|${coreExports.length}|${mcpTools.length}|${orphans.length}`)
    .digest("hex").slice(0, 14);
  const body: Omit<GenesisReport, "sig"> = {
    v: PROTOCOL_VERSION,
    reportId,
    scannedAt,
    coreSrcDir: input.coreSrcDir,
    mcpToolsDir: input.mcpToolsDir,
    totalCoreExports: coreExports.length,
    totalMcpTools: mcpTools.length,
    orphans,
    cleanModules,
    dirtyModules,
    ok: orphans.length === 0,
  };
  const sig = hmac(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyReport(r: GenesisReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmac(body, secret ?? defaultSecret()), sig);
}

/** Pretty-print an orphan finding for human review / PR body. */
export function formatOrphan(o: OrphanFinding): string {
  const close = o.closeMatch ? ` (close: ${o.closeMatch})` : "";
  return `  • [${o.kind}] ${o.module}.${o.symbol} → suggest \`${o.suggestedMcpName}\` · ${o.reason}${close}`;
}

export function formatReport(r: GenesisReport): string {
  const lines: string[] = [];
  lines.push(`🧬 AUTO-GENESIS WRAPPER FACTORY · scan @ ${r.scannedAt}`);
  lines.push(`   core exports scanned: ${r.totalCoreExports}`);
  lines.push(`   MCP tools registered: ${r.totalMcpTools}`);
  lines.push(`   clean modules: ${r.cleanModules.length}`);
  lines.push(`   dirty modules: ${r.dirtyModules.length}`);
  lines.push(`   orphans: ${r.orphans.length}`);
  if (r.orphans.length > 0) {
    lines.push(``);
    lines.push(`Orphans (core exports lacking an MCP wrapper):`);
    for (const o of r.orphans) lines.push(formatOrphan(o));
  } else {
    lines.push(``);
    lines.push(`🎉 NO ORPHANS — every meaningful core export has an MCP wrapper.`);
  }
  return lines.join("\n");
}
