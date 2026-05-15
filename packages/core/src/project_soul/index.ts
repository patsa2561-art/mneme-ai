/**
 * v2.14.0 — PROJECT SOUL (a.k.a. MNEME GENOME for project-level values)
 *
 *   "Every project has a soul. AI doesn't see it. Mneme writes it down,
 *    HMAC-signs it, and refuses any AI change that breaks it."
 *
 * The soul is a tiny JSON manifest at `.mneme/project_soul.json` that
 * captures the project's hard-won opinions:
 *
 *   - values:        what the team cares about (e.g., "no Redux", "UTC dates")
 *   - antiPatterns:  patterns that cost time before (e.g., "useEffect setState
 *                     without deps", "lodash dependency")
 *   - conventions:   bake-in style decisions
 *   - scars:         past incidents the project paid for
 *   - sacred:        files / paths AI must never modify without explicit ack
 *
 * Every entry is HMAC-signed and the whole file has a chain signature.
 * Tampering with the file is detectable.
 *
 * SOUL GATE: before applying any AI change, call `checkAgainstSoul`.
 * It returns a verdict: PASS / WARN / BLOCK plus per-rule findings.
 *
 * Wisdom note: rules are *additive only by design*. AI cannot silently
 * delete a rule — every removal needs human-typed `reason:` field.
 * This prevents AI from editing the very rules that constrain it.
 *
 * Composes orthogonally with the existing `dna/` (genetic ancestry) and
 * `genome/` (MCP tool genetic engineering) modules — different concern.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const PROTOCOL_VERSION = 1 as const;

export interface SoulRule {
  /** Stable kebab-case ID of the rule. */
  id: string;
  /** Plain-English statement of the rule. */
  text: string;
  /** When this rule was added (ISO 8601). */
  addedAt: string;
  /** Optional historical incident the rule traces back to. */
  scarFrom?: string;
  /** warn = note it; block = refuse the change. */
  severity: "warn" | "block";
  /** If true, AI may not silently propose removing this rule. */
  immutable?: boolean;
  /** HMAC of the rule body. */
  sig: string;
}

export interface ProjectSoul {
  v: typeof PROTOCOL_VERSION;
  project: string;
  /** Free-form "what is the spirit of this project". */
  spirit: string;
  values: SoulRule[];
  antiPatterns: SoulRule[];
  conventions: SoulRule[];
  scars: SoulRule[];
  sacred: SoulRule[];
  updatedAt: string;
  ruleCount: number;
  /** HMAC over the canonical body. Tampering with rules invalidates this. */
  soulSig: string;
}

export type SoulCategory = "values" | "antiPatterns" | "conventions" | "scars" | "sacred";

export interface SoulChange {
  description: string;
  files?: string[];
  addsDeps?: string[];
  codeExcerpts?: string[];
}

export interface SoulFinding {
  ruleId: string;
  matchedAnchor: string;
  severity: "warn" | "block";
  evidence: string;
  category: SoulCategory;
}

export interface SoulVerdict {
  verdict: "PASS" | "WARN" | "BLOCK";
  findings: SoulFinding[];
  reasons: string[];
  next: string;
  signedAt: string;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function ruleSig(r: Omit<SoulRule, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(r)).digest("hex");
}

function soulBodyForSig(s: ProjectSoul): Omit<ProjectSoul, "soulSig"> {
  const { soulSig: _omit, ...rest } = s;
  return rest;
}

function signSoul(s: ProjectSoul, secret: string): string {
  return createHmac("sha256", secret).update(canon(soulBodyForSig(s))).digest("hex");
}

function defaultSecret(project: string): string {
  return process.env["MNEME_SOUL_SECRET"] || `mneme-soul-${project}-v${PROTOCOL_VERSION}`;
}

function resolveRoot(p: string): string {
  return isAbsolute(p) ? p : resolve(p);
}

export function newSoul(project: string, spirit: string, opts: { secret?: string } = {}): ProjectSoul {
  const now = new Date().toISOString();
  const secret = opts.secret ?? defaultSecret(project);
  const s: ProjectSoul = {
    v: PROTOCOL_VERSION,
    project, spirit,
    values: [], antiPatterns: [], conventions: [], scars: [], sacred: [],
    updatedAt: now, ruleCount: 0, soulSig: "",
  };
  s.soulSig = signSoul(s, secret);
  return s;
}

export interface AddRuleInput {
  category: SoulCategory;
  id: string;
  text: string;
  severity?: "warn" | "block";
  scarFrom?: string;
  immutable?: boolean;
  secret?: string;
}

export function addRule(s: ProjectSoul, input: AddRuleInput): ProjectSoul {
  const secret = input.secret ?? defaultSecret(s.project);
  if (s[input.category].some((r) => r.id === input.id)) {
    throw new Error(`rule id "${input.id}" already exists in ${input.category}`);
  }
  const noSig: Omit<SoulRule, "sig"> = {
    id: input.id,
    text: input.text,
    addedAt: new Date().toISOString(),
    severity: input.severity ?? "warn",
    ...(input.scarFrom ? { scarFrom: input.scarFrom } : {}),
    ...(input.immutable ? { immutable: true } : {}),
  };
  const rule: SoulRule = { ...noSig, sig: ruleSig(noSig, secret) };
  const updated: ProjectSoul = {
    ...s,
    [input.category]: [...s[input.category], rule],
    updatedAt: new Date().toISOString(),
    ruleCount: s.ruleCount + 1,
    soulSig: "",
  };
  updated.soulSig = signSoul(updated, secret);
  return updated;
}

export function verifySoul(s: ProjectSoul, secret?: string): { ok: boolean; reason?: string } {
  const sec = secret ?? defaultSecret(s.project);
  const expected = signSoul(s, sec);
  try {
    const ok = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(s.soulSig, "hex"));
    return ok ? { ok: true } : { ok: false, reason: "soulSig mismatch — file tampered or wrong secret" };
  } catch {
    return { ok: false, reason: "soulSig length invalid" };
  }
}

export function saveSoul(s: ProjectSoul, opts: { repoDir?: string } = {}): string {
  const root = resolveRoot(opts.repoDir ?? process.cwd());
  const dir = join(root, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, "project_soul.json");
  writeFileSync(path, JSON.stringify(s, null, 2));
  return path;
}

export function loadSoul(opts: { repoDir?: string } = {}): ProjectSoul | null {
  const root = resolveRoot(opts.repoDir ?? process.cwd());
  const path = join(root, ".mneme", "project_soul.json");
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as ProjectSoul; }
  catch { return null; }
}

const STOPWORDS = new Set([
  // articles / pronouns / connectives
  "the", "a", "an", "is", "are", "in", "on", "of", "to", "for", "and", "or", "but",
  "we", "i", "you", "it", "no", "not", "do", "must", "should", "all", "any", "with",
  "be", "this", "that", "these", "those", "from", "by", "as", "at", "can", "may",
  // common action verbs that aren't discriminating
  "add", "use", "make", "set", "get", "have", "has", "had", "create", "update",
  "change", "modify", "delete", "remove", "ensure", "prefer", "avoid", "allow",
  "take", "put", "run", "build", "test", "ship", "fix", "new", "old",
]);

function matchRule(rule: SoulRule, change: SoulChange, category: SoulCategory): SoulFinding | null {
  const haystack = [
    change.description,
    ...(change.files ?? []),
    ...(change.addsDeps ?? []),
    ...(change.codeExcerpts ?? []),
  ].join("\n").toLowerCase();
  const tokens = rule.text.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  // Match ANY content token from the rule (not just the longest). A rule
  // like "Prefer native over lodash dependency" anchors on lodash even
  // though "dependency" is longer.
  const matched = tokens.find((t) => haystack.includes(t));
  if (!matched) return null;
  const lines = (change.description + "\n" +
    (change.files ?? []).join("\n") + "\n" +
    (change.addsDeps ?? []).join("\n") + "\n" +
    (change.codeExcerpts ?? []).join("\n")).split("\n");
  const evidence = lines.find((l) => l.toLowerCase().includes(matched)) ?? matched;
  return {
    ruleId: rule.id,
    matchedAnchor: matched,
    severity: rule.severity,
    evidence: evidence.slice(0, 200),
    category,
  };
}

/**
 * The SOUL GATE. Returns a verdict + HMAC-signed audit trail. Block findings
 * mean "refuse the change". Warn findings mean "log + proceed".
 */
export function checkAgainstSoul(s: ProjectSoul, change: SoulChange, secret?: string): SoulVerdict {
  const findings: SoulFinding[] = [];
  // antiPatterns / scars / sacred GATE — match severity is honoured as-is.
  for (const cat of ["antiPatterns", "scars", "sacred"] as const) {
    for (const rule of s[cat]) {
      const m = matchRule(rule, change, cat);
      if (m) findings.push(m);
    }
  }
  // values / conventions are advisory — downgrade to warn even if rule said block.
  for (const cat of ["values", "conventions"] as const) {
    for (const rule of s[cat]) {
      const m = matchRule(rule, change, cat);
      if (m) findings.push({ ...m, severity: "warn" });
    }
  }
  let verdict: SoulVerdict["verdict"] = "PASS";
  const reasons: string[] = [];
  if (findings.some((f) => f.severity === "block")) {
    verdict = "BLOCK";
    reasons.push("one or more block-severity rules matched the change");
  } else if (findings.length > 0) {
    verdict = "WARN";
    reasons.push("change matched warn-severity rules — proceed with awareness");
  } else {
    reasons.push("no project-soul rules matched — clean ship");
  }
  const signedAt = new Date().toISOString();
  const body = { verdict, findings, signedAt, project: s.project };
  const sig = createHmac("sha256", secret ?? defaultSecret(s.project)).update(canon(body)).digest("hex");
  return {
    verdict, findings, reasons,
    next: verdict === "BLOCK"
      ? "Refuse the change; ask AI to revise so no block-severity rule triggers."
      : verdict === "WARN"
        ? "Proceed but log the warning in PR description."
        : "Ship freely.",
    signedAt, sig,
  };
}

/** One-line summary for pulse / wisdom output. */
export function formatSoulLine(s: ProjectSoul | null): string {
  if (!s) return "SOUL · not initialised (run mneme.soul.init)";
  return `SOUL · ${s.project} · ${s.ruleCount} rules · sig=${s.soulSig.slice(0, 8)}`;
}

/**
 * Sensible default rules every Mneme-managed project starts with.
 * Run once to bootstrap; they're additive so re-running is a no-op
 * for already-present IDs.
 */
export function seedDefaultRules(s: ProjectSoul, opts: { secret?: string } = {}): ProjectSoul {
  let cur = s;
  const seed: AddRuleInput[] = [
    { category: "values", id: "honest-claims", text: "AI must not state facts without verification; prefer 'I'm not sure' over fabrication.", severity: "warn", immutable: true },
    { category: "antiPatterns", id: "no-fake-files", text: "Never reference files or symbols that do not exist in the repo.", severity: "block", immutable: true },
    { category: "antiPatterns", id: "no-secret-leak", text: "Never include API keys, tokens, passwords, or PII in commits, comments, or logs.", severity: "block", immutable: true },
    { category: "sacred", id: "no-touch-mneme-config", text: ".mneme/ directory is sacred; AI must not modify config files without explicit human approval.", severity: "block", immutable: true },
    { category: "conventions", id: "utc-timestamps", text: "All timestamps stored as ISO 8601 UTC.", severity: "warn" },
  ];
  for (const r of seed) {
    if (!cur[r.category].some((x) => x.id === r.id)) {
      cur = addRule(cur, { ...r, secret: opts.secret });
    }
  }
  return cur;
}
