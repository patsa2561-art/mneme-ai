/**
 * SCAR-TISSUE VACCINE — inject the organisation's hard-won lessons into an AI agent BEFORE it repeats them.
 *
 * An AI agent writing code for you today has ZERO institutional memory. It will confidently reintroduce
 * the exact bug that took prod down in 2023, because it never lived through it — and the "why we don't do
 * it this way" (negative knowledge) left with the engineer who quit. This is the layer that remembers.
 *
 * The mechanism is an ASYMMETRY, and the asymmetry is the whole product:
 *   • FIRE when a change has the SHAPE of a past mistake (its triggers) AND lacks the ANTIBODY (the
 *     fix-pattern the team learned to apply) → surface the scar's lesson into the agent's context.
 *   • STAY SILENT when the same shape is present but the antibody IS there → the lesson was already
 *     applied; no nag. (And silent on novel changes.)
 * "You're touching payments" is noise. "You're touching payments in the shape that double-charged
 * customers in 2023, and you haven't added the idempotency key" is a vaccine.
 *
 * The scar corpus is the moat: it is the customer's own proprietary pain (mined by Mneme from regret /
 * revert / incident-correlation / the negative-knowledge ledger), and it compounds — the longer it runs,
 * the more of the org's scars it carries. This module owns the matcher + corpus format; the CLI/MCP load
 * the corpus (builtin classics + `.mneme/scars.json` + the org's derived scars).
 *
 * ★HONEST (DIAKRISIS): the matcher is a LEXICAL heuristic (trigger tokens × file overlap × antibody
 * presence) — a high-signal candidate to surface, NOT a proof the bug is present; a production deployment
 * should layer semantic similarity (Mneme's embeddings) to cut false positives. The asymmetry (quiet when
 * the antibody is present) is what keeps it from being noise. A FIRE means "look — you may be repeating
 * this", never "this is definitely the 2023 bug".
 */
export interface Scar {
  id: string; severity: "critical" | "high" | "medium" | "low"; title: string;
  files: string[];          // path fragments where this scar lives (file-overlap signal)
  triggers: string[];       // tokens whose presence = the mistake's SHAPE
  antibodies: string[];     // tokens whose presence = the fix was applied (suppresses the alert)
  lesson: string;           // the hard-won lesson to inject into the agent's context
}
export interface ScarHit { scar: Scar; score: number; matchedTriggers: string[]; antibody: string | null; fires: boolean }

/** The classic, cross-org scars — a sensible default corpus; real value comes from the org's own. */
export const BUILTIN_SCARS: Scar[] = [
  { id: "SCAR-double-charge", severity: "critical", title: "Double-charge — payment retry was not idempotent", files: ["payment", "charge", "billing"], triggers: ["retry", "charge"], antibodies: ["idempotencykey", "idempotency_key", "idempotency-key", "dedupe", "dedup"], lesson: "Any retry around a charge MUST carry an idempotency key — a network retry without one double-charges the customer." },
  { id: "SCAR-n-plus-1", severity: "high", title: "N+1 meltdown — per-row query inside a request loop", files: ["api", "service", "repository"], triggers: ["for", "await", "findunique"], antibodies: ["findmany", "in:", "include:", "batch", "dataloader"], lesson: "Querying per-row inside a loop (findUnique in a for-await) exhausts the connection pool under load. Batch with findMany({where:{id:{in:[...]}}}) or a DataLoader." },
  { id: "SCAR-auth-bypass", severity: "critical", title: "Auth bypass — a mutation endpoint wrote a sensitive table without an auth check", files: ["route", "controller", "handler"], triggers: ["router.", "prisma."], antibodies: ["requireauth", "authguard", "assertrole", "ensureauth", "withauth"], lesson: "A mutation endpoint shipped without an auth guard and leaked write access. Every router mutation must pass an auth check before touching a sensitive model." },
];

const lc = (s: string) => String(s ?? "").toLowerCase();
/** Match a proposed change against the scar corpus. Fires only when the mistake-shape is present AND the antibody is absent. */
export function checkChange(change: { files?: ReadonlyArray<string>; code?: string }, scars: ReadonlyArray<Scar>, opts?: { fireAt?: number }): ScarHit[] {
  const fireAt = opts?.fireAt ?? 0.6;
  const text = lc(change?.code || ""); const files = (change?.files ?? []).map(lc);
  const hits: ScarHit[] = [];
  for (const s of scars ?? []) {
    if (!s || !s.triggers?.length) continue;
    const matchedTriggers = s.triggers.filter((t) => text.includes(lc(t)));
    const triggerRatio = matchedTriggers.length / s.triggers.length;
    const fileOverlap = files.some((f) => (s.files ?? []).some((sf) => f.includes(lc(sf))));
    const antibody = (s.antibodies ?? []).find((a) => text.includes(lc(a))) ?? null;
    let score = 0;
    if (triggerRatio >= 0.66) score += 0.6 * triggerRatio;
    if (fileOverlap) score += 0.4;
    score = Math.round(score * 100) / 100;
    if (score < 0.4) continue;
    hits.push({ scar: s, score, matchedTriggers, antibody, fires: score >= fireAt && !antibody });
  }
  return hits.sort((a, b) => b.score - a.score || a.scar.id.localeCompare(b.scar.id));
}

export interface ScarVerdict { fires: boolean; firing: ScarHit[]; immune: ScarHit[]; report: string }
/** Verdict + a context block ready to inject into the agent BEFORE it commits. */
export function vaccinate(change: { title?: string; files?: ReadonlyArray<string>; code?: string }, scars: ReadonlyArray<Scar>, opts?: { fireAt?: number }): ScarVerdict {
  const hits = checkChange(change, scars, opts);
  const firing = hits.filter((h) => h.fires);
  const immune = hits.filter((h) => !h.fires && h.antibody);
  const sevIcon: Record<string, string> = { critical: "⛔", high: "🔴", medium: "🟠", low: "🟡" };
  const o: string[] = [];
  if (!firing.length) {
    o.push(immune.length ? `✅ resembles ${immune[0].scar.id} but the antibody "${immune[0].antibody}" is present — the lesson was already applied.` : "✅ no scar matched — change looks novel.");
  } else {
    o.push("🧬 SCAR-MEMORY — inject into the agent's context BEFORE it commits:");
    for (const h of firing) {
      o.push(`${sevIcon[h.scar.severity] || "⚠"} [${h.scar.severity.toUpperCase()}] resembles ${h.scar.id} (match ${h.score}) — "${h.scar.title}"`);
      o.push(`    LESSON: ${h.scar.lesson}`);
      o.push(`    → apply one of: ${h.scar.antibodies.join(", ")}`);
    }
  }
  return { fires: firing.length > 0, firing, immune, report: o.join("\n") };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ScarVaccineGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function scarVaccineGauntlet(): ScarVaccineGauntlet {
  const S = BUILTIN_SCARS;
  // retry around charge, NO idempotency key → FIRES double-charge.
  const noKey = vaccinate({ files: ["payments/retry.ts"], code: "export async function chargeWithRetry(req){ for(let i=0;i<3;i++){ try { return await charge(req); } catch(e){} } }" }, S);
  const fires = noKey.fires && noKey.firing.some((h) => h.scar.id === "SCAR-double-charge");
  // SAME shape but WITH idempotency key → IMMUNE (quiet).
  const withKey = vaccinate({ files: ["payments/retry.ts"], code: "export async function chargeWithRetry(req){ const idempotencyKey=req.id; for(let i=0;i<3;i++){ try { return await charge({...req, idempotencyKey}); } catch(e){} } }" }, S);
  const immune = !withKey.fires && withKey.immune.some((h) => h.scar.id === "SCAR-double-charge");
  // N+1 in a loop → FIRES n-plus-1.
  const nplus1 = vaccinate({ files: ["api/orders.ts"], code: "for (const o of orders) { o.user = await prisma.user.findUnique({where:{id:o.userId}}); }" }, S);
  const firesN1 = nplus1.firing.some((h) => h.scar.id === "SCAR-n-plus-1");
  // a totally novel change → silent.
  const novel = vaccinate({ files: ["ui/Button.tsx"], code: "const color = theme.primary; return color;" }, S);
  const novelSilent = !novel.fires && novel.immune.length === 0;
  const total = (() => { try { vaccinate(null as never, null as never); checkChange({}, null as never); vaccinate({}, []); return true; } catch { return false; } })();
  const checks = [
    { name: "FIRE-ON-MISTAKE-SHAPE", pass: fires, detail: "retry around charge with no idempotency key fires the double-charge scar" },
    { name: "QUIET-WHEN-ANTIBODY-PRESENT", pass: immune, detail: "the SAME shape WITH an idempotency key is recognised as immune — no nag (the asymmetry)" },
    { name: "MULTI-SCAR", pass: firesN1, detail: "an N+1 loop fires the n-plus-1 scar" },
    { name: "SILENT-ON-NOVEL", pass: novelSilent, detail: "an unrelated change matches nothing — no false alarm" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
