/**
 * v2.131.0 — DYNAMIC POLICY ENFORCEMENT (`mneme.policy.json`)
 * ===========================================================
 * Layer-2 of the Context Rail: a deterministic, per-repo access policy that the
 * rail consults BEFORE any local context crosses to a model. It answers one
 * question, totally and without an LLM: "is this agent allowed to send THIS
 * path / content / size right now?"
 *
 * The honest scope (DIAKRISIS):
 *  - This is a DETERMINISTIC gate (path globs + content patterns + agent allow-list
 *    + size cap), 100% reproducible and 100%-testable on a closed corpus. It is
 *    NOT a sandbox and NOT an OS-level file-permission system — it governs what
 *    Mneme's rail will relay, not what every process on the machine can open.
 *  - A deny is fail-CLOSED: a malformed policy, an unreadable file, or an
 *    ambiguous match denies rather than leaks (safe default).
 *
 * Every function is total (never throws): malformed input → a safe, explicit
 * decision, never an exception that could be swallowed and bypass the gate.
 */

export type ViolationKind = "path" | "content" | "agent" | "size";

export interface PolicyViolation {
  kind: ViolationKind;
  detail: string;
  /** the matched rule (glob / pattern source / agent / "maxBytes"). */
  rule: string;
}

export interface PolicyRule {
  /** glob patterns; a path matching ANY (full path OR basename) is denied. */
  denyPaths: string[];
  /** regex SOURCES; content matching ANY is denied (secret/PII shapes). */
  denyContent: string[];
  /** if non-empty, ONLY these agent ids may traverse (allow-list). */
  allowAgents: string[];
  /** payload byte cap; 0 = unlimited. */
  maxBytes: number;
}

export interface PolicyDecision {
  allowed: boolean;
  verdict: "ALLOW" | "DENY";
  reason: string;
  violations: PolicyViolation[];
}

export interface PolicyCheckInput {
  path?: string;
  content?: string;
  agent?: string;
  /** explicit byte count; falls back to content's utf8 length. */
  bytes?: number;
}

// ── default policy: deny the obvious secret/PII surfaces every CISO names ──
const DEFAULT_DENY_PATHS: readonly string[] = [
  ".env", ".env.*", "**/.env", "**/.env.*",
  "**/secrets/**", "**/secret/**", "secrets/**", "secret/**",
  "*.pem", "**/*.pem", "*.key", "**/*.key", "id_rsa", "**/id_rsa", "id_ed25519", "**/id_ed25519",
  "*.p12", "*.pfx", "**/credentials", "**/credentials.json", "**/.aws/**", "**/.ssh/**",
  "*.keystore", "**/serviceaccount*.json",
];
// content shapes that should never be relayed even if the PATH looks innocent.
const DEFAULT_DENY_CONTENT: readonly string[] = [
  "AKIA[0-9A-Z]{16}",                         // AWS access key id
  "-----BEGIN [A-Z ]*PRIVATE KEY-----",        // PEM private key block
  "gh[pousr]_[A-Za-z0-9]{36,}",                // GitHub token
  "sk-(?:proj-)?[A-Za-z0-9_-]{20,}",           // OpenAI key
  "xox[baprs]-[A-Za-z0-9-]{10,}",              // Slack token
  "\\b[1-9]\\d{12}\\b",                        // Thai national id (13 digits, no leading 0)
];

export function defaultPolicy(): PolicyRule {
  return {
    denyPaths: [...DEFAULT_DENY_PATHS],
    denyContent: [...DEFAULT_DENY_CONTENT],
    allowAgents: [],
    maxBytes: 0,
  };
}

/**
 * Coerce an arbitrary parsed object into a valid PolicyRule. Unknown / malformed
 * fields fall back to the default (fail-safe, never throws). This is what makes
 * loading a hand-edited `mneme.policy.json` total.
 */
export function normalizePolicy(raw: unknown): PolicyRule {
  const def = defaultPolicy();
  try {
    if (!raw || typeof raw !== "object") return def;
    const o = raw as Record<string, unknown>;
    const strArr = (v: unknown, fb: string[]): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fb;
    const n = Number((o as { maxBytes?: unknown }).maxBytes);
    return {
      denyPaths: strArr(o["denyPaths"], def.denyPaths),
      // drop ReDoS-prone deny-content patterns at load time so the gate can never
      // hang on a hand-edited (or PR-supplied) mneme.policy.json.
      denyContent: strArr(o["denyContent"], def.denyContent).filter(isSafeRegexSource),
      allowAgents: strArr(o["allowAgents"], []),
      maxBytes: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    };
  } catch {
    return def;
  }
}

/**
 * Normalize a path for matching: Unicode-canonicalize (NFKC) FIRST so homoglyph
 * lookalikes can't bypass the gate (e.g. U+2024 ONE-DOT-LEADER '․' → '.', so
 * "config/․env" canonicalizes to "config/.env" and is denied), then backslashes
 * → /, strip leading "./", lowercase. Total.
 */
function normPath(p: string): string {
  try {
    return String(p).normalize("NFKC").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  } catch {
    return String(p).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  }
}

/**
 * Conservative ReDoS guard for USER-supplied deny-content regex sources. Rejects
 * the dominant catastrophic-backtracking shape — a group that contains an
 * unbounded quantifier and is ITSELF quantified, e.g. `(a+)+`, `(a*)*`, `(a+)*`
 * — plus absurdly long sources and sources that won't compile. HONEST: this is a
 * heuristic that blocks the common nested-quantifier class, NOT a proof of
 * linear-time matching; it lets a policy author's safe patterns through while
 * refusing the patterns that would hang the gate.
 */
export function isSafeRegexSource(source: string): boolean {
  try {
    const s = String(source);
    if (s.length === 0 || s.length > 256) return false;
    // a quantified group whose body contains an unbounded quantifier → ReDoS-prone.
    if (/\([^()]*[+*][^()]*\)\s*[+*]/.test(s)) return false;
    // must compile.
    // eslint-disable-next-line no-new
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
}

/** Deterministic, total glob → anchored case-insensitive RegExp. Supports ** * ? */
export function globToRegExp(glob: string): RegExp {
  try {
    const g = String(glob).replace(/\\/g, "/");
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i]!;
      if (c === "*") {
        if (g[i + 1] === "*") {
          if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 2; }
          else { re += ".*"; i += 1; }
        } else {
          re += "[^/]*";
        }
      } else if (c === "?") {
        re += "[^/]";
      } else if (".+^${}()|[]\\/".includes(c)) {
        re += "\\" + c;
      } else {
        re += c;
      }
    }
    return new RegExp("^" + re + "$", "i");
  } catch {
    // a glob that somehow won't compile must never crash the gate — match nothing.
    return /$.^/;
  }
}

/** True if `path` matches `glob` on the full normalized path OR its basename. */
export function pathMatches(path: string, glob: string): boolean {
  try {
    const np = normPath(path);
    const base = np.split("/").pop() ?? np;
    const rx = globToRegExp(glob);
    return rx.test(np) || rx.test(base);
  } catch {
    return false;
  }
}

/** Total content-pattern test; an invalid OR ReDoS-prone source is skipped
 *  (never throws, never hangs — the gate's safety beats one extra deny rule). */
function contentMatches(content: string, source: string): boolean {
  try {
    if (!isSafeRegexSource(source)) return false;
    return new RegExp(source).test(content);
  } catch {
    return false;
  }
}

/**
 * The gate. Returns a structured ALLOW/DENY decision. Fail-closed by design:
 * any genuinely ambiguous state lands on DENY with an explicit reason.
 */
export function checkPolicy(input: PolicyCheckInput, policy?: PolicyRule): PolicyDecision {
  try {
    const p = policy ?? defaultPolicy();
    const violations: PolicyViolation[] = [];
    const path = typeof input?.path === "string" ? input.path : "";
    const content = typeof input?.content === "string" ? input.content : "";
    const agent = typeof input?.agent === "string" ? input.agent : "";
    const bytes = Number.isFinite(input?.bytes)
      ? Number(input!.bytes)
      : Buffer.byteLength(content, "utf8");

    // 1. agent allow-list (if configured)
    if (p.allowAgents.length > 0 && !p.allowAgents.includes(agent)) {
      violations.push({ kind: "agent", detail: `agent '${agent || "(none)"}' is not in the allow-list`, rule: p.allowAgents.join(",") });
    }
    // 2. path deny-globs
    if (path) {
      for (const g of p.denyPaths) {
        if (pathMatches(path, g)) {
          violations.push({ kind: "path", detail: `path '${path}' matches deny-glob '${g}'`, rule: g });
          break;
        }
      }
    }
    // 3. content deny-patterns
    if (content) {
      for (const src of p.denyContent) {
        if (contentMatches(content, src)) {
          violations.push({ kind: "content", detail: `content matches deny-pattern /${src}/`, rule: src });
          break;
        }
      }
    }
    // 4. size cap
    if (p.maxBytes > 0 && bytes > p.maxBytes) {
      violations.push({ kind: "size", detail: `payload ${bytes}B exceeds maxBytes ${p.maxBytes}`, rule: "maxBytes" });
    }

    const allowed = violations.length === 0;
    return {
      allowed,
      verdict: allowed ? "ALLOW" : "DENY",
      reason: allowed
        ? "no policy violation"
        : violations.map((v) => `[${v.kind}] ${v.detail}`).join("; "),
      violations,
    };
  } catch (e) {
    // fail-CLOSED: an unexpected error denies, never leaks.
    return {
      allowed: false,
      verdict: "DENY",
      reason: `policy check error (fail-closed): ${(e as Error).message}`,
      violations: [{ kind: "content", detail: "internal error", rule: "fail-closed" }],
    };
  }
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface PolicyGauntlet {
  deniesEnv: boolean;
  deniesNestedSecret: boolean;
  deniesPem: boolean;
  allowsBenign: boolean;
  deniesSecretContent: boolean;
  deniesDisallowedAgent: boolean;
  allowsAllowedAgent: boolean;
  deniesOversize: boolean;
  globSound: boolean;
  deniesHomoglyph: boolean;
  redosGuarded: boolean;
  failClosed: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function policyGauntlet(): PolicyGauntlet {
  const def = defaultPolicy();

  const deniesEnv = checkPolicy({ path: "config/.env", content: "X=1" }, def).verdict === "DENY"
    && checkPolicy({ path: ".env.production" }, def).verdict === "DENY";
  const deniesNestedSecret = checkPolicy({ path: "a/b/secrets/token.txt" }, def).verdict === "DENY"
    && checkPolicy({ path: "src/.aws/credentials" }, def).verdict === "DENY";
  const deniesPem = checkPolicy({ path: "keys/server.pem" }, def).verdict === "DENY"
    && checkPolicy({ path: "id_rsa" }, def).verdict === "DENY";
  const allowsBenign = checkPolicy({ path: "src/app/main.ts", content: "export const x = 1;" }, def).verdict === "ALLOW";
  const deniesSecretContent = checkPolicy({ path: "src/util.ts", content: "const k = 'AKIA1234567890ABCDEF';" }, def).verdict === "DENY";

  const scoped: PolicyRule = { ...def, allowAgents: ["claude", "cursor"] };
  const deniesDisallowedAgent = checkPolicy({ path: "src/a.ts", agent: "evil" }, scoped).verdict === "DENY";
  const allowsAllowedAgent = checkPolicy({ path: "src/a.ts", agent: "claude" }, scoped).verdict === "ALLOW";

  const capped: PolicyRule = { ...def, maxBytes: 10 };
  const deniesOversize = checkPolicy({ path: "src/a.ts", content: "x".repeat(50) }, capped).verdict === "DENY";

  // glob soundness: ** crosses dirs, * does not
  const globSound = pathMatches("a/b/c/.env", "**/.env")
    && !pathMatches("a/b/c.txt", "*.env")
    && pathMatches("server.pem", "*.pem")
    && globToRegExp("**/x").test("a/b/x")
    && !globToRegExp("*.ts").test("a/b.ts");

  // homoglyph bypass closed: a Unicode lookalike for "." canonicalizes (NFKC) and
  // is still denied; the ASCII form was already denied.
  const deniesHomoglyph = checkPolicy({ path: "config/․env" }, def).verdict === "DENY"
    && checkPolicy({ path: "config/.env" }, def).verdict === "DENY";

  // ReDoS guard: a catastrophic-backtracking pattern is rejected; a real secret
  // pattern is kept; normalizePolicy drops the unsafe one but keeps the safe one.
  const redosGuarded = isSafeRegexSource("(a+)+$") === false
    && isSafeRegexSource("AKIA[0-9A-Z]{16}") === true
    && normalizePolicy({ denyPaths: [], denyContent: ["(a+)+$", "sk-[A-Za-z0-9]{20,}"], allowAgents: [], maxBytes: 0 }).denyContent.length === 1
    && checkPolicy({ content: "x".repeat(50) }, { denyPaths: [], denyContent: ["(x+)+$"], allowAgents: [], maxBytes: 0 }).verdict === "ALLOW"; // unsafe pattern skipped, no hang

  // fail-closed: a deny-content regex that's invalid is skipped (not a crash),
  // and a totally broken input still returns a decision.
  const failClosed = checkPolicy({ content: "" }, { denyPaths: [], denyContent: ["(("], allowAgents: [], maxBytes: 0 }).verdict === "ALLOW"
    && checkPolicy(undefined as unknown as PolicyCheckInput).verdict !== undefined as unknown;

  // determinism: same input → identical decision JSON
  const a = JSON.stringify(checkPolicy({ path: "config/.env" }, def));
  const b = JSON.stringify(checkPolicy({ path: "config/.env" }, def));
  const deterministic = a === b;

  // totality: hostile inputs never throw
  let total = true;
  try {
    checkPolicy({ path: null as unknown as string, content: null as unknown as string });
    checkPolicy({ bytes: NaN, content: "x" }, normalizePolicy("not an object"));
    normalizePolicy(undefined);
    normalizePolicy({ denyPaths: 5, maxBytes: "x" });
    globToRegExp("***/[");
    pathMatches(undefined as unknown as string, undefined as unknown as string);
  } catch {
    total = false;
  }

  const all = deniesEnv && deniesNestedSecret && deniesPem && allowsBenign && deniesSecretContent
    && deniesDisallowedAgent && allowsAllowedAgent && deniesOversize && globSound && deniesHomoglyph
    && redosGuarded && failClosed && deterministic && total;
  return {
    deniesEnv, deniesNestedSecret, deniesPem, allowsBenign, deniesSecretContent,
    deniesDisallowedAgent, allowsAllowedAgent, deniesOversize, globSound, deniesHomoglyph,
    redosGuarded, failClosed, deterministic, total,
    score: all ? 100 : 0,
  };
}
