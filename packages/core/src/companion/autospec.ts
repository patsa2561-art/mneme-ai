/**
 * v2.22.0 — COMPANION · AUTOSPEC.
 *
 * Derives a JSON Schema for a verb's arguments from the manifest's
 * `command` template. AI agent provides args → autospec validates
 * BEFORE the verb is invoked, returning structured errors instead of
 * wasted invocations.
 *
 * The signature parser walks the `command` string and extracts:
 *   `<required>`       → required positional arg, type=string
 *   `[optional]`       → optional positional arg
 *   `<arg...>`         → variadic positional
 *   `--flag <value>`   → option with value
 *   `--flag`           → boolean flag
 *
 * For most catalog entries this is enough. Verbs with more complex
 * options can ship a JSON override at
 * `companion/overrides/<verb-slug>.json` (the `argSchema` key).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MNEME_COMMAND_CATALOG, type ManifestCommand } from "../agent_manifest.js";

export interface ArgSchema {
  /** Positional args, in order. */
  positional: Array<{ name: string; required: boolean; variadic: boolean; type: "string" | "number" | "boolean" }>;
  /** Named options. */
  options: Record<string, { type: "string" | "number" | "boolean"; required: boolean; description?: string; values?: string[] }>;
  /** Source — auto vs override. */
  source: "auto" | "override";
}

function overrideDir(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, "overrides");
  } catch {
    return "";
  }
}

function slugify(command: string): string {
  return command.replace(/^mneme\s+/, "").replace(/[\s<>\[\]|'"]+/g, "_").toLowerCase();
}

/** Parse the manifest `command` field into a schema. */
export function parseArgSchema(command: string): ArgSchema {
  const positional: ArgSchema["positional"] = [];
  const options: ArgSchema["options"] = {};
  const tokens = command.split(/\s+/).filter(Boolean);
  // Skip "mneme <head>"
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith("<") && t.endsWith(">")) {
      const inner = t.slice(1, -1);
      const variadic = inner.endsWith("...");
      const name = variadic ? inner.slice(0, -3) : inner;
      positional.push({ name, required: true, variadic, type: "string" });
    } else if (t.startsWith("[") && t.endsWith("]")) {
      const inner = t.slice(1, -1);
      const variadic = inner.endsWith("...");
      const name = variadic ? inner.slice(0, -3) : inner;
      positional.push({ name, required: false, variadic, type: "string" });
    } else if (t.startsWith("--")) {
      const name = t.replace(/^--/, "");
      const next = tokens[i + 1];
      if (next && (next.startsWith("<") || next.startsWith("["))) {
        options[name] = { type: "string", required: next.startsWith("<") };
        i++;
      } else {
        options[name] = { type: "boolean", required: false };
      }
    }
  }
  return { positional, options, source: "auto" };
}

export function schemaFor(entry: ManifestCommand): ArgSchema {
  // Override file may inject a richer schema.
  const dir = overrideDir();
  if (dir) {
    const p = join(dir, `${slugify(entry.command)}.json`);
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8"));
        if (j.argSchema) return { ...j.argSchema, source: "override" };
      } catch { /* fall through */ }
    }
  }
  return parseArgSchema(entry.command);
}

export interface ValidateResult {
  ok: boolean;
  errors: Array<{ field: string; reason: string }>;
}

export interface ProvidedArgs {
  positional?: string[];
  options?: Record<string, string | number | boolean | undefined>;
}

/** Validate provided args against the schema. Returns structured
 *  errors so AI agents can fix args without re-reading docs. */
export function validateArgs(schema: ArgSchema, provided: ProvidedArgs): ValidateResult {
  const errors: ValidateResult["errors"] = [];
  // Positional checks.
  const requiredPos = schema.positional.filter((p) => p.required).length;
  const variadicAt = schema.positional.findIndex((p) => p.variadic);
  const providedLen = provided.positional?.length ?? 0;
  if (variadicAt === -1) {
    if (providedLen < requiredPos) {
      errors.push({ field: "positional", reason: `expected ${requiredPos} required positional arg(s), got ${providedLen}` });
    }
  } else {
    // variadic absorbs trailing args
    if (providedLen < variadicAt + 1 && schema.positional[variadicAt]!.required) {
      errors.push({ field: schema.positional[variadicAt]!.name, reason: `expected at least 1 variadic arg, got 0` });
    }
  }
  // Option checks.
  for (const [name, opt] of Object.entries(schema.options)) {
    if (opt.required && (provided.options?.[name] === undefined || provided.options[name] === null)) {
      errors.push({ field: `--${name}`, reason: "required option missing" });
      continue;
    }
    const v = provided.options?.[name];
    if (v === undefined) continue;
    if (opt.type === "number" && typeof v !== "number" && Number.isNaN(parseFloat(String(v)))) {
      errors.push({ field: `--${name}`, reason: `expected number, got ${typeof v}: ${JSON.stringify(v)}` });
    }
    if (opt.values && !opt.values.includes(String(v))) {
      errors.push({ field: `--${name}`, reason: `value "${v}" not in allowed set [${opt.values.join(", ")}]` });
    }
  }
  return { ok: errors.length === 0, errors };
}

export function formatSchema(schema: ArgSchema): string {
  const lines: string[] = [`📐 ARG SCHEMA (source: ${schema.source})`, ""];
  lines.push(`  Positional:`);
  if (schema.positional.length === 0) lines.push(`    (none)`);
  for (const p of schema.positional) {
    const tag = p.required ? "required" : "optional";
    const vari = p.variadic ? " ...variadic" : "";
    lines.push(`    - ${p.name}  (${tag}${vari}, ${p.type})`);
  }
  lines.push(`  Options:`);
  const opts = Object.entries(schema.options);
  if (opts.length === 0) lines.push(`    (none)`);
  for (const [n, o] of opts) {
    const tag = o.required ? "required" : "optional";
    const values = o.values ? ` ∈ {${o.values.join("|")}}` : "";
    lines.push(`    - --${n}  (${tag}, ${o.type}${values})`);
  }
  return lines.join("\n");
}

export function allSchemas(catalog: ManifestCommand[] = MNEME_COMMAND_CATALOG): Map<string, ArgSchema> {
  const m = new Map<string, ArgSchema>();
  for (const e of catalog) m.set(e.command, schemaFor(e));
  return m;
}
