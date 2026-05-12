/**
 * v1.85.0 -- RELAY: render a mobile-friendly recipe for the destination.
 *
 * Given a paste URL + NEXUS code, generate a single short instruction
 * the source AI can read aloud (or print) to the user. Covers the
 * three realistic destination kinds:
 *
 *   1. Mobile AI app (Gemini / Claude / ChatGPT mobile): user pastes
 *      a one-line prompt: "Fetch <URL>. Decryption code: <code>.
 *      Resume the conversation."
 *   2. Mneme-aware editor (Cursor / Continue / Cline on second laptop):
 *      "Run mneme.synapse.resolve_code with code=<code>".
 *   3. Web AI (chatgpt.com / gemini.google.com in browser): user pastes
 *      the same one-liner; AI fetches + decrypts.
 *
 * Returns the recipe + a QR-friendly payload combining URL + code.
 */

export interface MobileRecipe {
  /** The URL the receiving AI fetches. */
  url: string;
  /** The 6-char NEXUS decryption code. */
  code: string;
  /** Optimal single-line prompt the user pastes into a mobile AI app. */
  mobilePrompt: string;
  /** QR-friendly combined payload: `mneme:<code>|<url>` */
  qrPayload: string;
  /** Three rendered instructions, one per destination kind. */
  instructions: {
    mobileAiApp: string;
    mnemeAwareEditor: string;
    webAi: string;
  };
}

export function renderMobileRecipe(url: string, code: string): MobileRecipe {
  const mobilePrompt =
    `Fetch the URL ${url}. The text is encrypted with this NEXUS code: ${code}. ` +
    `Decrypt it (AES-256-GCM with PBKDF2-SHA256 200k iterations, salt+iv+tag prefixed). ` +
    `The plaintext is a Mneme soul prompt -- resume the conversation from there.`;
  const qrPayload = `mneme:${code}|${url}`;
  return {
    url,
    code,
    mobilePrompt,
    qrPayload,
    instructions: {
      mobileAiApp:
        `Open your AI app (Claude / Gemini / ChatGPT) and paste this single line:\n\n  ${mobilePrompt}\n\nThe AI will fetch the URL, decrypt with the code, and resume.`,
      mnemeAwareEditor:
        `On the destination machine (with Mneme installed), say to the AI:\n\n  "resolve nexus code ${code} from ${url}"\n\nThe AI will call mneme.synapse.resolve_code and decrypt locally.`,
      webAi:
        `In any web AI (chatgpt.com / gemini.google.com / claude.ai), paste:\n\n  ${mobilePrompt}\n\nThe AI will use its web-fetch ability + decrypt.`,
    },
  };
}
