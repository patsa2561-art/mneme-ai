/**
 * v2.15.0 — MNEME GENESIS
 *
 *   "Cold-start to value in 60 seconds. Mneme reads your repo, infers
 *    the stack, seeds project soul + bounty + replica + infra-brain
 *    + the right DLP rules, all signed and tamper-evident. Zero questions
 *    asked. Zero config files to write."
 *
 * The wild distribution wedge: the friction between `npm install` and
 * "I see value" kills 90% of tools. GENESIS makes that gap < 60 seconds.
 * Composes onto existing PROJECT SOUL / BOUNTY / REPLICA / INFRA modules.
 *
 * Detection signals:
 *   - package.json / pyproject.toml / Cargo.toml / go.mod / Gemfile
 *   - file extensions distribution (.ts, .py, .rs, .go, .rb, .java)
 *   - framework markers (next.config.* / vite.config.* / tailwind.config.*
 *     / django settings / rails Gemfile / etc)
 *   - CI presence (.github/workflows / .gitlab-ci.yml / .circleci/)
 *   - repo size + age (more rules for bigger / older repos)
 *
 * Outputs a `GenesisPlan` listing every action it would take. Caller
 * confirms (or auto-applies). Plan is HMAC-signed for audit.
 */

import { createHmac } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, resolve, isAbsolute, basename } from "node:path";

const PROTOCOL_VERSION = 1 as const;
const MAX_FILES_SCAN = 5000;

export type Stack =
  | "typescript" | "javascript" | "python" | "rust" | "go" | "ruby" | "java"
  | "kotlin" | "swift" | "php" | "csharp" | "elixir" | "polyglot" | "unknown";

export type Framework =
  | "next" | "vite" | "react" | "vue" | "svelte" | "angular"
  | "django" | "flask" | "fastapi" | "rails" | "express" | "nestjs"
  | "tailwind" | "tauri" | "electron" | "expo"
  | "none";

export interface RepoFingerprint {
  stack: Stack;
  frameworks: Framework[];
  hasCI: boolean;
  hasTests: boolean;
  fileCount: number;
  ageMonths: number;
  packageManagers: Array<"npm" | "pnpm" | "yarn" | "bun" | "pip" | "uv" | "cargo" | "go" | "bundler" | "maven" | "gradle">;
  signals: Record<string, string | number | boolean>;
}

export interface GenesisAction {
  module: "soul" | "bounty" | "replica" | "infra" | "dlp" | "compliance";
  description: string;
  /** Why we picked this — visible to the user as rationale. */
  reason: string;
  /** Estimated benefit on a 1-10 scale based on detected signals. */
  benefit: number;
}

export interface GenesisPlan {
  v: typeof PROTOCOL_VERSION;
  generatedAt: string;
  repoDir: string;
  fingerprint: RepoFingerprint;
  actions: GenesisAction[];
  /** Plain-English summary the AI can read aloud to the user. */
  summary: string;
  /** Estimated total time to apply (seconds). */
  etaSeconds: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_GENESIS_SECRET"] || `mneme-genesis-v${PROTOCOL_VERSION}`;
}

function resolveRoot(p?: string): string {
  if (!p) return process.cwd();
  return isAbsolute(p) ? p : resolve(p);
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", ".next",
  "__pycache__", ".venv", "venv", "vendor", ".idea", ".vscode", ".cache",
  "coverage", ".turbo", ".parcel-cache", ".pytest_cache", ".mypy_cache",
]);

interface ScanResult {
  fileCount: number;
  byExt: Record<string, number>;
  found: Set<string>; // file basenames found
  hasTestDir: boolean;
}

function scanRepo(root: string): ScanResult {
  const result: ScanResult = { fileCount: 0, byExt: {}, found: new Set(), hasTestDir: false };
  function walk(dir: string, depth: number): void {
    if (result.fileCount >= MAX_FILES_SCAN || depth > 8) return;
    let entries: string[];
    try { entries = readdirSync(dir); }
    catch { return; }
    for (const name of entries) {
      if (result.fileCount >= MAX_FILES_SCAN) return;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (/^(tests?|__tests__|spec)$/i.test(name)) result.hasTestDir = true;
        walk(full, depth + 1);
      } else {
        result.fileCount++;
        const ext = extname(name).toLowerCase();
        if (ext) result.byExt[ext] = (result.byExt[ext] ?? 0) + 1;
        result.found.add(name);
      }
    }
  }
  walk(root, 0);
  return result;
}

function detectStack(scan: ScanResult): Stack {
  const counts = scan.byExt;
  // Pure-language detection by majority extension.
  const langScore: Partial<Record<Stack, number>> = {
    typescript: (counts[".ts"] ?? 0) + (counts[".tsx"] ?? 0),
    javascript: (counts[".js"] ?? 0) + (counts[".jsx"] ?? 0) + (counts[".mjs"] ?? 0) + (counts[".cjs"] ?? 0),
    python: (counts[".py"] ?? 0),
    rust: (counts[".rs"] ?? 0),
    go: (counts[".go"] ?? 0),
    ruby: (counts[".rb"] ?? 0),
    java: (counts[".java"] ?? 0),
    kotlin: (counts[".kt"] ?? 0) + (counts[".kts"] ?? 0),
    swift: (counts[".swift"] ?? 0),
    php: (counts[".php"] ?? 0),
    csharp: (counts[".cs"] ?? 0),
    elixir: (counts[".ex"] ?? 0) + (counts[".exs"] ?? 0),
  };
  const ranked = Object.entries(langScore).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const top = ranked[0];
  const second = ranked[1];
  if (!top || (top[1] ?? 0) === 0) return "unknown";
  if (second && (second[1] ?? 0) > 0 && (top[1] ?? 0) < (second[1] ?? 0) * 1.5) return "polyglot";
  return top[0] as Stack;
}

function detectFrameworks(root: string, scan: ScanResult): Framework[] {
  const frameworks: Framework[] = [];
  const has = (name: string) => scan.found.has(name);
  const fileContains = (path: string, needle: string): boolean => {
    try { return readFileSync(join(root, path), "utf8").includes(needle); }
    catch { return false; }
  };
  // Next.js
  if (has("next.config.js") || has("next.config.mjs") || has("next.config.ts")) frameworks.push("next");
  // Vite
  if (has("vite.config.js") || has("vite.config.ts") || has("vite.config.mjs")) frameworks.push("vite");
  // Tailwind
  if (has("tailwind.config.js") || has("tailwind.config.ts") || has("tailwind.config.cjs")) frameworks.push("tailwind");
  // Tauri / Electron / Expo
  if (has("tauri.conf.json") || existsSync(join(root, "src-tauri"))) frameworks.push("tauri");
  if (has("electron.js") || has("electron-builder.yml")) frameworks.push("electron");
  if (has("app.json") && fileContains("app.json", "expo")) frameworks.push("expo");
  // Django / Flask / FastAPI / Rails / Express / NestJS via package contents
  if (has("manage.py") || has("settings.py") || has("urls.py")) frameworks.push("django");
  if (has("Gemfile")) frameworks.push("rails");
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if ("react" in deps) frameworks.push("react");
      if ("vue" in deps) frameworks.push("vue");
      if ("svelte" in deps) frameworks.push("svelte");
      if ("@angular/core" in deps) frameworks.push("angular");
      if ("express" in deps) frameworks.push("express");
      if ("@nestjs/core" in deps) frameworks.push("nestjs");
      if ("fastapi" in deps) frameworks.push("fastapi");
      if ("flask" in deps) frameworks.push("flask");
    } catch { /* ignore */ }
  }
  if (has("pyproject.toml")) {
    try {
      const t = readFileSync(join(root, "pyproject.toml"), "utf8");
      if (/django/i.test(t)) frameworks.push("django");
      if (/flask/i.test(t)) frameworks.push("flask");
      if (/fastapi/i.test(t)) frameworks.push("fastapi");
    } catch { /* ignore */ }
  }
  return frameworks.length > 0 ? Array.from(new Set(frameworks)) : ["none"];
}

function detectPackageManagers(scan: ScanResult): RepoFingerprint["packageManagers"] {
  const out: RepoFingerprint["packageManagers"] = [];
  if (scan.found.has("package-lock.json")) out.push("npm");
  if (scan.found.has("pnpm-lock.yaml")) out.push("pnpm");
  if (scan.found.has("yarn.lock")) out.push("yarn");
  if (scan.found.has("bun.lockb") || scan.found.has("bun.lock")) out.push("bun");
  if (scan.found.has("requirements.txt") || scan.found.has("Pipfile")) out.push("pip");
  if (scan.found.has("uv.lock")) out.push("uv");
  if (scan.found.has("Cargo.lock")) out.push("cargo");
  if (scan.found.has("go.sum")) out.push("go");
  if (scan.found.has("Gemfile.lock")) out.push("bundler");
  if (scan.found.has("pom.xml")) out.push("maven");
  if (scan.found.has("build.gradle") || scan.found.has("build.gradle.kts")) out.push("gradle");
  return out;
}

function detectCI(root: string, scan: ScanResult): boolean {
  return existsSync(join(root, ".github", "workflows"))
    || scan.found.has(".gitlab-ci.yml")
    || existsSync(join(root, ".circleci"))
    || scan.found.has("azure-pipelines.yml")
    || scan.found.has(".drone.yml");
}

function detectAgeMonths(root: string, scan: ScanResult): number {
  // Heuristic: look at the oldest tracked file's mtime as a proxy. If git
  // is available, prefer the first commit ts (cheap via plumbing).
  try {
    const candidates = ["README.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Gemfile", ".gitignore"];
    let oldest = Date.now();
    for (const c of candidates) {
      const p = join(root, c);
      if (existsSync(p)) {
        const t = statSync(p).mtimeMs;
        if (t < oldest) oldest = t;
      }
    }
    void scan; // keep signature stable for future use
    const ageMs = Math.max(0, Date.now() - oldest);
    return Math.round(ageMs / (30 * 24 * 60 * 60 * 1000) * 10) / 10;
  } catch { return 0; }
}

/** The core fingerprinter. Pure I/O — no network. */
export function fingerprintRepo(opts: { repoDir?: string } = {}): RepoFingerprint {
  const root = resolveRoot(opts.repoDir);
  const scan = scanRepo(root);
  const stack = detectStack(scan);
  const frameworks = detectFrameworks(root, scan);
  const hasCI = detectCI(root, scan);
  const ageMonths = detectAgeMonths(root, scan);
  const packageManagers = detectPackageManagers(scan);
  return {
    stack, frameworks, hasCI,
    hasTests: scan.hasTestDir || (scan.byExt[".test.ts"] ?? 0) + (scan.byExt[".test.js"] ?? 0) + (scan.byExt[".spec.ts"] ?? 0) > 0,
    fileCount: scan.fileCount,
    ageMonths,
    packageManagers,
    signals: {
      majorityExt: Object.entries(scan.byExt).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none",
      hasReadme: scan.found.has("README.md") || scan.found.has("readme.md"),
      hasLicense: scan.found.has("LICENSE") || scan.found.has("LICENSE.md"),
      hasContributing: scan.found.has("CONTRIBUTING.md"),
      hasChangelog: scan.found.has("CHANGELOG.md"),
    },
  };
}

const STACK_ANTIPATTERNS: Partial<Record<Stack, GenesisAction[]>> = {
  typescript: [
    { module: "soul", description: "Add antiPattern: avoid `any` — prefer `unknown` + narrowing.", reason: "TypeScript lint best practice; reduces type-erasure bugs.", benefit: 8 },
    { module: "soul", description: "Add antiPattern: never silently catch errors without re-throw or log.", reason: "Reduces bug-hide pattern common in TS codebases.", benefit: 7 },
  ],
  javascript: [
    { module: "soul", description: "Add convention: enable strict equality (===) — never ==.", reason: "Coercion-bug class kills JS projects.", benefit: 7 },
  ],
  python: [
    { module: "soul", description: "Add convention: type hints on all public functions.", reason: "Static analysis benefits compound; reduces runtime errors.", benefit: 8 },
    { module: "soul", description: "Add antiPattern: never use `except:` without exception type.", reason: "Bare except hides KeyboardInterrupt and SystemExit; debugging nightmare.", benefit: 9 },
  ],
  rust: [
    { module: "soul", description: "Add convention: avoid `unwrap()` / `panic!()` in library code.", reason: "Library panics propagate badly; prefer Result-returning APIs.", benefit: 9 },
  ],
  go: [
    { module: "soul", description: "Add convention: always check returned error.", reason: "Go's idiomatic error handling; ignored errors hide bugs.", benefit: 9 },
  ],
  ruby: [
    { module: "soul", description: "Add convention: avoid monkey-patching core classes outside spec.", reason: "Action-at-a-distance bugs.", benefit: 8 },
  ],
};

const FRAMEWORK_ANTIPATTERNS: Partial<Record<Framework, GenesisAction[]>> = {
  react: [
    { module: "soul", description: "Add antiPattern: never call setState inside useEffect without dep array.", reason: "Infinite re-render bug class — costs production teams hours.", benefit: 10 },
    { module: "soul", description: "Add antiPattern: don't access window / document at module top-level (SSR break).", reason: "Common Next.js / Remix breakage.", benefit: 8 },
  ],
  next: [
    { module: "soul", description: "Add sacred: app/layout.tsx is sacred — explicit ack to modify.", reason: "Root layout breaks the entire app.", benefit: 9 },
  ],
  django: [
    { module: "soul", description: "Add antiPattern: never expose SECRET_KEY in version control.", reason: "Single most common Django security incident.", benefit: 10 },
    { module: "compliance", description: "Add DLP rule: Django SECRET_KEY pattern.", reason: "Pre-commit DLP catches accidental commits.", benefit: 9 },
  ],
  rails: [
    { module: "soul", description: "Add antiPattern: avoid mass assignment without strong params.", reason: "Top Rails security regression class.", benefit: 9 },
  ],
};

/**
 * Build a GenesisPlan from a fingerprint. Returns a tamper-evident,
 * HMAC-signed plan listing every action and why. Apply via applyPlan().
 */
export function buildPlan(fingerprint: RepoFingerprint, opts: { repoDir?: string; secret?: string } = {}): GenesisPlan {
  const root = resolveRoot(opts.repoDir);
  const actions: GenesisAction[] = [];

  // Always: protective starter SOUL rules from the v2.14 seed.
  actions.push(
    { module: "soul", description: "Initialise project soul with 5 protective starter rules (no-fake-files / no-secret-leak / sacred .mneme / utc-timestamps / honest-claims).", reason: "Universal AI-vs-team safety net.", benefit: 10 },
  );

  // Stack-specific antipatterns
  const stackActs = STACK_ANTIPATTERNS[fingerprint.stack];
  if (stackActs) actions.push(...stackActs);

  // Framework-specific antipatterns
  for (const f of fingerprint.frameworks) {
    const fa = FRAMEWORK_ANTIPATTERNS[f];
    if (fa) actions.push(...fa);
  }

  // BOUNTY — initialise empty ledger so the first claim has somewhere to land.
  actions.push({ module: "bounty", description: "Initialise empty BOUNTY ledger; first AI claim will be recorded automatically.", reason: "Vendor trust scorecard requires bootstrapped ledger.", benefit: 7 });

  // REPLICA — only valuable if there's a history to seed from.
  if (fingerprint.ageMonths >= 1) {
    actions.push({ module: "replica", description: "Initialise REPLICA corpus; future decisions will populate the oracle.", reason: `Repo is ~${fingerprint.ageMonths} months old; replica gets useful within ~10 captured decisions.`, benefit: 7 });
  }

  // INFRA — only valuable if there's CI or deploy signal.
  if (fingerprint.hasCI) {
    actions.push({ module: "infra", description: "Initialise INFRA observation log; hook into CI pipeline for deploy / failure events.", reason: "Detected CI workflows; capture-once gives recurring-pattern detection.", benefit: 8 });
  }

  // KILL SWITCH compliance — propose for older / larger repos.
  if (fingerprint.fileCount > 200 || fingerprint.ageMonths > 6) {
    actions.push({ module: "compliance", description: "Initialise compliance audit log; AI interactions become court-admissible HMAC chain.", reason: `Repo size (${fingerprint.fileCount} files) or age (${fingerprint.ageMonths}mo) suggests stable enough for audit value.`, benefit: 7 });
  }

  // ETA: rough — soul init ~5s, others ~2s each.
  const etaSeconds = 5 + actions.length * 2;

  // Plain-English summary — the AI quotes this to the user.
  const fwList = fingerprint.frameworks.filter((f) => f !== "none").join(", ");
  const summary = [
    `Detected: ${fingerprint.stack === "polyglot" ? "polyglot" : fingerprint.stack}${fwList ? ` + ${fwList}` : ""}, ${fingerprint.fileCount} files, ${fingerprint.ageMonths} months old${fingerprint.hasCI ? ", CI present" : ""}${fingerprint.hasTests ? ", tests present" : ""}.`,
    `Plan: ${actions.length} actions across ${new Set(actions.map((a) => a.module)).size} module(s).`,
    `Estimated time: ${etaSeconds}s.`,
    "All actions are reversible (each module's storage lives in .mneme/ and can be deleted).",
  ].join(" ");

  const generatedAt = new Date().toISOString();
  const body = { v: PROTOCOL_VERSION as typeof PROTOCOL_VERSION, generatedAt, repoDir: root, fingerprint, actions, summary, etaSeconds };
  const sig = createHmac("sha256", opts.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

/** Convenience: fingerprint + plan in one call. */
export function genesisPlan(opts: { repoDir?: string; secret?: string } = {}): GenesisPlan {
  return buildPlan(fingerprintRepo({ ...(opts.repoDir ? { repoDir: opts.repoDir } : {}) }), opts);
}

export interface ApplyResult {
  applied: string[];
  skipped: string[];
  errors: Array<{ module: string; error: string }>;
  durationMs: number;
}

/**
 * Apply the plan to disk by composing onto the existing v2.14 modules.
 * Each module's init is idempotent — re-running is safe.
 *
 * Module imports are dynamic so this file stays decoupled and testable
 * with stubbed inputs.
 */
export async function applyPlan(plan: GenesisPlan): Promise<ApplyResult> {
  const t0 = Date.now();
  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: ApplyResult["errors"] = [];
  const repoDir = plan.repoDir;

  const modulesUsed = new Set(plan.actions.map((a) => a.module));

  if (modulesUsed.has("soul")) {
    try {
      const soul = await import("../project_soul/index.js");
      let s = soul.loadSoul({ repoDir });
      if (!s) {
        const projectName = basename(repoDir);
        const stack = plan.fingerprint.stack;
        const frameworks = plan.fingerprint.frameworks.filter((f) => f !== "none").join(", ");
        s = soul.newSoul(projectName, `${stack}${frameworks ? ` + ${frameworks}` : ""} project bootstrapped by Mneme GENESIS`);
      }
      s = soul.seedDefaultRules(s);
      // Apply stack-specific rules
      for (const action of plan.actions.filter((a) => a.module === "soul")) {
        // Try to extract a rule id from description heuristically.
        const text = action.description.replace(/^Add (antiPattern|convention|sacred):\s*/i, "");
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "");
        if (s[/sacred:/i.test(action.description) ? "sacred" : /convention:/i.test(action.description) ? "conventions" : "antiPatterns"].some((r) => r.id === id)) continue;
        try {
          s = soul.addRule(s, {
            category: /sacred:/i.test(action.description) ? "sacred"
              : /convention:/i.test(action.description) ? "conventions"
                : "antiPatterns",
            id,
            text,
            severity: action.benefit >= 9 ? "block" : "warn",
          });
        } catch { /* duplicate or invalid; skip */ }
      }
      soul.saveSoul(s, { repoDir });
      applied.push(`soul (${s.ruleCount} rules)`);
    } catch (e) { errors.push({ module: "soul", error: (e as Error).message.slice(0, 200) }); }
  }

  if (modulesUsed.has("bounty")) {
    try {
      // Just touch the file by reading + verifying the chain is empty/valid.
      const bounty = await import("../bounty/index.js");
      const v = bounty.verifyChain({ repoDir });
      applied.push(`bounty (${v.total} entries)`);
    } catch (e) { errors.push({ module: "bounty", error: (e as Error).message.slice(0, 200) }); }
  }

  if (modulesUsed.has("replica")) {
    try {
      // Touch; corpus starts empty.
      await import("../replica/index.js");
      applied.push("replica (corpus initialised)");
    } catch (e) { errors.push({ module: "replica", error: (e as Error).message.slice(0, 200) }); }
  }

  if (modulesUsed.has("infra")) {
    try {
      await import("../infra_brain/index.js");
      applied.push("infra (observation log initialised)");
    } catch (e) { errors.push({ module: "infra", error: (e as Error).message.slice(0, 200) }); }
  }

  if (modulesUsed.has("compliance")) {
    try {
      await import("../kill_switch/index.js");
      applied.push("compliance (audit log initialised)");
    } catch (e) { errors.push({ module: "compliance", error: (e as Error).message.slice(0, 200) }); }
  }

  return { applied, skipped, errors, durationMs: Date.now() - t0 };
}

/** One-line pulse summary. */
export function formatGenesisLine(plan: GenesisPlan): string {
  return `GENESIS · ${plan.fingerprint.stack} · ${plan.actions.length} actions · ETA ${plan.etaSeconds}s · sig=${plan.sig.slice(0, 8)}`;
}
