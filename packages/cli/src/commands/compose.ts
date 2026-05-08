/**
 * `mneme compose "<intent>"` — compile a natural-language intent into
 * a runnable molecule plan from the periodic table.
 *
 * Two modes:
 *   - rule-based (default, no LLM):  cheap keyword + tag scorer assembles a plan
 *   - --llm (opt-in):                ask the configured LLM to refine the plan
 *
 * Either mode produces a MoleculePlan that the user can audit (--dry-run
 * default), then run with --execute. The plan is cached in
 * .mneme/molecule-cache.json keyed by the canonicalised intent so future
 * identical queries skip the planning step entirely (the v0.42
 * Second-Brain feature reads from this cache to promote frequent plans
 * into named commands).
 */

import kleur from "kleur";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { git, periodic } from "@mneme-ai/core";
// v0.42: every compose invocation also writes to the library so the
// Second-Brain promotion loop has data to work with.
import { resolveAllEnrichers, ResilientEnricher } from "@mneme-ai/embeddings";
import { ui, header, section, kv, divider, nextSteps } from "../ui.js";

export interface ComposeOptions {
  cwd: string;
  intent: string;
  maxSteps?: number;
  dryRun?: boolean;
  useLlm?: boolean;
  json?: boolean;
  quiet?: boolean;
  /** Skip cache reads (for benchmarking / debugging). */
  noCache?: boolean;
  /** v0.42: execute the plan after compiling it. */
  execute?: boolean;
}

const CACHE_FILE = "molecule-cache.json";
const CACHE_VERSION = 1;

interface CacheFile {
  version: 1;
  entries: Record<string, CachedPlan>;
}

interface CachedPlan {
  intent: string;
  plan: periodic.MoleculePlan;
  hits: number;
  firstSeen: string;
  lastSeen: string;
}

export async function composeCommand(opts: ComposeOptions): Promise<number> {
  const intent = opts.intent.trim();
  if (!intent || intent.length < 4) {
    ui.error("Pass an intent (e.g. `mneme compose \"find SQL injection in payment files\"`).");
    return 1;
  }

  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  // 1. Cache lookup (canonicalised by content hash so whitespace doesn't
  //    cause cache misses).
  const cacheKey = canonicalKey(intent);
  let cached: CachedPlan | undefined;
  if (!opts.noCache) cached = await readCache(meta.rootPath, cacheKey);

  // 2. Plan
  let plan: periodic.MoleculePlan;
  if (cached && !opts.useLlm) {
    plan = cached.plan;
    plan.trace = ["cache hit — reusing prior plan", ...plan.trace];
    await bumpCache(meta.rootPath, cacheKey, cached);
  } else {
    plan = periodic.compilePlan({ intent, maxSteps: opts.maxSteps });
    if (opts.useLlm) {
      plan = await refinePlanWithLlm(plan, intent);
    }
    await writeCache(meta.rootPath, cacheKey, intent, plan);
  }

  // v0.42: feed the library so frequency-based promotion can work.
  await periodic.recordInvocation(meta.rootPath, intent, plan);

  // 3. Render / json
  if (opts.json) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    return 0;
  }

  if (!opts.quiet) ui.banner();
  process.stdout.write(
    header(
      "🧪",
      "Compose — molecule plan from intent",
      `"${intent}"`,
      "Compiles a natural-language intent into a runnable pipeline of registered atoms / molecules.",
    ) + "\n\n",
  );

  process.stdout.write(
    kv("source", plan.source) +
      "\n" +
      kv("estimated p50", `${plan.estimatedMsP50.toFixed(1)} ms`) +
      "\n" +
      kv("steps", String(plan.steps.length)) +
      "\n" +
      kv("cache key", cacheKey.slice(0, 16)) +
      "\n\n",
  );

  if (plan.steps.length === 0) {
    process.stdout.write(`  ${kleur.yellow("!")} ${plan.trace[0]}\n\n`);
    return 1;
  }

  process.stdout.write(section("Plan", "execution order") + "\n\n");
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i]!;
    const m = periodic.registry.get(s.id);
    const cost = m ? `[${m.cost.cpu}·${m.cost.msP50}ms]` : "";
    process.stdout.write(
      `  ${kleur.gray(`${i + 1}.`)} ${kleur.cyan(s.id.padEnd(34))} ${kleur.gray(cost.padEnd(18))} ${kleur.white(s.why ?? "")}\n`,
    );
  }
  process.stdout.write("\n");

  process.stdout.write(section("Trace", "why each step was chosen") + "\n");
  for (const t of plan.trace) {
    process.stdout.write(`    ${kleur.gray("·")} ${kleur.gray(t)}\n`);
  }
  process.stdout.write("\n");

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "v0.41 ships the planner — `mneme compose` shows the plan but does NOT yet execute it.\n" +
          "  Execution lands in v0.42; for now you can copy the steps into individual `mneme <id>`\n" +
          "  invocations.  Plans are cached in `.mneme/molecule-cache.json`; a frequent plan will\n" +
          "  be promoted into a named command in v0.42's Second-Brain layer.",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme compose "${intent}" --llm`, why: "ask the configured LLM to refine the plan" },
      { cmd: `mneme compose "${intent}" --json`, why: "machine-readable plan for AI / MCP" },
      { cmd: `mneme periodic-table`, why: "browse the catalog of available primitives" },
    ]) + "\n",
  );

  return 0;
}

/* ──────────────  LLM refinement (optional)  ─────────────────────── */

const LLM_SYSTEM = `You are an expert planner that selects from a fixed catalog of primitives.
You must return JSON of shape: { "steps": [{"id": "<manifest-id>", "args": {...}, "why": "..."}], "trace": ["..."] }.
ONLY use ids from the catalog the user shows you; do NOT invent ids.
Keep steps in execution order. Maximum 6 steps. Keep "why" short (≤ 80 chars).`;

async function refinePlanWithLlm(
  seed: periodic.MoleculePlan,
  intent: string,
): Promise<periodic.MoleculePlan> {
  try {
    const enrichers = await resolveAllEnrichers();
    if (enrichers.length === 0) {
      seed.trace.push("LLM refinement skipped — no enricher available");
      return seed;
    }
    const enricher = new ResilientEnricher(enrichers);
    const catalog = periodic.registry.all().map((m) => `${m.id}\t${m.kind}\t${m.summary}`).join("\n");
    const user = `Intent: ${intent}

Seed plan from rule-based assembler (you may keep, drop, or replace any step):
${seed.steps.map((s, i) => `${i + 1}. ${s.id} — ${s.why ?? ""}`).join("\n")}

Catalog (id  kind  summary):
${catalog}

Return JSON only.`;
    const out = await enricher.enrich({ system: LLM_SYSTEM, user, temperature: 0.1, maxTokens: 600 });
    const json = tryParseJson(out.text);
    if (!json) {
      seed.trace.push(`LLM returned malformed JSON; kept rule-based plan`);
      return seed;
    }
    const refinedSteps: periodic.MoleculeStep[] = (json.steps ?? []).filter(
      (s: any) => s && typeof s.id === "string" && periodic.registry.get(s.id),
    );
    if (refinedSteps.length === 0) {
      seed.trace.push("LLM produced no valid steps; kept rule-based plan");
      return seed;
    }
    return {
      intent,
      steps: refinedSteps,
      estimatedMsP50: refinedSteps.reduce((sum, s) => {
        const m = periodic.registry.get(s.id);
        return sum + (m ? m.cost.msP50 : 0);
      }, 0),
      source: "llm",
      trace: ["refined by LLM", ...(json.trace ?? []), ...seed.trace],
    };
  } catch (err) {
    seed.trace.push(`LLM error: ${(err as Error).message.slice(0, 80)}`);
    return seed;
  }
}

function tryParseJson(text: string): any | null {
  // LLM sometimes wraps in markdown — strip ```json fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find a JSON object inside the text
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/* ──────────────  Cache I/O  ─────────────────────────────────────── */

function canonicalKey(intent: string): string {
  const normalised = intent.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}

async function readCache(rootPath: string, key: string): Promise<CachedPlan | undefined> {
  const file = join(rootPath, ".mneme", CACHE_FILE);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.version !== CACHE_VERSION) return undefined;
    return parsed.entries[key];
  } catch {
    return undefined;
  }
}

async function writeCache(
  rootPath: string,
  key: string,
  intent: string,
  plan: periodic.MoleculePlan,
): Promise<void> {
  const dir = join(rootPath, ".mneme");
  await mkdir(dir, { recursive: true });
  const file = join(dir, CACHE_FILE);
  let cache: CacheFile;
  try {
    cache = JSON.parse(await readFile(file, "utf8")) as CacheFile;
    if (cache.version !== CACHE_VERSION) cache = { version: CACHE_VERSION, entries: {} };
  } catch {
    cache = { version: CACHE_VERSION, entries: {} };
  }
  const now = new Date().toISOString();
  const existing = cache.entries[key];
  cache.entries[key] = {
    intent,
    plan,
    hits: (existing?.hits ?? 0) + 1,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  };
  await writeFile(file, JSON.stringify(cache, null, 2), "utf8");
}

async function bumpCache(rootPath: string, key: string, cached: CachedPlan): Promise<void> {
  await writeCache(rootPath, key, cached.intent, cached.plan);
}
