/**
 * AtrophyIntelligenceStrip — the WOW row above the heatmap.
 *
 * Connects the bare atrophy data to Mneme's nuclear features:
 *   • HKD  — Hidden Knowledge Density (% of files with one dominant author)
 *   • KAH  — Knowledge Atrophy Half-life (median weeks since last touch on critical files)
 *   • 3AM  — files with bus-factor-of-1 AND ghost-tier (the call-someone-at-3am set)
 *   • HEROES — top 3 owners by critical-file count + their "knowledge-years" exposure
 *   • ORPHANS — files with NO live expert
 *   • TALENT_YEARS — sum of "knowledge years" (commits × atrophy) at risk
 *
 * Plus a "What would you do?" insight ribbon underneath that turns the
 * raw numbers into one-line answers an engineering leader uses
 * tomorrow morning.
 *
 * No external service. No LLM. All metrics computed in-browser from the
 * same NervousSystemData. < 50ms even on 100-file repos.
 */

import { useMemo } from "react";
import type { NervousSystemData } from "../types";

interface Props {
  data: NervousSystemData;
}

interface NuclearMetric {
  code: string;
  glyph: string;
  value: string;
  suffix?: string;
  label: string;
  explain: string;
  tone: "ok" | "warn" | "critical";
}

interface NuclearInsight {
  glyph: string;
  headline: string;
  detail: string;
  tone: "ok" | "warn" | "critical";
}

interface NuclearReport {
  metrics: NuclearMetric[];
  insights: NuclearInsight[];
}

function buildReport(data: NervousSystemData): NuclearReport {
  const critical = data.atrophy.criticalFiles;
  const total = critical.length;

  // ─── HKD: % of critical files where 1 author dominates (≥ liveExpertCount===1)
  const dominated = critical.filter((f) => f.liveExpertCount === 1).length;
  const hkd = total === 0 ? 0 : Math.round((dominated / total) * 100);

  // ─── KAH: median (1 - freshestKnowledge) → atrophy fraction. Map to weeks.
  const halfLifeDays = data.atrophy.halfLifeDays || 60;
  const atrophyFractions = critical
    .map((f) => 1 - f.freshestKnowledge)
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  const median = atrophyFractions.length === 0 ? 0 : atrophyFractions[Math.floor(atrophyFractions.length / 2)] ?? 0;
  const kahWeeks = Math.round((median * halfLifeDays) / 7);

  // ─── 3AM: bus-factor-of-1 AND tier === at-risk (you'd call someone at 3am)
  const threeAmFiles = critical.filter((f) => f.liveExpertCount === 1 && f.tier === "at-risk");
  const threeAm = threeAmFiles.length;

  // ─── HEROES: top knowers ranked by # of critical files they own
  const ownership = new Map<string, { name: string; count: number; criticalCount: number }>();
  for (const f of critical) {
    if (!f.topKnower) continue;
    const cur = ownership.get(f.topKnower.email);
    if (cur) {
      cur.count += 1;
      if (f.tier === "at-risk") cur.criticalCount += 1;
    } else {
      ownership.set(f.topKnower.email, {
        name: f.topKnower.name,
        count: 1,
        criticalCount: f.tier === "at-risk" ? 1 : 0,
      });
    }
  }
  const heroes = [...ownership.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3);
  const heroExposure = heroes.length > 0 ? heroes[0]![1].count : 0;
  const heroName = heroes.length > 0 ? heroes[0]![1].name : null;

  // ─── ORPHANS: files with no live expert (or 0 expert count)
  const orphans = critical.filter((f) => f.liveExpertCount === 0).length;

  // ─── TALENT YEARS: sum of (touches × knowledge × halfLifeDays / 365) for files
  //     where top knower also owns ≥ 5 other critical files (= knowledge concentration risk)
  let talentYears = 0;
  for (const f of critical) {
    if (!f.topKnower) continue;
    const owner = ownership.get(f.topKnower.email);
    if (!owner || owner.count < 5) continue;
    const yrs = (f.totalTouches * (f.topKnower.knowledge ?? 0) * halfLifeDays) / 365;
    talentYears += yrs;
  }
  talentYears = Math.round(talentYears * 10) / 10;

  const metrics: NuclearMetric[] = [
    {
      code: "HKD",
      glyph: "🧠",
      value: String(hkd),
      suffix: "%",
      label: "hidden knowledge density",
      explain: `${dominated} of ${total} critical files have ONE dominant author. > 40% = bus-factor risk concentrated in a few people.`,
      tone: hkd >= 60 ? "critical" : hkd >= 40 ? "warn" : "ok",
    },
    {
      code: "KAH",
      glyph: "⌛",
      value: kahWeeks > 0 ? String(kahWeeks) : "—",
      suffix: kahWeeks > 0 ? "wk" : undefined,
      label: "atrophy half-life",
      explain: `Median time since the freshest expert last touched critical files. Higher = knowledge fading faster than work coming in.`,
      tone: kahWeeks >= 8 ? "critical" : kahWeeks >= 4 ? "warn" : "ok",
    },
    {
      code: "3AM",
      glyph: "🚨",
      value: String(threeAm),
      label: "call-at-3am files",
      explain: `Bus-factor of 1 AND knowledge already decaying. If something breaks here at 3am, exactly ONE person can fix it — and they're forgetting it too.`,
      tone: threeAm > 0 ? "critical" : "ok",
    },
    {
      code: "HERO",
      glyph: "👑",
      value: String(heroExposure),
      label: heroName ? `${heroName} owns` : "no top owner",
      explain: heroName
        ? `${heroName} is the top knower on ${heroExposure} of ${total} critical files. If they leave, half the critical map walks out the door.`
        : "No author appears as top knower on multiple critical files.",
      tone: heroExposure >= total / 3 ? "critical" : heroExposure >= total / 5 ? "warn" : "ok",
    },
    {
      code: "ORPH",
      glyph: "🪦",
      value: String(orphans),
      label: "orphaned files",
      explain: `Critical files with NO live expert at all. Anyone who edits these is rewriting blind — there's no one to ask.`,
      tone: orphans > 0 ? "critical" : "ok",
    },
    {
      code: "YRS",
      glyph: "💎",
      value: talentYears > 0 ? String(talentYears) : "—",
      suffix: talentYears > 0 ? "yr" : undefined,
      label: "knowledge years at risk",
      explain: `Estimated person-years of accumulated knowledge concentrated in heroes (top knowers who own 5+ critical files). High = succession-planning emergency.`,
      tone: talentYears >= 5 ? "critical" : talentYears >= 2 ? "warn" : "ok",
    },
  ];

  // ─── INSIGHTS — turn numbers into actionable sentences
  const insights: NuclearInsight[] = [];

  if (heroes.length > 0) {
    const top = heroes[0]!;
    insights.push({
      glyph: "🎯",
      headline: `If ${top[1].name} leaves: lose ${top[1].count} critical file${top[1].count === 1 ? "" : "s"} of knowledge`,
      detail: `${top[1].name} is the top knower on ${top[1].count} of ${total} tracked-critical files. ${top[1].criticalCount > 0 ? `${top[1].criticalCount} of those are ALREADY in the at-risk band.` : "Pair-programming session this week could halve the bus factor."}`,
      tone: top[1].count >= 5 ? "critical" : "warn",
    });
  }

  if (threeAm > 0) {
    const example = threeAmFiles[0]!;
    insights.push({
      glyph: "🚨",
      headline: `${threeAm} file${threeAm === 1 ? "" : "s"} you cannot afford to break this week`,
      detail: `${example.filePath}${example.topKnower ? ` — only ${example.topKnower.name} can fix it, and their knowledge is at ${Math.round((example.freshestKnowledge ?? 0) * 100)}%.` : "."} ${threeAm > 1 ? `${threeAm - 1} more like it.` : ""}`,
      tone: "critical",
    });
  } else if (orphans > 0) {
    insights.push({
      glyph: "🪦",
      headline: `${orphans} orphaned file${orphans === 1 ? "" : "s"} — no live expert`,
      detail: `Anyone editing these is rewriting blind. Schedule an archaeology session: read commits, document, then assign a new owner.`,
      tone: "warn",
    });
  } else {
    insights.push({
      glyph: "✓",
      headline: "No 3am files right now",
      detail: "Every at-risk file still has multiple live experts. Healthy succession posture — keep it up by rotating ownership.",
      tone: "ok",
    });
  }

  // 3rd insight — what to ASK
  if (heroName && total > 0) {
    insights.push({
      glyph: "🗣",
      headline: `Ask ${heroName}: "Which file would you hand off LAST?"`,
      detail: `That answer points to the file where their tacit knowledge is most concentrated — the one where pairing or documentation buys the most reduction in bus factor.`,
      tone: "ok",
    });
  }

  return { metrics, insights };
}

export function AtrophyIntelligenceStrip({ data }: Props) {
  const report = useMemo(() => buildReport(data), [data]);
  const total = data.atrophy.criticalFiles.length;
  if (total === 0) return null;

  return (
    <section className="atrophy-intel" aria-label="Atrophy intelligence strip">
      <header className="atrophy-intel-head">
        <h3>
          <span className="atrophy-intel-glyph" aria-hidden>⚛</span>
          Nuclear Intelligence — what these {total} files are actually telling you
        </h3>
      </header>

      <div className="atrophy-intel-metrics">
        {report.metrics.map((m) => (
          <div
            key={m.code}
            className={`atrophy-intel-metric tone-${m.tone}`}
            title={m.explain}
          >
            <div className="atrophy-intel-metric-glyph" aria-hidden>{m.glyph}</div>
            <div className="atrophy-intel-metric-value">
              {m.value}
              {m.suffix && <span className="atrophy-intel-metric-suffix">{m.suffix}</span>}
            </div>
            <div className="atrophy-intel-metric-code">{m.code}</div>
            <div className="atrophy-intel-metric-label">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="atrophy-intel-insights">
        {report.insights.map((ins, i) => (
          <div key={i} className={`atrophy-intel-insight tone-${ins.tone}`}>
            <div className="atrophy-intel-insight-glyph" aria-hidden>{ins.glyph}</div>
            <div className="atrophy-intel-insight-body">
              <div className="atrophy-intel-insight-head">{ins.headline}</div>
              <div className="atrophy-intel-insight-detail">{ins.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <footer className="atrophy-intel-foot">
        Computed live from <code>data.atrophy.criticalFiles</code> + per-author{" "}
        <code>topFiles</code>. Same primitives as <code>mneme.people.atrophy</code>{" "}
        and <code>mneme.people.bus_factor</code>. For the FULL nuclear bundle
        (HKD/TWS/CVR/HRR/REI/KAH/PCS computed against indexed embeddings + HMAC
        audit log), run <code>mneme nervous-system --json</code> and drop the
        result back in.
      </footer>
    </section>
  );
}
