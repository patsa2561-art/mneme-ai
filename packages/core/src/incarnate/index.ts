/**
 * v2.142.0 — INCARNATE: the Intelligence-Automation briefing layer ("Code
 * Incarnation"). Turn a raw alert ("paymentGateway is 40% slower") into an
 * EXPERT-ANALYST briefing by composing the git-telepathy analysis (HAUNT) with
 * the historical regret base-rate (REGRET) and the team's shared knowledge
 * (CORTEX) — who/when/why + the safeguards it lacks + concrete next steps — in
 * the plain-language shape a developer can act on immediately.
 *
 * This is the AUTOMATION glue the "Developer Intelligence Partner" idea needs:
 * HAUNT is the analysis engine; INCARNATE is the alert → enriched-briefing
 * pipeline. (Delivery to a channel/LINE is intentionally NOT here yet — the
 * briefing is the deliverable; a delivery adapter can wrap it later.)
 *
 * DIAKRISIS — the honest ceiling:
 *   - INCARNATE COMPOSES real, already-proven signals (HAUNT's git facts, REGRET's
 *     calibrated base-rate, CORTEX's shared notes). It is an enrichment layer, NOT
 *     a metrics monitor (you FEED it the alert) and NOT a predictor — the verdict
 *     is ACTIONABLE / FYI / UNKNOWN, and a no-history alert yields UNKNOWN with no
 *     fabricated urgency. Next steps are "candidates to investigate", never a
 *     confirmed root cause.
 * Pure + deterministic + total.
 */

import type { HauntReport } from "../haunt/index.js";

export type Severity = "urgent" | "warning" | "info";
export interface Alert {
  file: string;
  symptom?: string;          // "40% slower", "500 errors at peak", "OOM"
  severity?: Severity;       // operator-declared; else derived from the verdict
  metric?: string;           // optional raw metric string for context
  region?: { start: number; end: number };
}

export type BriefingVerdict = "ACTIONABLE" | "FYI" | "UNKNOWN";
export interface Briefing {
  severity: Severity;
  verdict: BriefingVerdict;
  title: string;
  file: string;
  region: { start: number; end: number } | null;
  who: string | null;
  when: string | null;
  ageDays: number | null;
  intent: string | null;
  riskFlags: string[];
  regretBand: string | null;
  knowledge: { source?: string; value: string }[];
  nextSteps: string[];
  message: string;
}

const SEV_ICON: Record<Severity, string> = { urgent: "🔴", warning: "🟠", info: "🔵" };
const SEV_WORD: Record<Severity, string> = { urgent: "Urgent", warning: "Warning", info: "Info" };

function fnName(file: string, region: { start: number; end: number } | null): string {
  const base = (file || "").split(/[\\/]/).pop() || file || "code";
  return region ? `${base}:${region.start}-${region.end}` : base;
}

/** Map a HAUNT safeguard flag to a concrete, honest next-step. */
function stepForFlag(flag: string): string | null {
  if (/await inside a loop/i.test(flag)) return "Batch or parallelize the per-item awaits (serial I/O is a peak-load bottleneck).";
  if (/caching|memoization/i.test(flag)) return "Add a caching / memoization layer for the hot path.";
  if (/timeout|deadline/i.test(flag)) return "Add a timeout / deadline guard so it fails fast under load.";
  if (/error handling|retry/i.test(flag)) return "Add error handling / a retry so a transient failure doesn't cascade.";
  if (/unbounded query|SELECT/i.test(flag)) return "Bound the query (avoid SELECT * / a full scan).";
  if (/unbounded accumulation|listener|leak/i.test(flag)) return "Cap the accumulation / remove the listener to stop the leak.";
  return null;
}

/**
 * Compose an alert + a HAUNT report (+ optional regret band & extra knowledge)
 * into an expert-analyst briefing. Pure + deterministic + total.
 */
export function buildBriefing(alert: Alert, haunt: HauntReport, opts?: { regretBand?: string; extraKnowledge?: { source?: string; value: string }[] }): Briefing {
  try {
    const file = typeof alert?.file === "string" ? alert.file : (haunt?.file ?? "(unknown)");
    const region = (alert?.region ?? haunt?.region ?? null) as Briefing["region"];
    const symptom = typeof alert?.symptom === "string" && alert.symptom ? alert.symptom : null;
    const regretBand = typeof opts?.regretBand === "string" ? opts.regretBand : null;

    const hv = haunt?.verdict ?? "UNKNOWN";
    const riskFlags = Array.isArray(haunt?.riskFlags) ? haunt.riskFlags : [];
    const temporaryFix = haunt?.intent?.temporaryFix === true;
    const knowledge = [...(Array.isArray(haunt?.relatedKnowledge) ? haunt.relatedKnowledge : []), ...(Array.isArray(opts?.extraKnowledge) ? opts!.extraKnowledge! : [])].slice(0, 5);

    // verdict: UNKNOWN if no git history; ACTIONABLE if haunted / risky / elevated
    // regret; else FYI.
    const elevated = regretBand === "HIGH" || regretBand === "ELEVATED";
    let verdict: BriefingVerdict;
    if (hv === "UNKNOWN") verdict = "UNKNOWN";
    else if (hv === "HAUNTED" || elevated || riskFlags.length > 0) verdict = "ACTIONABLE";
    else verdict = "FYI";

    // severity: operator-declared wins; else derive from the verdict (never
    // invent urgency on UNKNOWN).
    const severity: Severity = (["urgent", "warning", "info"] as const).includes(alert?.severity as Severity)
      ? (alert!.severity as Severity)
      : verdict === "ACTIONABLE" ? "warning" : "info";

    const who = haunt?.lastTouched?.author || null;
    const when = haunt?.lastTouched?.whenISO || null;
    const ageDays = typeof haunt?.ageDays === "number" ? haunt.ageDays : null;
    const intent = temporaryFix ? (haunt?.intent?.signals?.[0]?.quote ?? "temporary-fix intent recorded") : null;

    const title = `${SEV_ICON[severity]} ${SEV_WORD[severity]}: ${fnName(file, region)}${symptom ? ` — ${symptom}` : ""}`;

    // next steps (honest: candidates, not a confirmed fix)
    const nextSteps: string[] = [];
    if (temporaryFix) nextSteps.push("Revisit the temporary fix the original author flagged.");
    for (const f of riskFlags) { const s = stepForFlag(f); if (s && !nextSteps.includes(s)) nextSteps.push(s); }
    if (who) nextSteps.push(`Loop in ${who} (last touched this region) for the original context.`);
    if (knowledge.length) nextSteps.push("Check the team knowledge already shared for this area (below).");

    // message: the expert-analyst plain-language briefing
    const parts: string[] = [title];
    if (verdict === "UNKNOWN") {
      parts.push(`No git history for ${fnName(file, region)} — I can't attribute an author or a past intent. Not enough signal to brief; investigate directly.`);
    } else {
      parts.push(haunt?.narrative ?? "");
      if (regretBand && regretBand !== "UNKNOWN") parts.push(`Past-outcome signal: edits carrying these signals were historically regretted at a ${regretBand} rate (calibrated base rate, not a prediction).`);
      if (alert?.metric) parts.push(`Alert metric: ${alert.metric}.`);
      if (nextSteps.length) parts.push(`Next steps (candidates, not a confirmed root cause): ${nextSteps.map((s, i) => `(${i + 1}) ${s}`).join(" ")}`);
    }
    const message = parts.filter(Boolean).join("\n");

    return { severity, verdict, title, file, region, who, when, ageDays, intent, riskFlags, regretBand, knowledge, nextSteps, message };
  } catch {
    return { severity: "info", verdict: "UNKNOWN", title: "🔵 Info: briefing error", file: alert?.file ?? "(unknown)", region: null, who: null, when: null, ageDays: null, intent: null, riskFlags: [], regretBand: null, knowledge: [], nextSteps: [], message: "INCARNATE briefing error — abstaining." };
  }
}

// ── falsifiable proof ────────────────────────────────────────────────────────
export interface IncarnateGauntlet {
  urgentHauntedIsActionable: boolean;
  derivesSeverityIcon: boolean;
  unknownNoFalseUrgency: boolean;
  nextStepsFromRiskFlags: boolean;
  foldsRegretBand: boolean;
  surfacesIntentAndAuthor: boolean;
  honestNoConfirmedCause: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function incarnateGauntlet(): IncarnateGauntlet {
  const hauntedReport: HauntReport = {
    file: "src/payment.ts", region: { start: 40, end: 92 },
    lastTouched: { author: "Alice", whenISO: "2023-08-01", commit: "abc1234d", subject: "quick fix for flash sale" },
    ageDays: 90,
    intent: { temporaryFix: true, signals: [{ label: "temporary-fix", quote: "temporary, will revisit after the sale" }] },
    riskFlags: ["no caching/memoization layer", "await inside a loop (serial I/O — slow under load)"],
    relatedKnowledge: [{ source: "Bob", value: "use the batched charge API" }],
    verdict: "HAUNTED",
    narrative: "src/payment.ts:40-92 was last changed 90 days ago by Alice — \"quick fix for flash sale\". ⚠ temporary-fix intent. (candidate, not a proven cause.)",
  };
  const bUrgent = buildBriefing({ file: "src/payment.ts", region: { start: 40, end: 92 }, symptom: "40% slower at traffic peak", severity: "urgent", metric: "p95 latency +40%" }, hauntedReport, { regretBand: "ELEVATED" });
  const urgentHauntedIsActionable = bUrgent.verdict === "ACTIONABLE";
  const derivesSeverityIcon = bUrgent.severity === "urgent" && bUrgent.title.startsWith("🔴 Urgent:");
  const nextStepsFromRiskFlags = bUrgent.nextSteps.some((s) => /caching/i.test(s)) && bUrgent.nextSteps.some((s) => /parallelize|batch/i.test(s)) && bUrgent.nextSteps.some((s) => /Alice/.test(s));
  const foldsRegretBand = /ELEVATED rate/.test(bUrgent.message) && /not a prediction/.test(bUrgent.message);
  const surfacesIntentAndAuthor = bUrgent.who === "Alice" && bUrgent.intent !== null && /Alice/.test(bUrgent.message);
  const honestNoConfirmedCause = /candidates, not a confirmed root cause/i.test(bUrgent.message) && !/this is the (bug|cause)/i.test(bUrgent.message);

  const unknownReport: HauntReport = { file: "x.ts", region: null, lastTouched: null, ageDays: null, intent: { temporaryFix: false, signals: [] }, riskFlags: [], relatedKnowledge: [], verdict: "UNKNOWN", narrative: "No git history found for x.ts — UNKNOWN." };
  const bUnknown = buildBriefing({ file: "x.ts", symptom: "errors" }, unknownReport);
  const unknownNoFalseUrgency = bUnknown.verdict === "UNKNOWN" && bUnknown.severity === "info" && /can't attribute an author/i.test(bUnknown.message);

  const deterministic = JSON.stringify(buildBriefing({ file: "src/payment.ts", symptom: "slow", severity: "urgent" }, hauntedReport, { regretBand: "ELEVATED" })) === JSON.stringify(buildBriefing({ file: "src/payment.ts", symptom: "slow", severity: "urgent" }, hauntedReport, { regretBand: "ELEVATED" }));

  let total = true;
  try {
    buildBriefing(null as unknown as Alert, null as unknown as HauntReport);
    buildBriefing({ file: 1 as unknown as string }, { verdict: "weird" } as unknown as HauntReport);
  } catch { total = false; }

  const all = urgentHauntedIsActionable && derivesSeverityIcon && unknownNoFalseUrgency && nextStepsFromRiskFlags
    && foldsRegretBand && surfacesIntentAndAuthor && honestNoConfirmedCause && deterministic && total;
  return { urgentHauntedIsActionable, derivesSeverityIcon, unknownNoFalseUrgency, nextStepsFromRiskFlags, foldsRegretBand, surfacesIntentAndAuthor, honestNoConfirmedCause, deterministic, total, score: all ? 100 : 0 };
}
