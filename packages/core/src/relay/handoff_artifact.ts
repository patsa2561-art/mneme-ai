/**
 * v1.87.0 -- RELAY: HANDOFF ARTIFACT.
 *
 * Combines (paste URL + NEXUS code + deep link + REAL scannable QR)
 * into one bundle the source AI hands to the user. The user has
 * THREE ways to use it -- any one works:
 *
 *   1. Scan the QR with phone camera → AI app opens with the
 *      prompt pre-filled → tap send → resume. ZERO typing.
 *   2. Tap the deep link on a clickable device → same flow.
 *   3. Copy the long prompt manually (fallback for cases without
 *      camera / clickable link).
 *
 * This closes the UX gap user surfaced: previously the only path was
 * "copy 200 chars from PC to phone" which is hostile across devices.
 * Now phone-camera-scan is the canonical path.
 */

import { encodeQRReal } from "../synapse/qr_real.js";
import { bestDeepLink, buildDeepLink, type DeepLinkVendor } from "./deep_link.js";

export interface HandoffInput {
  pasteUrl: string;
  nexusCode: string;
  /** Optional vendor hint. When omitted, AI picks the shortest fit. */
  vendor?: DeepLinkVendor;
  /** SVG module size (pixels). Default 8. */
  moduleSize?: number;
}

export interface HandoffArtifact {
  pasteUrl: string;
  nexusCode: string;
  /** The deep link that gets QR-encoded. */
  deepLink: { vendor: DeepLinkVendor; url: string; prompt: string };
  /** Real scannable QR (zero-dep encoder). */
  qr: { svg: string; size: number; version: number; mask: number };
  /** Plain-text fallback the user can copy if QR/deep-link unavailable. */
  copyFallback: string;
  /** One-line instructions per surface. */
  instructions: {
    qrScan: string;
    tapLink: string;
    manualCopy: string;
  };
}

export function renderHandoff(input: HandoffInput): HandoffArtifact {
  const link = input.vendor
    ? buildDeepLink({ pasteUrl: input.pasteUrl, nexusCode: input.nexusCode, vendor: input.vendor })
    : bestDeepLink({ pasteUrl: input.pasteUrl, nexusCode: input.nexusCode });
  const qr = encodeQRReal(link.url, { moduleSize: input.moduleSize ?? 8 });
  return {
    pasteUrl: input.pasteUrl,
    nexusCode: input.nexusCode,
    deepLink: { vendor: link.vendor, url: link.url, prompt: link.prompt },
    qr: { svg: qr.svg, size: qr.size, version: qr.version, mask: qr.mask },
    copyFallback: link.prompt,
    instructions: {
      qrScan: `Scan the QR code with your phone camera. The AI app opens with the prompt pre-filled -- tap send and the conversation resumes.`,
      tapLink: `Tap (or paste into your browser) this link: ${link.url}`,
      manualCopy: `If neither scan nor tap works, copy this single line into any AI:\n\n${link.prompt}`,
    },
  };
}
