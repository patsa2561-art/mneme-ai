/**
 * v2.29.0 — OpenAI adapter for CONCLAVE.
 *
 * Speaks the Chat Completions API. Auth via env: OPENAI_API_KEY.
 */

import type { VendorAdapter } from "./interface.js";
import { CONCLAVE_PROMPT, parseStance, parseConfidence } from "./interface.js";
import type { VendorVerdict } from "../types.js";

const OPENAI_API = "https://api.openai.com/v1/chat/completions";

function vendorIdToModel(id: string): string {
  const m: Record<string, string> = {
    "gpt-5": "gpt-5",
    "gpt-5-mini": "gpt-5-mini",
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "gpt-4o-mini",
  };
  return m[id] ?? id;
}

export function makeOpenAIAdapter(vendorId: string): VendorAdapter {
  return {
    id: vendorId,
    available() { return !!process.env["OPENAI_API_KEY"]; },
    async run({ claim, variantId, timeoutMs = 30_000 }): Promise<VendorVerdict> {
      const t0 = Date.now();
      const key = process.env["OPENAI_API_KEY"];
      if (!key) {
        return {
          vendor: vendorId, variant: variantId, stance: "uncertain", confidence: 0,
          reasoning: "OPENAI_API_KEY not set", dtMs: Date.now() - t0, error: "no-api-key",
        };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(OPENAI_API, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: vendorIdToModel(vendorId),
            max_tokens: 600,
            messages: [
              { role: "system", content: "You are one of N independent verifiers in a Byzantine consensus protocol." },
              { role: "user", content: CONCLAVE_PROMPT + claim },
            ],
          }),
        });
        clearTimeout(timer);
        if (!res.ok) {
          return {
            vendor: vendorId, variant: variantId, stance: "uncertain", confidence: 0,
            reasoning: `HTTP ${res.status}`, dtMs: Date.now() - t0, error: `http-${res.status}`,
          };
        }
        const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = (j.choices?.[0]?.message?.content ?? "").trim();
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
