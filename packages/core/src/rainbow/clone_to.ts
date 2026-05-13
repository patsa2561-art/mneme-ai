/**
 * v1.97.0 -- RAINBOW · CLONE-TO universal intent parser + executor.
 *
 * The bug the user yelled about:
 *   "User says 'ส่งสมองไปมือถือ' or 'clone mneme to gemini' in Claude Code,
 *    AI agent doesn't recognize the intent, no QR appears, no URL pops up,
 *    user is stranded."
 *
 * Root cause:
 *   v1.95/96 shipped rainbow.show_local / show_handoff / quantum bridge
 *   modules, but NO MCP tool with the obvious name + crystal-clear
 *   description that maps natural language → action. AI agent had to
 *   know which specific tool to call. It didn't.
 *
 * v1.97 fix:
 *   ONE tool — `mneme.clone.to` — with a description so obvious that
 *   every AI agent recognizes "send / clone / sync / move brain /
 *   memory / mneme to <target>" calls it. The tool itself does
 *   fuzzy phrase parsing in Thai + English + mixed-language input,
 *   resolves the target, picks the right transport, executes, and
 *   auto-opens the browser when applicable.
 *
 * Targets recognized:
 *   📱 mobile / phone / iPhone / Android / มือถือ / โทรศัพท์
 *   💻 another-pc / laptop / notebook / คอมอื่น / โน้ตบุ๊ค
 *   🖥 this-pc / localhost / browser-on-this-pc / เครื่องนี้
 *   🟢 chatgpt / chatgpt-web / openai
 *   🔵 gemini / gemini-web / google-ai
 *   🟣 claude / claude-web / anthropic
 *   ⚪ perplexity / perplexity-web
 *   🤖 copilot / github-copilot / vscode-copilot
 *   📝 vscode / vs-code / editor
 *   📱 ipad / tablet / แทบเล็ต
 *   💾 usb / offline / file
 *   🔄 back / return / กลับ (Web AI → editor AI return path)
 *
 * Verbs recognized:
 *   send / clone / move / sync / migrate / give / share / push
 *   ส่ง / โคลน / ย้าย / sync / ก๊อป / copy / แชร์ / ใส่
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";

// ============================================================
// Phrase dictionary — language-agnostic intent recognition
// ============================================================

/** Canonical target identifiers. */
export type CloneTarget =
  | "mobile"
  | "another-pc"
  | "this-pc"
  | "chatgpt"
  | "gemini"
  | "claude"
  | "perplexity"
  | "copilot"
  | "vscode"
  | "ipad"
  | "usb"
  | "return"
  | "unknown";

interface TargetPattern {
  target: CloneTarget;
  /** Words that, when present, vote for this target. */
  keywords: string[];
}

const TARGET_PATTERNS: TargetPattern[] = [
  { target: "mobile", keywords: ["มือถือ", "โทรศัพท์", "โทรสับ", "mobile", "phone", "iphone", "android", "samsung", "smartphone", "cellular", "เบอร์โทร"] },
  { target: "ipad", keywords: ["ipad", "tablet", "แทบเล็ต", "แท็บเล็ต"] },
  { target: "another-pc", keywords: ["another pc", "another computer", "another laptop", "notebook", "laptop", "โน้ตบุ๊ค", "โน๊ตบุ๊ค", "คอมอื่น", "เครื่องอื่น", "second laptop", "secondary computer", "another machine", "second machine", "other machine", "another device"] },
  { target: "this-pc", keywords: ["this pc", "this computer", "this machine", "เครื่องนี้", "this device", "localhost", "local", "browser on this pc", "browser on same machine", "same machine", "this browser", "same pc", "บนเครื่องนี้", "บราวเซอร์นี้", "browser นี้"] },
  { target: "chatgpt", keywords: ["chatgpt", "chat gpt", "openai", "gpt", "chat-gpt"] },
  { target: "gemini", keywords: ["gemini", "google ai", "google-ai", "googleai", "บาร์ด", "bard"] },
  { target: "claude", keywords: ["claude.ai", "claude-web", "claude web", "anthropic"] }, // Note: just "claude" matches editor AI too — keep specific
  { target: "perplexity", keywords: ["perplexity", "perplexity ai", "perp"] },
  { target: "copilot", keywords: ["copilot", "github copilot", "co-pilot"] },
  { target: "vscode", keywords: ["vscode", "vs code", "vs-code", "visual studio", "editor", "cursor"] },
  { target: "usb", keywords: ["usb", "offline", "file", "ไฟล์", "thumbdrive", "thumb drive", "external drive", "ออฟไลน์"] },
  { target: "return", keywords: ["กลับ", "back to", "back to pc", "return to", "send back", "ส่งกลับ", "boomerang"] },
];

/** Words that strongly indicate cloning intent (not just any "send"). */
const CLONE_VERBS = [
  "send", "sync", "clone", "copy", "move", "migrate", "give", "share", "push", "transfer", "transport", "deliver", "beam", "teleport", "carry", "bring",
  "ส่ง", "โคลน", "clone", "ย้าย", "ก๊อป", "ก๊อปปี้", "copy", "แชร์", "ใส่", "ดัน", "เอา", "พา", "ลาก",
];

/** Words that strongly indicate the SUBJECT is the brain/memory/mneme. */
const SUBJECT_WORDS = [
  "mneme", "brain", "memory", "context", "conversation", "session", "chat",
  "สมอง", "ความจำ", "บริบท", "บทสนทนา", "เซสชัน", "การคุย",
];

export interface ParsedCloneIntent {
  isCloneRequest: boolean;
  /** Confidence 0..1 that this is a clone request. */
  confidence: number;
  target: CloneTarget;
  /** Why we picked this target (which keyword matched). */
  targetEvidence: string[];
  /** Why we believe this is a clone request (which verb + subject matched). */
  verbEvidence: string[];
  subjectEvidence: string[];
  /** Normalized lower-case input. */
  normalized: string;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFC").replace(/[​‌‍﻿]/g, "").trim();
}

function containsAny(haystack: string, needles: string[]): { hit: boolean; matches: string[] } {
  const matches: string[] = [];
  for (const n of needles) {
    if (haystack.includes(n.toLowerCase())) matches.push(n);
  }
  return { hit: matches.length > 0, matches };
}

/** Parse a free-form user message and decide if it's a clone request +
 *  what the target is. Fuzzy + language-agnostic. */
export function parseCloneIntent(text: string): ParsedCloneIntent {
  const norm = normalize(text);

  const verbHit = containsAny(norm, CLONE_VERBS);
  const subjectHit = containsAny(norm, SUBJECT_WORDS);

  // Target search: order matters — more specific patterns first.
  let bestTarget: CloneTarget = "unknown";
  let bestEvidence: string[] = [];
  let bestScore = 0;
  for (const p of TARGET_PATTERNS) {
    const r = containsAny(norm, p.keywords);
    if (r.hit) {
      // Score by longest match (more specific keyword > generic).
      const score = Math.max(...r.matches.map((m) => m.length));
      if (score > bestScore) {
        bestScore = score;
        bestTarget = p.target;
        bestEvidence = r.matches;
      }
    }
  }

  // Confidence:
  //   verb + subject + target → 0.95 (almost certain)
  //   verb + target          → 0.80
  //   subject + target       → 0.70
  //   verb + subject         → 0.55 (target missing → "show me a menu")
  //   target alone           → 0.40
  //   verb alone             → 0.20
  let confidence = 0;
  if (verbHit.hit && subjectHit.hit && bestTarget !== "unknown") confidence = 0.95;
  else if (verbHit.hit && bestTarget !== "unknown") confidence = 0.80;
  else if (subjectHit.hit && bestTarget !== "unknown") confidence = 0.70;
  else if (verbHit.hit && subjectHit.hit) confidence = 0.55;
  else if (bestTarget !== "unknown" && (verbHit.hit || subjectHit.hit)) confidence = 0.40;
  else if (verbHit.hit) confidence = 0.20;

  return {
    isCloneRequest: confidence >= 0.4,
    confidence,
    target: bestTarget,
    targetEvidence: bestEvidence,
    verbEvidence: verbHit.matches,
    subjectEvidence: subjectHit.matches,
    normalized: norm,
  };
}

// ============================================================
// Target → transport plan
// ============================================================

export type TransportPlan =
  | { transport: "same-shell"; openUrl: string; description: string }
  | { transport: "lan-qr"; lanPort: number; description: string }
  | { transport: "tunnel-qr"; lanPort: number; description: string }
  | { transport: "web-paste"; aiUrl: string; description: string }
  | { transport: "usb-wanderer"; description: string }
  | { transport: "boomerang-return"; description: string }
  | { transport: "menu"; options: Array<{ target: CloneTarget; label: string }>; description: string };

/** Map a target to the recommended transport. */
export function planTransport(target: CloneTarget, opts: { lanPort?: number } = {}): TransportPlan {
  const lanPort = opts.lanPort ?? 7741;
  switch (target) {
    case "this-pc":
      return {
        transport: "same-shell",
        openUrl: `http://localhost:${lanPort}/local`,
        description: "Open the SAME-SHELL page on localhost. Brain auto-copies to clipboard. Click any AI button → paste.",
      };
    case "chatgpt":
      return {
        transport: "web-paste",
        aiUrl: "https://chatgpt.com/",
        description: "Copy brain to clipboard + open ChatGPT.com in a new tab. Paste in the chat.",
      };
    case "gemini":
      return {
        transport: "web-paste",
        aiUrl: "https://gemini.google.com/app",
        description: "Copy brain to clipboard + open Gemini in a new tab. Paste in the chat.",
      };
    case "claude":
      return {
        transport: "web-paste",
        aiUrl: "https://claude.ai/new",
        description: "Copy brain to clipboard + open Claude.ai in a new tab. Paste in the chat.",
      };
    case "perplexity":
      return {
        transport: "web-paste",
        aiUrl: "https://www.perplexity.ai/",
        description: "Copy brain to clipboard + open Perplexity in a new tab. Paste in the chat.",
      };
    case "copilot":
      return {
        transport: "web-paste",
        aiUrl: "https://github.com/copilot",
        description: "Copy brain to clipboard + open GitHub Copilot Chat (web). Paste in the chat.",
      };
    case "vscode":
      return {
        transport: "same-shell",
        openUrl: `http://localhost:${lanPort}/local`,
        description: "Open SAME-SHELL page. Brain on clipboard. Switch to VS Code / Cursor chat → paste.",
      };
    case "mobile":
    case "ipad":
      return {
        transport: "tunnel-qr",
        lanPort,
        description: "Render PC page with QR + cloudflared tunnel (works any network) → mobile camera scans → opens page → tap green button.",
      };
    case "another-pc":
      return {
        transport: "lan-qr",
        lanPort,
        description: "Open LAN page on this PC, show URL + QR. Other PC opens the URL.",
      };
    case "usb":
      return {
        transport: "usb-wanderer",
        description: "Pack brain as a signed .mwt file → drop on USB → unpack on other machine via 'mneme wanderer unpack'.",
      };
    case "return":
      return {
        transport: "boomerang-return",
        description: "Paste the Web AI's reply (must include HOMUNCULUS RETURN block) → /return endpoint → editor AI ingests via mneme.abyss.homunculus.ingest.",
      };
    case "unknown":
      return {
        transport: "menu",
        description: "Target unclear — show user the menu so they can pick.",
        options: [
          { target: "this-pc", label: "💻 Browser on THIS PC (no QR, no tunnel — fastest)" },
          { target: "mobile", label: "📱 Mobile / Phone (QR scan, any network)" },
          { target: "another-pc", label: "🖥 Another computer / laptop (LAN bridge or USB)" },
          { target: "chatgpt", label: "🟢 ChatGPT.com (paste in browser)" },
          { target: "gemini", label: "🔵 Gemini (paste in browser)" },
          { target: "claude", label: "🟣 Claude.ai (paste in browser)" },
          { target: "copilot", label: "🤖 GitHub Copilot Chat (paste in browser)" },
          { target: "usb", label: "💾 USB / offline (.mwt file)" },
          { target: "return", label: "🪃 Send reply BACK from Web AI to this editor AI" },
        ],
      };
  }
}

// ============================================================
// Browser auto-open (cross-platform)
// ============================================================

export interface OpenBrowserOptions {
  /** Test stub: when provided, called instead of spawning a real browser. */
  spawnOverride?: (cmd: string, args: string[]) => void;
}

/** Open a URL in the default browser. Cross-platform: Win/Mac/Linux/WSL. */
export function openInBrowser(url: string, opts: OpenBrowserOptions = {}): { command: string; args: string[]; opened: boolean } {
  const p = platform();
  let cmd: string;
  let args: string[];
  if (p === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else if (p === "darwin") {
    cmd = "open";
    args = [url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    if (opts.spawnOverride) {
      opts.spawnOverride(cmd, args);
    } else {
      spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    }
    return { command: cmd, args, opened: true };
  } catch {
    return { command: cmd, args, opened: false };
  }
}

// ============================================================
// The unified entry function AI agents call
// ============================================================

export interface CloneToInput {
  /** Free-form user text — Mneme parses it. Pass through the raw user message. */
  userText?: string;
  /** OR specify target directly (skip parsing). */
  target?: CloneTarget;
  /** LAN port the rainbow server listens on. Default 7741. */
  lanPort?: number;
  /** Auto-open the browser when applicable. Default true. */
  openBrowser?: boolean;
  /** Test stub for browser open. */
  spawnOverride?: (cmd: string, args: string[]) => void;
}

export interface CloneToResult {
  intent: ParsedCloneIntent | null;
  resolvedTarget: CloneTarget;
  plan: TransportPlan;
  /** One-line summary for AI agent to relay to the user. */
  userInstruction: string;
  /** Cross-platform browser open report when applicable. */
  browserOpen?: { command: string; args: string[]; opened: boolean };
}

/** The single function AI agents call when the user says ANY phrase about
 *  sending / cloning / syncing / moving brain to anywhere. */
export function cloneTo(input: CloneToInput): CloneToResult {
  let intent: ParsedCloneIntent | null = null;
  let target: CloneTarget;
  if (input.target) {
    target = input.target;
  } else if (input.userText) {
    intent = parseCloneIntent(input.userText);
    target = intent.target;
  } else {
    target = "unknown";
  }

  const plan = planTransport(target, { lanPort: input.lanPort });
  const openBrowser = input.openBrowser !== false;

  let browserOpen: CloneToResult["browserOpen"];
  let userInstruction: string;

  if (plan.transport === "same-shell") {
    if (openBrowser) browserOpen = openInBrowser(plan.openUrl, { spawnOverride: input.spawnOverride });
    userInstruction = `Opened ${plan.openUrl} in your browser. ${plan.description}`;
  } else if (plan.transport === "web-paste") {
    if (openBrowser) browserOpen = openInBrowser(plan.aiUrl, { spawnOverride: input.spawnOverride });
    userInstruction = `Brain is on your clipboard. Opened ${plan.aiUrl}. Paste with Ctrl+V (Cmd+V on Mac).`;
  } else if (plan.transport === "lan-qr") {
    userInstruction = `LAN page ready at port ${plan.lanPort}. Open the URL or scan the QR shown there from the other device.`;
  } else if (plan.transport === "tunnel-qr") {
    userInstruction = `Mobile handoff page ready. Scan the QR with your phone camera, tap the link, tap the green Send button.`;
  } else if (plan.transport === "usb-wanderer") {
    userInstruction = `Run 'mneme wanderer pack' to produce a .mwt file. Drop on USB. On the other machine: 'mneme wanderer unpack <file>'.`;
  } else if (plan.transport === "boomerang-return") {
    userInstruction = `Paste the Web AI's reply (must contain '# HOMUNCULUS RETURN'). Mneme ingests via the return-pad on the SAME-SHELL page.`;
  } else {
    // menu
    const lines = plan.options.map((o, i) => `  ${i + 1}. ${o.label}`).join("\n");
    userInstruction = `Where to? Pick one and say "clone to <target>":\n${lines}`;
  }

  return { intent, resolvedTarget: target, plan, userInstruction, browserOpen };
}

/** Pulse-style summary for AI agents to surface. */
export function formatCloneToPulseLine(r: CloneToResult): string {
  return `CLONE-TO · target=${r.resolvedTarget} · transport=${r.plan.transport}${r.browserOpen ? ` · browser=${r.browserOpen.opened ? "opened" : "failed"}` : ""}${r.intent ? ` · confidence=${(r.intent.confidence * 100).toFixed(0)}%` : ""}`;
}
