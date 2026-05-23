/**
 * v2.40.0 — MCP wrappers for ARGUS-10 (4 tools).
 *
 *   mneme.argus.search   — 10-eyed weighted-sum search; HMAC-signed.
 *   mneme.argus.eyes     — list eye bundle + per-eye live/closed state.
 *   mneme.argus.hydra    — show currently-spawned HYDRA eyes (from AV strains).
 *   mneme.argus.verify   — offline HMAC verify of a pasted ArgusSearchResult.
 *
 * All STATELESS — no runtime / git required.
 */

import { resolve } from "node:path";
import type { MnemeTool, ToolRuntime } from "./_types.js";

function repoRootOf(rt: ToolRuntime): string {
  return resolve(rt.meta?.rootPath ?? process.cwd());
}

export const argusSearchTool: MnemeTool = {
  name: "mneme.argus.search",
  category: "meta",
  description:
    "ARGUS-10 — 10-eyed memory search. 5 surface (bigram-Dice + Damerau-Lev-Thai + Thai metaphone + length ratio + sliding window) + 5 truth (homoglyph collapse + number-paraphrase bridge + embedding cosine + HMAC provenance boost + honest-mirror penalty). Failed eyes softmax-rebalance. HMAC-signed result frame. Pure stateless; no runtime needed.",
  whenToUse: "Rank candidate memories/answers against a user query with graceful degradation under missing-embedder, missing-honest-mirror, missing-HMAC-chain.",
  triggers: ["argus search", "ten eyed search", "argus10"],
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "User query." },
      candidates: {
        type: "array",
        description: "Array of {text, meta?} candidates to rank.",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            meta: {
              type: "object",
              properties: {
                vendor: { type: "string" },
                recencyDays: { type: "number" },
                inHmacChain: { type: "boolean" },
                source: { type: "string" },
              },
            },
          },
          required: ["text"],
        },
      },
      topK: { type: "integer", description: "Optional cap on returned candidates." },
    },
    required: ["query", "candidates"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.argus.eyes", "mneme.argus.verify"],
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const repoRoot = repoRootOf(rt);
      const query = String(args["query"] ?? "");
      const cand = (args["candidates"] as Array<{ text: string; meta?: object }>) ?? [];
      const topK = typeof args["topK"] === "number" ? (args["topK"] as number) : undefined;
      if (!query) return { data: { ok: false, error: "query required" }, wisdom: "Pass query.", followUp: [], confidence: { level: "high" as const } };
      if (!Array.isArray(cand) || cand.length === 0) {
        return { data: { ok: false, error: "candidates required (non-empty array)" }, wisdom: "Pass candidates.", followUp: [], confidence: { level: "high" as const } };
      }
      const out = await core.argus10.argusSearch({
        query,
        candidates: cand.map((c) => ({ text: String(c.text ?? ""), meta: (c.meta as { vendor?: string; recencyDays?: number; inHmacChain?: boolean; source?: string }) ?? undefined })),
        repoRoot,
        ...(typeof topK === "number" ? { topK } : {}),
      });
      const top = out.scored[0];
      return {
        data: out,
        wisdom: top
          ? `👁 Top match (score ${top.score.toFixed(3)}, eyes ${out.health.open}/${out.health.total}): "${top.candidate.text.slice(0, 80)}"`
          : `No candidates returned (eyes ${out.health.open}/${out.health.total}).`,
        followUp: ["mneme.argus.verify"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: `ARGUS-10 search failed: ${(e as Error).message}`, followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const argusEyesTool: MnemeTool = {
  name: "mneme.argus.eyes",
  category: "meta",
  description: "ARGUS-10 — list the 10-eye bundle + per-eye nominal weight + layer. Pure introspection; no I/O.",
  whenToUse: "Inspect the eye catalog; understand the weighting.",
  triggers: ["argus eyes", "argus10 eyes"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    try {
      const core = await import("@mneme-ai/core");
      const surface = core.argus10.SURFACE_EYES.map((e) => ({ id: e.id, layer: e.layer, weight: e.weight }));
      const truth = core.argus10.TRUTH_EYES.map((e) => ({ id: e.id, layer: e.layer, weight: e.weight }));
      const sum = [...surface, ...truth].reduce((s, e) => s + e.weight, 0);
      return {
        data: { surface, truth, totalWeight: Number(sum.toFixed(3)) },
        wisdom: `👁×10 bundle. Surface=${surface.length}, Truth=${truth.length}, sum=${sum.toFixed(3)}.`,
        followUp: ["mneme.argus.search"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "eyes failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const argusHydraTool: MnemeTool = {
  name: "mneme.argus.hydra",
  category: "meta",
  description: "ARGUS-10 HYDRA — spawn new eyes from antivirus strains with precision > 0.9 and recall ≥ 0.5. Returns the list of accepted strains and their spawned eye IDs.",
  whenToUse: "After an AV gap-scan run, surface the new eyes that just spawned.",
  triggers: ["argus hydra"],
  inputSchema: {
    type: "object",
    properties: {
      strains: {
        type: "array",
        description: "List of {name, regex, precision, recall, accepted?} strains.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            regex: { type: "string" },
            precision: { type: "number" },
            recall: { type: "number" },
            accepted: { type: "boolean" },
          },
          required: ["name", "regex", "precision"],
        },
      },
    },
    required: ["strains"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const strains = (args["strains"] as Array<{ name: string; regex: string; precision: number; recall?: number; accepted?: boolean }>) ?? [];
      const spawned = core.argus10.autoSpawnHydra(strains);
      return {
        data: {
          requested: strains.length,
          spawned: spawned.length,
          eyes: spawned.map((e) => ({ id: e.id, weight: e.weight, layer: e.layer })),
        },
        wisdom: `🐍 HYDRA spawned ${spawned.length} of ${strains.length} requested.`,
        followUp: ["mneme.argus.search"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "hydra failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const argusVerifyTool: MnemeTool = {
  name: "mneme.argus.verify",
  category: "meta",
  description: "ARGUS-10 — offline HMAC verify of a pasted ArgusSearchResult given its original input.",
  whenToUse: "Cross-machine attestation; tamper-detection on shared search results.",
  triggers: ["argus verify"],
  inputSchema: {
    type: "object",
    properties: {
      input: { type: "object", description: "Original ArgusSearchInput." },
      result: { type: "object", description: "ArgusSearchResult to verify." },
    },
    required: ["input", "result"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const i = args["input"] as Parameters<typeof core.argus10.verifyArgusResult>[0];
      const r = args["result"] as Parameters<typeof core.argus10.verifyArgusResult>[1];
      if (!i || !r) return { data: { ok: false, reason: "input and result both required" }, wisdom: "Pass input + result.", followUp: [], confidence: { level: "high" as const } };
      const ok = core.argus10.verifyArgusResult(i, r);
      return { data: { ok }, wisdom: ok ? "HMAC verified." : "HMAC FAIL — tampered.", followUp: [], confidence: { level: "high" as const } };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "verify failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

// v2.41.0 — ARGUS-11 MULTIMODAL SURFACE (image + code + parallel + phantom).
export const argusMultimodalTool: MnemeTool = {
  name: "mneme.argus.multimodal",
  category: "meta",
  description:
    "ARGUS-11 multimodal search — text + image + code in one ranked result. Includes bloom pre-filter (~20× speedup on large corpora) + PHANTOM EYE lazy eval (expensive eyes only fire when cheap eyes leave verdict ambiguous, ≥3× wall-time reduction). Parallel candidate fan-out via Promise.all. Same HMAC-signed result shape as mneme.argus.search.",
  whenToUse: "Rank mixed-modality candidates (some text / some have imageBytes / some have codeText) against a query.",
  triggers: ["argus multimodal", "argus11", "search images and code"],
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      candidates: {
        type: "array",
        description: "Each candidate may carry meta.imageBytes (Uint8Array) / meta.imagePath / meta.codeText",
        items: {
          type: "object",
          properties: { text: { type: "string" }, meta: { type: "object" } },
          required: ["text"],
        },
      },
      topK: { type: "integer" },
      skipBloom: { type: "boolean" },
      skipPhantom: { type: "boolean" },
      multimodal: { type: "boolean", description: "Include image+code eyes (default true)." },
    },
    required: ["query", "candidates"],
  },
  outputSchema: { type: "object" },
  composeWith: ["mneme.argus.adapters", "mneme.argus.verify"],
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const { resolve } = await import("node:path");
      const repoRoot = resolve(rt.meta?.rootPath ?? process.cwd());
      const q = String(args["query"] ?? "");
      const cand = (args["candidates"] as Array<{ text: string; meta?: object }>) ?? [];
      if (!q || !Array.isArray(cand) || cand.length === 0) {
        return { data: { ok: false, error: "query + candidates required" }, wisdom: "Pass query + candidates.", followUp: [], confidence: { level: "high" as const } };
      }
      const argusInput: Parameters<typeof core.argus10.argusSearchMultimodal>[0] = {
        query: q,
        candidates: cand.map((c) => ({ text: String(c.text ?? ""), meta: c.meta as Parameters<typeof core.argus10.argusSearchMultimodal>[0]["candidates"][number]["meta"] })),
        repoRoot,
      };
      if (typeof args["topK"] === "number") argusInput.topK = args["topK"] as number;
      const opts: Parameters<typeof core.argus10.argusSearchMultimodal>[1] = {};
      if (typeof args["skipBloom"] === "boolean") opts.skipBloom = args["skipBloom"] as boolean;
      if (typeof args["skipPhantom"] === "boolean") opts.skipPhantom = args["skipPhantom"] as boolean;
      if (typeof args["multimodal"] === "boolean") opts.multimodal = args["multimodal"] as boolean;
      const out = await core.argus10.argusSearchMultimodal(argusInput, opts);
      const top = out.scored[0];
      return {
        data: out,
        wisdom: top
          ? `👁×11 Top match (score ${top.score.toFixed(3)}, bloom pruned ${out.bloomPruned}, phantom skipped expensive on ${out.phantomCheapOnly}, ${out.durationMs}ms): "${top.candidate.text.slice(0, 80)}"`
          : "No candidates after bloom pre-filter.",
        followUp: ["mneme.argus.verify"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: `ARGUS-11 search failed: ${(e as Error).message}`, followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const argusAdaptersTool: MnemeTool = {
  name: "mneme.argus.adapters",
  category: "meta",
  description: "ARGUS-11 vendor adapter table — list every AI agent / editor / web AI that can call ARGUS via MCP / HTTP bridge / CLI / userscript. The TRUTH GATE probe `claim.argus11.world_first_multimodal` asserts count ≥ 9.",
  whenToUse: "Confirm a specific vendor (cursor / cline / chatgpt-web / etc) has a wired adapter.",
  triggers: ["argus adapters", "vendor list"],
  inputSchema: { type: "object", properties: { transport: { type: "string", description: "Optional filter: mcp | http-bridge | userscript | cli." } } },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const t = args["transport"] as string | undefined;
      const list = t ? core.argus10.adaptersByTransport(t as "mcp" | "http-bridge" | "userscript" | "cli") : core.argus10.listAdapters();
      const live = list.filter((a) => a.status === "live").length;
      return {
        data: { total: list.length, live, adapters: list },
        wisdom: `🔌 ARGUS adapters — ${live} live / ${list.length} total${t ? ` (transport=${t})` : ""}.`,
        followUp: ["mneme.argus.search"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "adapters failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const ARGUS10_TOOLS: MnemeTool[] = [
  argusSearchTool,
  argusEyesTool,
  argusHydraTool,
  argusVerifyTool,
  argusMultimodalTool,
  argusAdaptersTool,
];
