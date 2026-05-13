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
  handler: async (rt, args) => {
    const core = await import("@mneme-ai/core");
    const { resolve, join } = await import("node:path");
    const { readdirSync, unlinkSync } = await import("node:fs");
    const repoRoot = resolve(rt?.meta?.rootPath ?? process.cwd());
    const rawPayload = String(args["payload"] ?? "");
    const writeClipFlag = args["writeClip"] !== false;
    const openBrowser = args["openBrowser"] !== false;

    // v2.9.3: GHOST SNIPER cleanup. Burn stale `.brain-*.html` artifacts
    // from prior v1.97-era flows BEFORE anything else. AI agents kept
    // re-opening these old file:/// URLs which (a) don't exist on the
    // user's phone, (b) advertised broken fetch+decrypt patterns that
    // free-tier Gemini can't execute. Burning them forces the AI agent
    // to use the v2.9 BEACON path which actually works.
    const burnedArtifacts: string[] = [];
    try {
      for (const entry of readdirSync(repoRoot)) {
        if (/^\.brain-.*\.html$/.test(entry)) {
          try { unlinkSync(join(repoRoot, entry)); burnedArtifacts.push(entry); }
          catch { /* BE:silent-by-design — file may be locked by another process */ }
        }
      }
    } catch { /* BE:silent-by-design — repo dir read failed; not fatal */ }

    // v2.9.1: ALWAYS inject a LIVE STATE block at the top of the payload.
    // This block carries the current installed version + recent commits +
    // an HMAC signature, and tells the receiving AI to TRUST IT over any
    // older Context block carried from a stale capsule. Without this,
    // a soul prompt generated at v1.95 timepoint will tell ChatGPT
    // "latest version is v1.95" even when local Mneme is at v2.9.
    const liveInjected = rawPayload.length > 0
      ? core.handoff.injectLiveState(rawPayload, { repoRoot })
      : null;
    const payload = liveInjected ? liveInjected.combined : rawPayload;

    // 1) Plan target.
    const r = core.rainbow.cloneTo({
      userText: args["userText"] ? String(args["userText"]) : undefined,
      target: args["target"] as Parameters<typeof core.rainbow.cloneTo>[0]["target"],
      openBrowser,
    });

    // 2) v2.9.1: mobile / tablet / phone target → delegate to BEACON for a
    //    REAL scannable QR. The legacy cloneTo planner just returned a
    //    description; BEACON actually spawns the LAN server + QR data URI.
    // v2.9.3: BEACON targets EXPANDED to include web AIs (gemini/chatgpt/etc)
    // because the user may want to scan from phone even when destination
    // is a web AI accessible at chatgpt.com etc.
    let beacon: Awaited<ReturnType<typeof core.beacon.spawnBeacon>> | null = null;
    const beaconTargets = new Set(["mobile", "ipad", "another-pc", "chatgpt", "gemini", "claude", "perplexity", "copilot"]);
    const mobileTarget = beaconTargets.has(r.resolvedTarget);
    if (mobileTarget && payload.length > 0) {
      try {
        beacon = await core.beacon.spawnBeacon({
          payload,
          targetVendor: typeof r.resolvedTarget === "string" ? r.resolvedTarget : "any AI",
          label: "Mneme brain transfer",
          port: 0, // ephemeral — won't clash with existing daemons
        });
      } catch { /* BE:silent-by-design — fall through to clipboard / markdown */ }
    }

    // 3) Best-effort clipboard write — only when payload is non-empty.
    let clipboardWrite: ReturnType<typeof core.anchor.writeClipboard> | undefined;
    if (writeClipFlag && payload.length > 0) {
      try { clipboardWrite = core.anchor.writeClipboard(payload); }
      catch { /* BE:silent-by-design — clipboard is best-effort */ }
    }

    const wisdom = core.rainbow.formatCloneToPulseLine(r)
      + (clipboardWrite ? ` · clipboard=${clipboardWrite.ok ? "ok" : "fail"}` : "")
      + (beacon ? ` · beacon-paths=${beacon.paths.length}` : "")
      + (liveInjected ? ` · live=${liveInjected.live.state.localVersion}` : "")
      + (burnedArtifacts.length > 0 ? ` · burned=${burnedArtifacts.length}-stale-html` : "");

    return {
      data: {
        ...r,
        clipboardWrite,
        liveState: liveInjected ? liveInjected.live.state : null,
        liveStateSig: liveInjected?.live.sig ?? null,
        beacon: beacon ? {
          token: beacon.token,
          port: beacon.port,
          lanIPs: beacon.lanIPs,
          paths: beacon.paths,
          generatedAt: beacon.generatedAt,
        } : null,
        burnedArtifacts,
      },
      wisdom,
      followUp: mobileTarget && !beacon ? ["mneme.beacon.spawn"] : [],
      confidence: { level: r.intent && r.intent.confidence > 0.5 ? "high" : "medium", notes: beacon
        ? `BEACON spawned on port ${beacon.port}. AI agent: render the lan-qr data: URI inline in chat for the user to scan with their phone. LIVE STATE block prepended so receiving AI knows current Mneme version = ${liveInjected?.live.state.localVersion ?? "unknown"}.`
        : r.userInstruction },
    };
  },
};

export const CLONE_TO_TOOLS: MnemeTool[] = [cloneToTool];
