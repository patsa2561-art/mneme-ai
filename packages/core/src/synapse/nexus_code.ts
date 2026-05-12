/**
 * v1.81.0 -- SYNAPSE: NEXUS short-code for cross-device brain sync.
 *
 * The breakthrough: user types a 6-character code on their phone /
 * tablet / second laptop and any Mneme-aware AI fetches the matching
 * soul prompt. No long URLs to copy. Like Apple AirDrop's PIN, but
 * for AI brains.
 *
 * How the code resolves:
 *   1. Local machine: looks up code → soul-prompt body
 *      (stored in `.mneme/synapse/codes.jsonl`)
 *   2. Cloud relay: code maps to a Gist URL the daemon uploads
 *      when the code is minted (user-owned cloud, no Mneme cloud)
 *   3. QR / clipboard: user shares the code via any messenger
 *
 * Codes are 6 alphanumeric chars (uppercase, no ambiguous 0/O/1/I/L)
 * giving ~26B unique codes. Collision-resistant for the 5-min window
 * a code is active. Auto-expires after 24h by default.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L
const CODE_LENGTH = 6;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const STORE_DIR = ".mneme/synapse";
const STORE_FILE = "codes.jsonl";

export interface NexusCode {
  code: string;
  /** ISO timestamp when minted. */
  createdAt: string;
  /** ISO timestamp when the code stops being valid. */
  expiresAt: string;
  /** Stable id derived from soul-prompt content (sha256, 16-hex). */
  soulHash: string;
  /** Soul-prompt body (text). Optional -- can be omitted if `gistUrl` is set. */
  soulText?: string;
  /** External relay (e.g. private Gist URL). */
  gistUrl?: string;
  /** Number of times the code has been resolved. */
  resolveCount: number;
}

export interface MintInput {
  soulText: string;
  gistUrl?: string;
  ttlMs?: number;
  storeDir?: string;
  /** Optional LAN URL for same-WiFi pairing (used with AURA payloads). */
  lanUrl?: string;
}

/** v1.84 ARCHITECTURAL FIX: NEXUS code → portable URL for mobile apps.
 *  Root problem the user surfaced: mobile AI apps (Claude/Gemini/ChatGPT
 *  on phone) cannot resolve a bare 6-char code -- they have no Mneme +
 *  no MCP. They hallucinate something completely unrelated.
 *
 *  Solution: every NEXUS code is ALSO published as a portable URL the
 *  mobile AI can fetch. The "code" stays for Mneme-aware destinations;
 *  the URL is for everyone else. User shares whichever the destination
 *  can use:
 *    - Mneme-aware destination (Cursor laptop)  -> short code "K7M9X2"
 *    - Mobile app / web AI                       -> portable URL
 */
export interface NexusPortable {
  /** The 6-char code (Mneme-aware destinations). */
  code: string;
  /** A user-shareable URL the mobile AI can fetch.
   *  Prefers gistUrl > lanUrl > null. */
  url: string | null;
  /** Human-readable instruction the SOURCE AI can read aloud to the user. */
  instruction: string;
  /** A QR-friendly payload combining code + URL on one line.
   *  Format: "mneme:K7M9X2|<url>" -- short, scannable, deterministic. */
  qrPayload: string;
}

export function portableFor(entry: NexusCode): NexusPortable {
  const url = entry.gistUrl ?? null;
  const qrPayload = url ? `mneme:${entry.code}|${url}` : `mneme:${entry.code}`;
  const instruction = url
    ? `On the other device, either type code "${entry.code}" (if it has Mneme) OR paste this URL into the chat and say "fetch this brain": ${url}`
    : `On the other device with Mneme, type code "${entry.code}". (For a phone app WITHOUT Mneme, ask source AI to mint a code WITH a Gist URL.)`;
  return { code: entry.code, url, instruction, qrPayload };
}

function ensureStoreDir(repoRoot: string, override?: string): string {
  const dir = override ?? join(repoRoot, STORE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH * 2);
  let out = "";
  for (let i = 0; out.length < CODE_LENGTH && i < bytes.length; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Mint a NEXUS code for a soul prompt. Returns the code + persists. */
export function mintNexusCode(repoRoot: string, input: MintInput): NexusCode & { portable: NexusPortable } {
  const dir = ensureStoreDir(repoRoot, input.storeDir);
  const now = Date.now();
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const code = generateCode();
  const entry: NexusCode = {
    code,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    soulHash: sha16(input.soulText),
    soulText: input.soulText,
    gistUrl: input.gistUrl,
    resolveCount: 0,
  };
  appendFileSync(join(dir, STORE_FILE), JSON.stringify(entry) + "\n", "utf8");
  // v1.84: bundle the portable representation alongside so source AI
  // can directly hand the user a mobile-friendly URL + instruction.
  return { ...entry, portable: portableFor(entry) };
}

/** Resolve a NEXUS code back to its entry. Returns null if expired or
 *  unknown. Bumps `resolveCount` on success. */
export function resolveNexusCode(repoRoot: string, code: string, storeDir?: string): NexusCode | null {
  const dir = ensureStoreDir(repoRoot, storeDir);
  const path = join(dir, STORE_FILE);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  // Walk in reverse to find the newest matching code (in case of accidental
  // collision -- exceedingly rare but possible at 6 chars).
  const now = Date.now();
  let matched: NexusCode | null = null;
  let matchedIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry: NexusCode = JSON.parse(lines[i]!);
      if (entry.code !== code) continue;
      if (new Date(entry.expiresAt).getTime() < now) {
        // expired -- keep walking in case there's a fresher entry above
        continue;
      }
      matched = entry;
      matchedIdx = i;
      break;
    } catch {
      // skip corrupt line
    }
  }
  if (!matched || matchedIdx < 0) return null;

  // Bump resolveCount by rewriting the matching line.
  matched.resolveCount += 1;
  lines[matchedIdx] = JSON.stringify(matched);
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  return matched;
}

/** List all live (unexpired) NEXUS codes. */
export function listNexusCodes(repoRoot: string, storeDir?: string): NexusCode[] {
  const dir = ensureStoreDir(repoRoot, storeDir);
  const path = join(dir, STORE_FILE);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const now = Date.now();
  const out: NexusCode[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      const entry: NexusCode = JSON.parse(line);
      if (new Date(entry.expiresAt).getTime() >= now) out.push(entry);
    } catch {
      // skip
    }
  }
  return out;
}
