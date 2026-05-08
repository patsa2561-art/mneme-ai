/**
 * Molecule plan executor — turn a MoleculePlan into actual results.
 *
 * The executor resolves each step's manifest, dynamically imports the
 * implementation module, and invokes the export with the step's args.
 * Results from one step can feed into the next via a shared scratchpad.
 *
 * Design constraints:
 *   - **Safety first.** Steps that would mutate the user's filesystem,
 *     spawn subprocesses, or hit the network are explicitly enumerated
 *     by sideEffect class. `--dry-run` (default) prints what would run
 *     without invoking it.
 *   - **Auditable.** Every invocation is logged with input, output
 *     summary, ms_actual, and any error. The execution trace becomes a
 *     post-mortem artifact.
 *   - **Resumable.** A failed step doesn't kill the run; the executor
 *     records the error and continues so the user sees the full picture.
 */

import { registry } from "./registry.js";
import type { MoleculePlan, MoleculeStep } from "./compiler.js";
import type { AnyManifest, SideEffect } from "./manifest.js";

export interface ExecuteOptions {
  /** Repo root — passed as `cwd` to any element that takes one. */
  cwd: string;
  /** Stop after this many steps. Default: full plan. */
  maxSteps?: number;
  /** Skip steps with these side-effect classes. */
  forbidSideEffects?: SideEffect[];
  /** Pre-populate the scratchpad with these key→value pairs. */
  scratch?: Record<string, unknown>;
}

export interface StepResult {
  step: MoleculeStep;
  manifest: AnyManifest;
  /** Wall-clock ms for this step. */
  msActual: number;
  /** Brief output preview (truncated for log readability). */
  outputPreview: string;
  /** Full output kept under the scratchpad key matching the step id. */
  ok: boolean;
  error?: string;
}

export interface ExecutionResult {
  plan: MoleculePlan;
  results: StepResult[];
  /** Scratchpad after all steps ran — keyed by step id. */
  scratch: Record<string, unknown>;
  /** Sum of all ms_actual. */
  totalMs: number;
  /** True if every step succeeded. */
  ok: boolean;
}

/**
 * Execute a plan. Each step is resolved → imported → invoked. Outputs
 * accumulate in the scratchpad and are passed to subsequent steps as
 * inputs when their manifests' input names match a scratchpad key.
 */
export async function executePlan(
  plan: MoleculePlan,
  opts: ExecuteOptions,
): Promise<ExecutionResult> {
  const results: StepResult[] = [];
  const scratch: Record<string, unknown> = { cwd: opts.cwd, ...(opts.scratch ?? {}) };
  const forbid = new Set(opts.forbidSideEffects ?? []);
  const stepCap = opts.maxSteps ?? plan.steps.length;
  let totalMs = 0;
  let ok = true;

  for (let i = 0; i < Math.min(plan.steps.length, stepCap); i++) {
    const step = plan.steps[i]!;
    const manifest = registry.get(step.id);
    if (!manifest) {
      ok = false;
      results.push({
        step,
        manifest: makePlaceholderManifest(step.id),
        msActual: 0,
        outputPreview: "",
        ok: false,
        error: `Unknown manifest id: ${step.id}`,
      });
      continue;
    }
    if (forbid.has(manifest.sideEffect)) {
      ok = false;
      results.push({
        step,
        manifest,
        msActual: 0,
        outputPreview: "",
        ok: false,
        error: `Side effect "${manifest.sideEffect}" is forbidden by this run`,
      });
      continue;
    }
    if (!manifest.modulePath || !manifest.exportName) {
      // Some manifests are documentation-only (no implementation). The
      // compiler may still pick them as planning markers (e.g.
      // pattern.regex). We record this and continue with success.
      results.push({
        step,
        manifest,
        msActual: 0,
        outputPreview: "(documentation-only — no module/export wired)",
        ok: true,
      });
      continue;
    }

    const t0 = Date.now();
    try {
      const fn = await resolveExport(manifest.modulePath, manifest.exportName);
      if (typeof fn !== "function") {
        throw new Error(`export ${manifest.exportName} is not a function`);
      }
      const args = bindArgs(manifest, step.args, scratch);
      const result = await Promise.resolve(fn(...args));
      const dt = Date.now() - t0;
      totalMs += dt;
      scratch[manifest.id] = result;
      results.push({
        step,
        manifest,
        msActual: dt,
        outputPreview: previewOf(result),
        ok: true,
      });
    } catch (err) {
      const dt = Date.now() - t0;
      totalMs += dt;
      ok = false;
      results.push({
        step,
        manifest,
        msActual: dt,
        outputPreview: "",
        ok: false,
        error: (err as Error).message ?? String(err),
      });
    }
  }

  return { plan, results, scratch, totalMs, ok };
}

/* ────────────  Internals  ─────────────────────────────────────────── */

async function resolveExport(modulePath: string, exportName: string): Promise<unknown> {
  // Modules in our manifests are referenced by relative path
  // ("../git/batch-log.js") OR by package name ("@mneme-ai/embeddings").
  // We resolve both via `import()`. Relative paths are interpreted
  // relative to packages/core/src — the same convention the manifest
  // declares.
  const isRelative = modulePath.startsWith(".") || modulePath.startsWith("/");
  if (isRelative) {
    // Resolve relative to this file (compiles to packages/core/dist/periodic/executor.js).
    const url = new URL(modulePath.replace(/\.ts$/, ".js"), import.meta.url);
    const mod = await import(url.href);
    return (mod as Record<string, unknown>)[exportName];
  }
  const mod = await import(modulePath);
  return (mod as Record<string, unknown>)[exportName];
}

/** Convert manifest-declared input shape + step.args + scratch into a
 *  positional argument list for the export call. Most exports take a
 *  single options object; some (cosineSim, dotProductNormalized) take
 *  positional Float32Arrays. We auto-detect by counting input keys. */
function bindArgs(
  manifest: AnyManifest,
  stepArgs: Record<string, unknown>,
  scratch: Record<string, unknown>,
): unknown[] {
  const inputKeys = Object.keys(manifest.inputs);
  // Fill values: stepArgs takes precedence, scratchpad fills in cwd / etc.
  const merged: Record<string, unknown> = { ...scratch, ...stepArgs };

  // Heuristic: positional invocation only when ALL inputs declare a
  // typed-array shape. This catches vector kernels (cosineSim(a, b),
  // dotProductNormalized(a, b)) without mistakenly treating a one-key
  // options object {x: number} as positional.
  const positional =
    inputKeys.length >= 1 &&
    inputKeys.every((k) => /Float\d+Array|Uint\d+Array|Int\d+Array/.test(manifest.inputs[k] ?? ""));
  if (positional) {
    return inputKeys.map((k) => merged[k]);
  }
  return [merged];
}

function previewOf(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === "string") return value.slice(0, 120);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{ ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }`;
  }
  return typeof value;
}

function makePlaceholderManifest(id: string): AnyManifest {
  return {
    id,
    kind: "element",
    summary: "(unresolved manifest)",
    description: "Placeholder for a step whose manifest could not be resolved.",
    inputs: {},
    output: "void",
    cost: { io: "none", cpu: "trivial", msP50: 0 },
    deterministic: false,
    sideEffect: "none",
    tags: [],
  };
}
