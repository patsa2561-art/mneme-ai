/**
 * v2.76.0 — Windows-tolerant `--json` argument parser.
 *
 * THE BUG. `mneme <family> <action> --json '{"a":1}'` works in bash, but on
 * Windows the user shells through cmd.exe, which:
 *   • does NOT treat single quotes as quoting → the arg arrives as the literal
 *     string `'{"a":1}'` (surrounding single quotes included) → JSON.parse fails;
 *   • can strip the inner double quotes from `--json "{\"a\":1}"` → `{a:1}`.
 * Either way, programmatic integration on Windows was painful (the only reliable
 * path was `node <binpath> ... ` with shell:false). This helper makes the raw
 * `--json` value robust by trying, in order:
 *   0. JSON.parse as-is
 *   1. strip ONE layer of surrounding matching quotes cmd left literal (' " `)
 *   2. JSON5-lite repair: single-quoted strings → double-quoted; bare
 *      identifier keys → quoted (handles cmd that dropped the inner quotes)
 *
 * Pure + dependency-free. Never throws — returns a structured result so the
 * caller can print a helpful hint (use a file / stdin) on total failure.
 */

export interface JsonArgOk { ok: true; value: unknown; repaired: boolean; }
export interface JsonArgErr { ok: false; error: string; }
export type JsonArgResult = JsonArgOk | JsonArgErr;

function tryParse(s: string): unknown | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}

/** JSON5-lite: convert single-quoted strings to double-quoted + quote bare keys.
 *  Best-effort string surgery for cmd-mangled JSON; only used as a last resort
 *  after strict parses fail, so it can never corrupt already-valid JSON. */
function repair(s: string): string {
  return s
    // 'value' / 'key'  →  "value" / "key"   (single-quoted tokens with no escapes)
    .replace(/'([^'\\]*)'/g, '"$1"')
    // {key:  ,key:  →  {"key":  ,"key":   (bare identifier keys)
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
}

export function parseJsonArg(raw: unknown): JsonArgResult {
  if (typeof raw !== "string") return { ok: false, error: "value is not a string" };
  let s = raw.trim();
  if (s.length === 0) return { ok: false, error: "empty --json value" };

  // 0. strict, as-is.
  let v = tryParse(s);
  if (v !== undefined) return { ok: true, value: v, repaired: false };

  // 1. strip ONE layer of surrounding matching quotes (the cmd.exe single-quote case).
  const q = s[0];
  if ((q === "'" || q === '"' || q === "`") && s[s.length - 1] === q && s.length >= 2) {
    const inner = s.slice(1, -1);
    v = tryParse(inner);
    if (v !== undefined) return { ok: true, value: v, repaired: true };
    s = inner; // keep the unwrapped form for the repair pass
  }

  // 2. JSON5-lite repair (single-quoted / unquoted-key JSON).
  v = tryParse(repair(s));
  if (v !== undefined) return { ok: true, value: v, repaired: true };

  return {
    ok: false,
    error: "could not parse --json (even after Windows-shell quote repair). On cmd.exe, prefer the explicit --<field> flags, or pass the payload via a file/stdin.",
  };
}
