/**
 * Iris — visual entity continuity.
 *
 * The pillar:  "abc1234" must look identical in every command — same colour,
 * same spacing, same prefix glyph — so the user's eye learns one visual
 * language across `mneme ask`, `mneme why`, `mneme forensics`, etc.
 *
 * All renderers below are deterministic: same input → byte-identical output
 * (modulo NO_COLOR for CI). No randomization, no per-command flair.
 *
 * These helpers wrap kleur + osc8.  They DO NOT replace `cli/src/ui.ts` —
 * they fix a small set of *visual decisions* (colour, glyph, format) that
 * commands previously made in eight different ways.
 */

import kleur from "kleur";

/** OSC 8 hyperlink — clickable in modern terminals; plain text on dumb ones. */
function osc8(url: string | undefined, text: string): string {
  if (!url) return text;
  if (!process.stdout.isTTY) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/** Normalise a hash to the canonical 7-char short form. */
function shortify(hash: string, shortHash?: string): string {
  if (shortHash && shortHash.length >= 4) return shortHash.slice(0, 7);
  return hash.slice(0, 7);
}

/** Deterministic ISO-date → `YYYY-MM-DD` (or empty if unparseable). */
function dateOnly(iso?: string): string {
  if (!iso) return "";
  const t = iso.indexOf("T");
  if (t > 0) return iso.slice(0, t);
  // Already short or non-ISO — use first 10 chars defensively.
  return iso.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────
// Entity renderers — each one is a single source of truth.
// Every command should route through these instead of styling ad-hoc.
// ─────────────────────────────────────────────────────────────────────

export interface RenderCommitOpts {
  /** Pack onto one line if true (no body indent). Default: false. */
  compact?: boolean;
  /** Highlight as the "primary" commit (e.g. the answer's top citation). */
  emphasized?: boolean;
  /** Click-through URL (GitHub/GitLab/Bitbucket). */
  url?: string;
}

export interface RenderableCommit {
  hash: string;
  shortHash?: string;
  subject: string;
  authorName?: string;
  authorDate?: string;
}

/**
 * Render a commit citation IDENTICALLY across every command.
 *
 *   ●  abc1234   [2024-08-12 · alice]   feat: add payment retry
 *
 * Compact form:
 *   abc1234  feat: add payment retry  [alice · 2024-08-12]
 */
export function renderCommit(c: RenderableCommit, opts: RenderCommitOpts = {}): string {
  const short = shortify(c.hash, c.shortHash);
  const dot = opts.emphasized ? kleur.green("●") : kleur.gray("●");
  const hash = osc8(opts.url, kleur.bold(short));
  const subject = kleur.white(c.subject);

  const meta: string[] = [];
  const date = dateOnly(c.authorDate);
  if (date) meta.push(date);
  if (c.authorName) meta.push(c.authorName);
  const metaStr = meta.length > 0 ? kleur.gray(`[${meta.join(" · ")}]`) : "";

  if (opts.compact) {
    const tail = metaStr ? `  ${metaStr}` : "";
    return `  ${dot} ${hash}  ${subject}${tail}`.trimEnd();
  }
  const head = `  ${dot} ${hash}  ${metaStr}`.trimEnd();
  return `${head}\n    ${subject}`;
}

export interface RenderAuthorOpts {
  /** Mark this author as "you" (the current git user). */
  isYou?: boolean;
}

/**
 * Render an author identity uniformly.
 *
 *   alice <alice@bank.com>            (default)
 *   you (Alice <alice@bank.com>)      (isYou)
 */
export function renderAuthor(name: string, email?: string, opts: RenderAuthorOpts = {}): string {
  const styledName = kleur.bold(name);
  const styledEmail = email ? kleur.gray(`<${email}>`) : "";
  const tail = email ? ` ${styledEmail}` : "";
  if (opts.isYou) {
    return `${kleur.cyan().bold("you")} ${kleur.gray("(")}${styledName}${tail}${kleur.gray(")")}`;
  }
  return `${styledName}${tail}`;
}

export interface RenderFileOpts {
  /** Optional `:start-end` line range. */
  lineRange?: string;
  /** How many times this file was touched (badge). */
  touched?: number;
}

/**
 * Render a file path uniformly.
 *
 *   src/payment/service.ts
 *   src/payment/service.ts:12-44      (with lineRange)
 *   src/payment/service.ts (×7)       (with touched)
 */
export function renderFile(path: string, opts: RenderFileOpts = {}): string {
  const styled = kleur.cyan(path);
  const range = opts.lineRange ? kleur.gray(`:${opts.lineRange}`) : "";
  const touched =
    typeof opts.touched === "number" && opts.touched > 0
      ? ` ${kleur.gray(`(×${opts.touched})`)}`
      : "";
  return `${styled}${range}${touched}`;
}

export interface RenderHashRefOpts {
  /** Click-through URL. */
  url?: string;
}

/**
 * Render a commit hash reference INLINE (e.g. inside a sentence).
 *
 *   …rolled back in `abc1234`.
 *
 * Always bold + monospace-styled.  Never adds a leading dot or trailing meta.
 */
export function renderHashRef(shortHash: string, opts: RenderHashRefOpts = {}): string {
  const sh = shortify(shortHash, shortHash);
  const inner = kleur.bold(`\`${sh}\``);
  return osc8(opts.url, inner);
}
