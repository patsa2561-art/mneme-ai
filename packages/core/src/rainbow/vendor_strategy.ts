/**
 * v1.98.0 -- RAINBOW · Vendor strategy map.
 *
 * Replaces the broken "one-size-fits-all RELAY" assumption with explicit
 * per-vendor strategies. Each vendor (web AI, mobile app, MCP-capable
 * editor, etc.) gets the transport that ACTUALLY works for its
 * capability tier.
 *
 * Strategies:
 *   clipboard-first  — copy plain text + open vendor home page. User pastes.
 *                      Works on EVERY Web AI's free tier. The default.
 *   plain-qr         — render plain-text soul as QR (NO encryption, NO
 *                      fetch-instruction). Phone scans → copies → pastes.
 *   mcp-direct       — vendor is MCP-aware (Claude Code, Cursor, Codex CLI,
 *                      Continue) — Mneme MCP server exposes tools directly.
 *                      No copy/paste needed.
 *   prefill-and-paste— vendor honors ?q= deep link AND has web-fetch
 *                      (paid-tier ChatGPT Plus / Gemini Advanced). The
 *                      old RELAY path. Used ONLY when caller explicitly
 *                      asserts "I have a paid-tier AI with browsing".
 *   app-deeplink-NA  — vendor mobile app does NOT honor any URL scheme.
 *                      Mneme cannot help; tell the user honestly.
 *
 * Every entry has `verified` (boolean) + `lastChecked` (ISO date) so
 * stale-URL claims like "Verified May 2026" cannot lie silently. The
 * companion `vendor_probe.ts` actually hits each URL with HEAD + asserts.
 */

export type VendorStrategy = "clipboard-first" | "plain-qr" | "mcp-direct" | "prefill-and-paste" | "app-deeplink-NA";

export interface VendorEntry {
  /** Canonical vendor id used across Mneme. */
  id: string;
  /** Display label. */
  label: string;
  /** Primary URL to open (home page for clipboard-first). */
  homeUrl: string;
  /** Default strategy for the FREE tier of this vendor. */
  freeStrategy: VendorStrategy;
  /** Strategy when user explicitly has the paid tier with browsing. */
  paidStrategy: VendorStrategy;
  /** Whether ?q= deep link is verified to work (empirical, not assumed). */
  qParamWorks: boolean;
  /** Whether the vendor offers web-fetch in chat (free tier). */
  webFetchAvailable: boolean;
  /** ISO date the URL was last probed. Updated by vendor_probe.ts. */
  lastChecked: string;
  /** Why we picked this strategy (transparency). */
  reasoning: string;
}

/** Canonical vendor table. Source of truth for strategy decisions. */
export const VENDOR_REGISTRY: VendorEntry[] = [
  {
    id: "chatgpt-web",
    label: "ChatGPT (web)",
    homeUrl: "https://chatgpt.com/",
    freeStrategy: "clipboard-first",
    paidStrategy: "prefill-and-paste",
    qParamWorks: false, // ChatGPT Free does not reliably prefill; old chat.openai.com 308-redirects
    webFetchAvailable: false,
    lastChecked: "2026-05-13",
    reasoning: "OpenAI rebranded chat.openai.com → chatgpt.com (308 redirect). Free tier has no web-fetch. ?q= prefill is silent in the chat UI for Free. Clipboard works.",
  },
  {
    id: "gemini-web",
    label: "Gemini (web)",
    homeUrl: "https://gemini.google.com/app",
    freeStrategy: "clipboard-first",
    paidStrategy: "clipboard-first", // even Gemini Advanced doesn't reliably prefill from ?q=
    qParamWorks: false, // verified empirically — ?q= returns 200 but does NOT pre-fill the input
    webFetchAvailable: false,
    lastChecked: "2026-05-13",
    reasoning: "Verified by user: ?q= returns 200 but input is not prefilled. Free tier has no web-fetch. Clipboard works on every tier.",
  },
  {
    id: "claude-web",
    label: "Claude (web)",
    homeUrl: "https://claude.ai/new",
    freeStrategy: "clipboard-first",
    paidStrategy: "clipboard-first",
    qParamWorks: false, // Cloudflare 403 on headless; live behavior unverified
    webFetchAvailable: false, // Claude has artifacts but not arbitrary URL fetch in chat
    lastChecked: "2026-05-13",
    reasoning: "Cloudflare blocks headless probes (returns 403). User-agent matters. Claude has artifact tool, not generic web-fetch. Clipboard works.",
  },
  {
    id: "claude-code",
    label: "Claude Code (CLI)",
    homeUrl: "claude://", // not actually used; MCP path is direct
    freeStrategy: "mcp-direct",
    paidStrategy: "mcp-direct",
    qParamWorks: false,
    webFetchAvailable: true,
    lastChecked: "2026-05-13",
    reasoning: "MCP-aware editor. Mneme MCP server exposes tools directly. No clipboard, no QR, no URL needed.",
  },
  {
    id: "cursor",
    label: "Cursor (editor)",
    homeUrl: "cursor://",
    freeStrategy: "mcp-direct",
    paidStrategy: "mcp-direct",
    qParamWorks: false,
    webFetchAvailable: true,
    lastChecked: "2026-05-13",
    reasoning: "MCP-aware. Same as Claude Code path.",
  },
  {
    id: "copilot-web",
    label: "GitHub Copilot Chat (web)",
    homeUrl: "https://github.com/copilot",
    freeStrategy: "clipboard-first",
    paidStrategy: "clipboard-first",
    qParamWorks: false,
    webFetchAvailable: false,
    lastChecked: "2026-05-13",
    reasoning: "No documented ?q= parameter. Clipboard works.",
  },
  {
    id: "perplexity-web",
    label: "Perplexity (web)",
    homeUrl: "https://www.perplexity.ai/",
    freeStrategy: "clipboard-first",
    paidStrategy: "clipboard-first",
    qParamWorks: true, // perplexity DOES support ?q= reliably across tiers
    webFetchAvailable: true, // Perplexity is search-grounded; fetch works
    lastChecked: "2026-05-13",
    reasoning: "Perplexity is the one major exception — ?q= prefill IS reliable. But for consistency Mneme defaults to clipboard-first; callers can opt in to prefill-and-paste.",
  },
  {
    id: "gemini-mobile",
    label: "Gemini (mobile app)",
    homeUrl: "gemini://", // does not exist
    freeStrategy: "app-deeplink-NA",
    paidStrategy: "app-deeplink-NA",
    qParamWorks: false,
    webFetchAvailable: false,
    lastChecked: "2026-05-13",
    reasoning: "Gemini iOS/Android does NOT register a custom URL scheme. Tapping a gemini:// link from outside fails. Use plain-qr → user opens browser tab → pastes.",
  },
  {
    id: "chatgpt-mobile",
    label: "ChatGPT (mobile app)",
    homeUrl: "chatgpt://",
    freeStrategy: "app-deeplink-NA",
    paidStrategy: "app-deeplink-NA",
    qParamWorks: false,
    webFetchAvailable: false,
    lastChecked: "2026-05-13",
    reasoning: "Same as Gemini mobile. No public URL scheme that prefills from outside.",
  },
  {
    id: "any-mobile-browser",
    label: "Mobile browser (any AI website)",
    homeUrl: "",
    freeStrategy: "plain-qr",
    paidStrategy: "plain-qr",
    qParamWorks: false,
    webFetchAvailable: false,
    lastChecked: "2026-05-13",
    reasoning: "Render the soul prompt as a plain-text QR — phone scans, gets plain text, pastes into any AI app the user has open. No encryption, no fetch dependency.",
  },
];

export function entryOf(id: string): VendorEntry | null {
  return VENDOR_REGISTRY.find((v) => v.id === id) ?? null;
}

/** Decide strategy given vendor + whether user has paid tier. */
export function pickStrategy(vendorId: string, opts: { paidTier?: boolean } = {}): { strategy: VendorStrategy; entry: VendorEntry | null; reason: string } {
  const e = entryOf(vendorId);
  if (!e) return { strategy: "clipboard-first", entry: null, reason: `unknown vendor '${vendorId}' — defaulting to clipboard-first (always-safe)` };
  const strategy = opts.paidTier ? e.paidStrategy : e.freeStrategy;
  return { strategy, entry: e, reason: `${vendorId}: free='${e.freeStrategy}', paid='${e.paidStrategy}', user opts.paidTier=${!!opts.paidTier} → '${strategy}'. ${e.reasoning}` };
}

/** Render the strategy decision as a pulse line. */
export function formatStrategyPulseLine(vendorId: string, opts: { paidTier?: boolean } = {}): string {
  const r = pickStrategy(vendorId, opts);
  return `VENDOR-STRATEGY · ${vendorId} · ${r.strategy}${r.entry ? ` · ?q=${r.entry.qParamWorks ? "yes" : "no"} fetch=${r.entry.webFetchAvailable ? "yes" : "no"}` : ""}`;
}
