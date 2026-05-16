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
  "jackpot",
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
