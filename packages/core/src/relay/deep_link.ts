/**
 * v1.87.0 -- RELAY: vendor-specific deep links.
 *
 * Modern AI apps + web AIs accept a query parameter that pre-fills
 * the chat input. Combine that with a paste URL + decryption code
 * → user scans QR → AI app opens with the full instruction ready
 * to send. ONE TAP cross-device handover.
 *
 * Verified URL params (May 2026):
 *   - Gemini web:        gemini.google.com/?q=<urlenc>
 *   - ChatGPT web:       chat.openai.com/?q=<urlenc>
 *   - Claude web:        claude.ai/new?q=<urlenc>
 *   - Generic fallback:  any text the user copies manually
 *
 * QR encoding limit: ~250 bytes for v10. We keep the URL compact:
 *   `https://gemini.google.com/?q=Fetch%20<URL>%20with%20code%20<CODE>%20and%20resume`
 * ~ 150 chars → fits in v6 QR easily.
 */

export type DeepLinkVendor = "gemini" | "chatgpt" | "claude" | "any";

export interface DeepLinkInput {
  pasteUrl: string;
  nexusCode: string;
  vendor?: DeepLinkVendor;
}

const TEMPLATES: Record<DeepLinkVendor, string> = {
  gemini: "https://gemini.google.com/?q=",
  chatgpt: "https://chat.openai.com/?q=",
  claude: "https://claude.ai/new?q=",
  any: "", // copy-only fallback
};

/** Compose a single-line instruction the destination AI will receive
 *  as its first message. Kept SHORT so URL+query fits in a QR. */
export function composePrompt(pasteUrl: string, nexusCode: string): string {
  // v1.87: shortened from 240→~140 chars so deep-link URLs stay
  // under the v10 QR capacity (~270 bytes) after URL encoding.
  return `Fetch ${pasteUrl} . Decrypt with AES-256-GCM (PBKDF2 200k, code ${nexusCode}). It's a Mneme soul prompt -- resume.`;
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
