/**
 * v2.126.0 — SCAFFOLD: the HONEST core of "Blueprint Inflation".
 *
 * The user's pitch: an agent emits a tiny spec, Mneme locally expands it into
 * full code → big OUTPUT-token savings. The adversarial design pass confirmed
 * this is REAL **only for known, templated patterns** (CRUD model, test
 * skeleton, config) — where the spec fully determines the output and the bytes
 * live in the generator's templates, NOT the prompt. It is **fantasy** for
 * arbitrary novel business logic ("a smart stock-deduction system" cannot be
 * recovered from 35 tokens — information theory forbids it).
 *
 * So SCAFFOLD does exactly the real part, and refuses the rest:
 *   - A FIXED catalog of deterministic templates. Agent emits a compact spec;
 *     Mneme renders the boilerplate locally (no syntax errors, no re-typing).
 *   - Saves OUTPUT tokens for BOILERPLATE only. The agent still designs the
 *     schema and writes/reviews the real business logic — scaffold leaves clear
 *     TODO markers exactly there.
 *   - Unknown `kind` → ok:false with an honest message (never a guess).
 *
 * Pure + total: deterministic, no I/O, no network, never throws.
 */

export type ScaffoldSpec =
  | { kind: "ts-model"; model: string; fields: Record<string, string>; crud?: boolean }
  | { kind: "test-skeleton"; target: string; framework?: "vitest" | "jest"; cases: string[] }
  | { kind: "config"; format: "json" | "env"; entries: Record<string, string | number | boolean> };

export interface ScaffoldFile { path: string; content: string }
export interface ScaffoldMeasure { specChars: number; codeChars: number; specTokens: number; codeTokens: number; expansionRatio: number; outputReductionPct: number }
export interface ScaffoldResult {
  ok: boolean;
  kind: string;
  files: ScaffoldFile[];
  measure: ScaffoldMeasure;
  note: string;
  error?: string;
}

const KNOWN_KINDS = ["ts-model", "test-skeleton", "config"] as const;
const ident = (s: unknown): string => String(s ?? "").replace(/[^A-Za-z0-9_$]/g, "") || "X";
const est = (chars: number): number => Math.ceil(chars / 4);

function measure(spec: ScaffoldSpec, files: ScaffoldFile[]): ScaffoldMeasure {
  const specChars = JSON.stringify(spec).length;
  const codeChars = files.reduce((n, f) => n + f.content.length, 0);
  const specTokens = est(specChars); const codeTokens = est(codeChars);
  return {
    specChars, codeChars, specTokens, codeTokens,
    expansionRatio: specChars > 0 ? Math.round((codeChars / specChars) * 100) / 100 : 0,
    outputReductionPct: codeTokens > 0 ? Math.round((1 - specTokens / codeTokens) * 1000) / 10 : 0,
  };
}

const NOTE = "deterministic scaffold of a KNOWN template — saves OUTPUT tokens for BOILERPLATE only; the agent still designs the schema + writes/reviews the real business logic (see TODO markers). NOT a generator of arbitrary novel logic.";

function renderTsModel(spec: Extract<ScaffoldSpec, { kind: "ts-model" }>): ScaffoldFile[] {
  const Model = ident(spec.model);
  const fields = spec.fields && typeof spec.fields === "object" ? spec.fields : {};
  const fieldLines = Object.entries(fields).map(([k, t]) => `  ${ident(k)}: ${String(t).replace(/[\r\n]/g, " ").slice(0, 40) || "unknown"};`);
  const lines: string[] = [];
  lines.push(`export interface ${Model} {`);
  for (const fl of fieldLines.length ? fieldLines : ["  id: string;"]) lines.push(fl);
  lines.push(`}`, ``);
  if (spec.crud !== false) {
    lines.push(`/** In-memory ${Model} repository scaffold. TODO: swap the Map for real persistence. */`);
    lines.push(`export class ${Model}Repo {`);
    lines.push(`  private store = new Map<string, ${Model}>();`);
    lines.push(`  create(id: string, value: ${Model}): ${Model} { this.store.set(id, value); return value; }`);
    lines.push(`  get(id: string): ${Model} | undefined { return this.store.get(id); }`);
    lines.push(`  list(): ${Model}[] { return [...this.store.values()]; }`);
    lines.push(`  update(id: string, patch: Partial<${Model}>): ${Model} | undefined {`);
    lines.push(`    const cur = this.store.get(id); if (!cur) return undefined;`);
    lines.push(`    const next = { ...cur, ...patch }; this.store.set(id, next); return next;`);
    lines.push(`  }`);
    lines.push(`  delete(id: string): boolean { return this.store.delete(id); }`);
    lines.push(`}`);
  }
  return [{ path: `${Model.toLowerCase()}.ts`, content: lines.join("\n") + "\n" }];
}

function renderTestSkeleton(spec: Extract<ScaffoldSpec, { kind: "test-skeleton" }>): ScaffoldFile[] {
  const target = String(spec.target ?? "subject").replace(/[\r\n"]/g, " ").slice(0, 60) || "subject";
  const fw = spec.framework === "jest" ? "@jest/globals" : "vitest";
  const cases = Array.isArray(spec.cases) && spec.cases.length ? spec.cases : ["does the thing"];
  const lines: string[] = [];
  lines.push(`import { describe, it, expect } from "${fw}";`, ``);
  lines.push(`describe(${JSON.stringify(target)}, () => {`);
  for (const c of cases) {
    lines.push(`  it(${JSON.stringify(String(c).slice(0, 80))}, () => {`);
    lines.push(`    // TODO: arrange + act`);
    lines.push(`    expect(true).toBe(true); // TODO: real assertion`);
    lines.push(`  });`);
  }
  lines.push(`});`);
  const base = ident(target).toLowerCase() || "subject";
  return [{ path: `${base}.test.ts`, content: lines.join("\n") + "\n" }];
}

function renderConfig(spec: Extract<ScaffoldSpec, { kind: "config" }>): ScaffoldFile[] {
  const entries = spec.entries && typeof spec.entries === "object" ? spec.entries : {};
  if (spec.format === "env") {
    const lines = Object.entries(entries).map(([k, v]) => `${ident(k).toUpperCase()}=${String(v).replace(/[\r\n]/g, " ")}`);
    return [{ path: `.env.example`, content: lines.join("\n") + "\n" }];
  }
  return [{ path: `config.json`, content: JSON.stringify(entries, null, 2) + "\n" }];
}

/** Render a known-template spec into boilerplate. Deterministic + total. */
export function scaffold(spec: ScaffoldSpec): ScaffoldResult {
  try {
    if (!spec || typeof spec !== "object" || typeof (spec as { kind?: unknown }).kind !== "string") {
      return { ok: false, kind: "?", files: [], measure: measure({} as ScaffoldSpec, []), note: NOTE, error: "spec must be an object with a 'kind' field" };
    }
    const kind = (spec as { kind: string }).kind;
    if (!(KNOWN_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, kind, files: [], measure: measure(spec, []), note: NOTE, error: `unknown scaffold kind "${kind}". Known: ${KNOWN_KINDS.join(", ")}. Scaffold only expands KNOWN templates — write arbitrary logic normally.` };
    }
    let files: ScaffoldFile[] = [];
    if (kind === "ts-model") files = renderTsModel(spec as Extract<ScaffoldSpec, { kind: "ts-model" }>);
    else if (kind === "test-skeleton") files = renderTestSkeleton(spec as Extract<ScaffoldSpec, { kind: "test-skeleton" }>);
    else if (kind === "config") files = renderConfig(spec as Extract<ScaffoldSpec, { kind: "config" }>);
    return { ok: files.length > 0, kind, files, measure: measure(spec, files), note: NOTE };
  } catch (e) {
    return { ok: false, kind: "?", files: [], measure: measure({} as ScaffoldSpec, []), note: NOTE, error: `scaffold error (safe): ${(e as Error).message}` };
  }
}

/** Cheap balanced-delimiter check (proves generated code isn't trivially broken). */
function balanced(code: string): boolean {
  let b = 0, p = 0;
  for (const ch of code) { if (ch === "{") b++; else if (ch === "}") b--; else if (ch === "(") p++; else if (ch === ")") p--; if (b < 0 || p < 0) return false; }
  return b === 0 && p === 0;
}

export interface ScaffoldGauntlet {
  tsModelValid: boolean;     // interface + repo + every field, balanced
  testSkeletonValid: boolean; // describe + each case, balanced
  configRoundTrips: boolean;  // json parses back to the entries
  expansionReal: boolean;     // code ≫ spec (output-token saving is real)
  refusesUnknown: boolean;    // unknown kind → ok:false honest, never guesses
  deterministic: boolean;
  stable: boolean;
  score: number;
}

export function scaffoldGauntlet(): ScaffoldGauntlet {
  try {
    const m = scaffold({ kind: "ts-model", model: "User", fields: { id: "string", email: "string", age: "number" }, crud: true });
    const code = m.files[0]?.content ?? "";
    const tsModelValid = m.ok && balanced(code) && code.includes("export interface User") && code.includes("class UserRepo") && code.includes("email: string;") && code.includes("age: number;");

    const t = scaffold({ kind: "test-skeleton", target: "UserRepo", cases: ["creates a user", "rejects duplicate id"] });
    const tcode = t.files[0]?.content ?? "";
    const testSkeletonValid = t.ok && balanced(tcode) && tcode.includes('describe("UserRepo"') && tcode.includes("creates a user") && tcode.includes("rejects duplicate id");

    const c = scaffold({ kind: "config", format: "json", entries: { port: 8080, name: "svc", debug: false } });
    let configRoundTrips = false;
    try { const parsed = JSON.parse(c.files[0]?.content ?? "{}"); configRoundTrips = parsed.port === 8080 && parsed.name === "svc" && parsed.debug === false; } catch { configRoundTrips = false; }

    const expansionReal = m.measure.expansionRatio > 3 && m.measure.outputReductionPct > 50;

    const unk = scaffold({ kind: "smart-stock-deduction-system" } as never);
    const refusesUnknown = unk.ok === false && !!unk.error && /unknown scaffold kind/i.test(unk.error) && unk.files.length === 0;

    const deterministic = JSON.stringify(scaffold({ kind: "ts-model", model: "User", fields: { id: "string" } })) === JSON.stringify(scaffold({ kind: "ts-model", model: "User", fields: { id: "string" } }));

    let stable = true;
    try { scaffold(null as never); scaffold({} as never); scaffold({ kind: "ts-model" } as never); scaffold({ kind: "config", format: "env" } as never); } catch { stable = false; }

    const perfect = tsModelValid && testSkeletonValid && configRoundTrips && expansionReal && refusesUnknown && deterministic && stable;
    return { tsModelValid, testSkeletonValid, configRoundTrips, expansionReal, refusesUnknown, deterministic, stable, score: perfect ? 100 : 0 };
  } catch {
    return { tsModelValid: false, testSkeletonValid: false, configRoundTrips: false, expansionReal: false, refusesUnknown: false, deterministic: false, stable: false, score: 0 };
  }
}
