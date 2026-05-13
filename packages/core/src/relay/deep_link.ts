/**
 * v1.87.0 -- RELAY: vendor-specific deep links.
 * v1.98.0 -- HONEST UPDATE: 4 things to know
 *   1. chat.openai.com → chatgpt.com  (OpenAI rebranded; old URL 308-redirects)
 *   2. The original `composePrompt` asks the AI to fetch+decrypt — Free tier
 *      Web AIs (Gemini-Free, ChatGPT-Free) cannot do EITHER. See bug_truth.ts.
 *   3. `?q=` prefill is NOT reliably honored by current Gemini Web (verified).
 *   4. `composeCleanPrompt` is the v1.98 replacement: plain identification, no
 *      fetch / decrypt instruction. The PAGE that the user opens copies plain
 *      text to clipboard — the AI just reads what's pasted.
 *
 * Updated vendor URLs (May 2026, with redirect-trace verification):
 *   - Gemini web:   gemini.google.com/?q=<urlenc>     (200, ?q= unreliable)
 *   - ChatGPT web:  chatgpt.com/?q=<urlenc>           (chat.openai.com 308→chatgpt.com)
 *   - Claude web:   claude.ai/new?q=<urlenc>          (Cloudflare may 403 headless)
 *
 *  v1.98 callers should prefer `composeCleanPrompt` + the clipboard-first
 *  strategy from `vendor_strategy.ts`. The fetch+decrypt path lives on for
 *  backward compatibility with `Mneme + Pro tier AI` flows where web-fetch
 *  IS available, but it must NEVER be the default.
 */

export type DeepLinkVendor = "gemini" | "chatgpt" | "claude" | "any";

export interface DeepLinkInput {
  pasteUrl: string;
  nexusCode: string;
  vendor?: DeepLinkVendor;
}

const TEMPLATES: Record<DeepLinkVendor, string> = {
  gemini: "https://gemini.google.com/?q=",
  // v1.98: was chat.openai.com (308-redirects to chatgpt.com). Direct URL.
  chatgpt: "https://chatgpt.com/?q=",
  claude: "https://claude.ai/new?q=",
  any: "", // copy-only fallback
};

/** @deprecated v1.98 — relies on Web AI fetching the paste URL + decrypting
 *  AES-256-GCM. Free-tier Web AIs cannot do either. Use `composeCleanPrompt`
 *  instead, paired with clipboard-first strategy in `vendor_strategy.ts`.
 *  Retained for `Mneme + Pro-tier AI` flows where web-fetch is enabled. */
export function composePrompt(pasteUrl: string, nexusCode: string): string {
  return `Fetch ${pasteUrl} . Decrypt with AES-256-GCM (PBKDF2 200k, code ${nexusCode}). It's a Mneme soul prompt -- resume.`;
}

/** v1.98 — clean prompt: just identifies the soul as Mneme. NO fetch
 *  instruction, NO decryption instruction. The PAGE that handles the
 *  user's clipboard puts the actual soul prompt in the AI's input box. */
export function composeCleanPrompt(): string {
  return "[Mneme soul prompt — paste from clipboard to continue this conversation across vendors. See https://mneme.dev for context.]";
}

export interface DeepLink {
  vendor: DeepLinkVendor;
  /** Final URL the user opens (or QR scans into). */
  url: string;
  /** Just the prompt portion, in case the URL is too long. */
  prompt: string;
  /** Whether the URL fits in a typical v10 QR payload (< 270 bytes). */
  fitsInQR: boolean;
}

export function buildDeepLink(input: DeepLinkInput): DeepLink {
  const vendor = input.vendor ?? "any";
  const prompt = composePrompt(input.pasteUrl, input.nexusCode);
  const tmpl = TEMPLATES[vendor];
  const url = tmpl ? `${tmpl}${encodeURIComponent(prompt)}` : prompt;
  return { vendor, url, prompt, fitsInQR: new TextEncoder().encode(url).length < 270 };
}

/** Pick the deep link with the SHORTEST URL that still fits in a QR.
 *  Best for "I don't know which AI app the user has" scenarios. */
export function bestDeepLink(input: DeepLinkInput): DeepLink {
  const candidates: DeepLinkVendor[] = ["gemini", "chatgpt", "claude", "any"];
  let best: DeepLink | null = null;
  for (const vendor of candidates) {
    const dl = buildDeepLink({ ...input, vendor });
    if (!dl.fitsInQR) continue;
    if (!best || dl.url.length < best.url.length) best = dl;
  }
  return best ?? buildDeepLink({ ...input, vendor: "any" });
}
