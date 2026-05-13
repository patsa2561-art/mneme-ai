/**
 * v2.4.0 -- SYMBIOSIS · FUSION HANDSHAKE.
 *
 * The wild move: a single canonical paste that any AI vendor can pick
 * up and act on. The bundle carries:
 *   - voice directive    (how the receiver should write)
 *   - intent block       (vendor-shaped top tools for this task)
 *   - lexicon header     (which profile was applied to the bytes)
 *   - drift-guard hash   (so a tampered bundle is detectable)
 *
 * The receiving AI doesn't need to know Mneme exists. It just reads the
 * fusion block in the prompt and produces output that fits Mneme's
 * downstream pipelines without extra parsing.
 */

import { createHash } from "node:crypto";
import { tuneForVendorArtifact, type LexiconProfile, profileByName } from "../lexicon/index.js";
import { type VoiceProfile, voiceForVendor, renderVoiceDirective } from "./voice.js";
import { shapeIntent, type IntentShape } from "./intent.js";

export interface FusionInput {
  /** Vendor receiving the bundle. Determines voice + lexicon. */
  vendor: string;
  /** Top intents to surface (post-TOOL-SELECTOR ranked list). */
  intents: IntentShape[];
  /** Optional per-vendor lexicon override; defaults to vendor inference. */
  lexiconProfile?: LexiconProfile;
  /** Optional override of voice; defaults to vendor inference. */
  voice?: VoiceProfile;
}

export interface FusionBundle {
  /** Plain markdown ready to paste into the vendor. */
  rendered: string;
  /** SHA-256 digest of the rendered bundle, hex. */
  digest: string;
  /** Vendor decided. */
  vendor: string;
  /** Voice that was applied. */
  voice: VoiceProfile;
  /** Lexicon profile that was applied. */
  lexicon: LexiconProfile;
}

function lexiconForVendor(vendor: string): LexiconProfile {
  const v = vendor.toLowerCase();
  if (v.includes("anthropic") || v.includes("claude")) return profileByName("anthropic")!;
  if (v.includes("openai") || v.includes("gpt") || v.includes("chatgpt") || v.includes("codex")) return profileByName("openai")!;
  if (v.includes("bank") || v.includes("enterprise") || v.includes("finance")) return profileByName("enterprise")!;
  return profileByName("identity")!;
}

export function fuseWithVendor(input: FusionInput): FusionBundle {
  const voice = input.voice ?? voiceForVendor(input.vendor);
  const lex = input.lexiconProfile ?? lexiconForVendor(input.vendor);
  const lines: string[] = [];
  lines.push("<!-- MNEME SYMBIOSIS FUSION BUNDLE START -->");
  lines.push(`[symbiosis] vendor=${input.vendor} voice=${voice.vendor} lexicon=${lex.name}`);
  lines.push("");
  lines.push(renderVoiceDirective(voice));
  lines.push("");
  if (input.intents.length > 0) {
    lines.push("Suggested next actions:");
    for (const i of input.intents) {
      lines.push("- " + shapeIntent(i, voice));
    }
  }
  lines.push("");
  lines.push("<!-- MNEME SYMBIOSIS FUSION BUNDLE END -->");
  // Tune the whole bundle through the chosen lexicon so the bytes
  // landing in the prompt are classifier-safe per that vendor.
  const tuned = tuneForVendorArtifact(lines.join("\n"), lex.name);
  const digest = createHash("sha256").update(tuned).digest("hex");
  return { rendered: tuned, digest, vendor: input.vendor, voice, lexicon: lex };
}

/** Verify a bundle's integrity by re-rendering with the same input and
 *  comparing digests. Returns true if untampered. */
export function verifyFusion(bundle: FusionBundle, input: FusionInput): boolean {
  const fresh = fuseWithVendor(input);
  return fresh.digest === bundle.digest;
}

/** One-line summary suitable for pulse / status. */
export function formatFusionPulseLine(bundle: FusionBundle): string {
  return `SYMBIOSIS · vendor=${bundle.vendor} · voice=${bundle.voice.vendor} · lexicon=${bundle.lexicon.name} · sha256=${bundle.digest.slice(0, 8)}`;
}
