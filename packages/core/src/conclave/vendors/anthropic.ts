/**
 * v2.29.0 — Anthropic adapter for CONCLAVE.
 *
 * Speaks the Messages API (POST /v1/messages).
 * Auth via env: ANTHROPIC_API_KEY.
 * Defaults to claude-haiku-4-5 (cheap+fast) for cost discipline; the
 * orchestrator can pass a specific model via vendor id like
 * "claude-opus-4-7" → modelId "claude-opus-4-7".
 *
 * Returns a structured VendorVerdict; never throws (errors → VendorVerdict
 * with stance=uncertain + error field).
 */

import type { VendorAdapter } from "./interface.js";
import { CONCLAVE_PROMPT, parseStance, parseConfidence } from "./interface.js";
import type { VendorVerdict } from "../types.js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

function vendorIdToModel(id: string): string {
  // Accept short aliases or full model IDs.
  const m: Record<string, string> = {
    "claude-opus-4-7": "claude-opus-4-7",
    "claude-opus-4.7": "claude-opus-4-7",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    "claude-haiku-4.5": "claude-haiku-4-5-20251001",
  };
  return m[id] ?? id;
}

export function makeAnthropicAdapter(vendorId: string): VendorAdapter {
  return {
    id: vendorId,
    available() { return !!process.env["ANTHROPIC_API_KEY"]; },
    async run({ claim, variantId, timeoutMs = 30_000 }): Promise<VendorVerdict> {
      const t0 = Date.now();
      const key = process.env["ANTHROPIC_API_KEY"];
      if (!key) {
        return {
          vendor: vendorId, variant: variantId, stance: "uncertain", confidence: 0,
          reasoning: "ANTHROPIC_API_KEY not set", dtMs: Date.now() - t0, error: "no-api-key",
        };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(ANTHROPIC_API, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: vendorIdToModel(vendorId),
            max_tokens: 600,
            messages: [{ role: "user", content: CONCLAVE_PROMPT + claim }],
          }),
        });
        clearTimeout(timer);
        if (!res.ok) {
          return {
            vendor: vendorId, variant: variantId, stance: "uncertain", confidence: 0,
            reasoning: `HTTP ${res.status}`, dtMs: Date.now() - t0, error: `http-${res.status}`,
          };
        }
        const j = await res.json() as { content?: Array<{ type?: string; text?: string }> };
        const text = (j.content ?? []).map((c) => c.text ?? "").join("\n").trim();
        return {
          vendor: vendorId, variant: variantId,
          stance: parseStance(text), confidence: parseConfidence(text),
          reasoning: text.slice(0, 600), dtMs: Date.now() - t0,
          rawSample: text.slice(0, 1200),
        };
      } catch (e) {
        clearTimeout(timer);
        return {
          vendor: vendorId, variant: variantId, stance: "uncertain", confidence: 0,
          reasoning: `fetch failed: ${(e as Error).message}`, dtMs: Date.now() - t0, error: (e as Error).name,
        };
      }
    },
  };
}
