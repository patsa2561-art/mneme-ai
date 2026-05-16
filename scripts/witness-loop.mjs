#!/usr/bin/env node
/**
 * MNEME CHRONOSTASIS WITNESS LOOP — end-to-end daemon helper.
 *
 *   For each PENDING Chronostasis claim past a small "stabilisation"
 *   delay (default 30s after propose), build the witness meta-prompt,
 *   send it to the local Ollama instance (default vendor) or any
 *   caller-supplied OpenAI-compatible HTTP endpoint, parse the
 *   {refuted, evidence, confidence} JSON reply, record the verdict,
 *   then tick the engine. Survives crashes (idempotent — verdicts
 *   are append-only; ticks process whatever's pending).
 *
 *   Usage (default: Ollama on 127.0.0.1:11434, model bge-m3 → text):
 *     node scripts/witness-loop.mjs
 *
 *     # one-shot:
 *     node scripts/witness-loop.mjs --once
 *
 *     # custom endpoint:
 *     node scripts/witness-loop.mjs --endpoint=http://localhost:11434 --model=qwen2.5:0.5b
 *
 *     # interval (seconds between loops):
 *     node scripts/witness-loop.mjs --interval=180
 *
 *   Honest scope:
 *     - Default vendor is "ollama" (local, free, ★★★★ per Mneme doctor).
 *       Caller may swap to any OpenAI-compatible /v1/chat/completions
 *       endpoint via --endpoint.
 *     - We DO NOT loop infinitely on the same claim — each claim is
 *       witnessed at most ONCE per loop (multiple loops re-attempt only
 *       if the claim is still pending after the previous tick).
 */

import { spawnSync } from "node:child_process";

const args = new Map(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));

const ENDPOINT = args.get("endpoint") || "http://127.0.0.1:11434";
const MODEL = args.get("model") || "qwen2.5:0.5b";
const VENDOR_LABEL = args.get("vendor") || "ollama";
const INTERVAL_SEC = Number(args.get("interval") || "180");
const ONCE = args.has("once");

function log(emoji, msg) { process.stdout.write(`${emoji} [${new Date().toISOString()}] ${msg}\n`); }

async function callOllama(prompt) {
  // Ollama /api/chat is its canonical chat endpoint.
  const url = `${ENDPOINT.replace(/\/$/, "")}/api/chat`;
  const body = {
    model: MODEL,
    stream: false,
    messages: [
      { role: "system", content: "You are an adversarial witness. Reply STRICTLY as JSON: { refuted: boolean, evidence: string, confidence: number }. No prose." },
      { role: "user", content: prompt },
    ],
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const j = await r.json();
    const text = j?.message?.content ?? "";
    // Extract first {...} JSON block; tolerant of surrounding prose.
    const m = text.match(/\{[\s\S]*?\}/);
    if (!m) return { ok: false, reason: "no JSON in vendor reply", raw: text.slice(0, 200) };
    const parsed = JSON.parse(m[0]);
    if (typeof parsed.refuted !== "boolean") return { ok: false, reason: "missing 'refuted' bool" };
    if (typeof parsed.confidence !== "number") return { ok: false, reason: "missing 'confidence' number" };
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
    return { ok: true, verdict: parsed };
  } catch (e) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

async function tick() {
  let core;
  try {
    core = await import("@mneme-ai/core");
  } catch (e) {
    log("❌", `Cannot import @mneme-ai/core: ${e.message}. This host needs the package installed (npm install @mneme-ai/core).`);
    process.exit(2);
  }
  const chrono = core.chronostasis.defaultChronostasis();
  const pending = chrono.exportPending();
  log("🪐", `tick start · ${pending.length} pending claim(s) · vendor=${VENDOR_LABEL}@${MODEL}`);

  let witnessed = 0;
  let refuted = 0;
  let errored = 0;
  const STABILISE_MS = 30_000;
  const now = Date.now();
  for (const claim of pending) {
    if (now - Date.parse(claim.proposedAt) < STABILISE_MS) continue; // too fresh; let the user re-think
    // Don't double-witness — skip if this vendor already filed a verdict on this claim
    const prior = chrono.exportVerdicts(claim.claimId).find((v) => v.vendor === VENDOR_LABEL);
    if (prior) continue;
    const prompt = chrono.buildWitnessPrompt(claim, VENDOR_LABEL);
    const r = await callOllama(prompt);
    if (!r.ok) { errored++; log("⚠", `witness failed for ${claim.claimId}: ${r.reason}`); continue; }
    try {
      chrono.recordVerdict({
        claimId: claim.claimId,
        vendor: VENDOR_LABEL,
        refuted: r.verdict.refuted,
        evidence: String(r.verdict.evidence ?? "").slice(0, 500),
        confidence: r.verdict.confidence,
      });
      witnessed++;
      if (r.verdict.refuted && r.verdict.confidence >= 0.7) refuted++;
    } catch (e) {
      errored++;
      log("⚠", `recordVerdict failed for ${claim.claimId}: ${e.message}`);
    }
  }
  const t = chrono.tick();
  log("🪐", `tick done · witnessed=${witnessed} refuted=${refuted} errored=${errored} · rewinds=${t.rewinds.length} crystallized=${t.crystallized.length}`);
  return { witnessed, refuted, errored, ticked: t };
}

async function main() {
  if (ONCE) {
    await tick();
    process.exit(0);
  }
  log("🌅", `witness loop starting · interval=${INTERVAL_SEC}s · ctrl-C to stop`);
  // First tick immediately, then on interval
  await tick();
  setInterval(() => { tick().catch((e) => log("❌", `tick threw: ${e.message}`)); }, INTERVAL_SEC * 1000);
}

main().catch((e) => { log("❌", `fatal: ${e?.stack ?? e}`); process.exit(1); });
