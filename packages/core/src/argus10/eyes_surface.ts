/**
 * v2.40.0 — ARGUS-10 SURFACE LAYER (EYE_1..EYE_5).
 *
 * Lexical / phonetic / shape signals. All pure functions, no I/O,
 * always healthy (OPEN) — they can't be closed by environment.
 */

import type { Candidate, Eye, EyeSignal } from "./types.js";

// ─── EYE_1 — bigram Dice coefficient ───────────────────────────────────
//
// Dice = 2 |A ∩ B| / (|A| + |B|). Operates on character bigrams. Robust
// to small typos + word-order shuffles; symmetric. We use [\p{L}\p{N}]
// to allow Thai/CJK/Latin uniformly.

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const clean = s.toLowerCase().normalize("NFC");
  const t = clean.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (t.length < 2) {
    if (t.length === 1) out.add(t);
    return out;
  }
  for (let i = 0; i < t.length - 1; i++) {
    const bg = t.slice(i, i + 2);
    if (!bg.includes(" ") || bg.trim().length > 0) out.add(bg);
  }
  return out;
}

export const EYE_1_bigram_dice: Eye = {
  id: "EYE_1_bigram_dice",
  layer: "surface",
  weight: 0.18,
  probe: () => "OPEN",
  signal(q: string, c: Candidate): EyeSignal {
    const a = bigrams(q);
    const b = bigrams(c.text);
    if (a.size === 0 || b.size === 0) return { raw: 0, reason: "empty bigram set" };
    let inter = 0;
    for (const bg of a) if (b.has(bg)) inter++;
    const raw = (2 * inter) / (a.size + b.size);
    return { raw, reason: `dice=2·${inter}/(${a.size}+${b.size})` };
  },
};

// ─── EYE_2 — Damerau-Levenshtein with Thai-aware confuse / phonetic /
// keyboard substitution discounts ──────────────────────────────────────
//
// Standard Damerau-Lev: insert / delete / substitute / transpose = 1 each.
// We modify substitution cost based on three knobs:
//   visualConfuse: pairs like ร↔ล / น↔ม / Latin o↔Cyrillic о        (0.3)
//   phoneticClass: pairs in the same Thai initial-consonant class     (0.4)
//   keyboardAdj:   physically-adjacent keys on Kedmanee+QWERTY        (0.5)

const VISUAL_CONFUSE_PAIRS = new Set<string>([
  // Thai look-alikes
  "รล", "ลร", "นม", "มน", "บผ", "ผบ", "ปบ", "บป", "ฉจ", "จฉ",
  // Cyrillic/Latin lookalikes (D5 ARGUS demonstrates this)
  "ое", "ео", "eо", "оe", // Cyrillic 'о' (U+043E)
  "aа", "аa",             // Cyrillic 'а' (U+0430)
  "cс", "сc",             // Cyrillic 'с' (U+0441)
]);
const PHONETIC_CLASS_PAIRS = new Set<string>([
  // Thai initial consonant groups (กลุ่มอักษรกลาง/สูง/ต่ำ partial)
  "กข", "ขก", "กค", "คก", "กฆ", "ฆก", "ขฆ", "ฆข", "คฆ", "ฆค",
  "จฉ", "ฉจ", "จช", "ชจ", "ฉช", "ชฉ",
  "ตด", "ดต", "ตถ", "ถต", "ตท", "ทต", "ตธ", "ธต",
  "พภ", "ภพ", "ฟภ", "ภฟ",
  "สศ", "ศส", "สษ", "ษส",
]);
const KEYBOARD_ADJ_PAIRS = new Set<string>([
  // QWERTY rows (subset)
  "qw","wq","we","ew","er","re","rt","tr","ty","yt","yu","uy","ui","iu","io","oi","op","po",
  "as","sa","sd","ds","df","fd","fg","gf","gh","hg","hj","jh","jk","kj","kl","lk",
  "zx","xz","xc","cx","cv","vc","vb","bv","bn","nb","nm","mn",
]);

function substCost(a: string, b: string): number {
  if (a === b) return 0;
  const pair = a + b;
  if (VISUAL_CONFUSE_PAIRS.has(pair)) return 0.3;
  if (PHONETIC_CLASS_PAIRS.has(pair)) return 0.4;
  if (KEYBOARD_ADJ_PAIRS.has(pair.toLowerCase())) return 0.5;
  return 1.0;
}

function damerauLevThai(a: string, b: string): number {
  a = a.normalize("NFC"); b = b.normalize("NFC");
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // 2-row optimization is tricky for damerau (transposition needs 3 rows);
  // for the lengths we care about (queries ≤ 200 chars), full matrix is fine.
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = substCost(a[i - 1]!, b[j - 1]!);
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

export const EYE_2_damerau_lev_thai: Eye = {
  id: "EYE_2_damerau_lev_thai",
  layer: "surface",
  weight: 0.18,
  probe: () => "OPEN",
  signal(q: string, c: Candidate): EyeSignal {
    if (q.length === 0 || c.text.length === 0) return { raw: 0, reason: "empty" };
    const dist = damerauLevThai(q.toLowerCase(), c.text.toLowerCase());
    const maxLen = Math.max(q.length, c.text.length);
    const raw = Math.max(0, 1 - dist / maxLen);
    return { raw, reason: `dist=${dist.toFixed(1)}/${maxLen}` };
  },
};

// ─── EYE_3 — Thai metaphone ────────────────────────────────────────────
//
// Phonetic key approximation. Map Thai consonants by their Thai metaphone
// class; map Latin via Soundex-style. Equal keys = high score, partial =
// linear by shared prefix length.

const THAI_METAPHONE_CLASS: Record<string, string> = {
  // High-class (1)
  "ข": "K", "ฉ": "C", "ฐ": "T", "ถ": "T", "ผ": "P", "ฝ": "F", "ศ": "S", "ษ": "S", "ส": "S", "ห": "H",
  // Mid-class (2)
  "ก": "K", "จ": "C", "ฎ": "D", "ฏ": "T", "ด": "D", "ต": "T", "บ": "B", "ป": "P", "อ": "A",
  // Low-class (3)
  "ค": "K", "ฆ": "K", "ง": "G", "ช": "C", "ซ": "S", "ญ": "Y", "ฌ": "C", "ฑ": "D", "ฒ": "T", "ณ": "N",
  "ท": "T", "ธ": "T", "น": "N", "พ": "P", "ฟ": "F", "ภ": "P", "ม": "M", "ย": "Y", "ร": "R", "ล": "L",
  "ฬ": "L", "ว": "W", "ฮ": "H",
};

function thaiMetaphone(s: string): string {
  // Strip vowels + tone marks (Thai range 0x0E30..0x0E4F). Collapse
  // consecutive duplicates. Map consonants via the class table; Latin
  // letters pass through their Soundex digit.
  const out: string[] = [];
  for (const ch of s.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0E30 && cp <= 0x0E4F) continue; // Thai vowels + tone marks
    const tk = THAI_METAPHONE_CLASS[ch];
    if (tk) { out.push(tk); continue; }
    if (/[A-Za-z]/.test(ch)) {
      const lower = ch.toLowerCase();
      const map: Record<string, string> = {
        "b": "B", "f": "F", "p": "P", "v": "V",
        "c": "K", "g": "K", "j": "C", "k": "K", "q": "K", "s": "S", "x": "K", "z": "S",
        "d": "D", "t": "T",
        "l": "L", "m": "M", "n": "N", "r": "R",
        "h": "H", "w": "W", "y": "Y",
      };
      const m = map[lower];
      if (m) out.push(m);
      continue;
    }
  }
  // Collapse consecutive dupes
  return out.filter((v, i) => i === 0 || out[i - 1] !== v).join("");
}

export const EYE_3_thai_metaphone: Eye = {
  id: "EYE_3_thai_metaphone",
  layer: "surface",
  weight: 0.08,
  probe: () => "OPEN",
  signal(q: string, c: Candidate): EyeSignal {
    const kq = thaiMetaphone(q);
    const kc = thaiMetaphone(c.text);
    if (kq.length === 0 || kc.length === 0) return { raw: 0, reason: "empty key" };
    if (kq === kc) return { raw: 1.0, reason: `match key=${kq}` };
    // Shared longest prefix
    let i = 0;
    while (i < Math.min(kq.length, kc.length) && kq[i] === kc[i]) i++;
    const raw = i / Math.max(kq.length, kc.length);
    return { raw, reason: `prefix=${i}/${Math.max(kq.length, kc.length)}` };
  },
};

// ─── EYE_4 — length ratio (cheap shape check) ──────────────────────────

export const EYE_4_length_ratio: Eye = {
  id: "EYE_4_length_ratio",
  layer: "surface",
  weight: 0.04,
  probe: () => "OPEN",
  signal(q: string, c: Candidate): EyeSignal {
    const a = q.length, b = c.text.length;
    if (a === 0 && b === 0) return { raw: 0, reason: "both empty" };
    if (a === 0 || b === 0) return { raw: 0, reason: "one empty" };
    const raw = Math.min(a, b) / Math.max(a, b);
    return { raw, reason: `min/max=${Math.min(a, b)}/${Math.max(a, b)}` };
  },
};

// ─── EYE_5 — sliding window n-gram ─────────────────────────────────────
//
// Slide a window of width w ∈ [3..6] over the query; check what fraction
// of windows appear anywhere in the candidate. Captures partial-match
// signal lost to Dice (which collapses all bigrams into a set).

export const EYE_5_sliding_window: Eye = {
  id: "EYE_5_sliding_window",
  layer: "surface",
  weight: 0.08,
  probe: () => "OPEN",
  signal(q: string, c: Candidate): EyeSignal {
    const qn = q.toLowerCase().normalize("NFC");
    const cn = c.text.toLowerCase().normalize("NFC");
    if (qn.length < 3 || cn.length < 3) return { raw: 0, reason: "too short" };
    let hits = 0;
    let attempts = 0;
    for (let w = 3; w <= Math.min(6, qn.length); w++) {
      for (let i = 0; i + w <= qn.length; i++) {
        attempts++;
        const win = qn.slice(i, i + w);
        if (cn.includes(win)) hits++;
      }
    }
    if (attempts === 0) return { raw: 0, reason: "no windows" };
    const raw = hits / attempts;
    return { raw, reason: `${hits}/${attempts} windows` };
  },
};

export const SURFACE_EYES: Eye[] = [
  EYE_1_bigram_dice,
  EYE_2_damerau_lev_thai,
  EYE_3_thai_metaphone,
  EYE_4_length_ratio,
  EYE_5_sliding_window,
];

// Re-export the internal helpers for tests
export { bigrams, damerauLevThai, thaiMetaphone };
