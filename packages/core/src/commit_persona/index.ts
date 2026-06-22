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

/** Loot-box rarity, mapped 1:1 from tier — for the "collect them all" gallery.
 *  SECRET is the rarest: it takes genuinely excellent git practice to mint one. */
export type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "MYTHIC" | "LEGENDARY" | "SECRET";
export const RARITY_BY_TIER: Record<Tier, Rarity> = {
  ROOKIE: "COMMON", BRONZE: "UNCOMMON", SILVER: "RARE", GOLD: "EPIC",
  PLATINUM: "MYTHIC", DIAMOND: "LEGENDARY", LEGENDARY: "SECRET",
};
export const RARITY_META: Record<Rarity, { label: string; color: string; chance: string; how: string }> = {
  COMMON:    { label: "Common",    color: "#9ca3af", chance: "very common", how: "huge commits or no tests — start shipping small, tested changes" },
  UNCOMMON:  { label: "Uncommon",  color: "#22c55e", chance: "common",      how: "some structure forming — add tests + tighten commit size" },
  RARE:      { label: "Rare",      color: "#38bdf8", chance: "uncommon",    how: "solid habits — keep commits small and test more paths" },
  EPIC:      { label: "Epic",      color: "#f4b400", chance: "rare",        how: "strong engineering discipline across most commits" },
  MYTHIC:    { label: "Mythic",    color: "#5eead4", chance: "very rare",   how: "small, tested, well-explained commits at scale" },
  LEGENDARY: { label: "Legendary", color: "#818cf8", chance: "ultra rare",  how: "near-flawless hygiene — focused, tested, conventional, stable" },
  SECRET:    { label: "✦ Secret",  color: "#f0abfc", chance: "1-in-a-repo", how: "the rarest: prolific AND focused AND tested AND clean AND stable" },
};

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
  rarity: Rarity;            // loot-box rarity for the "collect them all" gallery
  traits: AvatarTraits;      // deterministic visual genome
}

export interface AvatarTraits {
  hue: number; accent: number; gid: number; bodyColor: string; accentColor: string;
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

/** The RPG character sheet — each stat measured from git, 0..100.
 *  PRECISION is dominated by commit SIZE: a 3000-line commit can't be "precise"
 *  no matter how few files it touches — that's the accuracy fix. */
function computeStats(m: PersonaMetrics): PersonaStats {
  const r = (x: number) => Math.round(clamp(x, 0, 1) * 100);
  const sizeScore = clamp(1 - m.avgChurn / 280, 0, 1);                          // small commits
  // PRECISION is gated by size: a giant commit can't be "precise" even in few
  // files — focus can only ADD on top of a small-commit base, never rescue a
  // 3000-line dump. (sizeScore is the ceiling; focus nudges within it.)
  return {
    precision: r(sizeScore * (0.7 + 0.3 * m.focus)),                            // SIZE is the ceiling, focus nudges
    discipline: r(m.conventionalRate * 0.65 + m.bodyRate * 0.35),               // structured + explained
    coverage: r(m.testTouchRate),                                               // ships tests
    velocity: r(clamp(m.commits / 200, 0, 1)),                                  // volume / activity
    stability: r(1 - clamp(m.fixRate / 0.5, 0, 1)),                             // few fixups/reverts
  };
}

/** POWER 0..100 = the real "excellent-git-push" score. The ENGINEERING stats
 *  (precision = small commits, coverage = ships tests) are weighted highest; nice
 *  messages (discipline) and stability matter less; volume only nudges. A hard
 *  TEST-GATE caps the ceiling: you cannot be elite while shipping no tests — so a
 *  3874-line, 1%-test "bulldozer" lands ROUGH no matter how clean its messages. */
function powerScore(s: PersonaStats): number {
  const base = (s.precision * 1.3 + s.coverage * 1.3 + s.discipline * 0.7 + s.stability * 0.7) / 4;
  let power = base * 0.85 + s.velocity * 0.15;
  if (s.coverage < 5) power = Math.min(power, 42);          // ~never tests → ROUGH ceiling
  else if (s.coverage < 15) power = Math.min(power, 55);    // barely tests → can't pass SILVER
  else if (s.coverage < 35) power = Math.min(power, 72);    // light tests → can't reach DIAMOND
  return Math.round(clamp(power, 0, 100));
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

// Body color FAMILY per tier so a hero visibly IS its rarity (matches the gallery +
// the rarity label) — like a gacha card. [hue, saturation%]. Per-author lightness
// varies within the family so same-rarity heroes still look distinct.
// hue/sat MATCH the rarity label colors (RARITY_META) so a hero's body color is
// literally its rarity — Common=gray · Uncommon=green · Rare=blue · Epic=gold ·
// Mythic=teal · Legendary=indigo · Secret=pink — consistent with the collection list.
const TIER_HSL: Record<Tier, [number, number]> = {
  ROOKIE: [220, 8], BRONZE: [142, 55], SILVER: [199, 75], GOLD: [44, 85],
  PLATINUM: [166, 65], DIAMOND: [232, 80], LEGENDARY: [298, 75],
};

function deriveTraits(author: string, m: PersonaMetrics, archetype: Archetype, stats: PersonaStats, power: number, level: number, tier: Tier, rank: number): AvatarTraits {
  const seed = h32(author);
  const [th, ts] = TIER_HSL[tier];
  const lShift = (seed % 16) - 8;                          // per-author lightness −8..+7 within the rarity family
  const hue = th;                                          // hero color = rarity family (matches the collection list)
  const accent = th;
  const build: AvatarTraits["build"] = m.avgChurn >= 400 ? "buff" : m.avgChurn <= 90 ? "slim" : "round";
  const eyes: AvatarTraits["eyes"] = m.nightRate >= 0.45 ? "tired" : power >= 70 ? "happy" : m.fixRate >= 0.4 ? "wow" : "neutral";
  const mouth: AvatarTraits["mouth"] = power >= 70 ? "smile" : power >= 50 ? "flat" : m.fixRate >= 0.4 ? "grimace" : "open";
  return {
    hue, accent, gid: seed,                                 // gid = unique gradient id per author (no SVG id clash)
    bodyColor: `hsl(${th} ${ts}% ${50 + lShift}%)`, accentColor: `hsl(${th} ${Math.min(90, ts + 12)}% ${64 + lShift}%)`,
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
    rarity: RARITY_BY_TIER[tier],
    traits: deriveTraits(author, m, archetype, stats, power, level, tier, rank),
  };
}

/** A representative hero for a tier — for the "collect them all" gallery. Pure. */
export function sampleHeroForTier(tier: Tier, author?: string, archetype: Archetype = "The Builder"): Persona {
  const rank = Math.max(0, TIERS.indexOf(tier));
  const at = (xs: number[]) => xs[rank]!;
  const stats: PersonaStats = {
    precision: at([20, 40, 55, 68, 80, 90, 98]),
    discipline: at([28, 50, 62, 74, 84, 93, 100]),
    coverage: at([2, 25, 45, 62, 76, 90, 100]),
    velocity: at([10, 26, 42, 56, 70, 85, 100]),
    stability: at([48, 64, 76, 86, 92, 96, 100]),
  };
  const power = at([22, 38, 52, 66, 78, 88, 96]);
  const xp = xpFor(power, stats); const level = levelFromXp(xp);
  const m: PersonaMetrics = { commits: at([6, 20, 45, 90, 160, 280, 420]), avgChurn: at([900, 500, 280, 150, 80, 40, 28]), medFiles: 2, conventionalRate: stats.discipline / 100, bodyRate: stats.discipline / 130, testTouchRate: stats.coverage / 100, fixRate: at([0.5, 0.3, 0.15, 0.08, 0.04, 0.02, 0]), nightRate: 0.1, avgMsgLen: 34, focus: 0.8 };
  const band = power >= 85 ? "PRISTINE" : power >= 65 ? "TIDY" : power >= 40 ? "ROUGH" : "CHAOTIC";
  return {
    author: author || RARITY_BY_TIER[tier], metrics: m, archetype, blurb: BLURB[archetype],
    stats, power, hygiene: power, band, level, xp, nextLevelXp: 0, tier, rarity: RARITY_BY_TIER[tier],
    traits: deriveTraits(author || tier, m, archetype, stats, power, level, tier, rank),
  };
}
/** One representative hero per tier (ROOKIE→LEGENDARY) for the collection gallery. */
export function sampleCollection(): Persona[] {
  const arches: Archetype[] = ["The Builder", "The Machine Gun", "The Firefighter", "The Architect", "The Storyteller", "The Surgeon", "The Surgeon"];
  return TIERS.map((tier, i) => sampleHeroForTier(tier, undefined, arches[i]));
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

const TIER_COLOR: Record<Tier, string> = {
  ROOKIE: "#9ca3af", BRONZE: "#c2803f", SILVER: "#cbd5e1", GOLD: "#f4b400",
  PLATINUM: "#5eead4", DIAMOND: "#818cf8", LEGENDARY: "#f0abfc",
};

function faceSvg(e: AvatarTraits["eyes"], mo: AvatarTraits["mouth"], cx: number, cy: number): string {
  const lx = cx - 14, rxe = cx + 14;
  let eyes: string;
  if (e === "happy") eyes = `<path d="M${lx - 7} ${cy} q7 -7 14 0" stroke="#10261f" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M${rxe - 7} ${cy} q7 -7 14 0" stroke="#10261f" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  else if (e === "tired") eyes = `<circle cx="${lx}" cy="${cy + 2}" r="4" fill="#10261f"/><circle cx="${rxe}" cy="${cy + 2}" r="4" fill="#10261f"/><path d="M${lx - 8} ${cy - 5} h16 M${rxe - 8} ${cy - 5} h16" stroke="#10261f" stroke-width="2.5" stroke-linecap="round"/>`;
  else if (e === "wow") eyes = `<circle cx="${lx}" cy="${cy}" r="6.5" fill="#fff" stroke="#10261f" stroke-width="2.5"/><circle cx="${lx}" cy="${cy}" r="3" fill="#10261f"/><circle cx="${rxe}" cy="${cy}" r="6.5" fill="#fff" stroke="#10261f" stroke-width="2.5"/><circle cx="${rxe}" cy="${cy}" r="3" fill="#10261f"/>`;
  else eyes = `<circle cx="${lx}" cy="${cy}" r="5" fill="#10261f"/><circle cx="${rxe}" cy="${cy}" r="5" fill="#10261f"/><circle cx="${lx + 1.5}" cy="${cy - 1.5}" r="1.5" fill="#fff"/><circle cx="${rxe + 1.5}" cy="${cy - 1.5}" r="1.5" fill="#fff"/>`;
  const my = cy + 17;
  const mouth = mo === "smile" ? `<path d="M${cx - 12} ${my} q12 12 24 0" stroke="#10261f" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : mo === "grimace" ? `<path d="M${cx - 12} ${my + 1} h24 M${cx - 6} ${my - 4} v9 M${cx + 4} ${my - 4} v9" stroke="#10261f" stroke-width="2.5" fill="none"/>`
    : mo === "open" ? `<ellipse cx="${cx}" cy="${my}" rx="7" ry="5.5" fill="#10261f"/>`
    : `<path d="M${cx - 10} ${my} h20" stroke="#10261f" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  return eyes + mouth;
}

/** The weapon in the hero's right hand — one per archetype. Positioned near (172,150). */
function weaponSvg(a: AvatarTraits["accessory"], accent: string): string {
  switch (a) {
    case "scalpel": return `<g transform="translate(176 96) rotate(18)"><rect x="-2" y="0" width="5" height="64" rx="2" fill="#e2e8f0" stroke="#0b1220" stroke-width="1.5"/><rect x="-3" y="58" width="7" height="16" rx="2" fill="${accent}"/></g>`;          // surgeon — scalpel
    case "hardhat": return `<g transform="translate(176 92) rotate(12)"><rect x="-3" y="14" width="6" height="58" rx="3" fill="#7c4a1e"/><rect x="-18" y="2" width="36" height="20" rx="4" fill="#9ca3af" stroke="#0b1220" stroke-width="2"/></g>`;        // bulldozer — sledgehammer
    case "extinguisher": return `<g transform="translate(174 96) rotate(10)"><rect x="-4" y="14" width="8" height="58" rx="3" fill="#7c4a1e"/><path d="M-18 14 l18 -16 l18 16 z" fill="#dc2626" stroke="#0b1220" stroke-width="2"/></g>`;            // firefighter — fire axe
    case "book": return `<g transform="translate(170 100)"><rect x="-4" y="0" width="8" height="70" rx="3" fill="#7c4a1e"/><circle cx="0" cy="-4" r="11" fill="${accent}" stroke="#0b1220" stroke-width="2"/><circle cx="0" cy="-4" r="4" fill="#fff"/></g>`; // storyteller — sage staff
    case "coffee": return `<g transform="translate(172 98)"><rect x="-3" y="0" width="6" height="72" rx="3" fill="#475569"/><path d="M-12 -6 a12 12 0 1 0 18 10 a8 8 0 1 1 -18 -10z" fill="#cbd5e1" stroke="#0b1220" stroke-width="2"/></g>`;             // night owl — moon staff
    case "bolt": return `<g transform="translate(176 98)"><path d="M2 0 l-14 30 h10 l-6 26 l22 -34 h-12 z" fill="#fde047" stroke="#0b1220" stroke-width="1.8"/></g>`;                                                                              // machine gun — bolt blade
    case "compass": return `<g transform="translate(172 100)"><rect x="-3" y="0" width="6" height="68" rx="3" fill="#64748b"/><path d="M0 -14 l12 22 l-24 0 z" fill="none" stroke="${accent}" stroke-width="3"/></g>`;                          // architect — compass staff
    default: return `<g transform="translate(176 100) rotate(20)"><rect x="-3" y="6" width="6" height="60" rx="3" fill="#94a3b8"/><circle cx="0" cy="2" r="9" fill="none" stroke="#94a3b8" stroke-width="6"/></g>`;                              // builder — wrench
  }
}

/**
 * A humanoid GAME HERO — head · torso · two arms · two legs · plus gear that scales
 * with measured git stats: helmet & armor plating ← tier · chestplate emblem & shoulder
 * pads grow with rank · shield (left hand) size & shine ← test coverage · weapon (right
 * hand) ← archetype · cape ← PLATINUM+ · glowing aura ← DIAMOND+ · crown ← GOLD+ &
 * disciplined · rank stars ← level · body build ← commit size · battle scars ← firefighting.
 * Higher level/quality = visibly more armored & decorated. Deterministic + total.
 */
export function personaAvatarSvg(p: Persona): string {
  try {
    const t = p.traits || ({} as AvatarTraits);
    const tier = t.tier || "ROOKIE"; const rank = t.tierRank || 0;
    const tc = TIER_COLOR[tier] || "#9ca3af";
    const gid = t.gid ?? (t.hue ?? 210); const body = t.bodyColor || "#64748b"; const accent = t.accentColor || "#94a3b8";
    const cx = 120; const headY = 70; const headR = t.build === "buff" ? 44 : t.build === "slim" ? 38 : 41;
    const tw = t.build === "buff" ? 80 : t.build === "slim" ? 58 : 68;     // torso width
    const tx = cx - tw / 2; const torsoTop = 112; const torsoBot = 196;
    const out = rank >= 2 ? tc : "#0b1220"; const ow = 2.5 + Math.min(3.5, rank * 0.6);
    const L: string[] = [];
    L.push(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300" viewBox="0 0 240 300" role="img" aria-label="${esc(p.author)} — ${esc(p.archetype)}, ${esc(tier)} (${esc(p.rarity)}) level ${p.level}">`);
    L.push(`<defs><radialGradient id="g${gid}" cx="40%" cy="32%"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${body}"/></radialGradient>`);
    L.push(`<linearGradient id="pl${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tc}"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs>`);
    // aura (DIAMOND+)
    if (t.aura > 0) { L.push(`<circle cx="${cx}" cy="150" r="118" fill="${tc}" opacity="${(0.08 * t.aura).toFixed(2)}"/><circle cx="${cx}" cy="150" r="96" fill="${tc}" opacity="${(0.10 * t.aura).toFixed(2)}"/>`); }
    // cape (PLATINUM+)
    if (t.cape) L.push(`<path d="M${tx + 6} ${torsoTop + 4} q-34 70 -16 122 l${tw - 12} 0 q18 -52 -16 -122 z" fill="${tc}" opacity="0.5"/>`);
    // ground shadow
    L.push(`<ellipse cx="${cx}" cy="280" rx="64" ry="13" fill="#000" opacity="0.22"/>`);
    // legs + boots
    const legY = torsoBot - 6;
    for (const dx of [-18, 18]) {
      L.push(`<rect x="${cx + dx - 9}" y="${legY}" width="18" height="60" rx="9" fill="${body}" stroke="#0b1220" stroke-width="2"/>`);
      L.push(`<rect x="${cx + dx - 11}" y="${legY + 48}" width="22" height="20" rx="7" fill="${rank >= 2 ? tc : "#334155"}" stroke="#0b1220" stroke-width="2"/>`); // boots
    }
    // arms (behind torso a touch) — left holds shield, right holds weapon
    L.push(`<rect x="${tx - 16}" y="${torsoTop + 6}" width="18" height="56" rx="9" fill="${body}" stroke="#0b1220" stroke-width="2"/>`);
    L.push(`<rect x="${tx + tw - 2}" y="${torsoTop + 6}" width="18" height="56" rx="9" fill="${body}" stroke="#0b1220" stroke-width="2"/>`);
    // weapon (right hand)
    L.push(weaponSvg(t.accessory, accent));
    // torso (chestplate)
    L.push(`<rect x="${tx}" y="${torsoTop}" width="${tw}" height="${torsoBot - torsoTop}" rx="20" fill="url(#g${gid})" stroke="${out}" stroke-width="${ow}"/>`);
    // armor plating (SILVER+) — chest plate overlay + shoulder pads
    if (rank >= 2) {
      L.push(`<path d="M${tx + 6} ${torsoTop + 6} h${tw - 12} v26 q-${tw / 2 - 6} 18 -${tw - 12} 0 z" fill="url(#pl${gid})" opacity="0.92" stroke="${tc}" stroke-width="1.5"/>`); // chest plate
      L.push(`<ellipse cx="${tx + 4}" cy="${torsoTop + 8}" rx="13" ry="10" fill="${tc}" stroke="#0b1220" stroke-width="2"/><ellipse cx="${tx + tw - 4}" cy="${torsoTop + 8}" rx="13" ry="10" fill="${tc}" stroke="#0b1220" stroke-width="2"/>`); // shoulder pads
    }
    // chest emblem (rank>=1) — a small gem that brightens with tier
    if (rank >= 1) L.push(`<path d="M${cx} ${torsoTop + 40} l9 9 l-9 12 l-9 -12 z" fill="${tc}" stroke="#0b1220" stroke-width="1.5"/>`);
    // belt (rank>=3)
    if (rank >= 3) L.push(`<rect x="${tx + 4}" y="${torsoBot - 22}" width="${tw - 8}" height="12" rx="4" fill="${tc}" stroke="#0b1220" stroke-width="1.5"/>`);
    // battle scars ← firefighting (on the chestplate)
    for (let i = 0; i < (t.scars || 0); i++) L.push(`<path d="M${cx - 16 + i * 16} ${torsoTop + 14} l9 24" stroke="#7f1d1d" stroke-width="2.5" opacity="0.65" stroke-linecap="round"/>`);
    // shield ← coverage (left hand)
    if ((t.shield || 0) > 0.05) {
      const ss = 16 + t.shield * 20; const sx = tx - 18; const sy = torsoTop + 40;
      L.push(`<g transform="translate(${sx} ${sy})"><path d="M${-ss / 2} ${-ss} h${ss} q4 0 4 4 v${ss * 0.6} q0 ${ss * 0.7} -${ss / 2 + 2} ${ss} q-${ss / 2 + 2} -${ss * 0.3} -${ss / 2 + 2} -${ss} v-${ss * 0.6} q0 -4 4 -4 z" fill="${tc}" stroke="#0b1220" stroke-width="2" opacity="${(0.55 + t.shield * 0.45).toFixed(2)}"/>`);
      if (t.shield >= 0.5) L.push(`<path d="M${-ss * 0.26} -2 l${ss * 0.16} ${ss * 0.2} l${ss * 0.36} -${ss * 0.36}" stroke="#04141b" stroke-width="3" fill="none" stroke-linecap="round"/>`);
      L.push(`</g>`);
    }
    // head
    L.push(`<circle cx="${cx}" cy="${headY}" r="${headR}" fill="url(#g${gid})" stroke="${out}" stroke-width="${ow}"/>`);
    L.push(`<ellipse cx="${cx - headR * 0.38}" cy="${headY - headR * 0.4}" rx="${headR * 0.34}" ry="${headR * 0.22}" fill="#fff" opacity="0.30"/>`); // sheen
    L.push(faceSvg(t.eyes, t.mouth, cx, headY));
    // helmet by tier: band → visor → full helm
    if (rank >= 1 && rank <= 2) L.push(`<path d="M${cx - headR} ${headY - 6} a${headR} ${headR} 0 0 1 ${headR * 2} 0 z" fill="${tc}" opacity="0.92" stroke="#0b1220" stroke-width="2"/>`);
    else if (rank >= 3) L.push(`<path d="M${cx - headR - 2} ${headY - 2} a${headR + 2} ${headR + 2} 0 0 1 ${(headR + 2) * 2} 0 l0 6 l-${(headR + 2) * 2} 0 z" fill="${tc}" stroke="#0b1220" stroke-width="2"/><rect x="${cx - 4}" y="${headY - headR - 6}" width="8" height="12" rx="3" fill="${tc}" stroke="#0b1220" stroke-width="1.5"/>`);
    // crown (GOLD+ disciplined)
    if (t.crown) L.push(`<path d="M${cx - 24} ${headY - headR - 4} l5 -16 l7 10 l7 -14 l7 14 l7 -10 l5 16 z" fill="${tier === "LEGENDARY" ? "#f0abfc" : "#f4b400"}" stroke="#0b1220" stroke-width="1.5"/>`);
    // rank stars ← level (above the head)
    let stars = ""; const sn = t.stars || 0;
    for (let i = 0; i < sn; i++) stars += `<text x="${cx - (sn - 1) * 8 + i * 16}" y="${t.crown ? headY - headR - 24 : headY - headR - 10}" text-anchor="middle" font-size="13" fill="${tc}">★</text>`;
    L.push(stars);
    L.push(`</svg>`);
    return L.join("");
  } catch { return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="240" height="300" fill="#1b1f24"/><text x="120" y="150" fill="#fff" text-anchor="middle" font-size="14">persona?</text></svg>`; }
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
