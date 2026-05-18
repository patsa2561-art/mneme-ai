/**
 * v2.19.55 OPTIONAL NATIVE MCP — expose the opt-in heavy-deps protocol.
 *
 *   mneme.optional.status         — dashboard: which natives available + sizes
 *   mneme.optional.probe          — single-native availability probe
 *   mneme.optional.install_hint   — exact npm command + size + rationale
 *   mneme.optional.list_known     — catalog of every known optional native
 *
 * The wild bet exposed as MCP: Mneme's default install is ZERO-NATIVE.
 * AI agents call these tools to (a) report install footprint, (b) suggest
 * to user "want better quality? install transformers (~50MB)", (c) detect
 * which fallback path is active.
 *
 * No AI tool worldwide exposes an opt-in native-dep protocol via MCP.
 * First-mover.
 */

import type { MnemeTool } from "./_types.js";

export const optionalStatusTool: MnemeTool = {
  name: "mneme.optional.status",
  category: "audit",
  description: "🪶 OPTIONAL NATIVE — dashboard: which heavy native deps are available on this install + their MB footprint + missing ones with fallback hints. Mneme's default install is ZERO-NATIVE; all heavy deps are opt-in.",
  whenToUse: "First-contact diagnostic: 'how lean is my install? what can I opt in to?'. Periodic health snapshot.",
  triggers: ["optional status", "native deps status", "install footprint"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What heavy deps are installed?", args: {}, expectedOutput: "{ available: [...], missing: [...], bytesAvailable, recommendation }" }],
  pitfalls: ["MB sizes are approximate — actual disk usage depends on platform binaries + transitive deps."],
  composeWith: ["mneme.optional.install_hint", "mneme.optional.probe"],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const s = await core.optionalNative.installStatus();
    return {
      data: s,
      wisdom: `🪶 ${s.available.length}/${s.totalKnown} natives · ${(s.bytesAvailable / 1_000_000).toFixed(0)}MB · ${s.recommendation.split(" — ")[0]}`,
      confidence: { level: "high" },
    };
  },
};

export const optionalProbeTool: MnemeTool = {
  name: "mneme.optional.probe",
  category: "audit",
  description: "🪶 OPTIONAL NATIVE — probe a single optional native dep. Returns availability + version if present + load error if missing + active fallback. Fast (lazy import, no actual usage).",
  whenToUse: "Before calling code that depends on a specific optional native (e.g., before invoking WASM embedder, probe 'transformers').",
  triggers: ["optional probe", "native probe", "is native available"],
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Native name: transformers / sharp / onnxruntime_node / tensorflow / z3_solver." },
    },
    required: ["name"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is transformers installed?", args: { name: "transformers" }, expectedOutput: "{ name, available, versionIfAvailable, loadErrorIfMissing, fallback }" }],
  pitfalls: ["Probe does NOT actually USE the module — just tries to import it. The real module may still throw on first use."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const name = String(args["name"]).replace(/_/g, "-") as Parameters<typeof core.optionalNative.probeNative>[0];
    const r = await core.optionalNative.probeNative(name);
    return {
      data: r,
      wisdom: r.available
        ? `🪶 ✓ ${r.name} available${r.versionIfAvailable ? ` (v${r.versionIfAvailable})` : ""}`
        : `🪶 ✗ ${r.name} missing · fallback: ${r.fallback}`,
      confidence: { level: "high" },
    };
  },
};

export const optionalInstallHintTool: MnemeTool = {
  name: "mneme.optional.install_hint",
  category: "lab",
  description: "🪶 OPTIONAL NATIVE — exact npm install command + estimated MB + rationale for opting in to a heavy native dep. The user gets a clear 'here's what installing this gives you' answer before the cost is paid.",
  whenToUse: "User asks 'how do I get better embeddings?' or 'what would I gain by installing X?'. Also: AI agent recommending an upgrade path.",
  triggers: ["install hint", "how to install native", "opt in native"],
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Native name: transformers / sharp / onnxruntime_node / tensorflow / z3_solver." },
    },
    required: ["name"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How do I install transformers?", args: { name: "transformers" }, expectedOutput: "{ npmCommand, enables, approxMB, rationale }" }],
  pitfalls: ["Installing a native dep can fail on Windows if a DLL is locked — pair with mneme.install.upgrade_pipeline before retrying."],
  composeWith: ["mneme.install.upgrade_pipeline", "mneme.optional.status"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const name = String(args["name"]).replace(/_/g, "-") as Parameters<typeof core.optionalNative.installHint>[0];
    const r = core.optionalNative.installHint(name);
    if (!r.ok) return { data: r, wisdom: `🪶 ${r.error}`, confidence: { level: "high" } };
    return {
      data: r,
      wisdom: `🪶 \`${r.npmCommand}\` (~${r.approxMB}MB) → ${r.enables}`,
      confidence: { level: "high" },
    };
  },
};

export const optionalListKnownTool: MnemeTool = {
  name: "mneme.optional.list_known",
  category: "audit",
  description: "🪶 OPTIONAL NATIVE — catalog of every known optional native dep Mneme can opt into. Each entry: name, npm package, what it enables, fallback when missing, install command, approx size.",
  whenToUse: "Discovery — 'what optional natives does Mneme support?'.",
  triggers: ["list optional natives", "list known natives"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show me all optional natives", args: {}, expectedOutput: "{ catalog: [{name, npmPackage, enables, fallback, ...}] }" }],
  pitfalls: ["Catalog is curated — Mneme only KNOWS about these specific natives. Other npm packages can still be installed by the user but won't appear in optional.status until added to KNOWN_NATIVES."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    return {
      data: { catalog: core.optionalNative.KNOWN_NATIVES, total: core.optionalNative.KNOWN_NATIVES.length },
      wisdom: `🪶 ${core.optionalNative.KNOWN_NATIVES.length} optional natives in catalog`,
      confidence: { level: "high" },
    };
  },
};

export const V1955_OPTIONAL_NATIVE_TOOLS: MnemeTool[] = [
  optionalStatusTool,
  optionalProbeTool,
  optionalInstallHintTool,
  optionalListKnownTool,
];
