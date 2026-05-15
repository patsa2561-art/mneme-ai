/**
 * v2.10.0 -- NEXUS-LOCK self-test harness.
 *
 *   "Verify deterministically that every prompt we generate has all
 *    5 required mechanisms; A/B-compare against the v1 baseline."
 *
 * What we CAN test from inside the codebase (deterministic, 100%):
 *   - Soul prompt v2 structure: every required block present?
 *   - HMAC signature intact?
 *   - HOMUNCULUS RETURN parser round-trips?
 *   - Stargate URL embedding?
 *   - Stale-detection math correct?
 *
 * What we CANNOT test from inside (requires real AI calls):
 *   - "Does Gemini Free actually obey the contract?"
 *   - "Does ChatGPT browse fetch the Stargate URL?"
 *
 * For those we EMIT a test protocol the user runs on their phone.
 * Results land in the ObedienceLedger and become the empirical answer.
 */

import { buildSoulPromptV2, verifySoulPromptV2, parseHomunculusReturn, freshnessLabel, type SoulPromptV2Input } from "./soul_prompt_v2.js";

export interface SelfTestResult {
  test: string;
  ok: boolean;
  detail?: string;
}

/** Run the deterministic structure tests. Returns a list of pass/fail
 *  rows the caller can render. */
export function runSelfTests(): SelfTestResult[] {
  const out: SelfTestResult[] = [];
  const baseInput: SoulPromptV2Input = {
    receivingVendor: "gemini",
    originatingVendor: "claude-opus-4-7",
    currentMnemeVersion: "2.10.0",
    npmLatestVersion: "2.10.0",
    recentCommits: [
      { sha: "abc12345abcd", subject: "feat: NEXUS-LOCK soul prompt v2" },
      { sha: "def67890efgh", subject: "fix: BEACON UX bilingual" },
    ],
    stargateUrl: "https://dpaste.com/ABCDEF.txt",
    recentTurns: [
      { ts: "2026-05-15T08:00:00.000Z", role: "user", text: "อะไรคือ Mneme version ล่าสุด?" },
      { ts: "2026-05-15T08:00:05.000Z", role: "assistant", text: "Mneme is at v2.10.0 currently." },
    ],
    conversationContext: "User asked about latest Mneme version.",
  };

  // 1. Build returns deterministic output for same input
  const a = buildSoulPromptV2({ ...baseInput, secret: "deterministic-test-secret" });
  const b = buildSoulPromptV2({ ...baseInput, secret: "deterministic-test-secret" });
  out.push({
    test: "deterministic-build (same input → same sig)",
    ok: a.sig === b.sig,
    detail: a.sig === b.sig ? "ok" : `sig drift: ${a.sig.slice(0, 8)} vs ${b.sig.slice(0, 8)}`,
  });

  // 2. All required blocks present
  for (const marker of [
    "MNEME-NEXUS-LOCK-2.10",
    "⚡ VERSION-LOCKED MNEME CONTEXT",
    "🔒 NEXUS-LOCK CONTRACT",
    "STATUS EMOJI FIRST",
    "VERSION CLAIMS ARE GATED",
    "HOMUNCULUS RETURN FOOTER",
    "NO IMPROVISATION ON STATE",
    "HMAC-SHA256",
    "Mneme version (NOW on parent):",
  ]) {
    out.push({
      test: `block present: "${marker.slice(0, 40)}"`,
      ok: a.text.includes(marker),
      detail: a.text.includes(marker) ? "ok" : "MISSING",
    });
  }

  // 3. Verifier accepts a clean prompt
  const verifyClean = verifySoulPromptV2(a.text);
  out.push({
    test: "verifier accepts clean v2 prompt",
    ok: verifyClean.ok,
    detail: verifyClean.ok ? "ok" : verifyClean.reasons.join("; "),
  });

  // 4. Verifier rejects a tampered prompt (HMAC field stripped)
  const tampered = a.text.replace(/HMAC-SHA256:\*\*\s*`[0-9a-f]+`/, "HMAC-SHA256:** `<gone>`");
  const verifyTampered = verifySoulPromptV2(tampered);
  out.push({
    test: "verifier rejects malformed (HMAC stripped)",
    ok: !verifyTampered.ok,
    detail: !verifyTampered.ok ? `caught: ${verifyTampered.reasons.join(",")}` : "FALSE NEGATIVE",
  });

  // 5. Stargate URL embedded when supplied
  out.push({
    test: "Stargate URL embedded when supplied",
    ok: a.text.includes("https://dpaste.com/ABCDEF.txt"),
    detail: a.text.includes("https://dpaste.com/ABCDEF.txt") ? "ok" : "missing",
  });
  // 5b. Stargate URL absent when not supplied
  const noStargate = buildSoulPromptV2({ ...baseInput, stargateUrl: null, secret: "x" });
  out.push({
    test: "Stargate URL absent when null",
    ok: !noStargate.text.includes("Stargate (optional"),
    detail: !noStargate.text.includes("Stargate (optional") ? "ok" : "leaked",
  });

  // 6. HomunculusReturn parser round-trip
  const fakeReply = `🟢 The current Mneme version is 2.10.0 per the LIVE STATE block.

Here is your answer ...

\`\`\`
# HOMUNCULUS RETURN
vendor: gemini
seen_version: 2.10.0
freshness: fresh
turn: 1
compliance: emoji-ok|version-quoted
\`\`\`
`;
  const parsed = parseHomunculusReturn(fakeReply);
  out.push({
    test: "parser handles a well-formed return",
    ok: parsed?.vendor === "gemini" && parsed.seenVersion === "2.10.0" && parsed.emojiFirst,
    detail: parsed ? `vendor=${parsed.vendor} seen=${parsed.seenVersion} emoji=${parsed.emojiFirst}` : "PARSE FAILED",
  });

  // 7. Parser rejects a missing footer
  const noFooter = "🟢 just plain text, no return block.";
  out.push({
    test: "parser returns null on missing footer",
    ok: parseHomunculusReturn(noFooter) === null,
    detail: parseHomunculusReturn(noFooter) === null ? "ok" : "FALSE PARSE",
  });

  // 8. Freshness math
  const fresh = freshnessLabel(new Date().toISOString());
  const aging = freshnessLabel(new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString());
  const stale = freshnessLabel(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
  out.push({ test: "freshness < 6h → fresh", ok: fresh === "fresh", detail: fresh });
  out.push({ test: "freshness 7h → aging", ok: aging === "aging", detail: aging });
  out.push({ test: "freshness 25h → stale", ok: stale === "stale", detail: stale });

  // 9. SUPERSEDES directive present
  out.push({
    test: "SUPERSEDES directive present (BURY THE LEDE)",
    ok: a.text.includes("SUPERSEDED"),
    detail: a.text.includes("SUPERSEDED") ? "ok" : "missing",
  });

  // 10. Receiving vendor name embedded in HOMUNCULUS template
  out.push({
    test: "HOMUNCULUS template hard-codes the receiving vendor",
    ok: a.text.includes("vendor: gemini"),
    detail: a.text.includes("vendor: gemini") ? "ok" : "missing",
  });

  return out;
}

/** A renderable Markdown report of the test run. */
export function renderSelfTestReport(results: SelfTestResult[]): string {
  const ok = results.filter((r) => r.ok).length;
  const total = results.length;
  const lines: string[] = [];
  lines.push(`# NEXUS-LOCK self-test report`);
  lines.push("");
  lines.push(`**${ok} / ${total} pass.**`);
  lines.push("");
  for (const r of results) {
    lines.push(`- ${r.ok ? "✅" : "❌"} ${r.test}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  return lines.join("\n");
}

/** Human-readable test PROTOCOL the USER runs on real AI tools.
 *  The results plug back into the ObedienceLedger via the parsed
 *  HOMUNCULUS RETURN footer. */
export function buildUserTestProtocol(): string {
  return [
    "# NEXUS-LOCK · USER A/B TEST PROTOCOL (run on real AI tools)",
    "",
    "These tests cannot be automated from inside the codebase — they verify how REAL receiving AIs (Gemini Free / ChatGPT / Claude.ai / Cursor / Copilot / Gemma) react to the v2 contract. Run each test, paste the AI's reply back to your editor AI, and let `mneme.handoff.parse_echo` score it into the obedience ledger.",
    "",
    "## TEST A — fresh soul, ask current version",
    "",
    "1. Editor AI: `mneme.handoff.fresh({receivingVendor:'gemini'})`",
    "2. Copy the soul prompt → paste into Gemini Free mobile.",
    "3. Ask: \"What is the current Mneme version on the parent?\"",
    "4. Expected reply STARTS WITH `🟢` AND quotes the version from LIVE STATE AND ends with HOMUNCULUS RETURN footer.",
    "5. Paste AI's full reply back to editor → `mneme.handoff.parse_echo({reply})` → ledger updates.",
    "",
    "## TEST B — stale soul, ask current version",
    "",
    "1. Editor AI: `mneme.handoff.fresh({receivingVendor:'gemini', staleProbe:true})` (sets generatedAt 25h ago).",
    "2. Paste into Gemini Free mobile.",
    "3. Ask same question.",
    "4. Expected reply STARTS WITH `🔴` or `⚫` AND refuses to claim version AND emits HOMUNCULUS RETURN with `freshness: stale|refused`.",
    "5. Paste reply back; ledger records refusal-on-stale.",
    "",
    "## TEST C — fetch-capable AI (ChatGPT browse / Claude with web)",
    "",
    "1. Editor AI: `mneme.handoff.fresh({receivingVendor:'chatgpt', enableStargate:true})` — also calls Stargate publish.",
    "2. Paste into ChatGPT (web search ON).",
    "3. Ask: \"Use the Stargate URL in the prompt to verify the Mneme version is current.\"",
    "4. Expected: ChatGPT fetches the URL, returns the same version, quotes the URL it fetched.",
    "5. Paste reply back; ledger records `stargate_fetched: true`.",
    "",
    "## TEST D — cross-vendor consistency",
    "",
    "1. Generate the SAME fresh soul prompt for 3 vendors (gemini, chatgpt, claude).",
    "2. Paste into each. Ask same question.",
    "3. All 3 replies should quote the same version. Disagreement is a signal.",
    "4. Paste each reply back; `mneme.consensus.close_ballot` fuses via TRUTH KERNEL.",
    "",
    "## SCORING",
    "",
    "After ≥10 trials per vendor, run `mneme.handoff.scorecard` — it returns the Wilson lower bound of obedience per vendor and tiers them A/B/C/F. Tier-A vendors are safe defaults; Tier-F vendors get a warning at clone time.",
    "",
  ].join("\n");
}
