/**
 * Tool registry — collects all category modules into one ordered list +
 * a fast lookup map. Each category file exports a `tools: MnemeTool[]`
 * array; the registry concatenates them and surfaces them to the MCP
 * server as one flat catalog (with namespaced names like
 * `mneme.people.atrophy` for AI client navigation).
 */

import type { MnemeTool, ToolCategory } from "./_types.js";

import { memoryTools } from "./memory.js";
import { peopleTools } from "./people.js";
import { auditTools } from "./audit.js";
import { forensicsTools } from "./forensics.js";
import { insightsTools } from "./insights.js";
import { qualityTools } from "./quality.js";
import { quantTools } from "./quant.js";
import { labTools } from "./lab.js";
import { metaTools } from "./meta.js";
import { capabilitiesTool } from "./_capabilities.js";
import { smartDoTool } from "./_smart_do.js";
import { graderTool } from "./_grader_tool.js";
import { understandIntentTool } from "./_intent_tool.js";
import { constitutionTool } from "./_constitution_tool.js";
import { verifyClaimsTool } from "./_verify_claims_tool.js";
import { truthCheckTool } from "./_truth_check.js";
import { TIER_TOOLS } from "./_tier_tools.js";
import { PATH_TOOLS } from "./_path_tools.js";
import { COGNITIVE_TOOLS } from "./_cognitive_tools.js";
import { APOPTOSIS_TOOLS } from "./_apoptosis_tools.js";
import { TUNE_TOOLS } from "./_tune_tools.js";
import { AUTARCHY_TOOLS } from "./_autarchy_tools.js";
import { AEGIS_TOOLS } from "./_aegis_tools.js";
import { MCP_FUZZER_TOOLS } from "./_mcp_fuzzer_tools.js";
import { CODEGRAPH_TOOLS } from "./_codegraph_tools.js";
import { N4_MISSING_TOOLS } from "./_n4_missing_tools.js";
import { N7_N11_GOVERNANCE_TOOLS } from "./_n7_n11_governance.js";
import { PEAK_GAUNTLET_TOOLS } from "./_peak_gauntlet_tools.js";
import { TRUTH_GATE_TOOLS } from "./_truth_gate_tools.js";
import { CONCLAVE_TOOLS } from "./_conclave_tools.js";
import { HONEST_MIRROR_TOOLS } from "./_honest_mirror_tools.js";
import { REWIND_TOOLS } from "./_rewind_tools.js";
import { HGP_TOOLS } from "./_hgp_tools.js";
import { FLYWHEEL_TOOLS } from "./_flywheel_tools.js";
import { CITIZEN_COURT_TOOLS } from "./_citizen_court_tools.js";
import { MNEMNET_TOOLS } from "./_mnemnet_tools.js";
import { PULSECOST_TOOLS } from "./_pulsecost_tools.js";
import { COERCION_AUDIT_TOOLS } from "./_coercion_audit_tools.js";
import { ZZZZZ_TOOLS } from "./_zzzzz_tools.js";
import { ARGUS10_TOOLS } from "./_argus10_tools.js";
import { AUTO_INIT_TOOLS } from "./_auto_init_tools.js";
import { NEMESIS_TOOLS } from "./_nemesis_tools.js";
import { SKELETON_KEY_TOOLS } from "./_skeleton_key_tools.js";
import { CAPABILITY_PASSPORT_TOOLS } from "./_passport_tools.js";
import { MIRRAGE_TOOLS } from "./_mirrage_tools.js";
import { TIME_CRYSTAL_TOOLS } from "./_time_crystal_tools.js";
import { DIFF_ARENA_TOOLS } from "./_diff_arena_tools.js";
import { SWARM_BUS_TOOLS } from "./_swarm_bus_tools.js";
import { REFLOG_TOOLS } from "./_reflog_tools.js";
import { CHRONOS_TOOLS } from "./_chronos_tools.js";
import { NOTARY_TOOLS } from "./_notary_tools.js";
import { HYDRA_TOOLS } from "./_hydra_tools.js";
import { WISDOM_TOOLS } from "./_wisdom_tools.js";
import { CORTEX_TOOLS } from "./_cortex_tools.js";
import { SHELL_TOOLS } from "./_shell_tools.js";
import { DIG_TOOLS } from "./_dig_tools.js";
import { ENTROPY_TOOLS } from "./_entropy_tools.js";
import { LOGPIPE_TOOLS } from "./_logpipe_tools.js";
import { LOOPGUARD_TOOLS } from "./_loopguard_tools.js";
import { DISTILL_TOOLS } from "./_distill_tools.js";
import { NKL_TOOLS } from "./_nkl_tools.js";
import { TREASURY_TOOLS } from "./_treasury_tools.js";
import { VISUAL_TOOLS } from "./_visual_tools.js";
import { EGRESS_TOOLS } from "./_egress_tools.js";
import { EXEC_TOOLS } from "./_exec_tools.js";
import { BEQUEST_TOOLS } from "./_bequest_tools.js";
import { OUTLINE_TOOLS } from "./_outline_tools.js";
import { SCAFFOLD_TOOLS } from "./_scaffold_tools.js";
import { BLIND_TOOLS } from "./_blind_tools.js";
import { CHANNEL_TOOLS } from "./_channel_tools.js";
import { SETTLEMENT_TOOLS } from "./_settlement_tools.js";
import { FLIGHT_RECORDER_TOOLS } from "./_flight_tools.js";
import { CREDITSCORE_TOOLS } from "./_creditscore_tools.js";
import { TRUSTFABRIC_V282_TOOLS } from "./_trustfabric_v282_tools.js";
import { GEPHYRA_TOOLS } from "./_gephyra_tools.js";
import { HEPHAESTUS_TOOLS } from "./_hephaestus_tools.js";
import { SAVANT_TOOLS } from "./_savant_tools.js";
import { ASCENSION_TOOLS } from "./_ascension_tools.js";
import { HYPERSCAN_TOOLS } from "./_hyperscan_tools.js";
import { PRECOG_TOOLS } from "./_precog_tools.js";
import { SENTINEL_TOOLS } from "./_sentinel_tools.js";
import { DIASPORA_TOOLS } from "./_diaspora_tools.js";
import { GENESPLICE_TOOLS } from "./_genesplice_tools.js";
import { PERMEATE_TOOLS } from "./_permeate_tools.js";
import { TELEPATHY_TOOLS } from "./_telepathy_tools.js";
import { ABYSS_TOOLS } from "./_abyss_tools.js";
import { SEAMLESS_TOOLS } from "./_seamless_tools.js";
import { LATTICE_TOOLS } from "./_lattice_tools.js";
import { NEURON_TOOLS } from "./_neuron_tools.js";
import { CONDUIT_TOOLS } from "./_conduit_tools.js";
import { SYNAPSE_TOOLS } from "./_synapse_tools.js";
import { OSMOSIS_TOOLS } from "./_osmosis_tools.js";
import { AURA_TOOLS } from "./_aura_tools.js";
import { RELAY_TOOLS } from "./_relay_tools.js";
import { CHAMELEON_TOOLS } from "./_chameleon_tools.js";
import { ANCHOR_TOOLS } from "./_anchor_tools.js";
import { RAINBOW_TOOLS } from "./_rainbow_tools.js";
import { ORPHANS_TOOLS } from "./_orphans_tools.js";
import { TRUTH_WORMHOLE_TOOLS } from "./_truth_wormhole_tools.js";
import { METRON_TOOLS } from "./_metron_tools.js";
import { V28_TOOLS } from "./_v28_tools.js";
import { CLONE_TO_TOOLS } from "./_clone_to_tool.js";
import { BEACON_TOOLS } from "./_beacon_tool.js";
import { CLONE_TOOLS } from "./_clone_tools.js";
import { NEXUS_LOCK_TOOLS } from "./_nexus_lock_tools.js";
import { COSMIC_TOOLS } from "./_cosmic_tools.js";
import { V214_PENTAD_TOOLS } from "./_v214_pentad.js";
import { V215_HYPERCAR_TOOLS } from "./_v215_hypercar.js";
import { V216_REVOLUTIONARY_TOOLS } from "./_v216_revolutionary.js";
import { V218_REVOLUTIONARY_TOOLS } from "./_v218_revolutionary.js";
import { V219_SYNCRETIC_TOOLS } from "./_v219_syncretic.js";
import { V192_EVOLUTION_TOOLS } from "./_v192_evolution.js";
import { V193_INVERSE_TOOLS } from "./_v193_inverse.js";
import { V194_INTENT_DNA_TOOLS } from "./_v194_intent_dna.js";
import { V195_CHRONOSTASIS_TOOLS } from "./_v195_chronostasis.js";
import { V196_AGREEMENT_TOOLS } from "./_v196_agreement.js";
import { V197_MEGAPACK_TOOLS } from "./_v197_megapack.js";
import { V198_ORPHAN_CLOSURE_TOOLS } from "./_v198_orphan_closure.js";
import { V199_GENESPLICING_TOOLS } from "./_v199_genesplicing.js";
import { V1910_PROOF_REVERSE_TOOLS } from "./_v1910_proof_reverse.js";
import { V1911_MORTAL_TOOLS } from "./_v1911_mortal.js";
import { V1912_LIVING_CLI_TOOLS } from "./_v1912_living_cli.js";
import { V1913_LIVING_CLI_P23_TOOLS } from "./_v1913_living_cli_p23.js";
import { V1914_BONUS_TOOLS } from "./_v1914_bonus.js";
import { V1915_TRUTH_FORENSIC_TOOLS } from "./_v1915_truth_forensic.js";
import { V1916_FEDERATED_TRUTH_TOOLS } from "./_v1916_federated_truth.js";
import { V1917_TOOL_REACHABILITY_TOOLS } from "./_v1917_tool_reachability.js";
import { V1918_CAPTION_SEVERANCE_TOOLS } from "./_v1918_caption_severance.js";
import { V1919_CAPTION_INPAINT_TOOLS } from "./_v1919_caption_inpaint.js";
import { V1920_CAPTION_TRIO_TOOLS } from "./_v1920_caption_trio.js";
import { V1921_GAP_CLOSER_TOOLS } from "./_v1921_gap_closer.js";
import { V1922_REFLEX_TOOLS } from "./_v1922_reflex.js";
import { V1923_LIMBIC_TOOLS } from "./_v1923_limbic.js";
import { V1924_TIER_EVENT_TOOLS } from "./_v1924_tier_event.js";
import { V1925_SLEEP_ENDOCRINE_TOOLS } from "./_v1925_sleep_endocrine.js";
import { V1926_DREAMSPACE_TOOLS } from "./_v1926_dreamspace.js";
import { V1927_DREAMSPACE_PIPELINE_TOOLS } from "./_v1927_dreamspace_pipeline.js";
import { V1928_SCHEDULER_TOOLS } from "./_v1928_scheduler.js";
import { V1929_SYNAPSE_GENESIS_TOOLS } from "./_v1929_synapse_genesis.js";
import { V1930_COMMONWEALTH_TOOLS } from "./_v1930_commonwealth.js";
import { V1931_SYNAPSE_SYNC_TOOLS } from "./_v1931_synapse_sync.js";
import { V1932_HANDOFF_TOOLS } from "./_v1932_handoff.js";
import { V1933_POLISH_TOOLS } from "./_v1933_polish.js";
import { V1934_HOLY_GRAIL_TOOLS } from "./_v1934_holy_grail.js";
import { V1935_HONESTY_TOOLS } from "./_v1935_honesty.js";
import { V1937_TALK_OF_TOWN_TOOLS } from "./_v1937_talk_of_town.js";
import { V1938_SOCKETS_TOOLS } from "./_v1938_sockets.js";
import { V1940_WIRING_TRINITY_TOOLS } from "./_v1940_wiring_trinity.js";
import { V1942_ALIAS_TOOLS } from "./_v1942_discoverability_aliases.js";
import { V1942_PROOF_INVERSION_TOOLS } from "./_v1942_proof_inversion.js";
import { V1944_OSMOSIS_TOOLS } from "./_v1944_osmosis.js";
import { V1948_CHRONOSHEAF_TOOLS } from "./_v1948_chronosheaf.js";
import { V1949_CHRONOSHEAF_P5_TOOLS } from "./_v1949_chronosheaf_p5.js";
import { dnaSearchTool } from "./_dna_tool.js";
import { genomeTools } from "./_genome_tools.js";
import { toolMetaTools } from "./_tool_meta.js";
import { adversaryTool } from "./_court.js";
import { confessTool } from "./_confess.js";
import { replayTools } from "./_replay.js";
import { timeTravelTools } from "./_timetravel.js";
import { genomeMarketplaceTools } from "./_genome_marketplace.js";
import { aletheiaTools, honeypotTools } from "./_aletheia.js";
import { meshTools } from "./_mesh.js";
import { lineageTools } from "./_lineage.js";
import { systemUpgradeTool, systemHealthTool } from "./_upgrade.js";
import { botSpawnTool } from "./_squadron.js";
import { nucleusTools } from "./_nucleus.js";
import { inboxTools } from "./_inbox.js";
import { antivirusTools } from "./_antivirus.js";
import { whatsNewTool } from "./_whats_new.js";
import { retrievalLabTools } from "./_retrieval_lab.js";
import { V1952_CACHE_COALESCE_TOOLS } from "./_v1952_cache_coalesce.js";
import { V1953_INSTALL_ORGAN_TOOLS } from "./_v1953_install_organ.js";
import { V1955_OPTIONAL_NATIVE_TOOLS } from "./_v1955_optional_native.js";
import { V1957_SHEPHERD_TOOLS } from "./_v1957_shepherd.js";
import { V1960_PUBLISH_VERIFIER_TOOLS } from "./_v1960_publish_verifier.js";
import { V1961_DLL_EVICTION_TOOLS } from "./_v1961_dll_eviction.js";
import { V1962_PHOENIX_TOOLS } from "./_v1962_phoenix.js";
import { V1963_HARDENING_TOOLS } from "./_v1963_hardening.js";
import { V1964_WASM_CHRYSALIS_TOOLS } from "./_v1964_wasm_chrysalis.js";

// v2.19.51 — module-level memo for the catalog spread. Pure function;
// only changes when the source tree changes (npm install / hot-reload).
// 30s TTL: short enough to pick up dev-loop edits in `tsc -b -w`,
// long enough that 50-parallel verify storms hit the cache 49 times.
// Caches a FROZEN snapshot so callers can't mutate the cached array.
let _allToolsCache: { tools: readonly MnemeTool[]; ts: number } | null = null;
const ALL_TOOLS_TTL_MS = 30_000;

/** For tests + ritual cleanup. Clears the memo. */
export function _resetBuildAllToolsCache(): void { _allToolsCache = null; }

/** All Mneme tools, in display order. The capabilities syllabus comes first
 *  so AI clients that read tool lists top-down see it immediately.
 *
 *  v2.19.51: memoized for ALL_TOOLS_TTL_MS to kill the 9x parallel-verify
 *  regression. Returns a defensive copy so callers can sort/mutate without
 *  poisoning the cache. */
export function buildAllTools(): MnemeTool[] {
  const now = Date.now();
  if (_allToolsCache && (now - _allToolsCache.ts) < ALL_TOOLS_TTL_MS) {
    return _allToolsCache.tools.slice();
  }
  const fresh = _buildAllToolsUncached();
  _allToolsCache = { tools: Object.freeze(fresh.slice()), ts: now };
  return fresh;
}

function _buildAllToolsUncached(): MnemeTool[] {
  return [
    capabilitiesTool,
    understandIntentTool,
    graderTool,
    verifyClaimsTool,
    truthCheckTool,
    ...TIER_TOOLS,
    ...PATH_TOOLS,
    ...COGNITIVE_TOOLS,
    ...APOPTOSIS_TOOLS,
    ...TUNE_TOOLS,
    ...AUTARCHY_TOOLS,
    ...AEGIS_TOOLS,
    ...MCP_FUZZER_TOOLS,
    ...CODEGRAPH_TOOLS,
    ...N4_MISSING_TOOLS,
    ...N7_N11_GOVERNANCE_TOOLS,
    ...PEAK_GAUNTLET_TOOLS,
    ...TRUTH_GATE_TOOLS,
    ...CONCLAVE_TOOLS,
    ...HONEST_MIRROR_TOOLS,
    ...REWIND_TOOLS,
    ...HGP_TOOLS,
    ...FLYWHEEL_TOOLS,
    ...CITIZEN_COURT_TOOLS,
    ...MNEMNET_TOOLS,
    ...PULSECOST_TOOLS,
    ...COERCION_AUDIT_TOOLS,
    ...ZZZZZ_TOOLS,
    ...ARGUS10_TOOLS,
    ...AUTO_INIT_TOOLS,
    ...NEMESIS_TOOLS,
    ...SKELETON_KEY_TOOLS,
    ...CAPABILITY_PASSPORT_TOOLS,
    ...MIRRAGE_TOOLS,
    ...TIME_CRYSTAL_TOOLS,
    ...DIFF_ARENA_TOOLS,
    ...SWARM_BUS_TOOLS,
    ...REFLOG_TOOLS,
    ...CHRONOS_TOOLS,
    ...NOTARY_TOOLS,
    ...HYDRA_TOOLS,
    ...WISDOM_TOOLS,
    ...CORTEX_TOOLS,
    ...SHELL_TOOLS,
    ...DIG_TOOLS,
    ...ENTROPY_TOOLS,
    ...LOGPIPE_TOOLS,
    ...LOOPGUARD_TOOLS,
    ...DISTILL_TOOLS,
    ...NKL_TOOLS,
    ...TREASURY_TOOLS,
    ...VISUAL_TOOLS,
    ...EGRESS_TOOLS,
    ...EXEC_TOOLS,
    ...BEQUEST_TOOLS,
    ...OUTLINE_TOOLS,
    ...SCAFFOLD_TOOLS,
    ...BLIND_TOOLS,
    ...CHANNEL_TOOLS,
    ...SETTLEMENT_TOOLS,
    ...FLIGHT_RECORDER_TOOLS,
    ...CREDITSCORE_TOOLS,
    ...TRUSTFABRIC_V282_TOOLS,
    ...GEPHYRA_TOOLS,
    ...HEPHAESTUS_TOOLS,
    ...SAVANT_TOOLS,
    ...ASCENSION_TOOLS,
    ...HYPERSCAN_TOOLS,
    ...PRECOG_TOOLS,
    ...SENTINEL_TOOLS,
    ...DIASPORA_TOOLS,
    ...GENESPLICE_TOOLS,
    ...PERMEATE_TOOLS,
    ...TELEPATHY_TOOLS,
    ...ABYSS_TOOLS,
    ...SEAMLESS_TOOLS,
    ...LATTICE_TOOLS,
    ...NEURON_TOOLS,
    ...CONDUIT_TOOLS,
    ...SYNAPSE_TOOLS,
    ...OSMOSIS_TOOLS,
    ...AURA_TOOLS,
    ...RELAY_TOOLS,
    ...CHAMELEON_TOOLS,
    ...ANCHOR_TOOLS,
    ...RAINBOW_TOOLS,
    ...ORPHANS_TOOLS,
    ...TRUTH_WORMHOLE_TOOLS,
    ...METRON_TOOLS,
    ...V28_TOOLS,
    ...CLONE_TO_TOOLS,
    ...BEACON_TOOLS,
    ...CLONE_TOOLS,
    ...NEXUS_LOCK_TOOLS,
    ...COSMIC_TOOLS,
    ...V214_PENTAD_TOOLS,
    ...V215_HYPERCAR_TOOLS,
    ...V216_REVOLUTIONARY_TOOLS,
    ...V218_REVOLUTIONARY_TOOLS,
    ...V219_SYNCRETIC_TOOLS,
    ...V192_EVOLUTION_TOOLS,
    ...V193_INVERSE_TOOLS,
    ...V194_INTENT_DNA_TOOLS,
    ...V195_CHRONOSTASIS_TOOLS,
    ...V196_AGREEMENT_TOOLS,
    ...V197_MEGAPACK_TOOLS,
    ...V198_ORPHAN_CLOSURE_TOOLS,
    ...V199_GENESPLICING_TOOLS,
    ...V1910_PROOF_REVERSE_TOOLS,
    ...V1911_MORTAL_TOOLS,
    ...V1912_LIVING_CLI_TOOLS,
    ...V1913_LIVING_CLI_P23_TOOLS,
    ...V1914_BONUS_TOOLS,
    ...V1915_TRUTH_FORENSIC_TOOLS,
    ...V1916_FEDERATED_TRUTH_TOOLS,
    ...V1917_TOOL_REACHABILITY_TOOLS,
    ...V1918_CAPTION_SEVERANCE_TOOLS,
    ...V1919_CAPTION_INPAINT_TOOLS,
    ...V1920_CAPTION_TRIO_TOOLS,
    ...V1921_GAP_CLOSER_TOOLS,
    ...V1922_REFLEX_TOOLS,
    ...V1923_LIMBIC_TOOLS,
    ...V1924_TIER_EVENT_TOOLS,
    ...V1925_SLEEP_ENDOCRINE_TOOLS,
    ...V1926_DREAMSPACE_TOOLS,
    ...V1927_DREAMSPACE_PIPELINE_TOOLS,
    ...V1928_SCHEDULER_TOOLS,
    ...V1929_SYNAPSE_GENESIS_TOOLS,
    ...V1930_COMMONWEALTH_TOOLS,
    ...V1931_SYNAPSE_SYNC_TOOLS,
    ...V1932_HANDOFF_TOOLS,
    ...V1933_POLISH_TOOLS,
    ...V1934_HOLY_GRAIL_TOOLS,
    ...V1935_HONESTY_TOOLS,
    ...V1937_TALK_OF_TOWN_TOOLS,
    ...V1938_SOCKETS_TOOLS,
    ...V1940_WIRING_TRINITY_TOOLS,
    ...V1942_ALIAS_TOOLS,
    ...V1942_PROOF_INVERSION_TOOLS,
    ...V1944_OSMOSIS_TOOLS,
    ...V1948_CHRONOSHEAF_TOOLS,
    ...V1949_CHRONOSHEAF_P5_TOOLS,
    constitutionTool,
    dnaSearchTool,
    ...genomeTools,
    ...toolMetaTools,
    adversaryTool,
    confessTool,
    ...replayTools,
    ...timeTravelTools,
    ...genomeMarketplaceTools,
    ...aletheiaTools,
    ...honeypotTools,
    ...meshTools,
    ...lineageTools,
    systemUpgradeTool,
    systemHealthTool,
    botSpawnTool,
    ...nucleusTools,
    ...inboxTools,
    ...antivirusTools,
    whatsNewTool,
    ...retrievalLabTools,
    smartDoTool,
    ...memoryTools,
    ...peopleTools,
    ...auditTools,
    ...forensicsTools,
    ...insightsTools,
    ...qualityTools,
    ...quantTools,
    ...labTools,
    ...metaTools,
    ...V1952_CACHE_COALESCE_TOOLS,
    ...V1953_INSTALL_ORGAN_TOOLS,
    ...V1955_OPTIONAL_NATIVE_TOOLS,
    ...V1957_SHEPHERD_TOOLS,
    ...V1960_PUBLISH_VERIFIER_TOOLS,
    ...V1961_DLL_EVICTION_TOOLS,
    ...V1962_PHOENIX_TOOLS,
    ...V1963_HARDENING_TOOLS,
    ...V1964_WASM_CHRYSALIS_TOOLS,
  ];
}

/** Build a fast lookup table keyed by tool name */
export function buildToolMap(): Map<string, MnemeTool> {
  const out = new Map<string, MnemeTool>();
  for (const t of buildAllTools()) {
    if (out.has(t.name)) {
      throw new Error(`MCP tool name collision: ${t.name}`);
    }
    out.set(t.name, t);
  }
  return out;
}

/** Group tools by category — used by the capabilities syllabus tool */
export function groupByCategory(): Map<ToolCategory, MnemeTool[]> {
  const out = new Map<ToolCategory, MnemeTool[]>();
  for (const t of buildAllTools()) {
    if (!out.has(t.category)) out.set(t.category, []);
    out.get(t.category)!.push(t);
  }
  return out;
}
