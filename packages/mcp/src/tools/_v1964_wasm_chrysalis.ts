/**
 * v2.19.64 — WASM CHRYSALIS MCP TOOLS — 4 callable surfaces.
 *
 *   mneme.wasm.launch          — full pipeline (load + instantiate + verify
 *                                + manifest) on a .wasm file
 *   mneme.wasm.verify_handle   — prove a path has no open handles (the
 *                                invariant verifier)
 *   mneme.wasm.manifest        — read the HMAC-chained launch manifest
 *   mneme.wasm.manifest_verify — chain integrity check
 *
 * 13th world-first as MCP primitive: WASM-blob launcher + handle-closure
 * invariant + HMAC-chained launch manifest. No AI tool in the npm ecosystem
 * ships any of this at the spec level.
 */

import type { MnemeTool } from "./_types.js";

export const wasmLaunchTool: MnemeTool = {
  name: "mneme.wasm.launch",
  category: "lab",
  description: "🦋 WASM CHRYSALIS — full launch pipeline on a .wasm file: load-as-bytes (close handle) → instantiate from memory → verify disk handle closed → append HMAC-chained manifest entries. Returns the assembled result + invariantHeld verdict. The endgame fix for EBUSY: WASM bytes live in V8 heap, npm can overwrite the file freely, instance survives.",
  whenToUse: "Loading a WASM module that may be overwritten during execution (npm upgrade). Diagnosing whether a .wasm file path can be safely npm-replaced while module is loaded.",
  triggers: ["wasm launch", "load wasm", "instantiate wasm", "chrysalis"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path to the .wasm file." },
      recordManifest: { type: "boolean", description: "Append HMAC-chained manifest entries. Default true." },
    },
    required: ["path"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Launch a WASM module via CHRYSALIS protocol", args: { path: "/path/to/module.wasm" }, expectedOutput: "{ invariantHeld: true, load: {sizeBytes,sha256,...}, instantiate: {ok}, handleCheck: {selfRead:true}, manifestEntries: 4 }" }],
  pitfalls: [
    "On Windows without sysinternals handle.exe, externalHolder probe is best-effort (selfRead is the most trusted signal).",
    "Imports for WebAssembly cannot be passed via MCP JSON; this surface is for inspection / pipeline-verification only. For dynamic-import scenarios use the JS API directly.",
  ],
  composeWith: ["mneme.wasm.verify_handle", "mneme.wasm.manifest", "mneme.phoenix.extract_status"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const path = String(args["path"]);
    const recordManifest = args["recordManifest"] !== false;
    const r = await core.wasmChrysalis.launchWasmFile(path, { recordManifest });
    return {
      data: r,
      wisdom: r.invariantHeld
        ? `🦋 invariant held · ${r.load?.sizeBytes ?? 0} bytes loaded · ${r.instantiate?.ok ? "instantiated" : "FAIL"} · handle closed (${r.handleCheck?.method}) · ${r.manifestEntries} manifest entries · ${r.totalDurationMs}ms`
        : `🦋 ⚠ invariant BROKEN · load=${r.load !== null} · inst=${r.instantiate?.ok ?? false} · handle.selfRead=${r.handleCheck?.selfRead ?? false}`,
      confidence: { level: r.invariantHeld ? "high" : "low" },
    };
  },
};

export const wasmVerifyHandleTool: MnemeTool = {
  name: "mneme.wasm.verify_handle",
  category: "audit",
  description: "🔍 WASM CHRYSALIS — verify a file path has no exclusive lock. Self-probes openSync('r+') (succeeds iff no other holder); plus lsof on POSIX. The invariant check that proves a .wasm or .dll can be safely npm-overwritten right now.",
  whenToUse: "Pre-install diagnostic: is this DLL/WASM safe to replace? Post-instantiation check: did the CHRYSALIS load actually close the handle? After a kill: did the OS release the handle yet?",
  triggers: ["verify handle closed", "is file locked", "handle probe"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is libvips-42.dll currently locked?", args: { path: "C:\\path\\libvips-42.dll" }, expectedOutput: "{ selfRead: false, externalHolder: 'yes', method: 'win32-fs-probe' }" }],
  pitfalls: ["selfRead=false but externalHolder='unknown' (Windows) means SOMETHING blocked our probe; could be us or another process — Windows lacks lsof equivalent without handle.exe."],
  composeWith: ["mneme.wasm.launch", "mneme.dll.probe", "mneme.phoenix.dll_sweep"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.wasmChrysalis.verifyHandleClosed(String(args["path"]));
    return {
      data: r,
      wisdom: r.selfRead && r.externalHolder !== "yes"
        ? `🔍 ${args["path"]} · no holders · safe to overwrite`
        : `🔍 ⚠ ${args["path"]} · selfRead=${r.selfRead} · externalHolder=${r.externalHolder} · DO NOT overwrite`,
      confidence: { level: r.method === "missing-file" ? "low" : "high" },
    };
  },
};

export const wasmManifestTool: MnemeTool = {
  name: "mneme.wasm.manifest",
  category: "audit",
  description: "📜 WASM CHRYSALIS — read the HMAC-chained launch manifest at ~/.mneme-global/launch-manifest.jsonl. Shows every load/instantiate/verify/complete event with sha256 + duration. The forensic trail for what WASM modules were launched + when.",
  whenToUse: "Audit which .wasm files were loaded + when. Verify a particular sha256 was launched. Diagnose 'why is this WASM stale?'.",
  triggers: ["wasm manifest", "launch history", "chrysalis log"],
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Return only the last N entries. Default unlimited." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show recent WASM launches", args: { limit: 10 }, expectedOutput: "{ entries: [...], summary: {totalLaunchCompletes, lastLaunch, chainOk} }" }],
  pitfalls: ["Manifest is per-user (~/.mneme-global). Cross-user launches invisible to each other."],
  composeWith: ["mneme.wasm.manifest_verify", "mneme.wasm.launch"],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const limit = typeof args["limit"] === "number" ? args["limit"] as number : Infinity;
    const all = core.wasmChrysalis.readManifest();
    const entries = limit < all.length ? all.slice(-limit) : all;
    const summary = core.wasmChrysalis.summarizeManifest();
    return {
      data: { entries, summary, manifestPath: core.wasmChrysalis.manifestPath() },
      wisdom: entries.length === 0
        ? "📜 no WASM launches recorded yet — CHRYSALIS hasn't fired on this machine"
        : `📜 ${entries.length}/${all.length} entries · ${summary.totalLaunchCompletes} complete launches · ${(summary.totalBytesLoaded/1024/1024).toFixed(1)} MB total loaded · chain ${summary.chainOk ? "ok" : "BROKEN"}`,
      confidence: { level: summary.chainOk ? "high" : "low" },
    };
  },
};

export const wasmManifestVerifyTool: MnemeTool = {
  name: "mneme.wasm.manifest_verify",
  category: "audit",
  description: "📜 WASM CHRYSALIS — verify HMAC chain integrity of the launch manifest. Returns broken-at index + reason if tampered. The 'is my launch evidence trustworthy?' question.",
  whenToUse: "Before trusting any manifest-based claim. Security audit. Periodic integrity check.",
  triggers: ["verify wasm manifest", "manifest integrity", "launch chain ok"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is the launch manifest tampered?", args: {}, expectedOutput: "{ chainOk: true, totalEntries: 12, lastTs: '2026-05-19T...' }" }],
  pitfalls: ["Returns chainOk=true on empty manifest (vacuously true). Use mneme.wasm.manifest to check entry count first."],
  composeWith: ["mneme.wasm.manifest", "mneme.install.trail_verify", "mneme.phoenix.sentinel_probe"],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const r = core.wasmChrysalis.verifyLaunchChain();
    return {
      data: r,
      wisdom: r.totalEntries === 0
        ? "📜 manifest empty — vacuously ok"
        : r.chainOk
        ? `📜 chain ok · ${r.totalEntries} entries · last: ${r.lastTs}`
        : `📜 ⚠ chain BROKEN at index ${r.brokenAtIndex}: ${r.brokenReason}`,
      confidence: { level: r.chainOk ? "high" : "low" },
    };
  },
};

export const V1964_WASM_CHRYSALIS_TOOLS: MnemeTool[] = [
  wasmLaunchTool,
  wasmVerifyHandleTool,
  wasmManifestTool,
  wasmManifestVerifyTool,
];
