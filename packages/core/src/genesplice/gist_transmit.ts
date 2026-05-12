/**
 * v1.73.0 -- GENESPLICE G3: GIST BRAIN TRANSFER.
 *
 * Wild idea: user uploads soul-prompt to their OWN GitHub Gist
 * (private or public). The Gist URL becomes the user-owned "brain
 * cloud" -- portable across any AI tool that can `fetch()` or
 * accept a URL.
 *
 * Why this is paradigm-shifting:
 *   - NO Mneme cloud needed (user owns their data)
 *   - NO API key needed (user creates gist via web UI)
 *   - ANY AI that supports tool-use can `fetch()` the gist
 *   - HMAC-signed = tamper-evident
 *
 * This module:
 *   - PACKAGES a capsule into a single text blob suitable for
 *     pasting into a new GitHub Gist
 *   - Provides a uri scheme: `mneme://gist/<gistId>?key=<hmac>`
 *     that AI agents resolve via the OpenAPI bridge
 *   - Does NOT directly upload (we don't ask for user's GitHub
 *     token; user pastes via gist.github.com UI manually)
 */

import { createHash } from "node:crypto";
import { compressToSoulPrompt, type SoulPrompt } from "./soul_prompt.js";
import type { SessionCapsule } from "../diaspora/session_capsule.js";
import type { HybridCapsule } from "./genome_recombine.js";

export interface GistTransmitInput {
  /** Either a raw capsule or a hybrid capsule. */
  capsule: SessionCapsule | HybridCapsule;
  secret?: string;
  /** Gist filename. Default: mneme-soul-<id>.md */
  filename?: string;
}

export interface GistPackage {
  /** Text blob -- paste into gist.github.com. */
  content: string;
  /** Suggested filename. */
  filename: string;
  /** Soul prompt id. */
  id: string;
  /** Step-by-step instructions printed to user. */
  instructions: string[];
  /** mneme:// URI to embed in receiving AI agents (after gist is created
   *  the user replaces <gistId> with their actual gist id). */
  mnemeUri: string;
}

function asSessionCapsule(c: SessionCapsule | HybridCapsule): SessionCapsule {
  // Hybrid -> session-shaped adapter
  if ("hybridVersion" in c) {
    return {
      id: c.id,
      capsuleVersion: 1,
      createdAt: c.createdAt,
      originVendor: `hybrid:${c.sources.map((s) => s.vendor).join("+")}`,
      repoFingerprint: "hybrid",
      contextSummary: c.contextSummary,
      promptTrace: c.promptTrace.map((p) => ({ ts: p.ts, role: p.role, text: p.text })),
      reasoningTrace: c.reasoningTrace.map((r) => r.text),
      decisions: c.decisions,
      hmac: "hybrid-no-hmac",
    };
  }
  return c;
}

export function packageGist(input: GistTransmitInput): GistPackage {
  const cap = asSessionCapsule(input.capsule);
  const soul = compressToSoulPrompt({ capsule: cap, secret: input.secret });
  const filename = input.filename ?? `mneme-soul-${soul.id}.md`;
  const wrapper = [
    `<!-- mneme://gist  format-version=1  id=${soul.id} -->`,
    "",
    soul.text,
    "",
    "<!-- end mneme://gist -->",
  ].join("\n");

  const instructions = [
    "1. Open https://gist.github.com/new",
    `2. Set filename: ${filename}`,
    "3. Paste the content above",
    "4. (Optional) Set visibility to 'secret' for private brain transfer",
    "5. Click 'Create gist'",
    "6. Copy the gist URL (raw URL works best for AI fetching)",
    `7. Tell ANY AI in another chat: "Resume Mneme soul from this gist: <paste-url>"`,
  ];

  const mnemeUri = `mneme://gist/<paste-gist-id-here>?soul=${soul.id}`;

  return { content: wrapper, filename, id: soul.id, instructions, mnemeUri };
}

/** Parse a gist URL (raw.githubusercontent.com or gist.github.com/api).
 *  Returns the gist id + filename hint for clients that need to fetch. */
export interface ParsedGistUrl {
  gistId: string | null;
  rawUrl: string;
  isRaw: boolean;
}
export function parseGistUrl(url: string): ParsedGistUrl {
  // raw.githubusercontent.com/<user>/<gistId>/raw/<sha>/<filename>
  const rawMatch = url.match(/gist\.githubusercontent\.com\/[^/]+\/([a-f0-9]+)\//);
  if (rawMatch) return { gistId: rawMatch[1]!, rawUrl: url, isRaw: true };
  // gist.github.com/<user>/<gistId>
  const webMatch = url.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/);
  if (webMatch) return { gistId: webMatch[1]!, rawUrl: url, isRaw: false };
  return { gistId: null, rawUrl: url, isRaw: false };
}

/** Given raw gist content (the same text we packaged), extract the soul
 *  prompt body for re-ingestion in the receiving AI. */
export function extractSoulFromGist(gistContent: string): string | null {
  const m = gistContent.match(/<!-- mneme:\/\/gist[^>]*-->\s*([\s\S]*?)\s*<!-- end mneme:\/\/gist -->/);
  if (m) return m[1]!;
  // Fallback: maybe user pasted just the soul prompt without wrappers
  if (gistContent.includes("MNEME SOUL PROMPT")) return gistContent;
  return null;
}
