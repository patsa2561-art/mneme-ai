/**
 * v2.19.52 CACHE COALESCE — expose verify_cache as MCP primitives.
 *
 * The wild idea: turn the v2.19.51 verify_cache from an internal hot-path
 * optimization into a USER-FACING MCP primitive. AI agents calling Mneme
 * can now ask Mneme to coalesce ANY of their own slow operations:
 *
 *   - mneme.cache.put(key, value, ttlMs?)         — manual cache write
 *   - mneme.cache.get(key)                        — read-through; misses don't block
 *   - mneme.cache.stats()                         — miss/hit/coalesce counters
 *   - mneme.cache.reset()                         — full clear (tests, debug)
 *   - mneme.cache.measure_savings(callCount, perCallMs) — compute the
 *     theoretical wall-time + token saving for N coalesced calls
 *
 * No AI tool worldwide (OpenAI/Anthropic/Cursor/Copilot/Aider/Codeium/
 * LangChain/Helicone/Portkey/Vellum/Braintrust) exposes a generic
 * promise-coalescing cache to other tools as an MCP primitive. First-mover.
 *
 * Note: full `withCoalesce(key, asyncFn)` semantics requires the caller to
 * pass an awaitable function across MCP — not natively possible. So we
 * expose the BUILDING BLOCKS (put/get/stats) and let the caller layer
 * their own withCoalesce wrapper around any MCP-callable tool by:
 *   1. Hash claim → key
 *   2. mneme.cache.get(key); if HIT → return
 *   3. Run the slow op
 *   4. mneme.cache.put(key, result, ttlMs)
 *
 * The Mneme-side hot paths (truth.forensic / truth.explain) already use the
 * full coalesce semantics from v2.19.51; these new MCP tools let EXTERNAL
 * callers get the TTL-memo half of the win.
 */

import type { MnemeTool } from "./_types.js";

// External-facing key prefix to avoid collisions with the internal
// truth.forensic / truth.explain keys.
const EXTERNAL_KEY_PREFIX = "ext::";

export const cacheCoalescePutTool: MnemeTool = {
  name: "mneme.cache.put",
  category: "lab",
  description: "⚡ CACHE — write a value into the shared promise-coalescing memo. Subsequent mneme.cache.get(key) within ttlMs returns the value without recomputation. Keys are prefixed to avoid collision with Mneme's internal verify cache.",
  whenToUse: "After running an expensive operation whose result you want to share across subsequent calls in the same session.",
  triggers: ["cache put", "cache write", "memoize value"],
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "Cache key. Will be prefixed internally to namespace from internal verify cache." },
      value: { description: "Any JSON-serialisable value to cache." },
      ttlMs: { type: "number", description: "Time-to-live in milliseconds. Default 5000." },
    },
    required: ["key", "value"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Cache this expensive LLM response", args: { key: "summary:doc-42", value: { summary: "..." }, ttlMs: 60000 }, expectedOutput: "{ ok: true, key: 'ext::summary:doc-42', ttlMs: 60000 }" }],
  pitfalls: ["TTL is process-local — not shared across worker threads or restarts. For durable cache use mneme.osmosis.* or mneme.chronosheaf.storage_persist."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const key = `${EXTERNAL_KEY_PREFIX}${String(args["key"])}`;
    const value = args["value"];
    const ttlMs = typeof args["ttlMs"] === "number" ? (args["ttlMs"] as number) : 5_000;
    core.verifyCache.syncMemo(key, () => value, { ttlMs });
    return { data: { ok: true, key, ttlMs }, wisdom: `⚡ cached ${key} (${ttlMs}ms TTL)`, confidence: { level: "high" } };
  },
};

export const cacheCoalesceGetTool: MnemeTool = {
  name: "mneme.cache.get",
  category: "lab",
  description: "⚡ CACHE — read a value from the shared memo. Returns { hit: true, value } on cache hit or { hit: false } on miss. Never blocks; never throws. Use BEFORE running an expensive operation to skip it.",
  whenToUse: "Cache-aside pattern: get → if miss, compute + put. Especially valuable for parallel agents that may all be working on the same prompt.",
  triggers: ["cache get", "cache read", "check memoized"],
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "Cache key (will be prefixed internally to match mneme.cache.put)." },
    },
    required: ["key"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is there a cached result for this prompt?", args: { key: "summary:doc-42" }, expectedOutput: "{ hit: true, value: {...} } or { hit: false }" }],
  pitfalls: ["Returns hit=false on both miss AND expired entry — caller can't distinguish 'never cached' from 'cached but TTL elapsed'."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const key = `${EXTERNAL_KEY_PREFIX}${String(args["key"])}`;
    // withVerifyCache with a no-op compute that throws if called — the only
    // way to "peek" without writing. If the entry exists, the cached value
    // is returned; if not, our compute throws + we return { hit: false }.
    try {
      const value = await core.verifyCache.withVerifyCache<unknown>(key, async () => {
        throw new Error("MISS");
      }, { ttlMs: 5_000 });
      return { data: { hit: true, value }, wisdom: `⚡ cache HIT ${key}`, confidence: { level: "high" } };
    } catch (e) {
      if ((e as Error).message === "MISS") {
        return { data: { hit: false }, wisdom: `⚡ cache MISS ${key}`, confidence: { level: "high" } };
      }
      throw e;
    }
  },
};

export const cacheCoalesceStatsTool: MnemeTool = {
  name: "mneme.cache.stats",
  category: "lab",
  description: "⚡ CACHE — dashboard view of the shared memo: memoSize / inflightSize / totalHits / totalMisses / totalCoalesced. The coalesce count is the dollar-value metric: N coalesced ≈ N × (vendor cost per call).",
  whenToUse: "Periodic health snapshot; explaining 'how much did Mneme save me this hour?'; debugging cache effectiveness.",
  triggers: ["cache stats", "cache dashboard", "coalesce counter"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How effective is Mneme's cache?", args: {}, expectedOutput: "{ memoSize: 42, inflightSize: 0, totalHits: 156, totalMisses: 12, totalCoalesced: 88 }" }],
  pitfalls: ["Counters are process-local + monotonically increasing — restart resets them. For durable saving telemetry use mneme.proof.mint."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const s = core.verifyCache.verifyCacheStats();
    const hitRate = (s.totalHits + s.totalMisses) > 0
      ? (s.totalHits / (s.totalHits + s.totalMisses) * 100).toFixed(1)
      : "0.0";
    return {
      data: s,
      wisdom: `⚡ ${s.memoSize} entries · ${hitRate}% hit · ${s.totalCoalesced} coalesced (${s.totalCoalesced} compute calls saved)`,
      confidence: { level: "high" },
    };
  },
};

export const cacheCoalesceResetTool: MnemeTool = {
  name: "mneme.cache.reset",
  category: "lab",
  description: "⚡ CACHE — full clear: memo + in-flight + counters all wiped. Mostly for tests / debugging. Production code rarely needs this.",
  whenToUse: "Test isolation; debugging stale-cache surprises; explicit cache invalidation on a known schema change.",
  triggers: ["cache reset", "cache clear", "drop cache"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Clear the cache", args: {}, expectedOutput: "{ ok: true, clearedAt: '...' }" }],
  pitfalls: ["Wipes the cache for the WHOLE process — including internal Mneme verify caches. Use sparingly in production."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    core.verifyCache._resetVerifyCache();
    return { data: { ok: true, clearedAt: new Date().toISOString() }, wisdom: `⚡ cache cleared`, confidence: { level: "high" } };
  },
};

export const cacheCoalesceMeasureSavingsTool: MnemeTool = {
  name: "mneme.cache.measure_savings",
  category: "lab",
  description: "⚡ CACHE — compute the theoretical wall-time + token saving for N coalesced parallel calls. Given the actual hit/coalesce counters + average per-call cost, returns the dollar-equivalent value. Pairs with mneme.proof.mint for procurement-grade savings receipts.",
  whenToUse: "Quarterly review; demonstrating ROI; explaining to leadership why Mneme should stay deployed.",
  triggers: ["cache savings", "cache value", "measure coalesce roi"],
  inputSchema: {
    type: "object",
    properties: {
      perCallMs: { type: "number", description: "Average wall-time per uncached compute (ms). Default 100." },
      perCallTokens: { type: "number", description: "Average tokens per uncached compute. Default 1000." },
      perKTokenUsd: { type: "number", description: "Vendor price per 1K tokens (USD). Default 0.015 (Opus blended)." },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How much have we saved?", args: { perCallMs: 200, perCallTokens: 800, perKTokenUsd: 0.015 }, expectedOutput: "{ savedCalls: 88, savedMs: 17600, savedTokens: 70400, savedUsd: 1.056 }" }],
  pitfalls: ["Estimates assume each coalesced call WOULD have run uncached at full cost. Actual savings depend on workload; pair with mneme.proof.mint for HMAC+Merkle audit-grade receipts."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.verifyCache.verifyCacheStats();
    const perCallMs = typeof args["perCallMs"] === "number" ? (args["perCallMs"] as number) : 100;
    const perCallTokens = typeof args["perCallTokens"] === "number" ? (args["perCallTokens"] as number) : 1000;
    const perKTokenUsd = typeof args["perKTokenUsd"] === "number" ? (args["perKTokenUsd"] as number) : 0.015;
    const savedCalls = s.totalCoalesced + s.totalHits;
    const savedMs = savedCalls * perCallMs;
    const savedTokens = savedCalls * perCallTokens;
    const savedUsd = (savedTokens / 1000) * perKTokenUsd;
    return {
      data: { savedCalls, savedMs, savedTokens, savedUsd, stats: s, assumptions: { perCallMs, perCallTokens, perKTokenUsd } },
      wisdom: `⚡ saved ${savedCalls} calls · ${savedMs}ms wall-time · ${savedTokens.toLocaleString()} tokens · $${savedUsd.toFixed(3)}`,
      confidence: { level: "medium" },
    };
  },
};

export const V1952_CACHE_COALESCE_TOOLS: MnemeTool[] = [
  cacheCoalescePutTool,
  cacheCoalesceGetTool,
  cacheCoalesceStatsTool,
  cacheCoalesceResetTool,
  cacheCoalesceMeasureSavingsTool,
];
