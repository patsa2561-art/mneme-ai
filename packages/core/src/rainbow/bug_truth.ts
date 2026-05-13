/**
 * v1.97.0 -- RAINBOW · The Truth About v1.85 RELAY (4 bugs · honest postmortem).
 *
 * User caught us in 4 lies:
 *
 *   🔴 BUG #1: AI-fetches-URL doesn't work
 *     - Free Gemini / ChatGPT-Free / Claude.ai do NOT have web-fetch in
 *       chat completion paths. The instruction "Fetch this URL..." is
 *       silently ignored or refused.
 *
 *   🔴 BUG #2: AI cannot do AES-GCM + PBKDF2(200k) decryption
 *     - Asking the AI to manually decrypt is a hallucination magnet. It
 *       has no Web Crypto access in the chat sandbox; output is fabricated.
 *
 *   🔴 BUG #3: gemini.google.com/?q= deep link does NOT prefill
 *     - User has to type the prompt themselves anyway. The deep-link
 *       parameter is silently ignored by current Gemini Web.
 *
 *   🔴 BUG #4: We claimed it works without integration testing
 *     - v1.85 commit messages and docs asserted "any AI can fetch URL +
 *       decrypt". Never tested against a real free-tier AI. False claim.
 *
 * The DEMON FIX (v1.97):
 *
 *   STOP depending on Web AI to do ANYTHING beyond reading text.
 *
 *   The ONLY assumption that holds across every Web AI's free tier on
 *   every platform: the user can paste into the chat box.
 *
 *   So Mneme:
 *     1. Renders the soul prompt as PLAIN TEXT (no encryption needed —
 *        soul never leaves user's machine when using SAME-SHELL).
 *     2. Copies it to the user's CLIPBOARD via the browser's
 *        navigator.clipboard API (works on every modern browser).
 *     3. Opens the AI's HOME page (not a deep link with ?q= — that
 *        path is broken and we've confirmed it).
 *     4. Shows a clear banner: "BRAIN IS ON YOUR CLIPBOARD. Press Ctrl+V."
 *     5. User pastes plain text into the chat. AI reads plain text.
 *
 *   No crypto burden on AI. No fetch dependency. No deep-link reliance.
 *   100% reliable on every Web AI that lets a human paste in the chat —
 *   which is every Web AI that exists.
 *
 *   v1.85 ENCRYPTED-RELAY architecture is DEPRECATED. Code remains for
 *   the LAN/tunnel transport (where the BROWSER does the decryption,
 *   not the AI), but the "AI fetches + decrypts" assumption is gone.
 *
 *   This file exists to be honest about it in the codebase.
 */

export interface ArchitectureWarning {
  /** Module name. */
  module: string;
  /** Why it's deprecated. */
  reason: string;
  /** What to use instead. */
  replacement: string;
}

export const DEPRECATED_RELAY_PATHS: ArchitectureWarning[] = [
  {
    module: "rainbow.handoff.buildDataBridgeUrl (v1.89)",
    reason: "data: URL navigation is blocked by Chrome/Safari since 2018 at the top-level. Even when it isn't, modern Web AIs (Gemini Free, ChatGPT Free, Claude.ai) have no web-fetch in chat completion to retrieve the encrypted soul. Deep-link prefill is silently ignored by current Gemini Web.",
    replacement: "Use rainbow.same_shell.renderSameShellPage + rainbow.clone_to.cloneTo for clipboard-based handoff. The page copies plain text to clipboard; user pastes into the AI directly.",
  },
  {
    module: "v1.85 RELAY · AI fetches encrypted soul from public paste",
    reason: "Asks the Web AI to (a) fetch a public URL — most free tiers refuse, (b) decrypt AES-256-GCM with PBKDF2(200k) — AI sandbox has no Web Crypto, output is hallucinated, (c) parse the result back into context — only the AI's reading capability is reliable.",
    replacement: "BROWSER (not AI) does the decryption. Use the same-shell flow — soul stays on user's machine as plain text, clipboard delivers it.",
  },
  {
    module: "Vendor-prefill deep links (chatgpt.com/?q=, gemini.google.com/?q=)",
    reason: "Empirically broken on Gemini Web (verified by user). ChatGPT and Claude.ai don't reliably honor query params either across all entry routes. User STILL has to paste — but now they're confused why the prompt didn't auto-fill.",
    replacement: "Open the AI's plain home URL + tell the user clearly: 'Brain is on clipboard. Press Ctrl+V.' Reliable on every Web AI.",
  },
];

/** Print the architecture warnings — used by the doctor command + the
 *  AI agent contract to remind both human + AI that the old paths are dead. */
export function formatBugTruth(): string {
  return DEPRECATED_RELAY_PATHS.map((w, i) =>
    `🔴 [${i + 1}/${DEPRECATED_RELAY_PATHS.length}] ${w.module}\n` +
    `    why: ${w.reason}\n` +
    `    use: ${w.replacement}`
  ).join("\n\n");
}
