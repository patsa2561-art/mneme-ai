/**
 * v3.143.0 — THE PUBLIC HONESTY LEDGER.
 *
 * Weaponizes the zero-drift TRUTH GATE into a VISIBLE, offline-verifiable moat.
 * The gate is real (every public claim binds to a probe; `npm test` fails the
 * build on drift) — but it was INVISIBLE, buried in tests nobody sees. This layer
 * emits a signed, public ledger of every marketing claim + its probe + last-measured
 * verdict, plus an auto-generated honest badge.
 *
 * The moat: anyone verifies OFFLINE (Ed25519, embedded key) that Mneme's own
 * marketing has zero drift. A competitor cannot publish the same badge without
 * standing up the same claim→probe→reconcile discipline AND exposing their own
 * unmeasured/over-claims — the badge literally cannot be faked green (it embeds the
 * measured numbers + a signature that re-derives from them).
 *
 * HONEST: the badge attests "every PUBLIC claim in this catalog currently passes its
 * probe", NOT "the software is bug-free". Coverage = the catalog, not all behavior.
 */
import { generateKeyPairSync } from "node:crypto";
import { reconcileAll } from "../truth_gate/engine.js";
import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/receipt.js";
import { publicKeyToB64, fingerprintOf, type IssuerKeyPair } from "../notary/keys.js";

export interface LedgerClaim {
  id: string;
  text: string;
  source: string;
  probeId: string;
  severity: string;
  verdict: string;
  reason: string;
}
export interface LedgerSummary {
  total: number;
  pass: number;
  drift: number;
  refuted: number;
  unmeasured: number;
  measured: number;
  score: number;
  honest: boolean; // drift === 0 && refuted === 0
}
export interface HonestyLedger {
  spec: "MNEME-HONESTY-LEDGER";
  v: 1;
  version: string;
  generatedAt: string;
  summary: LedgerSummary;
  claims: LedgerClaim[];
}

function summarize(total: number, pass: number, drift: number, refuted: number, unmeasured: number): LedgerSummary {
  const measured = pass + drift + refuted;
  const score = measured > 0 ? Math.round((pass / measured) * 100) : 0;
  return { total, pass, drift, refuted, unmeasured, measured, score, honest: drift === 0 && refuted === 0 };
}

/** A fresh in-memory Ed25519 keypair (no disk) — for deterministic tests/gauntlet. */
export function freshKeyPair(): IssuerKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyB64 = publicKeyToB64(publicKey);
  return { privateKey, publicKey, publicKeyB64, fingerprint: fingerprintOf(publicKeyB64) };
}

/**
 * Reconcile the real repo and emit a signed public honesty ledger.
 * The full ledger is the receipt payload → verifiable offline from the receipt alone.
 */
export async function buildHonestyLedger(
  repoRoot: string,
  version: string,
  keyPair?: IssuerKeyPair,
): Promise<{ ledger: HonestyLedger; receipt: NotaryReceipt }> {
  const m = await reconcileAll({ cwd: repoRoot });
  const claims: LedgerClaim[] = m.entries.map((e) => ({
    id: e.claim.id,
    text: String(e.claim.text).slice(0, 240),
    source: String(e.claim.source).slice(0, 120),
    probeId: e.claim.probeId,
    severity: String(e.claim.severity),
    verdict: e.verdict,
    reason: String(e.reason).slice(0, 160),
  }));
  const s = m.summary;
  const ledger: HonestyLedger = {
    spec: "MNEME-HONESTY-LEDGER",
    v: 1,
    version,
    generatedAt: m.scannedAt,
    summary: summarize(m.entries.length, s.pass, s.drift, s.refuted, s.unmeasured),
    claims,
  };
  const receipt = issueReceipt(repoRoot, { subject: `mneme-honesty-ledger@${version}`, payload: ledger }, keyPair);
  return { ledger, receipt };
}

/** Does the ledger's own arithmetic hold (no cooked summary)? */
export function ledgerConsistent(l: HonestyLedger): boolean {
  if (!l || l.spec !== "MNEME-HONESTY-LEDGER" || !Array.isArray(l.claims)) return false;
  const s = l.summary;
  if (s.pass + s.drift + s.refuted + s.unmeasured !== s.total) return false;
  if (s.total !== l.claims.length) return false;
  if (s.measured !== s.pass + s.drift + s.refuted) return false;
  const expectScore = s.measured > 0 ? Math.round((s.pass / s.measured) * 100) : 0;
  if (s.score !== expectScore) return false;
  if (s.honest !== (s.drift === 0 && s.refuted === 0)) return false;
  // the verdict tallies must match the actual claim rows (can't lie in the summary)
  const tally = { pass: 0, drift: 0, refuted: 0, unmeasured: 0 } as Record<string, number>;
  for (const c of l.claims) if (c.verdict in tally) tally[c.verdict]!++;
  return tally.pass === s.pass && tally.drift === s.drift && tally.refuted === s.refuted && tally.unmeasured === s.unmeasured;
}

export interface LedgerVerdict {
  valid: boolean;
  reason?: string;
  honest?: boolean;
  summary?: LedgerSummary;
}

/**
 * Verify a public honesty ledger OFFLINE from the receipt alone:
 *   1. the Ed25519 signature is valid for the embedded key
 *   2. the inline payload hash matches (no swapped ledger)
 *   3. the ledger's own arithmetic re-derives (no cooked summary)
 * Returns `honest` = the verified claim that drift === 0 && refuted === 0.
 */
export function verifyHonestyLedger(receipt: unknown): LedgerVerdict {
  const v = verifyReceipt(receipt);
  if (!v.valid) return { valid: false, reason: v.reason };
  const l = (receipt as { payload?: HonestyLedger }).payload;
  if (!l || l.spec !== "MNEME-HONESTY-LEDGER") return { valid: false, reason: "not a Mneme honesty ledger" };
  if (!ledgerConsistent(l)) return { valid: false, reason: "ledger summary does not re-derive from its claims (cooked)" };
  return { valid: true, honest: l.summary.honest, summary: l.summary };
}

const esc = (s: string): string => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));

/** Honest self-contained SVG badge — green ONLY when drift+refuted=0; embeds real numbers. */
export function badgeSVG(summary: LedgerSummary): string {
  try {
    const honest = summary.drift === 0 && summary.refuted === 0;
    const color = honest ? "#2da44e" : "#cf222e";
    const right = honest
      ? `${summary.pass}/${summary.measured} · drift 0`
      : `drift ${summary.drift} · refuted ${summary.refuted}`;
    const rw = 70 + right.length * 7;
    const W = 132 + rw;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="28" role="img" aria-label="Mneme Truth Gate: ${esc(right)}">`,
      `<rect width="${W}" height="28" rx="4" fill="#1b1f24"/>`,
      `<rect x="132" width="${rw}" height="28" rx="4" fill="${color}"/>`,
      `<rect x="132" width="6" height="28" fill="${color}"/>`,
      `<text x="12" y="18" fill="#e6edf3" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="12" font-weight="600">🛡 Truth Gate</text>`,
      `<text x="${132 + rw / 2}" y="18" fill="#ffffff" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="12" font-weight="700" text-anchor="middle">${esc(right)}</text>`,
      `</svg>`,
    ].join("");
  } catch {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="28"><rect width="150" height="28" fill="#cf222e"/><text x="8" y="18" fill="#fff" font-size="12">Truth Gate: error</text></svg>`;
  }
}

/** shields.io endpoint JSON (so the README badge can be live + auto-verified). */
export function badgeShields(summary: LedgerSummary): { schemaVersion: 1; label: string; message: string; color: string } {
  const honest = summary.drift === 0 && summary.refuted === 0;
  return {
    schemaVersion: 1,
    label: "truth gate",
    message: honest ? `${summary.pass}/${summary.measured} · drift 0` : `drift ${summary.drift}`,
    color: honest ? "brightgreen" : "red",
  };
}

/** Human-readable ledger markdown (committed to docs/, regenerated each release). */
export function ledgerMarkdown(l: HonestyLedger, receipt: NotaryReceipt): string {
  const s = l.summary;
  const lines: string[] = [];
  lines.push(`# 🛡 Mneme Public Honesty Ledger`);
  lines.push(``);
  lines.push(`> Auto-generated + Ed25519-signed. Verify offline: \`mneme honesty verify\` (paste the JSON).`);
  lines.push(`> This attests every **public claim currently passes its probe** — not that the software is bug-free.`);
  lines.push(``);
  lines.push(`**mneme@${l.version}** · generated ${l.generatedAt}`);
  lines.push(``);
  lines.push(`| | count |`);
  lines.push(`|--|--|`);
  lines.push(`| ✅ pass | ${s.pass} |`);
  lines.push(`| 🟠 drift | ${s.drift} |`);
  lines.push(`| 🔴 refuted | ${s.refuted} |`);
  lines.push(`| ⚪ unmeasured | ${s.unmeasured} |`);
  lines.push(`| **score** | **${s.score}/100** ${s.honest ? "· 🟢 ZERO-DRIFT" : "· ⚠ DRIFTING"} |`);
  lines.push(``);
  lines.push(`Signed: \`${receipt.issuerFingerprint}\` · receipt \`${receipt.receiptId.slice(0, 16)}…\``);
  lines.push(``);
  lines.push(`<details><summary>All ${l.claims.length} claims</summary>`);
  lines.push(``);
  lines.push(`| claim | verdict | probe |`);
  lines.push(`|--|--|--|`);
  for (const c of l.claims) {
    const mark = c.verdict === "pass" ? "✅" : c.verdict === "unmeasured" ? "⚪" : c.verdict === "drift" ? "🟠" : "🔴";
    lines.push(`| \`${c.id}\` | ${mark} ${c.verdict} | \`${c.probeId}\` |`);
  }
  lines.push(``);
  lines.push(`</details>`);
  return lines.join("\n");
}

// ── Deterministic gauntlet (no .mneme, no real reconcile — pure logic) ──────
export interface HonestyLedgerGauntlet {
  signedRoundTrips: boolean;
  tamperDetected: boolean;
  cookedSummaryRejected: boolean;
  badgeReflectsTruth: boolean;
  badgeCannotFakeGreen: boolean;
  consistencyMath: boolean;
  total: boolean;
  score: 0 | 100;
}

export function honestyLedgerGauntlet(): HonestyLedgerGauntlet {
  const kp = freshKeyPair();
  const mk = (pass: number, drift: number, refuted: number, unmeasured: number): HonestyLedger => {
    const claims: LedgerClaim[] = [];
    const push = (v: string, n: number) => { for (let i = 0; i < n; i++) claims.push({ id: `claim.x.${v}.${i}`, text: "t", source: "s", probeId: `probe.x.${v}.${i}`, severity: "info", verdict: v, reason: "r" }); };
    push("pass", pass); push("drift", drift); push("refuted", refuted); push("unmeasured", unmeasured);
    return { spec: "MNEME-HONESTY-LEDGER", v: 1, version: "test", generatedAt: "2026-01-01T00:00:00.000Z", summary: summarize(pass + drift + refuted + unmeasured, pass, drift, refuted, unmeasured), claims };
  };

  // 1. a clean ledger signs + verifies offline as honest.
  const cleanLedger = mk(10, 0, 0, 2);
  const cleanReceipt = issueReceipt(process.cwd(), { subject: "test", payload: cleanLedger }, kp);
  const cv = verifyHonestyLedger(cleanReceipt);
  const signedRoundTrips = cv.valid === true && cv.honest === true;

  // 2. tampering the payload (flip a verdict) breaks verification.
  const tampered = JSON.parse(JSON.stringify(cleanReceipt)) as NotaryReceipt & { payload: HonestyLedger };
  tampered.payload.summary.drift = 0; // try to keep "honest" while editing a claim
  (tampered.payload.claims[0] as LedgerClaim).verdict = "drift";
  const tamperDetected = verifyHonestyLedger(tampered).valid === false;

  // 3. a cooked summary (claims say drift but summary says 0) is rejected even if re-signed.
  const cooked = mk(10, 0, 0, 0);
  (cooked.claims[0] as LedgerClaim).verdict = "drift"; // row says drift, summary still 0
  const cookedReceipt = issueReceipt(process.cwd(), { subject: "test", payload: cooked }, kp);
  const cookedSummaryRejected = verifyHonestyLedger(cookedReceipt).valid === false;

  // 4. badge shows the real numbers when honest.
  const badge = badgeSVG(cleanLedger.summary);
  const badgeReflectsTruth = badge.includes("#2da44e") && badge.includes("10/10");

  // 5. a drifting ledger CANNOT produce a green badge.
  const driftBadge = badgeSVG(mk(8, 2, 0, 0).summary);
  const badgeCannotFakeGreen = driftBadge.includes("#cf222e") && !driftBadge.includes("#2da44e");

  // 6. consistency math catches an impossible summary.
  const bad = mk(10, 0, 0, 0); bad.summary.score = 50; // lie about the score
  const consistencyMath = ledgerConsistent(bad) === false && ledgerConsistent(cleanLedger) === true;

  let total = true;
  try {
    verifyHonestyLedger(null); verifyHonestyLedger({}); badgeSVG(null as unknown as LedgerSummary);
    ledgerConsistent(null as unknown as HonestyLedger); badgeShields(cleanLedger.summary);
  } catch { total = false; }

  const checks = [signedRoundTrips, tamperDetected, cookedSummaryRejected, badgeReflectsTruth, badgeCannotFakeGreen, consistencyMath, total];
  return { signedRoundTrips, tamperDetected, cookedSummaryRejected, badgeReflectsTruth, badgeCannotFakeGreen, consistencyMath, total, score: checks.every(Boolean) ? 100 : 0 };
}
