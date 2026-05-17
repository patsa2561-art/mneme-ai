/**
 * v2.19.38 SOCKETS RELEASE — MCP tools (4 production sockets for v2.19.37 plumbing)
 *
 *   CITIZENS CONTRIBUTE (2):
 *     mneme.citizens.contribute_pack    — pack + sign envelope from local receipts
 *     mneme.citizens.contribute_preview — dry-run preview before push
 *
 *   CONSCIENCE AUTO-HOOK (2):
 *     mneme.card.auto_emit              — failure event → card + SVG + path
 *     mneme.card.daily_digest           — aggregate today's cards → user message
 *
 *   MAYOR AUTO-VOTE (4):
 *     mneme.mayor.detect_vendor         — parse commit msg → vendor
 *     mneme.mayor.auto_vote_from_commit — full pipeline (parse + vote + state)
 *     mneme.mayor.install_hook          — emit post-commit hook script
 *     mneme.mayor.status_line           — IDE status-bar text
 *
 *   BROWSER USERSCRIPT (4):
 *     mneme.browser.userscript           — emit .user.js bytes for Tampermonkey
 *     mneme.browser.manifest             — emit Manifest V3 JSON for Chrome extension
 *     mneme.browser.popup                — emit popup HTML for extension
 *     mneme.browser.readme               — emit install instructions
 */

import type { MnemeTool } from "./_types.js";

// ─── CITIZENS CONTRIBUTE ──────────────────────────────────────────────

export const citizensContributePackTool: MnemeTool = {
  name: "mneme.citizens.contribute_pack",
  category: "audit",
  description: "🪙 CITIZENS (v2.19.38) — pack local protocol receipts into a signed contribution envelope ready for git push to public citizens-audit repo. Anonymises + dedupes + signs. Caller does the git I/O.",
  whenToUse: "End of quarter (manual) or via daemon scheduler. Pair with mneme.citizens.contribute_preview for dry-run.",
  triggers: ["citizens contribute", "quarterly contribution"],
  inputSchema: {
    type: "object",
    properties: {
      receipts: { type: "array" }, installId: { type: "string" },
      windowStartMs: { type: "number" }, windowEndMs: { type: "number" },
    },
    required: ["receipts", "installId"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Pack my Q2 receipts for citizens audit", args: { receipts: [], installId: "abc" }, expectedOutput: "{ envelope: {...}, file: { path, bytes, commitMessage, branchHint } }" }],
  pitfalls: ["installId should be stable per device (e.g. randomBytes written once to .mneme/install-id). Vendor fingerprint derived from this is opaque to outsiders."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const env = core.citizensContribute.packContribution(args as unknown as Parameters<typeof core.citizensContribute.packContribution>[0]);
    const file = core.citizensContribute.emitContributionFile(env);
    return { data: { envelope: env, file }, wisdom: `🪙 packed ${env.count} receipts → ${file.path}`, confidence: { level: "high" } };
  },
};

export const citizensContributePreviewTool: MnemeTool = {
  name: "mneme.citizens.contribute_preview",
  category: "meta",
  description: "🪙 CITIZENS — dry-run preview: shows vendor breakdown + file path + estimated URL before user confirms push.",
  whenToUse: "Before mneme.citizens.contribute_pack to give user a chance to back out.",
  triggers: ["citizens preview", "contribute dry-run"],
  inputSchema: { type: "object", properties: { envelope: { type: "object" }, repoUrl: { type: "string" } }, required: ["envelope"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Preview what I'd contribute", args: { envelope: {} }, expectedOutput: "{ quarter, count, vendorBreakdown, filePath, byteSize, estimatedRepoUrl }" }],
  pitfalls: ["Preview is non-destructive — caller still must do the actual git push."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.citizensContribute.previewContribution(
      args["envelope"] as Parameters<typeof core.citizensContribute.previewContribution>[0],
      args["repoUrl"] as string | undefined,
    );
    return { data: p, wisdom: `🪙 would push ${p.count} receipts to ${p.filePath}`, confidence: { level: "high" } };
  },
};

// ─── CONSCIENCE AUTO-HOOK ─────────────────────────────────────────────

export const cardAutoEmitTool: MnemeTool = {
  name: "mneme.card.auto_emit",
  category: "meta",
  description: "📣 CARD (v2.19.38 socket) — failure event → auto-built Conscience Card + SVG + text + suggested file path. Caller (daemon) writes SVG to .mneme/cards/<quarter>/<cardId>.svg.",
  whenToUse: "Hooked into apostille / truth_forensic / apoptosis / fairness / vaccine_trigger / guard outputs.",
  triggers: ["card auto emit", "card from failure"],
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string" }, vendor: { type: "string" }, modelVersion: { type: "string" },
      aiClaim: { type: "string" }, detection: { type: "string" },
      verdict: { type: "string" }, outcomeClass: { type: "string" }, savedValue: { type: "string" },
    },
    required: ["source", "vendor", "aiClaim", "detection"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Emit card for this hallucination", args: { source: "apoptosis", vendor: "claude", aiClaim: "...", detection: "...", verdict: "NECROTIC" }, expectedOutput: "{ card, svgBytes, textBytes, filePath, reason }" }],
  pitfalls: ["Events that aren't AI failures (e.g., apostille outcomeClass=merged) skip card emission — that's by design."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.conscienceAutoHook.autoEmitConscienceCard(args as unknown as Parameters<typeof core.conscienceAutoHook.autoEmitConscienceCard>[0]);
    return { data: r, wisdom: r.card ? `📣 card ${r.card.cardId} (${r.card.kind})` : `📣 skipped: ${r.reason}`, confidence: { level: r.card ? "high" : "low" } };
  },
};

export const cardDailyDigestTool: MnemeTool = {
  name: "mneme.card.daily_digest",
  category: "meta",
  description: "📣 CARD — aggregate today's cards into a daily digest with user-facing message. Daemon surfaces this in the pulse so user knows when there's something share-worthy.",
  whenToUse: "End of day; pulse refresh; user asks 'what did Mneme catch today?'.",
  triggers: ["daily digest", "card digest"],
  inputSchema: { type: "object", properties: { cards: { type: "array" }, todayMs: { type: "number" } }, required: ["cards"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What AI failures did Mneme catch today?", args: { cards: [] }, expectedOutput: "{ totalCards, kindBreakdown, topVendor, topKind, userMessage }" }],
  pitfalls: ["Filter cards to today's dayBucketMs only — caller passes full set; digest filters internally."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.conscienceAutoHook.buildDailyDigest(
      args["cards"] as Parameters<typeof core.conscienceAutoHook.buildDailyDigest>[0],
      args["todayMs"] as number | undefined,
    );
    return { data: d, wisdom: d.userMessage, confidence: { level: "high" } };
  },
};

// ─── MAYOR AUTO-VOTE ──────────────────────────────────────────────────

export const mayorDetectVendorTool: MnemeTool = {
  name: "mneme.mayor.detect_vendor",
  category: "meta",
  description: "👑 MAYOR (v2.19.38 socket) — parse a commit message for AI vendor trailers (Co-Authored-By: Claude / AI-Generated-By: gpt / etc). Returns null for human-only commits.",
  whenToUse: "Inside post-commit git hook OR batch backfill via mneme.mayor.auto_vote_from_commit.",
  triggers: ["detect vendor commit", "trailer parse"],
  inputSchema: { type: "object", properties: { commitMessage: { type: "string" } }, required: ["commitMessage"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Who wrote this commit?", args: { commitMessage: "fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>" }, expectedOutput: "{ vendor: 'claude' }" }],
  pitfalls: ["Recognises 8 canonical vendors + generic AI-Generated-By: <name> fallback."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const vendor = core.mayorAutoVote.detectVendorFromCommit(String(args["commitMessage"] ?? ""));
    return { data: { vendor }, wisdom: vendor ? `👑 detected ${vendor}` : "👑 no AI trailer (human commit)", confidence: { level: vendor ? "high" : "low" } };
  },
};

export const mayorAutoVoteFromCommitTool: MnemeTool = {
  name: "mneme.mayor.auto_vote_from_commit",
  category: "lab",
  description: "👑 MAYOR — full auto-vote pipeline: parse commit msg → detect vendor → cast vote (dedupe by commitSha). Called from post-commit git hook.",
  whenToUse: "Inside post-commit git hook; or batch backfill from `git log`.",
  triggers: ["auto vote from commit"],
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "object" }, commitMessage: { type: "string" }, commitSha: { type: "string" }, castAtMs: { type: "number" },
    },
    required: ["state", "commitMessage"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Auto-vote from this commit", args: { state: {}, commitMessage: "fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>", commitSha: "abc" }, expectedOutput: "{ state, vote, detectedVendor, reason }" }],
  pitfalls: ["State is mutated functionally (returned as new state). Caller persists."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.mayorAutoVote.autoVoteFromCommit(args as unknown as Parameters<typeof core.mayorAutoVote.autoVoteFromCommit>[0]);
    return { data: r, wisdom: r.reason, confidence: { level: r.vote ? "high" : "low" } };
  },
};

export const mayorInstallHookTool: MnemeTool = {
  name: "mneme.mayor.install_hook",
  category: "meta",
  description: "👑 MAYOR — emit post-commit git hook script bytes (bash for POSIX + PowerShell for Windows). Caller writes to .git/hooks/post-commit + chmod +x.",
  whenToUse: "One-time setup: 'mneme mayor install-hook'. Idempotent — re-running overwrites with latest version.",
  triggers: ["install mayor hook", "post-commit hook"],
  inputSchema: { type: "object", properties: { shell: { type: "string", enum: ["bash", "pwsh"] } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Install the auto-vote hook", args: { shell: "bash" }, expectedOutput: "{ script: '#!/usr/bin/env bash\\n...' }" }],
  pitfalls: ["Caller does the actual file write + chmod +x. Hook is best-effort: if Mneme isn't installed, the hook silently no-ops."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const shell = (args["shell"] === "pwsh") ? "pwsh" : "bash";
    const script = shell === "pwsh" ? core.mayorAutoVote.generatePostCommitHookPwsh() : core.mayorAutoVote.generatePostCommitHook();
    return { data: { shell, script, suggestedPath: shell === "pwsh" ? ".git/hooks/post-commit.ps1" : ".git/hooks/post-commit" }, wisdom: `👑 ${shell} post-commit hook (${script.length} bytes)`, confidence: { level: "high" } };
  },
};

export const mayorStatusLineTool: MnemeTool = {
  name: "mneme.mayor.status_line",
  category: "meta",
  description: "👑 MAYOR — IDE status-bar text generator. Formats winner + runner-up + term-remaining. Used by VSCode/Cursor plugin.",
  whenToUse: "After mneme.mayor.tally — extract winner/runner-up/term info, pass to this for one-line display.",
  triggers: ["mayor status line", "status bar mayor"],
  inputSchema: {
    type: "object",
    properties: {
      winnerVendor: { type: "string" }, winnerVoteCount: { type: "number" },
      runnerUpVendor: { type: "string" }, runnerUpVoteCount: { type: "number" },
      marginPct: { type: "number" }, termRemainingMs: { type: "number" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Status line for IDE", args: { winnerVendor: "claude", winnerVoteCount: 35 }, expectedOutput: "{ statusLine: '👑 Mayor: claude 35 ...' }" }],
  pitfalls: ["Output is a single line — caller truncates further if status bar is narrow."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const line = core.mayorAutoVote.generateStatusLine(args as unknown as Parameters<typeof core.mayorAutoVote.generateStatusLine>[0]);
    return { data: { statusLine: line }, wisdom: line, confidence: { level: "high" } };
  },
};

// ─── BROWSER USERSCRIPT / EXTENSION ────────────────────────────────────

export const browserUserscriptTool: MnemeTool = {
  name: "mneme.browser.userscript",
  category: "meta",
  description: "🛡 BROWSER (v2.19.38 socket) — emit single-file Tampermonkey/Violentmonkey userscript bytes. Production-ready; install in any browser via Tampermonkey.",
  whenToUse: "Distribution: write to dist/browser/mneme.user.js so users can one-click install.",
  triggers: ["browser userscript", "tampermonkey script"],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get the userscript bytes", args: {}, expectedOutput: "{ script: '// ==UserScript==\\n...' }" }],
  pitfalls: ["Script self-contained — no external deps. Works in Chrome/Firefox/Edge/Safari via Tampermonkey."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const script = core.browserUserscript.generateUserscript();
    return { data: { script, suggestedPath: "dist/browser/mneme.user.js" }, wisdom: `🛡 userscript ${script.length} bytes`, confidence: { level: "high" } };
  },
};

export const browserManifestTool: MnemeTool = {
  name: "mneme.browser.manifest",
  category: "meta",
  description: "🛡 BROWSER — emit Manifest V3 JSON for Chrome Web Store extension. Pair with mneme.browser.popup + browser core JS for full extension.",
  whenToUse: "Building the .crx extension package.",
  triggers: ["browser manifest", "chrome manifest v3"],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get manifest.json", args: {}, expectedOutput: "{ manifest: { manifest_version: 3, ... } }" }],
  pitfalls: ["Manifest references content.js + popup.html — caller must bundle those (via mneme.browser.popup + mneme.browser.userscript)."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const manifest = core.browserUserscript.generateManifestV3();
    return { data: { manifest, suggestedPath: "dist/browser/manifest.json" }, wisdom: `🛡 manifest v${manifest.manifest_version} · ${manifest.host_permissions.length} hosts`, confidence: { level: "high" } };
  },
};

export const browserPopupTool: MnemeTool = {
  name: "mneme.browser.popup",
  category: "meta",
  description: "🛡 BROWSER — emit popup.html for Chrome extension. Shows receipt count + export/clear buttons.",
  whenToUse: "Building the .crx extension package.",
  triggers: ["browser popup", "extension popup"],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Get popup HTML", args: {}, expectedOutput: "{ html: '<!DOCTYPE html>...' }" }],
  pitfalls: ["Popup uses inline <script> — content security policy must allow."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const html = core.browserUserscript.generatePopupHtml();
    return { data: { html, suggestedPath: "dist/browser/popup.html" }, wisdom: `🛡 popup ${html.length} bytes`, confidence: { level: "high" } };
  },
};

export const browserReadmeTool: MnemeTool = {
  name: "mneme.browser.readme",
  category: "meta",
  description: "🛡 BROWSER — emit install README for both Tampermonkey + Chrome extension paths. Bundle with distribution artifacts.",
  whenToUse: "Building distribution; surfacing install instructions to user.",
  triggers: ["browser readme", "install instructions"],
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How do I install the browser extension?", args: {}, expectedOutput: "{ markdown: '# 🛡 Mneme Browser Receipt — install once...' }" }],
  pitfalls: ["Caller may translate to user's language; the canonical markdown is English."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const md = core.browserUserscript.generateBrowserReadme();
    return { data: { markdown: md, suggestedPath: "dist/browser/README.md" }, wisdom: `🛡 README ${md.length} bytes`, confidence: { level: "high" } };
  },
};

export const V1938_SOCKETS_TOOLS: MnemeTool[] = [
  citizensContributePackTool, citizensContributePreviewTool,
  cardAutoEmitTool, cardDailyDigestTool,
  mayorDetectVendorTool, mayorAutoVoteFromCommitTool, mayorInstallHookTool, mayorStatusLineTool,
  browserUserscriptTool, browserManifestTool, browserPopupTool, browserReadmeTool,
];
