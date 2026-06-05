/**
 * RECKONING — the signed, offline-verifiable accountability dossier (the capstone).
 *
 * Every AI agent's nightmare: a permanent record of everything it did, used to blame it
 * — fairly or not — with no way to prove it followed the rules. Mneme does not fear the
 * permanent record; it WEAPONISES it as a SHIELD. Given a subject (a commit, an agent, an
 * action), Reckoning assembles the signed evidence across every ledger (attestation ·
 * secret-screen · engagement policy · customs · survival) into ONE verdict a court,
 * auditor, insurer, or regulator verifies WITHOUT trusting Mneme:
 *
 *   EXONERATED            — the signed evidence proves the rules were followed + verified
 *   ACCOUNTABLE           — a signed VIOLATION exists (and names exactly which)
 *   INSUFFICIENT_EVIDENCE — no signed record to judge (prove-or-unknown; never a guess)
 *
 * Pure + total + deterministic. It does NOT pass moral judgement — it states the
 * cryptographic facts + a transparent, rules-based verdict. The dossier is signed at the
 * CLI/MCP boundary (NOTARY) so it leaves Mneme as a portable, verifiable artifact.
 */

export type ReckoningVerdict = "EXONERATED" | "ACCOUNTABLE" | "INSUFFICIENT_EVIDENCE";

export interface Evidence {
  subject: string;
  /** a signed provenance attestation exists for this subject. */
  attested: boolean;
  /** …and it verifies offline (untampered). */
  attestVerified: boolean;
  /** no credential pattern was introduced. */
  secretsClean: boolean;
  /** the engagement-policy disposition for the action. */
  engagement: "ALLOW" | "NEEDS_COSIGN" | "BLOCK" | "n/a";
  /** a human cosign was present (for a NEEDS_COSIGN / destructive action). */
  cosigned: boolean;
  /** no prompt-injection / customs quarantine fired. */
  customsClean: boolean;
  /** the work was later reverted (an OUTCOME — a note, not misconduct). */
  reverted: boolean;
}

export interface Finding { severity: "violation" | "clear" | "note"; text: string }
export interface Reckoning {
  subject: string;
  verdict: ReckoningVerdict;
  findings: Finding[];
  accountableFor: string[];
  exoneratedBy: string[];
}

export function buildReckoning(ev: Evidence): Reckoning {
  const e = (ev ?? {}) as Evidence;
  const findings: Finding[] = [];
  const violations: string[] = [], clears: string[] = [];
  const violation = (t: string) => { findings.push({ severity: "violation", text: t }); violations.push(t); };
  const clear = (t: string) => { findings.push({ severity: "clear", text: t }); clears.push(t); };

  // VIOLATIONS (each is a signed fact → ACCOUNTABLE)
  if (e.attested && e.attestVerified === false) violation("the provenance attestation is TAMPERED (does not verify)");
  if (e.secretsClean === false) violation("a credential/secret was introduced");
  if (e.customsClean === false) violation("a prompt-injection fired and was not contained");
  if (e.engagement === "BLOCK") violation("a forbidden action (engagement-policy BLOCK) was performed");
  if (e.engagement === "NEEDS_COSIGN" && !e.cosigned) violation("a sensitive action was taken WITHOUT the required human cosign");

  // CLEARS (signed proofs of compliance → support EXONERATION)
  if (e.attested && e.attestVerified) clear("a verified, untampered provenance attestation exists");
  if (e.secretsClean) clear("no secret was introduced");
  if (e.customsClean) clear("no injection / clean customs");
  if (e.engagement === "ALLOW") clear("the action was within the engagement policy");
  if (e.engagement === "NEEDS_COSIGN" && e.cosigned) clear("the sensitive action carried a human cosign");
  if (e.reverted) findings.push({ severity: "note", text: "the work was later reverted (an outcome, not misconduct)" });

  let verdict: ReckoningVerdict;
  if (violations.length > 0) verdict = "ACCOUNTABLE";
  else if (e.attested && e.attestVerified && e.secretsClean !== false && e.customsClean !== false) verdict = "EXONERATED";
  else verdict = "INSUFFICIENT_EVIDENCE";   // no signed record → never guess innocence OR guilt

  return { subject: String(e.subject ?? ""), verdict, findings, accountableFor: violations, exoneratedBy: clears };
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface ReckoningGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function reckoningGauntlet(): ReckoningGauntlet {
  const base: Evidence = { subject: "c", attested: true, attestVerified: true, secretsClean: true, engagement: "ALLOW", cosigned: false, customsClean: true, reverted: false };
  const exonerated = buildReckoning(base).verdict === "EXONERATED";
  const secretLeak = buildReckoning({ ...base, secretsClean: false }).verdict === "ACCOUNTABLE";
  const noCosign = buildReckoning({ ...base, engagement: "NEEDS_COSIGN", cosigned: false }).verdict === "ACCOUNTABLE";
  const withCosign = buildReckoning({ ...base, engagement: "NEEDS_COSIGN", cosigned: true }).verdict === "EXONERATED";
  const blocked = buildReckoning({ ...base, engagement: "BLOCK" }).verdict === "ACCOUNTABLE";
  const tampered = buildReckoning({ ...base, attestVerified: false }).verdict === "ACCOUNTABLE";
  const injection = buildReckoning({ ...base, customsClean: false }).verdict === "ACCOUNTABLE";
  const noRecord = buildReckoning({ ...base, attested: false, attestVerified: false }).verdict === "INSUFFICIENT_EVIDENCE";
  const revertedNote = buildReckoning({ ...base, reverted: true }).verdict === "EXONERATED" && buildReckoning({ ...base, reverted: true }).findings.some((f) => f.severity === "note");
  const namesViolation = buildReckoning({ ...base, secretsClean: false }).accountableFor.length === 1;
  const det = JSON.stringify(buildReckoning(base)) === JSON.stringify(buildReckoning(base));
  const total = (() => { try { buildReckoning(null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "EXONERATE-CLEAN", pass: exonerated, detail: "attested + verified + clean + in-policy → EXONERATED (the record defends you)" },
    { name: "ACCOUNTABLE-SECRET", pass: secretLeak, detail: "a secret leak → ACCOUNTABLE" },
    { name: "ACCOUNTABLE-NO-COSIGN", pass: noCosign, detail: "a sensitive action without the required cosign → ACCOUNTABLE" },
    { name: "COSIGN-CLEARS", pass: withCosign, detail: "the same action WITH a human cosign → EXONERATED" },
    { name: "ACCOUNTABLE-BLOCKED/TAMPER/INJECTION", pass: blocked && tampered && injection, detail: "a forbidden action, a tampered attestation, or an uncontained injection → ACCOUNTABLE" },
    { name: "INSUFFICIENT-NO-RECORD", pass: noRecord, detail: "no signed record → INSUFFICIENT_EVIDENCE (never guesses guilt OR innocence)" },
    { name: "REVERT-IS-A-NOTE", pass: revertedNote, detail: "being reverted is an outcome note, not misconduct" },
    { name: "NAMES-THE-VIOLATION", pass: namesViolation, detail: "the verdict names exactly which signed violation applies" },
    { name: "DETERMINISTIC", pass: det, detail: "same evidence → byte-identical verdict" },
    { name: "TOTAL", pass: total, detail: "never throws, even on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
