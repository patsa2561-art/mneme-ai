/**
 * v2.29.0 — Vendor adapter registry + auto-resolution.
 *
 * Given a list of vendor ids, returns the best adapter for each:
 *   1. Real adapter if its env credential is present
 *   2. Mock adapter as fallback (so tests + offline always work)
 *
 * Adding a new vendor (grok / gemini / deepseek): write a thin
 * adapter in this dir + add a case below.
 */

import type { VendorAdapter } from "./interface.js";
import { makeMockAdapter } from "./mock.js";
import { makeAnthropicAdapter } from "./anthropic.js";
import { makeOpenAIAdapter } from "./openai.js";

export function adapterFor(vendorId: string, opts: { mockOnly?: boolean } = {}): VendorAdapter {
  if (opts.mockOnly) return makeMockAdapter(vendorId);
  if (vendorId.startsWith("claude")) return makeAnthropicAdapter(vendorId);
  if (vendorId.startsWith("gpt") || vendorId === "openai") return makeOpenAIAdapter(vendorId);
  if (vendorId === "mock" || vendorId.startsWith("mock")) return makeMockAdapter(vendorId);
  // Unknown vendor → mock so the orchestrator doesn't crash.
  return makeMockAdapter(vendorId);
}

/** Resolve a list of vendor ids to live adapters, mocking any without creds. */
export function resolveVendors(
  vendorIds: string[],
  opts: { mockOnly?: boolean } = {},
): VendorAdapter[] {
  return vendorIds.map((id) => {
    const a = adapterFor(id, opts);
    if (a.available() || opts.mockOnly) return a;
    // Real adapter requested but no credentials → fall back to mock
    // tagged with original id so the user sees which vendor was mocked.
    return makeMockAdapter(`${id}@mock`);
  });
}
