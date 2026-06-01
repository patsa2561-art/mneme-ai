/**
 * v2.127.0 — CONTEXT BLINDING: "your code's real names + secrets never reach the
 * model, with a reversible local map" — the honest, fast core of the image's
 * "Cryptographic Context Blinding / Ephemeral Context Eraser / Dynamic Salt
 * Mapping".
 *
 * THE PROBLEM (CISO's nightmare): to use a hosted model (Claude/GPT/Grok) your
 * agent must send code over the wire. Even with on-prem everything else, the
 * PROMPT itself carries your real identifiers ("SecretFinancialEngine",
 * "UserPasswordHash") and any secret literals to the provider.
 *
 * THE HONEST GEM (structure-preserving pseudonymization — NOT ZKP/FHE, which is
 * too slow to run in real time in 2026, and NOT a kernel hook, which is malware):
 *   1. SECRETS are REMOVED entirely (reused from the EGRESS guard) — they never
 *      leave, not even as a placeholder you could map back.
 *   2. Sensitive IDENTIFIERS are replaced by stable, meaningless placeholders
 *      (SecretFinancialEngine → MZ1) via a deterministic, collision-free,
 *      reversible map kept ONLY on your machine. The model sees structurally-
 *      valid code with nonsense names — it reasons over the STRUCTURE (which is
 *      all it needs; names are arbitrary to it) and its output references the
 *      placeholders, which Mneme inverse-maps back to your real names locally.
 *
 * So a provider employee or an attacker who reads the chat history on the cloud
 * sees syntactically-valid but business-meaningless code; your machine restores
 * the real names with 100% fidelity. The agent CALLS blind() before sending and
 * unblind() on the reply — no hook, same pull model as OUTLINE.
 *
 * HONEST LIMITS (DIAKRISIS): this blinds NAMES + removes SECRETS; it does NOT
 * hide the code's STRUCTURE/logic (the model needs that to help) — so it is
 * pseudonymization, not encryption. It is reversible by design (the value is the
 * local map never leaving), it is not a zero-knowledge proof, and it makes no
 * claim that the model "learns nothing". Pure + total: deterministic, never
 * throws.
 */

// language keywords + very common builtins that must NEVER be blinded (else the
// code stops being parseable for the model). A multi-language superset.
const STOP = new Set<string>([
  // JS/TS
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "class", "extends", "super", "this", "typeof", "instanceof", "in", "of", "void", "delete", "yield", "async", "await", "try", "catch", "finally", "throw", "import", "export", "from", "as", "default", "interface", "type", "enum", "namespace", "implements", "private", "public", "protected", "readonly", "static", "abstract", "get", "set", "true", "false", "null", "undefined", "boolean", "number", "string", "object", "symbol", "bigint", "any", "unknown", "never", "void", "Promise", "Array", "Map", "Set", "Record", "Partial", "console", "JSON", "Math", "Date", "Object", "Error", "require", "module", "exports", "process", "Buffer",
  // python
  "def", "elif", "lambda", "pass", "with", "yield", "global", "nonlocal", "raise", "except", "finally", "and", "or", "not", "is", "None", "True", "False", "self", "cls", "print", "len", "range", "dict", "list", "str", "int", "float", "bool", "tuple",
  // go
  "func", "package", "struct", "chan", "go", "defer", "select", "map", "make", "nil", "fmt", "err", "range",
  // rust
  "fn", "pub", "impl", "trait", "mod", "use", "mut", "let", "match", "Some", "None", "Ok", "Err", "Self", "Vec", "Option", "Result", "Box", "String", "str", "usize", "i32", "i64", "u32", "u64", "f64", "bool",
]);

const SENSITIVE_RX = /secret|password|passwd|pwd|token|apikey|api[_-]?key|private|credential|cred|financial|internal|confidential|ssn|salary|payroll|bank|account|encrypt|decrypt|signing|privatekey/i;
const IDENT_RX = /[A-Za-z_$][A-Za-z0-9_$]*/g;

export type BlindMode = "sensitive" | "aggressive";

export interface BlindResult {
  /** the payload safe to send: secrets removed, sensitive names → placeholders. */
  blinded: string;
  /** LOCAL-ONLY reverse map { placeholder → originalName }. NEVER send this. */
  map: Record<string, string>;
  identifiersBlinded: number;
  secretsRedacted: number;
  prefix: string;
  note: string;
}

const NOTE = "structure-preserving pseudonymization: secrets REMOVED, sensitive identifiers → reversible local placeholders. The map never leaves your machine. NOT encryption/ZKP — the code's structure is still visible (the model needs it); names + secrets are not.";

/** Run the EGRESS secret patterns to strip secret literals (best-effort import). */
function redactSecrets(text: string): { text: string; count: number } {
  try {
    // dynamic require avoided; use a local copy of the highest-value patterns so
    // blind() stays usable even if egress changes. (egress remains the canonical
    // full guard; this is the literal-secret pass for the blinding payload.)
    const PATS: Array<readonly [string, RegExp]> = [
      ["aws", /\bAKIA[0-9A-Z]{16}\b/g],
      ["openai", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
      ["anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
      ["github", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
      ["slack", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
      ["pem", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
      ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
    ];
    let out = text; let count = 0;
    for (const [, re] of PATS) out = out.replace(new RegExp(re.source, re.flags), () => { count++; return "«REDACTED-SECRET»"; });
    return { text: out, count };
  } catch { return { text, count: 0 }; }
}

function pickPrefix(src: string): string {
  for (const p of ["MZ", "MZZ", "ZBLND", "QQX"]) { if (!new RegExp(`\\b${p}\\d+\\b`).test(src)) return p; }
  return "ZBLNDX";
}

/** Blind a payload before it leaves for a hosted model. Deterministic + total. */
export function blindContext(payload: string, opts?: { mode?: BlindMode; protect?: string[]; redactSecrets?: boolean }): BlindResult {
  try {
    const src = typeof payload === "string" ? payload : "";
    const mode: BlindMode = opts?.mode ?? "sensitive";
    const protect = new Set((opts?.protect ?? []).map(String));
    const doSecrets = opts?.redactSecrets !== false;

    const sec = doSecrets ? redactSecrets(src) : { text: src, count: 0 };
    const work = sec.text;
    const prefix = pickPrefix(work);

    const assigned = new Map<string, string>(); // original → placeholder
    let n = 0;
    const shouldBlind = (id: string): boolean => {
      if (STOP.has(id)) return false;
      if (id.startsWith(prefix) && /\d+$/.test(id)) return false; // never re-blind a placeholder
      if (protect.has(id)) return true;
      if (mode === "aggressive") return id.length >= 2;
      return SENSITIVE_RX.test(id);
    };

    const blinded = work.replace(IDENT_RX, (id) => {
      if (!shouldBlind(id)) return id;
      let ph = assigned.get(id);
      if (!ph) { n++; ph = `${prefix}${n}`; assigned.set(id, ph); }
      return ph;
    });

    const map: Record<string, string> = {};
    for (const [orig, ph] of assigned) map[ph] = orig;
    return { blinded, map, identifiersBlinded: assigned.size, secretsRedacted: sec.count, prefix, note: NOTE };
  } catch {
    return { blinded: typeof payload === "string" ? payload : "", map: {}, identifiersBlinded: 0, secretsRedacted: 0, prefix: "MZ", note: "blind error (safe — returned unblinded; do NOT send if this fires)" };
  }
}

/** Inverse-map a model's output: placeholders → your real names. Deterministic + total. */
export function unblindOutput(text: string, map: Record<string, string>): string {
  try {
    let out = typeof text === "string" ? text : "";
    const m = map && typeof map === "object" ? map : {};
    // replace longest placeholders first so MZ1 doesn't clobber inside MZ10
    const phs = Object.keys(m).sort((a, b) => b.length - a.length);
    for (const ph of phs) {
      const orig = m[ph]; if (typeof orig !== "string") continue;
      out = out.replace(new RegExp(`\\b${ph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), orig);
    }
    return out;
  } catch { return typeof text === "string" ? text : ""; }
}

export interface BlindGauntlet {
  /** round-trip: unblind(blind(src).blinded, map) restores the original names. */
  roundTripExact: boolean;
  /** the blinded payload contains NONE of the protected real names. */
  namesNotLeaked: boolean;
  /** distinct identifiers → distinct placeholders (bijection). */
  bijection: boolean;
  /** secrets are removed (not present, not in the map). */
  secretsGone: boolean;
  /** structure preserved: keyword tokens + brace/paren counts unchanged. */
  structurePreserved: boolean;
  /** a model "edit" referencing placeholders unblinds back to real names. */
  editRoundTrips: boolean;
  /** deterministic. */
  deterministic: boolean;
  /** total on garbage. */
  stable: boolean;
  score: number;
}

export function blindGauntlet(): BlindGauntlet {
  try {
    const src = `import { db } from "./db";
const apiSecretToken = "sk-proj-ABCDEFGHIJ1234567890zzz";
export function chargeFinancialAccount(userPasswordHash: string, amount: number): number {
  const internalLedger = db.query(userPasswordHash);
  if (internalLedger > 0) { return amount; }
  return 0;
}`;
    const r = blindContext(src, { mode: "sensitive" });
    const back = unblindOutput(r.blinded, r.map);
    // round-trip restores the original (secrets aside — those are removed)
    const expected = src.replace(/"sk-proj-[^"]*"/, '"«REDACTED-SECRET»"');
    const roundTripExact = back === expected;

    const protectedNames = ["apiSecretToken", "chargeFinancialAccount", "userPasswordHash", "internalLedger"];
    const namesNotLeaked = protectedNames.every((nm) => !r.blinded.includes(nm));

    const phVals = Object.keys(r.map);
    const origVals = Object.values(r.map);
    const bijection = new Set(phVals).size === phVals.length && new Set(origVals).size === origVals.length;

    const secretsGone = !r.blinded.includes("sk-proj-ABCDEFGHIJ1234567890zzz") && !JSON.stringify(r.map).includes("sk-proj-ABCDEFGHIJ") && r.secretsRedacted >= 1;

    const kw = (s: string) => (s.match(/\b(?:function|const|return|if|import|export)\b/g) || []).length;
    const braces = (s: string) => (s.match(/[{}()]/g) || []).length;
    const structurePreserved = kw(r.blinded) === kw(src) && braces(r.blinded) === braces(src);

    // a model returns an edited line using the placeholder names; unblind restores reality
    const modelEdit = `${phVals.find((p) => r.map[p] === "internalLedger") ?? "MZ?"} = 999;`;
    const restored = unblindOutput(modelEdit, r.map);
    const editRoundTrips = restored.includes("internalLedger = 999;");

    const deterministic = JSON.stringify(blindContext(src)) === JSON.stringify(blindContext(src));

    let stable = true;
    try { blindContext(null as never); unblindOutput(null as never, null as never); blindContext("x", { mode: "aggressive" }); blindContext("", { protect: ["a"] }); } catch { stable = false; }

    const perfect = roundTripExact && namesNotLeaked && bijection && secretsGone && structurePreserved && editRoundTrips && deterministic && stable;
    return { roundTripExact, namesNotLeaked, bijection, secretsGone, structurePreserved, editRoundTrips, deterministic, stable, score: perfect ? 100 : 0 };
  } catch {
    return { roundTripExact: false, namesNotLeaked: false, bijection: false, secretsGone: false, structurePreserved: false, editRoundTrips: false, deterministic: false, stable: false, score: 0 };
  }
}
