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

export interface Persona {
  author: string;
  metrics: PersonaMetrics;
  archetype: Archetype;
  blurb: string;
  hygiene: number;           // 0..100 — COMMIT HYGIENE (not skill)
  band: "PRISTINE" | "TIDY" | "ROUGH" | "CHAOTIC";
  traits: AvatarTraits;      // deterministic visual genome
}

export interface AvatarTraits {
  hue: number; accent: number; bodyColor: string; accentColor: string;
  build: "slim" | "round" | "buff"; // from commit size
  eyes: "happy" | "neutral" | "tired" | "wow";
  mouth: "smile" | "flat" | "grimace" | "open";
  accessory: "scalpel" | "book" | "hardhat" | "extinguisher" | "coffee" | "bolt" | "compass" | "wrench";
  glow: boolean;             // PRISTINE gets a glow
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

/** COMMIT HYGIENE 0..100 — measured, weighted, honest. Good messages + bodies +
 *  tests + focused, reasonably-sized commits raise it; lots of fixups + huge
 *  sprawling commits lower it. NOT a measure of skill or value. */
function hygieneScore(m: PersonaMetrics): number {
  let s = 0;
  s += m.conventionalRate * 24;                          // clear, structured messages
  s += m.bodyRate * 14;                                  // explains the why
  s += m.testTouchRate * 22;                             // ships tests with code
  s += m.focus * 16;                                     // focused commits
  s += clamp(1 - m.avgChurn / 800, 0, 1) * 14;           // not giant dumps
  s += clamp(1 - m.fixRate / 0.5, 0, 1) * 10;            // few "oops" follow-ups
  return Math.round(clamp(s, 0, 100));
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

function deriveTraits(author: string, m: PersonaMetrics, archetype: Archetype, hygiene: number): AvatarTraits {
  const seed = h32(author);
  const hue = seed % 360;                                  // stable, distinct per author
  const accent = (hue + 40 + (seed >> 8) % 80) % 360;
  const build: AvatarTraits["build"] = m.avgChurn >= 400 ? "buff" : m.avgChurn <= 90 ? "slim" : "round";
  const eyes: AvatarTraits["eyes"] = m.nightRate >= 0.45 ? "tired" : hygiene >= 75 ? "happy" : m.fixRate >= 0.4 ? "wow" : "neutral";
  const mouth: AvatarTraits["mouth"] = hygiene >= 75 ? "smile" : hygiene >= 50 ? "flat" : m.fixRate >= 0.4 ? "grimace" : "open";
  return {
    hue, accent, bodyColor: `hsl(${hue} 68% 58%)`, accentColor: `hsl(${accent} 70% 62%)`,
    build, eyes, mouth, accessory: ARCH_ACCESSORY[archetype], glow: hygiene >= 85,
  };
}

/** Build one persona from one author's commits. Pure + total. */
export function buildPersona(author: string, commits: CommitRec[]): Persona {
  const m = computeMetrics(commits || []);
  const archetype = pickArchetype(m);
  const hygiene = hygieneScore(m);
  const band = hygiene >= 85 ? "PRISTINE" : hygiene >= 65 ? "TIDY" : hygiene >= 40 ? "ROUGH" : "CHAOTIC";
  return { author, metrics: m, archetype, blurb: BLURB[archetype], hygiene, band, traits: deriveTraits(author, m, archetype, hygiene) };
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

/** A distinct cartoon avatar SVG for a persona. Deterministic + total. */
export function personaAvatarSvg(p: Persona): string {
  try {
    const t = p.traits;
    const rx = t.build === "buff" ? 70 : t.build === "slim" ? 48 : 60;
    const bandColor = p.band === "PRISTINE" ? "#22c55e" : p.band === "TIDY" ? "#84cc16" : p.band === "ROUGH" ? "#eab308" : "#ef4444";
    const glow = t.glow ? `<circle cx="110" cy="110" r="${rx + 14}" fill="${t.accentColor}" opacity="0.18"/>` : "";
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220" role="img" aria-label="${esc(p.archetype)} avatar">`,
      `<defs><radialGradient id="g${t.hue}" cx="38%" cy="32%"><stop offset="0" stop-color="${t.accentColor}"/><stop offset="1" stop-color="${t.bodyColor}"/></radialGradient></defs>`,
      glow,
      `<ellipse cx="110" cy="190" rx="${rx}" ry="16" fill="#000" opacity="0.18"/>`,           // ground shadow → depth
      `<circle cx="110" cy="108" r="${rx}" fill="url(#g${t.hue})" stroke="#10261f" stroke-width="3"/>`,
      `<ellipse cx="${110 - rx * 0.4}" cy="${108 - rx * 0.4}" rx="${rx * 0.32}" ry="${rx * 0.22}" fill="#fff" opacity="0.28"/>`, // highlight → 3D sheen
      eyesSvg(t.eyes), mouthSvg(t.mouth), accessorySvg(t.accessory, t.accentColor),
      `<rect x="64" y="${162}" width="92" height="22" rx="11" fill="${bandColor}"/>`,
      `<text x="110" y="${177}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="12" font-weight="800" fill="#04141b">${esc(p.band)} ${p.hygiene}</text>`,
      `</svg>`,
    ].join("");
  } catch { return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="#1b1f24"/><text x="110" y="110" fill="#fff" text-anchor="middle" font-size="14">persona?</text></svg>`; }
}

// ── deterministic proof ──────────────────────────────────────────────────────
function synthCommits(kind: "surgeon" | "bulldozer" | "firefighter" | "storyteller", author: string): CommitRec[] {
  const out: CommitRec[] = []; const base = 1_700_000_000;
  for (let i = 0; i < 20; i++) {
    if (kind === "surgeon") out.push({ author, ts: base + i * 9000 + 43200, subject: `fix(core): tighten validation`, body: "why: edge case", files: ["src/x.ts", "src/x.test.ts"], insertions: 12, deletions: 4 });
    else if (kind === "bulldozer") out.push({ author, ts: base + i * 9000 + 43200, subject: "big update", files: Array.from({ length: 18 }, (_, k) => `src/f${k}.ts`), insertions: 700, deletions: 300 });
    else if (kind === "firefighter") out.push({ author, ts: base + i * 9000 + 43200, subject: i % 2 ? "fix bug oops" : "revert broken thing", files: ["src/y.ts"], insertions: 20, deletions: 18 });
    else out.push({ author, ts: base + i * 9000 + 43200, subject: "feat(api): add the paginated search endpoint", body: "Adds cursor pagination because offset was slow on big tables.", files: ["src/api.ts", "src/api.test.ts"], insertions: 60, deletions: 10 });
  }
  return out;
}

export interface PersonaGauntlet {
  archetypesDiscriminate: boolean;   // surgeon/bulldozer/firefighter/storyteller resolve correctly
  hygieneMonotonic: boolean;         // surgeon hygiene > bulldozer hygiene
  distinctAvatars: boolean;          // different authors ⇒ different avatars (distinct hue)
  avatarSelfContained: boolean;      // valid SVG, no external fetch
  bandReflectsScore: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function personaGauntlet(): PersonaGauntlet {
  const surgeon = buildPersona("alice", synthCommits("surgeon", "alice"));
  const bull = buildPersona("bob", synthCommits("bulldozer", "bob"));
  const fire = buildPersona("carol", synthCommits("firefighter", "carol"));
  const story = buildPersona("dave", synthCommits("storyteller", "dave"));
  const archetypesDiscriminate = surgeon.archetype === "The Surgeon" && bull.archetype === "The Bulldozer" && fire.archetype === "The Firefighter" && story.archetype === "The Storyteller";
  const hygieneMonotonic = surgeon.hygiene > bull.hygiene && story.hygiene > fire.hygiene;
  const a1 = personaAvatarSvg(surgeon), a2 = personaAvatarSvg(bull);
  const distinctAvatars = surgeon.traits.hue !== bull.traits.hue && a1 !== a2;
  const avatarSelfContained = a1.startsWith("<svg") && !/<script|xlink:href|\b(?:href|src)\s*=|<image/i.test(a1);
  const bandReflectsScore = (surgeon.hygiene >= 85) === (surgeon.band === "PRISTINE") && (bull.band !== "PRISTINE");
  const deterministic = JSON.stringify(buildPersona("alice", synthCommits("surgeon", "alice"))) === JSON.stringify(surgeon) && personaAvatarSvg(surgeon) === a1;
  let total = true;
  try { analyzeCommitPersonas(null as unknown as CommitRec[]); buildPersona("", []); personaAvatarSvg({ traits: {} } as Persona); analyzeCommitPersonas([{ author: "z", ts: 0, subject: "", files: [], insertions: 0, deletions: 0 }]); } catch { total = false; }
  const all = archetypesDiscriminate && hygieneMonotonic && distinctAvatars && avatarSelfContained && bandReflectsScore && deterministic && total;
  return { archetypesDiscriminate, hygieneMonotonic, distinctAvatars, avatarSelfContained, bandReflectsScore, deterministic, total, score: all ? 100 : 0 };
}
