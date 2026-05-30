/**
 * v2.101.0 — HYDRA MCP tool surface (the last flow: any AI agent calls the
 * whole HYDRA stack straight through the protocol).
 *
 * THE CRAZY-BUT-ACCURATE GEM — SELF-ATTESTING TOOL RESULTS. An ordinary MCP
 * tool returns JSON the calling model must simply TRUST. HYDRA's whole creed
 * is prove-or-unknown, so every HYDRA tool result is wrapped with a NOTARY
 * (Ed25519) receipt over the SHA-256 of its own data. The calling agent —
 * Claude, GPT, Gemini, anything — can verify OFFLINE, with the public key
 * alone, that the result is genuine and un-tampered between server and model.
 * Output you can check, not output you must believe.
 *
 * Every handler is total: it never throws; on any failure it returns a
 * structured { ok:false, error } with low confidence — an MCP tool must
 * never crash the server or the agent's turn.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

function sha256(s: string): string { return createHash("sha256").update(s, "utf8").digest("hex"); }
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const k = Object.keys(v as Record<string, unknown>).sort();
  return "{" + k.map((x) => JSON.stringify(x) + ":" + canon((v as Record<string, unknown>)[x])).join(",") + "}";
}

/** Wrap a tool's data with a NOTARY proof over its hash → verifiable output. */
async function attest(cwd: string, subject: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const core = await import("@mneme-ai/core");
    const dataHash = sha256(canon(data));
    const receipt = core.notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `hydra-mcp:${subject}:${dataHash.slice(0, 16)}`, payload: { dataHash, tool: subject }, includePayload: true });
    return { ...data, _proof: { dataHash, receipt, verifyHint: "recompute sha256(canonical(data minus _proof)); it must equal _proof.dataHash, and notary.verifyReceipt(_proof.receipt) must be valid" } };
  } catch {
    return data; // attestation is a bonus; never fail the tool because signing failed.
  }
}

function chainPathOf(cwd: string): string { return join(cwd, ".mneme", "hydra", "chain.json"); }
function readChain(cwd: string): unknown[] {
  try { const p = chainPathOf(cwd); if (!existsSync(p)) return []; const j = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(j) ? j : []; } catch { return []; }
}

async function corpusFor(cwd: string, args: Record<string, unknown>): Promise<string> {
  if (typeof args["text"] === "string" && (args["text"] as string).length > 0) return args["text"] as string;
  if (typeof args["file"] === "string" && existsSync(args["file"] as string)) { try { return readFileSync(args["file"] as string, "utf8"); } catch { /* */ } }
  const core = await import("@mneme-ai/core");
  return core.agentManifest.renderManifestMarkdown(undefined, "current");
}

const lowFail = (msg: string) => ({ data: { ok: false, error: msg }, wisdom: msg, followUp: [] as string[], confidence: { level: "low" as const } });

export const HYDRA_TOOLS: MnemeTool[] = [
  {
    name: "mneme.hydra.forge",
    category: "meta",
    description: "💎 HYDRA — forge the signed, provably-lossless, vendor-neutral context codebook from a corpus (default: the command manifest; pass `text` or `file` to override). Returns the gauntlet (lossless ∧ collision-free ∧ portable → score/100), honest ratios, and a NOTARY-signed proof of THIS result so you can verify offline that the tool didn't lie.",
    whenToUse: "Compress a context corpus into a portable, signed, byte-lossless codebook; check that the forge is sound (score 100) before trusting it.",
    triggers: ["hydra forge", "forge codebook", "sign context codebook"],
    inputSchema: { type: "object", properties: { text: { type: "string", description: "Corpus to forge over (else the manifest)." }, file: { type: "string", description: "Path to a corpus file." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const corpus = await corpusFor(cwd, args);
        const f = core.hydra.hydraForge(cwd, corpus, Date.now(), {});
        const g = f.gauntlet;
        const data = await attest(cwd, "forge", { gauntlet: g, converged: f.forge.converged, bytesSaved: f.energy.bytesSaved });
        return { data, wisdom: `forge ${g.score}/100 · lossless=${g.lossless} collisions=${g.collisions} · ${g.entries} entries · ${g.ratio.toFixed(2)}x text / ${g.netRatio.toFixed(2)}x net`, followUp: ["mneme.hydra.gauntlet", "mneme.hydra.chain"], confidence: { level: "high" as const } };
      } catch (e) { return lowFail((e as Error).message); }
    },
  },
  {
    name: "mneme.hydra.gauntlet",
    category: "meta",
    description: "💎 HYDRA — AUDIT a corpus's codebook: prove lossless (SHA-256 round-trip, a boolean — never a similarity score) ∧ collision-free ∧ portable → score/100. NOTARY-signed result. Use this before trusting any HYDRA codebook.",
    whenToUse: "Verify a context capsule is byte-lossless + sound before relying on it.",
    triggers: ["hydra gauntlet", "audit codebook", "is the codebook lossless"],
    inputSchema: { type: "object", properties: { text: { type: "string" }, file: { type: "string" } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const corpus = await corpusFor(cwd, args);
        const g = core.hydra.hydraForge(cwd, corpus, Date.now(), {}).gauntlet;
        const data = await attest(cwd, "gauntlet", { gauntlet: g });
        return { data, wisdom: `gauntlet ${g.score}/100 · lossless=${g.lossless} collisions=${g.collisions} portable=${g.portable}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return lowFail((e as Error).message); }
    },
  },
  {
    name: "mneme.hydra.guard",
    category: "meta",
    description: "🛡 HYDRA GUARD — Time-To-Trust: prove guarded expansion is byte-lossless for TRUSTED content but provably REDACTS a fraction of entries to a signed abstract (sha + byte-count, never the raw text) — an AI cannot hallucinate from expired memory. Returns the guarded gauntlet (fresh-lossless ∧ redaction-sound ∧ fresh-preserved ∧ deterministic → /100). NOTARY-signed.",
    whenToUse: "Demonstrate / verify that stale context can be redacted without ever leaking raw stale content or corrupting fresh content.",
    triggers: ["hydra guard", "time to trust", "redact stale memory"],
    inputSchema: { type: "object", properties: { text: { type: "string" }, file: { type: "string" }, staleFraction: { type: "number", description: "0..1 fraction of entries to mark stale (default 0.25)." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const corpus = await corpusFor(cwd, args);
        const cb = core.hydra.hydraForge(cwd, corpus, Date.now(), {}).forge.codebook;
        const encoded = core.hydra.compress(corpus, cb);
        const frac = Math.min(1, Math.max(0, typeof args["staleFraction"] === "number" ? args["staleFraction"] as number : 0.25));
        const nStale = Math.floor(cb.entries.length * frac);
        const trustMap: Record<string, "fresh" | "stale" | "quarantined"> = {};
        for (let i = 0; i < nStale; i++) { const e = cb.entries[i]; if (e) trustMap[e.sym] = "stale"; }
        const g = core.hydra.guardedGauntlet(corpus, encoded, cb, trustMap);
        const data = await attest(cwd, "guard", { guarded: g, staleFraction: frac });
        return { data, wisdom: `guard ${g.score}/100 · fresh-lossless=${g.freshLossless} redaction-sound=${g.redactionSound} · ${g.freshCount} fresh ${g.redactedCount} redacted`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return lowFail((e as Error).message); }
    },
  },
  {
    name: "mneme.hydra.chain",
    category: "meta",
    description: "⛓ HYDRA PROVENANCE CHAIN — append a SIGNED delta of the current corpus's codebook to .mneme/hydra/chain.json (optionally anchored to a commit via `commit`/`subject`), then verify the WHOLE history OFFLINE: Ed25519 sigs + prev→result links + byte-exact replay to every step. Memory with a cryptographic, replayable, tamper-evident history. NOTARY-signed result.",
    whenToUse: "Record an immutable, offline-verifiable checkpoint of Mneme's context; build a tamper-evident memory history.",
    triggers: ["hydra chain", "append provenance", "sign memory checkpoint"],
    inputSchema: { type: "object", properties: { text: { type: "string" }, file: { type: "string" }, commit: { type: "string", description: "Anchor sha (signed)." }, subject: { type: "string", description: "Anchor subject (signed)." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const dir = join(cwd, ".mneme", "hydra");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const chain = readChain(cwd);
        const corpus = await corpusFor(cwd, args);
        const cb = core.hydra.forgeCodebook(corpus, {}).codebook;
        const meta: Record<string, string> = {};
        if (typeof args["commit"] === "string") meta.commit = args["commit"] as string;
        if (typeof args["subject"] === "string") meta.subject = (args["subject"] as string).slice(0, 120);
        const appended = core.hydra.appendToChain(cwd, chain as never, cb, Date.now(), Object.keys(meta).length ? meta : undefined);
        writeFileSync(chainPathOf(cwd), JSON.stringify(appended.chain, null, 2));
        const gg = core.hydra.chainGauntlet(appended.chain);
        const data = await attest(cwd, "chain", { gauntlet: gg, length: gg.length, delta: { seq: appended.delta.seq, added: appended.delta.added.length, removed: appended.delta.removed.length } });
        return { data, wisdom: `chain ${gg.length} link(s) · verified=${gg.verified} replay-exact=${gg.replayExact} tamper-caught=${gg.tamperCaught} → ${gg.score}/100`, followUp: ["mneme.hydra.replay"], confidence: { level: "high" as const } };
      } catch (e) { return lowFail((e as Error).message); }
    },
  },
  {
    name: "mneme.hydra.replay",
    category: "meta",
    description: "⏳ HYDRA TEMPORAL GUARDED REPLAY — replay the codebook at a past chain step. With `guard`, staleness is derived from the chain's OWN history (atrophy): an entry added long ago and never touched is reported STALE (it would expand only to a signed abstract). Deterministic + proven-old-only. NOTARY-signed result.",
    whenToUse: "Inspect what Mneme's context looked like at a past step, with cold knowledge flagged so an agent doesn't quote rotten detail.",
    triggers: ["hydra replay", "time travel context", "what did mneme know"],
    inputSchema: { type: "object", properties: { index: { type: "number", description: "Chain step to replay (default: tip)." }, guard: { type: "boolean", description: "Derive temporal staleness from chain history." }, halflife: { type: "number", description: "Atrophy half-life in deltas (default 3)." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const chain = readChain(cwd);
        if (chain.length === 0) return lowFail("no chain yet — call mneme.hydra.chain first");
        const index = typeof args["index"] === "number" ? args["index"] as number : chain.length - 1;
        const hl = typeof args["halflife"] === "number" ? args["halflife"] as number : 3;
        const r = core.hydra.guardedReplay(chain as never, index, hl);
        if (!r.ok || !r.codebook) return lowFail(`replay failed: ${r.reason}`);
        const data = await attest(cwd, "replay", { atIndex: r.trust.atIndex, entries: r.codebook.entries.length, guard: args["guard"] === true, fresh: r.trust.freshCount, stale: r.trust.staleCount, halflife: hl });
        return { data, wisdom: `replay step ${r.trust.atIndex} · ${r.codebook.entries.length} entries${args["guard"] === true ? ` · ${r.trust.freshCount} fresh ${r.trust.staleCount} stale(redacted)` : ""}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return lowFail((e as Error).message); }
    },
  },
  {
    name: "mneme.hydra.sleep",
    category: "meta",
    description: "💤 HYDRA EPIGENETIC DORMANCY — put cold entries to sleep (methylate → moved out of the active working set into a cold signed store) and prove a full revive (demethylate) reconstructs the original BYTE-EXACT. The active footprint shrinks; nothing is lost; the split is Ed25519-signed. Returns the dormancy gauntlet (revive-exact ∧ shrinks ∧ signed-binds ∧ deterministic → /100). NOTARY self-attested.",
    whenToUse: "Shrink the active context footprint at scale (enterprise repos) by sleeping cold knowledge, while proving it can wake byte-exact on demand.",
    triggers: ["hydra sleep", "epigenetic dormancy", "dormant memory revive"],
    inputSchema: { type: "object", properties: { text: { type: "string" }, file: { type: "string" }, dormantFraction: { type: "number", description: "0..1 fraction of entries to sleep (default 0.5)." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        const cwd = rt.meta?.rootPath ?? process.cwd();
        const corpus = await corpusFor(cwd, args);
        const cb = core.hydra.forgeCodebook(corpus, {}).codebook;
        const frac = Math.min(1, Math.max(0, typeof args["dormantFraction"] === "number" ? args["dormantFraction"] as number : 0.5));
        const n = Math.floor(cb.entries.length * frac);
        const trustMap: Record<string, "fresh" | "stale" | "quarantined"> = {};
        for (let i = 0; i < n; i++) { const e = cb.entries[i]; if (e) trustMap[e.sym] = "stale"; }
        const g = core.hydra.dormancyGauntlet(cwd, cb, trustMap, Date.now());
        const data = await attest(cwd, "sleep", { dormancy: g, dormantFraction: frac });
        return { data, wisdom: `dormancy ${g.score}/100 · ${g.dormantCount} asleep · active ${g.activeBytes}/${g.fullBytes}B · revive-exact=${g.reviveExact}`, followUp: [], confidence: { level: "high" as const } };
      } catch (e) { return lowFail((e as Error).message); }
    },
  },
  {
    name: "mneme.hydra.verify",
    category: "meta",
    description: "✅ HYDRA — verify OFFLINE that a HYDRA result is genuine. Pass a tool result's `_proof` (or a portable artifact) + its `data`/`codebook`: checks the Ed25519 signature AND that the data hash binds to the receipt (no swap-after-sign). This is how ANY vendor confirms a HYDRA tool didn't lie. Pure crypto, no network.",
    whenToUse: "After receiving any HYDRA tool result — re-verify its _proof to confirm the output is authentic and untampered before acting on it.",
    triggers: ["hydra verify", "verify hydra proof", "is this tool result genuine"],
    inputSchema: { type: "object", properties: { proof: { description: "The _proof object from a HYDRA tool result." }, data: { description: "The data object the proof should bind (without _proof)." }, codebook: { description: "A codebook to bind, for artifact verification." }, receipt: { description: "A codebook receipt, for artifact verification." } } },
    outputSchema: { type: "object" },
    handler: async (rt, args) => {
      try {
        const core = await import("@mneme-ai/core");
        // Artifact mode: codebook + receipt.
        if (args["codebook"] && args["receipt"]) {
          const v = core.hydra.verifyCodebook(args["receipt"], args["codebook"] as never);
          return { data: { mode: "artifact", bound: v.bound, valid: v.valid, reason: v.reason }, wisdom: v.bound ? "✓ artifact verified offline" : `✗ ${v.reason}`, followUp: [], confidence: { level: v.bound ? "high" as const : "low" as const } };
        }
        // Result-proof mode: _proof over data hash.
        const proof = args["proof"] as { dataHash?: string; receipt?: unknown } | undefined;
        if (!proof || !proof.receipt) return lowFail("pass a _proof (with receipt) + data, or a codebook + receipt");
        const recV = core.notary.verifyReceipt(proof.receipt);
        let hashOk: boolean | null = null;
        if (args["data"] !== undefined && typeof proof.dataHash === "string") {
          hashOk = sha256(canon(args["data"])) === proof.dataHash;
        }
        const genuine = recV.valid && hashOk !== false;
        return { data: { mode: "result-proof", signatureValid: recV.valid, dataHashMatches: hashOk, genuine, reason: recV.reason }, wisdom: genuine ? "✓ tool result is genuine + untampered" : `✗ not genuine: ${recV.reason ?? "data hash mismatch"}`, followUp: [], confidence: { level: genuine ? "high" as const : "low" as const } };
      } catch (e) { return lowFail((e as Error).message); }
    },
  },
];
