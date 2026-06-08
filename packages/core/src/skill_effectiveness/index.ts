/**
 * SKILL EFFECTIVENESS — the missing axis of every "AI skill registry" (Mercury et al.): they list
 * 100s of SKILL.md playbooks, and SKILLSCAN already proves each is SAFE to install (signed, injection-
 * scanned) — but nobody measures which skills actually MAKE THE AGENT BETTER. This composes SKILLSCAN
 * (safe) + LIVE PROOF (real outcomes) into a measured EFFECTIVENESS score per skill: of the times a
 * skill was in play, how often did a real success/assist follow — a Wilson 95% lower bound, so a
 * thinly-used skill can't fake a high score. Rank + prune skills by PROVEN value, not popularity.
 *
 * ★HONEST (DIAKRISIS): this is a measured CORRELATION (skill-in-play → success-followed) with a
 * confidence interval — NOT proof the skill CAUSED the success, and NOT a judgement of the prose.
 * It abstains (UNPROVEN) on thin data and never auto-deletes a skill (Padgett: a new skill is UNPROVEN,
 * not bad). The win is honest: "which skills are measured-to-help here", which no registry reports.
 */
export type SkillBand = "PROVEN" | "PROMISING" | "UNPROVEN" | "INEFFECTIVE";
export interface SkillUse { skillId: string; agent?: string; landed: boolean; at: number }
export interface SkillScore { skillId: string; uses: number; landed: number; rateLB: number; band: SkillBand }

function wilsonLB(succ: number, n: number): number {
  if (n <= 0) return 0; const p = succ / n, z = 1.96, z2 = z * z;
  return Math.max(0, ((p + z2 / (2 * n)) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n));
}
export function normalizeUse(u: Partial<SkillUse>): SkillUse {
  return { skillId: String(u?.skillId ?? "unknown").slice(0, 120) || "unknown", agent: u?.agent ? String(u.agent).slice(0, 80) : undefined, landed: !!u?.landed, at: Number(u?.at) || 0 };
}
export function recordUse(ledger: ReadonlyArray<SkillUse>, u: Partial<SkillUse>): SkillUse[] { return [...(ledger ?? []), normalizeUse(u)]; }

export interface ScoreOpts { minSamples?: number; provenLB?: number }
/** Score one skill from its uses: Wilson-LB landing rate + a band (abstains UNPROVEN under minSamples). */
export function scoreSkill(uses: ReadonlyArray<SkillUse>, skillId: string, opts?: ScoreOpts): SkillScore {
  const minSamples = Number(opts?.minSamples) || 5; const provenLB = opts?.provenLB ?? 0.55;
  const rows = (uses ?? []).filter((u) => u.skillId === skillId);
  const n = rows.length, landed = rows.filter((u) => u.landed).length;
  const rateLB = wilsonLB(landed, n);
  let band: SkillBand;
  if (n < minSamples) band = "UNPROVEN";                              // Padgett — thin data is not "bad"
  else if (rateLB >= provenLB) band = "PROVEN";
  else if (rateLB >= 0.3) band = "PROMISING";
  else band = "INEFFECTIVE";
  return { skillId, uses: n, landed, rateLB: Math.round(rateLB * 100) / 100, band };
}
/** Rank all skills by proven effectiveness (PROVEN first, then by lower-bound rate; UNPROVEN sink). */
export function rankSkills(uses: ReadonlyArray<SkillUse>, opts?: ScoreOpts): SkillScore[] {
  const ids = [...new Set((uses ?? []).map((u) => u.skillId))];
  const order: Record<SkillBand, number> = { PROVEN: 3, PROMISING: 2, INEFFECTIVE: 1, UNPROVEN: 0 };
  return ids.map((id) => scoreSkill(uses, id, opts)).sort((a, b) => (order[b.band] - order[a.band]) || (b.rateLB - a.rateLB) || (b.uses - a.uses));
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface SkillGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function skillGauntlet(): SkillGauntlet {
  // a skill used 10× landing 9× → PROVEN; used 10× landing 1× → INEFFECTIVE; used 2× → UNPROVEN (thin)
  let L: SkillUse[] = [];
  for (let i = 0; i < 10; i++) L = recordUse(L, { skillId: "good", landed: i < 9, at: i });
  for (let i = 0; i < 10; i++) L = recordUse(L, { skillId: "bad", landed: i < 1, at: i });
  for (let i = 0; i < 2; i++) L = recordUse(L, { skillId: "new", landed: true, at: i });
  const good = scoreSkill(L, "good"), bad = scoreSkill(L, "bad"), neu = scoreSkill(L, "new");
  const bandsOK = good.band === "PROVEN" && bad.band === "INEFFECTIVE" && neu.band === "UNPROVEN";
  const lbOK = good.rateLB > bad.rateLB && good.landed === 9;
  const ranked = rankSkills(L);
  const rankOK = ranked[0].skillId === "good" && ranked[ranked.length - 1].skillId === "new";   // proven top, thin sinks
  const padgettOK = neu.band !== "INEFFECTIVE";   // a new (2-use) skill is NOT branded bad
  const wilsonOK = scoreSkill([{ skillId: "x", landed: true, at: 0 }], "x").rateLB < 1;   // 1/1 is NOT 100% (LB)
  const total = (() => { try { scoreSkill(null as never, "x"); rankSkills(null as never); normalizeUse(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "BANDS", pass: bandsOK, detail: "9/10→PROVEN · 1/10→INEFFECTIVE · 2 uses→UNPROVEN (abstain)" },
    { name: "WILSON-LB", pass: lbOK && wilsonOK, detail: "score is a Wilson lower bound — 1/1 ≠ 100%, thin samples can't fake high" },
    { name: "RANK-BY-PROVEN", pass: rankOK, detail: "skills rank by proven effectiveness; thin/unproven sink (not popularity)" },
    { name: "PADGETT-NEW-NOT-BAD", pass: padgettOK, detail: "a new, thinly-used skill is UNPROVEN, never branded INEFFECTIVE" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
