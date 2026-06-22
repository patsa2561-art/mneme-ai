/**
 * v3.133.0 — PR REVIEW comment: put Mneme in the daily dev loop. On every pull
 * request, generate ONE grounded markdown comment that fuses the verification +
 * git-native context stack:
 *   • VERICERT of the PR title/description (catch a hallucinated/overconfident claim)
 *   • CONTEXT for each changed file — "why is this file the way it is" (last decision
 *     + how often it changes), cited to real commits (séance/brief, file-focused)
 *   • the AUTHOR's commit persona (tier · archetype) — measured, not judgmental
 *
 * The whole team sees the bot comment → word-of-mouth; it lives where devs work →
 * real daily use. Deterministic given its inputs, every line cited. Pure + total.
 * HONEST (DIAKRISIS): a window onto measured git + the verification engines, never
 * an opinion — and an honest "not in the record" beats an invented reason.
 */

import { certify, type CertVerdict } from "../vericert/index.js";
import { buildPersona, type CommitRec } from "../commit_persona/index.js";

export interface PrCommit { hash: string; author?: string; ts: number; subject: string; body?: string; files?: string[]; churn?: number }
export interface PrInput { title: string; body?: string; changedFiles: string[]; commits: PrCommit[]; author?: string }

export interface FileContext { file: string; touches: number; lastSubject: string; lastHash: string }
export interface PrReview {
  prReview: "PRREVIEW/1";
  cert: { verdict: CertVerdict; score: number; faults: Array<{ claim: string; nerves: string[] }> };
  fileContexts: FileContext[];
  persona: { author: string; archetype: string; tier: string; commits: number } | null;
  citations: string[];
  markdown: string;
}

const VERDICT_ICON: Record<CertVerdict, string> = { CERTIFIED: "✅", CONDITIONAL: "⚠️", REJECTED: "🛑" };

/** Build the PR comment. Deterministic + total. */
export function buildPrComment(input: PrInput): PrReview {
  const title = String(input?.title || "");
  const body = String(input?.body || "");
  const changed = (input?.changedFiles || []).filter(Boolean);
  const commits = (input?.commits || []).filter((c) => c && c.hash);

  // 1) VERICERT the PR title + description
  const cert = certify(`${title}\n\n${body}`);

  // 2) per changed file: how often it changes + its last decision (cited)
  const fileContexts: FileContext[] = changed.slice(0, 8).map((file) => {
    const touching = commits.filter((c) => (c.files || []).includes(file)).sort((a, b) => b.ts - a.ts);
    const last = touching[0];
    return { file, touches: touching.length, lastSubject: last?.subject || "(no prior history — new file)", lastHash: last ? last.hash.slice(0, 12) : "" };
  });

  // 3) author persona (measured)
  let persona: PrReview["persona"] = null;
  const author = (input?.author || "").trim();
  if (author) {
    const own = commits.filter((c) => (c.author || "").trim() === author).map((c): CommitRec => ({ author, ts: c.ts, subject: c.subject || "", body: c.body || "", files: c.files || [], insertions: c.churn || 0, deletions: 0 }));
    if (own.length >= 1) { const p = buildPersona(author, own); persona = { author, archetype: p.archetype, tier: p.tier, commits: own.length }; }
  }

  const citations = [...fileContexts.filter((f) => f.lastHash).map((f) => f.lastHash), ...cert.faults.map((f) => `cert:${f.nerves.join("/")}`)];

  // ── assemble the markdown comment ──
  const L: string[] = [];
  L.push(`### 🧭 Mneme — PR context & checks`);
  L.push("");
  L.push(`**${VERDICT_ICON[cert.verdict]} PR description: ${cert.verdict}** (${Math.round(cert.score * 100)}% of claims clean)`);
  if (cert.faults.length) { for (const f of cert.faults.slice(0, 4)) L.push(`> ${f.verdict === "BLOCK" ? "🛑" : "⚠️"} _${f.nerves.join(", ")}_ — ${f.claim.slice(0, 120)}`); }
  L.push("");
  if (fileContexts.length) {
    L.push(`**📂 Why these files are the way they are** (cited to real commits):`);
    L.push("");
    L.push(`| file | changes | last decision |`);
    L.push(`|---|---|---|`);
    for (const f of fileContexts) L.push(`| \`${f.file}\` | ${f.touches}× | ${f.lastHash ? `\`${f.lastHash}\` ` : ""}${f.lastSubject.slice(0, 70).replace(/\|/g, "/")} |`);
    L.push("");
  }
  if (persona) L.push(`**🎭 Author** \`${persona.author}\` — ${persona.tier} · ${persona.archetype} (${persona.commits} commits). _commit hygiene, not skill._`);
  L.push("");
  L.push(`<sub>🧷 ${citations.length} citations · deterministic · git-native · local-first · powered by [Mneme](https://xray.mneme-ai.space). Reason from the cited commits.</sub>`);
  const markdown = L.join("\n");

  return {
    prReview: "PRREVIEW/1",
    cert: { verdict: cert.verdict, score: cert.score, faults: cert.faults.map((f) => ({ claim: f.claim, nerves: f.nerves })) },
    fileContexts, persona, citations, markdown,
  };
}

// ── deterministic proof ──────────────────────────────────────────────────────
function synth(): PrCommit[] {
  const base = 1_700_000_000; const out: PrCommit[] = [];
  for (let i = 0; i < 16; i++) out.push({ hash: "p" + String(i).padStart(3, "0") + "feedface", author: i % 2 ? "ana" : "ben", ts: base + i * 86400, subject: i % 3 === 0 ? "feat(auth): add token refresh" : "fix(auth): guard expiry", body: "", files: ["src/auth.ts", i % 2 ? "src/auth.test.ts" : "src/util.ts"], churn: 30 });
  return out;
}

export interface PrReviewGauntlet {
  hasVericertVerdict: boolean;
  surfacesFileContext: boolean;     // a changed file with history shows its last decision, cited
  newFileHonest: boolean;           // a file with no history says so (not invented)
  hasPersona: boolean;
  rejectsBadPrBody: boolean;        // a hallucinated PR body is NOT CERTIFIED
  citesCommits: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function prReviewGauntlet(): PrReviewGauntlet {
  const commits = synth();
  const good = buildPrComment({ title: "fix(auth): correct token expiry", body: "Tightens the refresh window. Verify against staging before merge.", changedFiles: ["src/auth.ts", "src/brand-new.ts"], commits, author: "ana" });
  const hasVericertVerdict = !!good.cert.verdict;
  const ctxAuth = good.fileContexts.find((f) => f.file === "src/auth.ts");
  const surfacesFileContext = !!ctxAuth && ctxAuth.touches > 0 && !!ctxAuth.lastHash && good.citations.includes(ctxAuth.lastHash);
  const ctxNew = good.fileContexts.find((f) => f.file === "src/brand-new.ts");
  const newFileHonest = !!ctxNew && ctxNew.touches === 0 && /new file/i.test(ctxNew.lastSubject) && ctxNew.lastHash === "";
  const hasPersona = !!good.persona && !!good.persona.tier;
  const bad = buildPrComment({ title: "perfect", body: "This always works and never fails. Studies prove exactly 73.2% of users love it.", changedFiles: ["src/auth.ts"], commits, author: "ben" });
  const rejectsBadPrBody = bad.cert.verdict !== "CERTIFIED";
  const citesCommits = good.citations.length > 0;
  const deterministic = JSON.stringify(buildPrComment({ title: "fix(auth): correct token expiry", body: "Tightens the refresh window. Verify against staging before merge.", changedFiles: ["src/auth.ts", "src/brand-new.ts"], commits, author: "ana" })) === JSON.stringify(good);
  let total = true;
  try { buildPrComment(null as unknown as PrInput); buildPrComment({ title: "", changedFiles: [], commits: [] }); } catch { total = false; }
  const all = hasVericertVerdict && surfacesFileContext && newFileHonest && hasPersona && rejectsBadPrBody && citesCommits && deterministic && total;
  return { hasVericertVerdict, surfacesFileContext, newFileHonest, hasPersona, rejectsBadPrBody, citesCommits, deterministic, total, score: all ? 100 : 0 };
}
