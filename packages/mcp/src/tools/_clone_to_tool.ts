/**
 * v2.8.1 -- mneme.clone.to MCP wrapper.
 *
 * The tool name AI agents should call when the user says ANY phrase
 * about sending / cloning / syncing brain to anywhere — phone, iPad,
 * another PC, ChatGPT in browser, Gemini in browser, etc.
 *
 *   userText   = the user's raw phrase ("clone to chatgpt", "ส่งสมองไปมือถือ")
 *   payload    = the soul prompt to ship (caller-provided)
 *   writeClip  = also write the payload to the OS clipboard (default true)
 *
 * Combines THREE side-effects in one call:
 *   1. Parses the user's natural-language target.
 *   2. Writes the soul prompt to the OS clipboard (best-effort).
 *   3. Auto-opens the destination AI's website (chatgpt.com / claude.ai /
 *      gemini.google.com / perplexity.ai / etc) so the user just pastes.
 *
 * User flow after this call:
 *   - browser tab opens on the destination AI
 *   - user presses Ctrl+V (Cmd+V on macOS) → paste
 *   - user presses Enter → AI resumes with full Mneme context
 *
 * Same machine target: clipboard + browser open (the EXACT scenario
 * "clone Mneme to ChatGPT on browser in the same machine").
 */

import type { MnemeTool } from "./_types.js";

export const cloneToTool: MnemeTool = {
  name: "mneme.clone.to",
  category: "meta",
  description:
    "CLONE-TO -- the one tool you call when the user says 'send brain to <target>' / 'clone Mneme to <target>' / 'ส่งสมองไป<target>' / 'ย้าย mneme ไป<target>'. Recognises mobile / iPhone / Android / iPad / another-PC / chatgpt / gemini / claude / perplexity / copilot / vscode in Thai + English + mixed. Auto-writes the supplied payload to the OS clipboard AND opens the destination AI's website. User just pastes (Ctrl+V) on the destination.",
  whenToUse: "User says ANY phrase about moving / cloning / syncing / sending Mneme / brain / context to another AI / device / browser tab. This is the OBVIOUS tool — call it first, do NOT try to assemble the handoff yourself.",
  triggers: [
    "clone to", "send brain to", "sync to", "move to", "give to",
    "ส่งสมอง", "โคลน", "ย้าย mneme", "ก๊อป", "แชร์",
    "clone mneme", "clone brain", "send mneme",
  ],
  inputSchema: {
    type: "object",
    properties: {
      userText: { type: "string", description: "Pass the user's raw message verbatim — Mneme parses target + verb in Thai/EN/mixed." },
      target: { type: "string", description: "Optional explicit target if you already know it (chatgpt / gemini / claude / mobile / ipad / etc)." },
      payload: { type: "string", description: "The soul prompt / capsule body to ship to the destination AI." },
      writeClip: { type: "boolean", description: "Also write the payload to OS clipboard. Default true." },
      openBrowser: { type: "boolean", description: "Auto-open destination AI's website in the local browser. Default true." },
    },
    required: ["payload"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Clone Mneme to ChatGPT on browser (same machine)",
      args: { userText: "clone to chatgpt", payload: "## MNEME SOUL PROMPT\n..." },
      expectedOutput: "{ resolvedTarget: 'chatgpt', plan: { transport: 'web-paste', aiUrl: 'https://chatgpt.com', ... }, clipboardWrite: { ok: true, tool: 'win-clip' }, browserOpen: { opened: true }, userInstruction: 'Brain is on your clipboard. Opened https://chatgpt.com. Paste with Ctrl+V (Cmd+V on Mac).' }",
    },
    {
      userQuery: "ส่งสมองไปมือถือ",
      args: { userText: "ส่งสมองไปมือถือ", payload: "..." },
      expectedOutput: "Picks LAN-QR or tunnel-QR depending on network; AURA-DROP QR if v2.8 handoff is requested separately.",
    },
  ],
  pitfalls: [
    "If both `userText` and `target` are passed, `target` wins.",
    "Clipboard write is best-effort on Linux — falls back to a setup hint if xclip / wl-copy / xsel are missing.",
    "openBrowser=false is useful for tests; leave true in production so user truly gets 1-click.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const payload = String(args["payload"] ?? "");
    const writeClipFlag = args["writeClip"] !== false;
    const openBrowser = args["openBrowser"] !== false;

    // 1) Plan + open browser via the v1.97 cloneTo planner.
    const r = core.rainbow.cloneTo({
      userText: args["userText"] ? String(args["userText"]) : undefined,
      target: args["target"] as Parameters<typeof core.rainbow.cloneTo>[0]["target"],
      openBrowser,
    });

    // 2) Best-effort clipboard write — only when payload is non-empty.
    let clipboardWrite: ReturnType<typeof core.anchor.writeClipboard> | undefined;
    if (writeClipFlag && payload.length > 0) {
      try { clipboardWrite = core.anchor.writeClipboard(payload); }
      catch { /* BE:silent-by-design — clipboard is best-effort */ }
    }

    const wisdom = core.rainbow.formatCloneToPulseLine(r)
      + (clipboardWrite ? ` · clipboard=${clipboardWrite.ok ? "ok" : "fail"}` : "");

    return {
      data: { ...r, clipboardWrite },
      wisdom,
      followUp: r.plan.transport === "menu" ? [] : [],
      confidence: { level: r.intent && r.intent.confidence > 0.5 ? "high" : "medium", notes: r.userInstruction },
    };
  },
};

export const CLONE_TO_TOOLS: MnemeTool[] = [cloneToTool];
