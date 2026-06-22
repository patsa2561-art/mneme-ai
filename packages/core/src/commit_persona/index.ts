/**
 * v3.123.0 — COMMIT PERSONA: every developer commits differently. This turns a
 * person's REAL git history into a measured "commit persona" + a distinct cartoon
 * avatar — so a team can SEE its commit culture, and an individual gets a fun,
 * shareable card of how they actually work.
 *
 * DIAKRISIS — honest by construction: this measures COMMIT HYGIENE (message
 * quality, commit size, test-touch, fix-rate, cadence), NOT a person's skill or
 * worth. Every trait is derived deterministically from git signals and the raw
 * numbers travel with the verdict — the avatar is a window onto measured behavior,
 * never an opinion about the human. Same author + same history ⇒ identical persona
 * + identical avatar (deterministic). Pure + total.
 */

import { createHash } from "node:crypto";

export interface CommitRec {
  author: string; email?: string; ts: number;     // unix seconds
  subject: string; body?: string;
  files: string[]; insertions: number; deletions: number;
}

function h32(s: string): number { return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16); }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function median(xs: number[]): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

const CONVENTIONAL = /^(feat|fix|docs|chore|refactor|test|style|perf|build|ci|revert)(\([^)]*\))?!?:/i;
// "firefighting" = panic/cleanup commits, NOT a well-formed conventional `fix:`
// (a structured fix is good hygiene). Reverts / oops / wip / hotfix always count.
const PANIC_WORD = /\b(revert|oops|whoops|hotfix|wip|broken|forgot|mistake|typo)\b/i;
function isFirefighting(subject: string): boolean {
  const s = subject || "";
  if (PANIC_WORD.test(s)) return true;
  return /\b(fix|bug)\b/i.test(s) && !CONVENTIONAL.test(s);   // ad-hoc "fix bug", not "fix(core): …"
}
const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\b|\.(test|spec)\.[a-z]+$/i;

export interface PersonaMetrics {
  commits: number;
  avgChurn: number;          // mean (insertions + deletions)
  medFiles: number;          // median files per commit
  conventionalRate: number;  // share of conventional-commit subjects
  bodyRate: number;          // share with an explanatory body
  testTouchRate: number;     // share touching a test file
  fixRate: number;           // share that look like a fix/revert/wip
  nightRate: number;         // share committed 00:00–05:59 local-ish (from ts hour UTC)
  avgMsgLen: number;
  focus: number;             // 0..1 — 1 = tight, focused commits; 0 = sprawling
}

export type Archetype =
  | "The Surgeon" | "The Storyteller" | "The Bulldozer" | "The Firefighter"
  | "The Night Owl" | "The Machine Gun" | "The Architect" | "The Builder";

export type Tier = "ROOKIE" | "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND" | "LEGENDARY";
export const TIERS: Tier[] = ["ROOKIE", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "LEGENDARY"];

/** An RPG-style character sheet — each stat is a measured git signal, 0..100. */
export interface PersonaStats {
  precision: number;   // small, focused commits (low churn + tight file count)
  discipline: number;  // structured, explained messages (conventional + body)
  coverage: number;    // ships tests with code
  velocity: number;    // commit volume / activity
  stability: number;   // few firefighting fixups / reverts
}

export interface Persona {
  author: string;
  metrics: PersonaMetrics;
  archetype: Archetype;
  blurb: string;
  stats: PersonaStats;
  power: number;             // 0..100 — quality-weighted overall (the old "hygiene")
  hygiene: number;           // alias of power (back-compat) — COMMIT HYGIENE, not skill
  band: "PRISTINE" | "TIDY" | "ROUGH" | "CHAOTIC";
  level: number;             // 1..50 — grows with quality (+ a little with volume)
  xp: number;                // measured points behind the level
  nextLevelXp: number;       // xp needed for the next level (0 at max)
  tier: Tier;                // ROOKIE→LEGENDARY — gated by QUALITY, so higher = cooler AND better
  traits: AvatarTraits;      // deterministic visual genome
}

export interface AvatarTraits {
  hue: number; accent: number; bodyColor: string; accentColor: string;
  build: "slim" | "round" | "buff"; // from commit size
  eyes: "happy" | "neutral" | "tired" | "wow";
  mouth: "smile" | "flat" | "grimace" | "open";
  accessory: "scalpel" | "book" | "hardhat" | "extinguisher" | "coffee" | "bolt" | "compass" | "wrench";
  tier: Tier;
  tierRank: number;          // 0..6
  shield: number;            // 0..1 — coverage → shield size/shine
  scars: number;             // 0..3 — firefighting → battle scars
  crown: boolean;            // GOLD+ with high discipline
  cape: boolean;             // PLATINUM+
  aura: number;              // 0..1 — DIAMOND+ glow strength
  stars: number;             // 0..5 — rank pips from level
  glow: boolean;
}

function computeMetrics(cs: CommitRec[]): PersonaMetrics {
  const n = cs.length || 1;
  const churn = cs.map((c) => (c.insertions || 0) + (c.deletions || 0));
  const filesCounts = cs.map((c) => (c.files?.length || 0));
  const conv = cs.filter((c) => CONVENTIONAL.test(c.subject || "")).length;
  const body = cs.filter((c) => (c.body || "").trim().length > 0).length;
  const test = cs.filter((c) => (c.files || []).some((f) => TEST_FILE.test(f))).length;
  const fix = cs.filter((c) => isFirefighting(c.subject || "")).length;
  const night = cs.filter((c) => { const hr = new Date((c.ts || 0) * 1000).getUTCHours(); return hr >= 0 && hr < 6; }).length;
  const msgLen = cs.reduce((a, c) => a + (c.subject || "").length, 0) / n;
  const medF = median(filesCounts);
  // focus: tight if median files small + low variance; sprawls if many files/commit
  const focus = clamp(1 - (medF - 1) / 12, 0, 1);
  return {
    commits: cs.length,
    avgChurn: round2(churn.reduce((a, b) => a + b, 0) / n),
    medFiles: round2(medF),
    conventionalRate: round2(conv / n),
    bodyRate: round2(body / n),
    testTouchRate: round2(test / n),
    fixRate: round2(fix / n),
    nightRate: round2(night / n),
    avgMsgLen: round2(msgLen),
    focus: round2(focus),
  };
}

/** The RPG character sheet — each stat measured from git, 0..100. */
function computeStats(m: PersonaMetrics): PersonaStats {
  const r = (x: number) => Math.round(clamp(x, 0, 1) * 100);
  return {
    precision: r(m.focus * 0.55 + clamp(1 - m.avgChurn / 450, 0, 1) * 0.45),   // small, focused
    discipline: r(m.conventionalRate * 0.65 + m.bodyRate * 0.35),               // structured + explained
    coverage: r(m.testTouchRate),                                               // ships tests
    velocity: r(clamp(m.commits / 200, 0, 1)),                                  // volume / activity
    stability: r(1 - clamp(m.fixRate / 0.5, 0, 1)),                             // few fixups/reverts
  };
}

/** POWER 0..100 = quality-weighted overall (the old "hygiene"). QUALITY stats
 *  (precision/discipline/coverage/stability) dominate; volume only nudges. So a
 *  high-volume, no-test "bulldozer" stays LOW — accurate, not flattering. */
function powerScore(s: PersonaStats): number {
  const quality = (s.precision + s.discipline + s.coverage + s.stability) / 4;
  return Math.round(clamp(quality * 0.85 + s.velocity * 0.15, 0, 100));
}

/** Level 1..50 — grows mostly with quality (power), a little with experience
 *  (volume), with diminishing returns so it feels like leveling up a character. */
function levelFromXp(xp: number): number { return Math.max(1, Math.min(50, Math.floor(Math.sqrt(xp) ) )); }
function xpFor(power: number, stats: PersonaStats): number {
  // power is the spine; coverage + volume add experience points
  return Math.round(power * power * 0.36 + stats.coverage * 3 + stats.velocity * 4);
}
function tierFromPower(power: number): { tier: Tier; rank: number } {
  const cuts = [30, 45, 60, 72, 83, 92];   // ROOKIE<30<BRONZE<45<SILVER<60<GOLD<72<PLAT<83<DIAMOND<92<LEGENDARY
  let rank = 0; for (const c of cuts) if (power >= c) rank++;
  return { tier: TIERS[rank]!, rank };
}

function pickArchetype(m: PersonaMetrics): Archetype {
  if (m.fixRate >= 0.4) return "The Firefighter";
  if (m.avgChurn >= 600 || m.medFiles >= 12) return "The Bulldozer";
  if (m.bodyRate >= 0.6 && m.conventionalRate >= 0.5 && m.avgMsgLen >= 35) return "The Storyteller";
  if (m.avgChurn <= 120 && m.testTouchRate >= 0.35 && m.focus >= 0.7) return "The Surgeon";
  if (m.nightRate >= 0.45) return "The Night Owl";
  if (m.commits >= 30 && m.avgChurn <= 60) return "The Machine Gun";
  if (m.conventionalRate >= 0.6 && m.focus >= 0.6) return "The Architect";
  return "The Builder";
}

const BLURB: Record<Archetype, string> = {
  "The Surgeon": "small, focused, test-backed cuts — precise and reversible.",
  "The Storyteller": "every commit explains the why; future-you says thanks.",
  "The Bulldozer": "moves mountains per commit — powerful, but hard to review.",
  "The Firefighter": "lots of fixes and reverts — always putting out flames.",
  "The Night Owl": "ships in the small hours — the repo never sleeps.",
  "The Machine Gun": "many tiny rapid commits — steady staccato progress.",
  "The Architect": "structured, conventional, deliberate — builds to a plan.",
  "The Builder": "steady, balanced commits — gets the work done.",
};
const ARCH_ACCESSORY: Record<Archetype, AvatarTraits["accessory"]> = {
  "The Surgeon": "scalpel", "The Storyteller": "book", "The Bulldozer": "hardhat",
  "The Firefighter": "extinguisher", "The Night Owl": "coffee", "The Machine Gun": "bolt",
  "The Architect": "compass", "The Builder": "wrench",
};

function deriveTraits(author: string, m: PersonaMetrics, archetype: Archetype, stats: PersonaStats, power: number, level: number, tier: Tier, rank: number): AvatarTraits {
  const seed = h32(author);
  const hue = seed % 360;                                  // stable, distinct per author
  const accent = (hue + 40 + (seed >> 8) % 80) % 360;
  const build: AvatarTraits["build"] = m.avgChurn >= 400 ? "buff" : m.avgChurn <= 90 ? "slim" : "round";
  const eyes: AvatarTraits["eyes"] = m.nightRate >= 0.45 ? "tired" : power >= 70 ? "happy" : m.fixRate >= 0.4 ? "wow" : "neutral";
  const mouth: AvatarTraits["mouth"] = power >= 70 ? "smile" : power >= 50 ? "flat" : m.fixRate >= 0.4 ? "grimace" : "open";
  return {
    hue, accent, bodyColor: `hsl(${hue} 68% 58%)`, accentColor: `hsl(${accent} 70% 62%)`,
    build, eyes, mouth, accessory: ARCH_ACCESSORY[archetype],
    tier, tierRank: rank,
    shield: clamp(stats.coverage / 100, 0, 1),             // tests → shield
    scars: Math.round(clamp(m.fixRate / 0.5, 0, 1) * 3),   // firefighting → scars
    crown: rank >= 3 && stats.discipline >= 60,            // GOLD+ disciplined → crown
    cape: rank >= 4,                                       // PLATINUM+
    aura: rank >= 5 ? clamp((power - 88) / 12, 0.3, 1) : 0, // DIAMOND+ glow
    stars: Math.max(0, Math.min(5, Math.round(level / 10))),
    glow: rank >= 5,
  };
}

/** Build one persona from one author's commits. Pure + total. */
export function buildPersona(author: string, commits: CommitRec[]): Persona {
  const m = computeMetrics(commits || []);
  const archetype = pickArchetype(m);
  const stats = computeStats(m);
  const power = powerScore(stats);
  const xp = xpFor(power, stats);
  const level = levelFromXp(xp);
  const nextLevelXp = level >= 50 ? 0 : Math.max(0, (level + 1) * (level + 1) - xp);
  const { tier, rank } = tierFromPower(power);
  const band = power >= 85 ? "PRISTINE" : power >= 65 ? "TIDY" : power >= 40 ? "ROUGH" : "CHAOTIC";
  return {
    author, metrics: m, archetype, blurb: BLURB[archetype],
    stats, power, hygiene: power, band, level, xp, nextLevelXp, tier,
    traits: deriveTraits(author, m, archetype, stats, power, level, tier, rank),
  };
}

/** Group commits by author → personas, busiest first. Pure + total. */
export function analyzeCommitPersonas(commits: CommitRec[], opts?: { top?: number; minCommits?: number }): Persona[] {
  const by = new Map<string, CommitRec[]>();
  for (const c of commits || []) { const k = (c.author || "unknown").trim() || "unknown"; (by.get(k) || by.set(k, []).get(k)!).push(c); }
  const min = opts?.minCommits ?? 1;
  const list = [...by.entries()].filter(([, cs]) => cs.length >= min).map(([a, cs]) => buildPersona(a, cs));
  list.sort((x, y) => y.metrics.commits - x.metrics.commits);
  return typeof opts?.top === "number" ? list.slice(0, opts.top) : list;
}

// ── the cartoon: a self-contained SVG, distinct per author (CSS-3D in the web) ──
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function eyesSvg(e: AvatarTraits["eyes"]): string {
  switch (e) {
    case "happy": return `<path d="M78 96 q8 -8 16 0" stroke="#10261f" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M126 96 q8 -8 16 0" stroke="#10261f" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case "tired": return `<circle cx="86" cy="98" r="5" fill="#10261f"/><circle cx="134" cy="98" r="5" fill="#10261f"/><path d="M76 90 h20 M124 90 h20" stroke="#10261f" stroke-width="3" stroke-linecap="round"/>`;
    case "wow": return `<circle cx="86" cy="96" r="8" fill="#fff" stroke="#10261f" stroke-width="3"/><circle cx="86" cy="96" r="3.5" fill="#10261f"/><circle cx="134" cy="96" r="8" fill="#fff" stroke="#10261f" stroke-width="3"/><circle cx="134" cy="96" r="3.5" fill="#10261f"/>`;
    default: return `<circle cx="86" cy="96" r="6" fill="#10261f"/><circle cx="134" cy="96" r="6" fill="#10261f"/>`;
  }
}
function mouthSvg(mo: AvatarTraits["mouth"]): string {
  switch (mo) {
    case "smile": return `<path d="M92 120 q18 18 36 0" stroke="#10261f" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case "grimace": return `<path d="M92 124 h36 M98 118 v12 M110 118 v12 M122 118 v12" stroke="#10261f" stroke-width="3" fill="none"/>`;
    case "open": return `<ellipse cx="110" cy="124" rx="11" ry="8" fill="#10261f"/>`;
    default: return `<path d="M94 124 h32" stroke="#10261f" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  }
}
function accessorySvg(a: AvatarTraits["accessory"], accent: string): string {
  switch (a) {
    case "hardhat": return `<path d="M64 70 q46 -34 92 0 z" fill="#f4b400"/><rect x="60" y="66" width="100" height="9" rx="4" fill="#f4b400"/>`;
    case "scalpel": return `<g transform="rotate(35 170 120)"><rect x="160" y="96" width="6" height="40" rx="2" fill="#cbd5e1"/><rect x="158" y="130" width="10" height="22" rx="2" fill="${accent}"/></g>`;
    case "book": return `<g transform="translate(150 120)"><rect x="0" y="0" width="34" height="26" rx="3" fill="${accent}"/><line x1="17" y1="2" x2="17" y2="24" stroke="#fff" stroke-width="2"/></g>`;
    case "extinguisher": return `<g transform="translate(156 104)"><rect x="0" y="6" width="16" height="34" rx="6" fill="#e11d48"/><rect x="5" y="0" width="6" height="8" fill="#9ca3af"/></g>`;
    case "coffee": return `<g transform="translate(154 116)"><rect x="0" y="0" width="26" height="22" rx="3" fill="#fff"/><path d="M26 4 q10 0 10 8 t-10 8" fill="none" stroke="#fff" stroke-width="3"/><path d="M8 -8 q4 6 0 12 M16 -8 q4 6 0 12" stroke="${accent}" stroke-width="2" fill="none"/></g>`;
    case "bolt": return `<path d="M168 96 l-14 26 h10 l-6 22 l22 -30 h-12 z" fill="#fde047" stroke="#10261f" stroke-width="1.5"/>`;
    case "compass": return `<g transform="translate(160 118)"><circle cx="12" cy="12" r="13" fill="none" stroke="${accent}" stroke-width="3"/><path d="M12 4 l4 8 l-4 8 l-4 -8 z" fill="${accent}"/></g>`;
    default: return `<g transform="rotate(40 168 120)"><rect x="162" y="98" width="7" height="38" rx="3" fill="#9ca3af"/><circle cx="165" cy="96" r="8" fill="none" stroke="#9ca3af" stroke-width="5"/></g>`;
  }
}

const TIER_COLOR: Record<Tier, string> = {
  ROOKIE: "#9ca3af", BRONZE: "#c2803f", SILVER: "#cbd5e1", GOLD: "#f4b400",
  PLATINUM: "#5eead4", DIAMOND: "#818cf8", LEGENDARY: "#f0abfc",
};

/**
 * A layered RPG-style avatar that VISIBLY levels up. Every layer is data-driven:
 * shield size ← test coverage · battle scars ← firefighting rate · armor plating &
 * outline thickness ← tier · crown ← GOLD+ disciplined · cape ← PLATINUM+ · glowing
 * aura ← DIAMOND+ · rank stars ← level · body size ← commit size · weapon ← archetype.
 * So a higher level/quality persona is unmistakably more decorated AND more capable.
 * Deterministic + total.
 */
export function personaAvatarSvg(p: Persona): string {
  try {
    const t = p.traits || ({} as AvatarTraits);
    const tier = t.tier || "ROOKIE"; const rank = t.tierRank || 0;
    const tc = TIER_COLOR[tier] || "#9ca3af";
    const rx = t.build === "buff" ? 66 : t.build === "slim" ? 48 : 58;
    const cx = 110, cy = 112;
    const L: string[] = [];
    L.push(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="248" viewBox="0 0 220 248" role="img" aria-label="${esc(p.author)} — ${esc(p.archetype)}, ${esc(tier)} level ${p.level}">`);
    L.push(`<defs><radialGradient id="g${t.hue}" cx="38%" cy="30%"><stop offset="0" stop-color="${t.accentColor}"/><stop offset="1" stop-color="${t.bodyColor}"/></radialGradient>`);
    L.push(`<linearGradient id="arm${rank}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tc}"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs>`);
    // aura (DIAMOND+) — glowing rings behind everything
    if (t.aura > 0) { L.push(`<circle cx="${cx}" cy="${cy}" r="${rx + 22}" fill="${tc}" opacity="${(0.10 * t.aura).toFixed(2)}"/>`); L.push(`<circle cx="${cx}" cy="${cy}" r="${rx + 12}" fill="${tc}" opacity="${(0.16 * t.aura).toFixed(2)}"/>`); }
    // cape (PLATINUM+)
    if (t.cape) L.push(`<path d="M${cx - rx + 6} ${cy} q-30 50 -10 96 l${rx * 2 - 12} 0 q20 -46 -10 -96 z" fill="${tc}" opacity="0.55"/>`);
    // ground shadow → depth
    L.push(`<ellipse cx="${cx}" cy="214" rx="${rx}" ry="15" fill="#000" opacity="0.20"/>`);
    // body
    L.push(`<circle cx="${cx}" cy="${cy}" r="${rx}" fill="url(#g${t.hue})" stroke="${rank >= 2 ? tc : "#10261f"}" stroke-width="${3 + Math.min(4, rank)}"/>`);
    // armor plating (SILVER+) — a metallic collar at the chin, tier-tinted
    if (rank >= 2) L.push(`<path d="M${cx - rx + 8} ${cy + rx * 0.55} a${rx} ${rx} 0 0 0 ${rx * 2 - 16} 0 z" fill="url(#arm${rank})" opacity="0.9" stroke="${tc}" stroke-width="2"/>`);
    // 3D sheen
    L.push(`<ellipse cx="${cx - rx * 0.4}" cy="${cy - rx * 0.42}" rx="${rx * 0.34}" ry="${rx * 0.22}" fill="#fff" opacity="0.30"/>`);
    // battle scars ← firefighting
    for (let i = 0; i < (t.scars || 0); i++) L.push(`<path d="M${cx - 20 + i * 18} ${cy - 14} l10 26" stroke="#7f1d1d" stroke-width="2.5" opacity="0.7" stroke-linecap="round"/>`);
    L.push(eyesSvg(t.eyes), mouthSvg(t.mouth), accessorySvg(t.accessory, t.accentColor));
    // shield ← coverage (tests). bigger + a check at high coverage; faded when low.
    if ((t.shield || 0) > 0.05) {
      const ss = 14 + t.shield * 22, sx = 40, sy = cy + 6;
      L.push(`<g transform="translate(${sx} ${sy})"><path d="M0 ${-ss} q${ss} 4 ${ss} ${ss * 0.5} q0 ${ss} -${ss} ${ss * 1.2} q-${ss} -${ss * 0.2} -${ss} -${ss * 1.2} q0 -${ss * 0.5 - 4} 0 -${ss * 0.5} z" transform="translate(${-ss / 2} 0)" fill="${tc}" stroke="#0b1220" stroke-width="2" opacity="${(0.5 + t.shield * 0.5).toFixed(2)}"/>`);
      if (t.shield >= 0.5) L.push(`<path d="M${-ss * 0.28} 2 l${ss * 0.18} ${ss * 0.22} l${ss * 0.4} -${ss * 0.4}" stroke="#04141b" stroke-width="3" fill="none" stroke-linecap="round"/>`);
      L.push(`</g>`);
    }
    // crown (GOLD+ disciplined)
    if (t.crown) L.push(`<path d="M${cx - 26} ${cy - rx + 4} l6 -20 l8 12 l8 -16 l8 16 l8 -12 l6 20 z" fill="${tier === "LEGENDARY" ? "#f0abfc" : "#f4b400"}" stroke="#0b1220" stroke-width="1.5"/>`);
    // rank stars ← level
    let stars = ""; for (let i = 0; i < (t.stars || 0); i++) stars += `<text x="${cx - (t.stars - 1) * 7 + i * 14}" y="232" text-anchor="middle" font-size="13" fill="${tc}">★</text>`;
    L.push(stars);
    // tier + level badge
    L.push(`<rect x="${cx - 56}" y="184" width="112" height="22" rx="11" fill="${tc}"/>`);
    L.push(`<text x="${cx}" y="199" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="11.5" font-weight="800" fill="#0b1220">${esc(tier)} · Lv.${p.level} · ${p.power}</text>`);
    L.push(`</svg>`);
    return L.join("");
  } catch { return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="248"><rect width="220" height="248" fill="#1b1f24"/><text x="110" y="124" fill="#fff" text-anchor="middle" font-size="14">persona?</text></svg>`; }
}

// ── deterministic proof ──────────────────────────────────────────────────────
function synthCommits(kind: "surgeon" | "bulldozer" | "firefighter" | "storyteller" | "legend", author: string, n = 20): CommitRec[] {
  const out: CommitRec[] = []; const base = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    if (kind === "surgeon") out.push({ author, ts: base + i * 9000 + 43200, subject: `fix(core): tighten validation`, body: "why: edge case", files: ["src/x.ts", "src/x.test.ts"], insertions: 12, deletions: 4 });
    else if (kind === "bulldozer") out.push({ author, ts: base + i * 9000 + 43200, subject: "big update", files: Array.from({ length: 18 }, (_, k) => `src/f${k}.ts`), insertions: 700, deletions: 300 });
    else if (kind === "firefighter") out.push({ author, ts: base + i * 9000 + 43200, subject: i % 2 ? "fix bug oops" : "revert broken thing", files: ["src/y.ts"], insertions: 20, deletions: 18 });
    else if (kind === "legend") out.push({ author, ts: base + i * 9000 + 43200, subject: "feat(core): add the validated parser", body: "Explains the why in full so reviewers and future-me understand the change.", files: ["src/p.ts", "src/p.test.ts"], insertions: 22, deletions: 6 });
    else out.push({ author, ts: base + i * 9000 + 43200, subject: "feat(api): add the paginated search endpoint", body: "Adds cursor pagination because offset was slow on big tables.", files: ["src/api.ts", "src/api.test.ts"], insertions: 60, deletions: 10 });
  }
  return out;
}

export interface PersonaGauntlet {
  archetypesDiscriminate: boolean;   // surgeon/bulldozer/firefighter/storyteller resolve correctly
  powerMonotonic: boolean;           // surgeon power > bulldozer; story > firefighter — quality, accurate
  levelMonotonic: boolean;           // a higher-quality persona is a higher level
  tierGatedByQuality: boolean;       // a no-test bulldozer can NEVER reach a top tier; a legend does
  bulldozerScoresLow: boolean;       // ★ the user's complaint: huge no-test commits land LOW (ROUGH/CHAOTIC)
  avatarLevelsUp: boolean;           // ★ higher tier ⇒ visibly more gear (crown/aura/cape) + longer SVG
  shieldTracksCoverage: boolean;     // tests ⇒ bigger shield than a no-test peer
  scarsTrackFirefighting: boolean;   // firefighter has battle scars; a clean dev has none
  distinctAvatars: boolean;
  avatarSelfContained: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function personaGauntlet(): PersonaGauntlet {
  const surgeon = buildPersona("alice", synthCommits("surgeon", "alice"));
  const bull = buildPersona("bob", synthCommits("bulldozer", "bob"));
  const fire = buildPersona("carol", synthCommits("firefighter", "carol"));
  const story = buildPersona("dave", synthCommits("storyteller", "dave"));
  const legend = buildPersona("erin", synthCommits("legend", "erin", 140));   // prolific, clean, tested

  const archetypesDiscriminate = surgeon.archetype === "The Surgeon" && bull.archetype === "The Bulldozer" && fire.archetype === "The Firefighter" && story.archetype === "The Storyteller";
  const powerMonotonic = surgeon.power > bull.power && story.power > fire.power;
  const levelMonotonic = legend.level > bull.level && surgeon.level >= bull.level;
  const tierGatedByQuality = legend.traits.tierRank >= 5 && bull.traits.tierRank <= 2;
  const bulldozerScoresLow = bull.band === "ROUGH" || bull.band === "CHAOTIC";

  const aLegend = personaAvatarSvg(legend), aBull = personaAvatarSvg(bull);
  const legendGear = (legend.traits.crown || legend.traits.aura > 0 || legend.traits.cape);
  const avatarLevelsUp = legendGear && aLegend.length > aBull.length && legend.traits.stars > bull.traits.stars;
  const shieldTracksCoverage = surgeon.traits.shield > bull.traits.shield;
  const scarsTrackFirefighting = fire.traits.scars > surgeon.traits.scars;

  const distinctAvatars = surgeon.traits.hue !== bull.traits.hue && aLegend !== aBull;
  const avatarSelfContained = aLegend.startsWith("<svg") && !/<script|xlink:href|\b(?:href|src)\s*=|<image/i.test(aLegend);
  const deterministic = JSON.stringify(buildPersona("alice", synthCommits("surgeon", "alice"))) === JSON.stringify(surgeon) && personaAvatarSvg(legend) === aLegend;
  let total = true;
  try { analyzeCommitPersonas(null as unknown as CommitRec[]); buildPersona("", []); personaAvatarSvg({ traits: {} } as Persona); personaAvatarSvg(null as unknown as Persona); analyzeCommitPersonas([{ author: "z", ts: 0, subject: "", files: [], insertions: 0, deletions: 0 }]); } catch { total = false; }

  const all = archetypesDiscriminate && powerMonotonic && levelMonotonic && tierGatedByQuality && bulldozerScoresLow && avatarLevelsUp && shieldTracksCoverage && scarsTrackFirefighting && distinctAvatars && avatarSelfContained && deterministic && total;
  return { archetypesDiscriminate, powerMonotonic, levelMonotonic, tierGatedByQuality, bulldozerScoresLow, avatarLevelsUp, shieldTracksCoverage, scarsTrackFirefighting, distinctAvatars, avatarSelfContained, deterministic, total, score: all ? 100 : 0 };
}
