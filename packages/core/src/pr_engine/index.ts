/**
 * v3.135.0 — THE PR ENGINE: launch/press content that CANNOT lie.
 *
 * Every launch is a temptation to overclaim — "world's best", "100% accurate",
 * "never wrong". The PR Engine generates the whole launch kit (Hacker News post,
 * X thread, Reddit post, changelog) from candidate claims, but runs EVERY claim —
 * and every assembled sentence — through VERICERT first. An overclaiming /
 * fabricated / unfalsifiable line is REJECTED and never makes it into the copy; the
 * author sees exactly which claims were too strong and why.
 *
 * THE MEASURED GUARANTEE: zero-overclaim output — no sentence in the generated kit
 * is REJECTED by VERICERT (it re-certifies its own output). On-brand for an
 * anti-hallucination product: the marketing is held to the same bar as the product.
 *
 * Pure + deterministic + total. HONEST: VERICERT screens KNOWN overclaim/fabrication
 * patterns — it keeps the copy defensible, it does not make a true claim true.
 */

import { certify } from "../vericert/index.js";

export interface LaunchInput {
  product: string;
  version?: string;
  url?: string;
  install?: string;
  claims: string[];          // candidate claims — each is VERICERT-screened
  channels?: Array<"hn" | "x" | "reddit" | "changelog">;
}

export interface LaunchKit {
  approved: string[];
  rejected: Array<{ claim: string; reason: string }>;
  hn: { title: string; body: string };
  x: string[];               // a thread, one string per tweet
  reddit: { title: string; body: string };
  changelog: string;
  clean: boolean;            // ★ true ⇒ no REJECTED sentence anywhere in the kit
}

// Marketing superlatives that are unfalsifiable without evidence — stricter than
// VERICERT because launch copy must not lean on them. Allowed only with a citation.
const SUPERLATIVE = /\b(world'?s? best|the best|greatest|#1|number one|ever made|the only|unbeatable|revolutionary|game.?chang(er|ing)|100%\s*(accurate|reliable|correct)|never wrong|magic(al)?|flawless|perfect)\b/i;

/** Split candidate claims into launch-ready vs rejected. STRICT: a claim ships only
 *  if VERICERT certifies it (CERTIFIED — not merely CONDITIONAL) AND it carries no
 *  unfalsifiable marketing superlative. Everything else is rejected with a reason. */
export function verifyLaunchClaims(claims: string[]): { approved: string[]; rejected: Array<{ claim: string; reason: string }> } {
  const approved: string[] = []; const rejected: Array<{ claim: string; reason: string }> = [];
  for (const raw of (claims || [])) {
    const claim = String(raw || "").trim();
    if (!claim) continue;
    if (SUPERLATIVE.test(claim)) { rejected.push({ claim, reason: "unfalsifiable superlative (no evidence)" }); continue; }
    const c = certify(claim);
    if (c.verdict !== "CERTIFIED") rejected.push({ claim, reason: c.verdict === "REJECTED" ? (c.faults.map((f) => f.nerves.join("/")).join(", ") || "overclaim") : "needs review (not rock-solid for copy)" });
    else approved.push(claim);
  }
  return { approved, rejected };
}

function bullets(xs: string[]): string { return xs.map((s) => `• ${s}`).join("\n"); }

/** Build the full launch kit from approved claims only. Deterministic + total. */
export function buildLaunchKit(input: LaunchInput): LaunchKit {
  const product = String(input?.product || "the project");
  const url = String(input?.url || "");
  const install = String(input?.install || "");
  const { approved, rejected } = verifyLaunchClaims(input?.claims || []);
  const lead = approved[0] || `${product} — try it.`;
  const rest = approved.slice(1);

  const hn = {
    title: `Show HN: ${product}${approved[0] ? " – " + approved[0].replace(/\.$/, "") : ""}`.slice(0, 80),
    body: [lead, "", rest.length ? bullets(rest) : "", "", url ? `Try it: ${url}` : "", install ? `Install: ${install}` : "", "", "Feedback very welcome — especially on what's missing or overstated."].filter((l) => l !== undefined).join("\n").trim(),
  };
  const x: string[] = [];
  x.push(`${product}: ${lead}`.slice(0, 270));
  rest.slice(0, 4).forEach((c, i) => x.push(`${i + 2}/ ${c}`.slice(0, 270)));
  if (url) x.push(`Try it → ${url}`);
  const reddit = {
    title: `${product} — ${approved[0] ? approved[0].replace(/\.$/, "") : "show & tell"}`.slice(0, 100),
    body: [lead, "", rest.length ? bullets(rest) : "", "", url ? `${url}` : "", "", "Honest about limits; curious what you'd want. Feedback appreciated."].join("\n").trim(),
  };
  const changelog = [`## ${product}${input?.version ? " " + input.version : ""}`, "", ...approved.map((c) => `- ${c}`)].join("\n");

  // ★ re-certify the assembled output — guarantee zero overclaim slipped through
  const allText = [hn.title, hn.body, ...x, reddit.title, reddit.body, changelog].join("\n");
  const clean = allText.split(/\n+/).map((s) => s.replace(/^[•\-\d/\s]+/, "").trim()).filter((s) => s.length >= 12).every((s) => certify(s).verdict !== "REJECTED");

  return { approved, rejected, hn, x, reddit, changelog, clean };
}

// ── deterministic proof ──────────────────────────────────────────────────────
export interface PrEngineGauntlet {
  rejectsOverclaim: boolean;     // "world's best, 100% accurate, never wrong" → rejected
  approvesMeasured: boolean;     // a calm measured claim → approved
  zeroOverclaimOutput: boolean;  // ★ no REJECTED sentence survives into the kit
  dropsRejectedFromCopy: boolean;// a rejected claim never appears in HN/X/Reddit
  buildsAllChannels: boolean;    // hn + x + reddit + changelog present
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function prEngineGauntlet(): PrEngineGauntlet {
  const claims = [
    "Deterministic, MIT-licensed, runs locally — no LLM in the analysis path.",       // ok
    "Verifies a poisoned context entry is never inherited (measured 0 leaks).",        // ok
    "The world's best tool, 100% accurate, it always works and never fails.",          // overclaim → reject
    "Studies prove exactly 99.9% of developers will love it instantly.",               // fabrication → reject
  ];
  const kit = buildLaunchKit({ product: "Mneme", version: "v3", url: "https://xray.mneme-ai.space", install: "npm i -g mneme-ai", claims });
  const rejectsOverclaim = kit.rejected.some((r) => /always works|never fails|100%/.test(r.claim)) && kit.rejected.length >= 2;
  const approvesMeasured = kit.approved.some((a) => /Deterministic, MIT/.test(a));
  const zeroOverclaimOutput = kit.clean === true;
  const blob = [kit.hn.title, kit.hn.body, ...kit.x, kit.reddit.title, kit.reddit.body, kit.changelog].join("\n");
  const dropsRejectedFromCopy = !/never fails|Studies prove exactly 99/.test(blob);
  const buildsAllChannels = !!kit.hn.title && !!kit.hn.body && kit.x.length > 0 && !!kit.reddit.title && !!kit.changelog;
  const deterministic = JSON.stringify(buildLaunchKit({ product: "Mneme", version: "v3", url: "https://xray.mneme-ai.space", install: "npm i -g mneme-ai", claims })) === JSON.stringify(kit);
  let total = true;
  try { buildLaunchKit(null as unknown as LaunchInput); buildLaunchKit({ product: "x", claims: [] }); verifyLaunchClaims(null as unknown as string[]); } catch { total = false; }
  const all = rejectsOverclaim && approvesMeasured && zeroOverclaimOutput && dropsRejectedFromCopy && buildsAllChannels && deterministic && total;
  return { rejectsOverclaim, approvesMeasured, zeroOverclaimOutput, dropsRejectedFromCopy, buildsAllChannels, deterministic, total, score: all ? 100 : 0 };
}
