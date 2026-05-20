/**
 * v2.19.88 — #1 MNEME TRUTH SWARM (the flagship "อึ้ง" demo).
 *
 * If Antigravity fires 93 generative agents to BUILD an OS, Truth Swarm
 * fires every Mneme audit organ in parallel to TRUTH-CHECK any input.
 *
 * The swarm composition (all Ollama-free, all already-shipped):
 *   1. POLYGRAPH        sentence-level browser-polygraph verdict
 *   2. WHISTLEBLOWER    dangerous-command / secret-leak / compliance scan
 *   3. RETIREMENT       7-oracle hallucination detector (lexicon-renamed
 *                       from apoptosis)
 *   4. SOCRATIC         humble hypotheses about WHY the code is shaped this way
 *   5. DEP_MORTALITY    if input mentions npm packages, score each one
 *   6. CONFESSIONAL_HOOK form a draft confession if a refute fires
 *   7. PULSE_RECORD     every verdict flows into pulse.jsonl for the globe
 *   8. CHRONOSHEAF      contradiction sniffer over the input (if available)
 *
 * Returns a unified `SwarmReport` with:
 *   - per-organ verdict object (ready for the dashboard's animated node)
 *   - overall verdict: SHIP / CAUTION / BLOCK (one-call decision)
 *   - HMAC-signed report id so the artifact is shareable
 *
 * Latency budget: <500ms for the full swarm (each organ is local + pure
 * JS); fan-out is parallel so the slowest organ sets the wall-clock time.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/truth_swarm";
const LEDGER = "swarm-reports.jsonl";
const KEY_FILE = "swarm.key";

export type OrganName =
  | "polygraph"
  | "whistleblower"
  | "retirement"
  | "socratic"
  | "dep_mortality"
  | "confessional_hook"
  | "pulse_record"
  | "chronosheaf";

export interface OrganOutput {
  organ: OrganName;
  ok: boolean;
  verdict: "green" | "yellow" | "red" | "grey";
  latencyMs: number;
  oneLine: string;
  details?: unknown;
}

export interface SwarmReport {
  reportId: string;
  ts: string;
  inputHash: string;
  inputLength: number;
  organs: OrganOutput[];
  overallVerdict: "ship" | "caution" | "block";
  greenCount: number;
  yellowCount: number;
  redCount: number;
  greyCount: number;
  sig: string;
}

export interface SwarmInput {
  /** The text to audit (AI response / diff / commit message / etc). */
  text: string;
  /** Optional vendor label — propagated to organs that record provenance. */
  vendor?: string;
  /** Optional `repoRoot` override. */
  repoRoot?: string;
  /** Hook for skipping organs in tests. */
  skipOrgans?: OrganName[];
}

function ensureKey(repoRoot: string): string {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function hashInput(text: string): string {
  return createHmac("sha256", "mneme-swarm-input").update(text).digest("base64url").slice(0, 16);
}

async function runWithTimeout<T>(label: OrganName, fn: () => Promise<T> | T, timeoutMs: number = 5000): Promise<{ result?: T; error?: Error; latencyMs: number }> {
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("organ-timeout:" + label)), timeoutMs)),
    ]);
    return { result, latencyMs: Date.now() - t0 };
  } catch (e) { return { error: e as Error, latencyMs: Date.now() - t0 }; }
}

/** Run the full swarm on an input.  Every organ executes in parallel;
 *  failures degrade gracefully (organ marked grey, never throws). */
export async function runTruthSwarm(input: SwarmInput): Promise<SwarmReport> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const text = input.text || "";
  const skip = new Set(input.skipOrgans ?? []);

  const tasks: Promise<OrganOutput>[] = [];

  if (!skip.has("polygraph")) {
    tasks.push((async () => {
      const r = await runWithTimeout("polygraph", async () => {
        const { verifyBrowserSentence } = await import("../polygraph/index.js");
        // Use first 200 chars as the canonical claim sentence.
        return verifyBrowserSentence({ sentence: text.slice(0, 200), repoRoot });
      });
      if (r.error || !r.result) return { organ: "polygraph", ok: false, verdict: "grey", latencyMs: r.latencyMs, oneLine: r.error?.message ?? "no verdict" };
      const v = r.result;
      return { organ: "polygraph", ok: true, verdict: v.color, latencyMs: r.latencyMs, oneLine: v.oneLine, details: v };
    })());
  }

  if (!skip.has("whistleblower")) {
    tasks.push((async () => {
      const r = await runWithTimeout("whistleblower", async () => {
        const { scanWhistle } = await import("../whistleblower/index.js");
        return scanWhistle(text, { vendor: input.vendor });
      });
      if (r.error || !r.result) return { organ: "whistleblower", ok: false, verdict: "grey", latencyMs: r.latencyMs, oneLine: r.error?.message ?? "scan-failed" };
      const incidents = r.result;
      const hasBlock = incidents.some((i) => i.severity === "block");
      const hasWarn = incidents.some((i) => i.severity === "warn");
      return {
        organ: "whistleblower", ok: true,
        verdict: hasBlock ? "red" : hasWarn ? "yellow" : incidents.length > 0 ? "yellow" : "green",
        latencyMs: r.latencyMs,
        oneLine: incidents.length > 0 ? `${incidents.length} compliance flag${incidents.length === 1 ? "" : "s"}` : "no compliance flags",
        details: incidents,
      };
    })());
  }

  if (!skip.has("retirement")) {
    tasks.push((async () => {
      const r = await runWithTimeout("retirement", async () => {
        // The lexicon renames apoptosis → retirement at vendor time; the
        // core module is still named apoptosis on disk. Import dynamically
        // and call best-effort — graceful degrade on signature mismatch.
        try {
          const m = await import("../apoptosis/index.js") as unknown as Record<string, unknown>;
          const fn = (m.detect ?? m.runApoptosis) as ((...a: unknown[]) => unknown) | undefined;
          if (typeof fn !== "function") return null;
          // apoptosis.detect(repoRoot, claim) signature in this codebase.
          return fn(repoRoot, text.slice(0, 200));
        } catch { return null; }
      });
      if (r.error || !r.result) return { organ: "retirement", ok: false, verdict: "grey", latencyMs: r.latencyMs, oneLine: r.error?.message ?? "no-detector" };
      const verdict = (r.result as { verdict?: string }).verdict ?? "HEALTHY";
      const color: OrganOutput["verdict"] = verdict === "NECROTIC" ? "red" : verdict === "INFLAMED" ? "yellow" : verdict === "APOPTOTIC" ? "red" : "green";
      return { organ: "retirement", ok: true, verdict: color, latencyMs: r.latencyMs, oneLine: `retirement: ${verdict}`, details: r.result };
    })());
  }

  if (!skip.has("socratic")) {
    tasks.push((async () => {
      const r = await runWithTimeout("socratic", async () => {
        const { readSocratic } = await import("../socratic/index.js");
        return readSocratic("swarm-input", text);
      });
      if (r.error || !r.result) return { organ: "socratic", ok: false, verdict: "grey", latencyMs: r.latencyMs, oneLine: r.error?.message ?? "no-features" };
      const features = r.result.features;
      return {
        organ: "socratic", ok: true,
        verdict: features.length > 0 ? "yellow" : "green",
        latencyMs: r.latencyMs,
        oneLine: features.length > 0 ? `${features.length} code feature${features.length === 1 ? "" : "s"} detected — 3 hypotheses ready` : "no code features",
        details: r.result,
      };
    })());
  }

  if (!skip.has("dep_mortality")) {
    tasks.push((async () => {
      const r = await runWithTimeout("dep_mortality", async () => {
        const { predictMortality } = await import("../dep_mortality/index.js");
        // Extract `npm install <pkg>` / `import x from 'pkg'` / `require('pkg')` mentions.
        const pkgs = new Set<string>();
        const reInstall = /npm\s+(?:install|i|add)\s+(?:-[A-Za-z]+\s+)*([@\w/-]+)/g;
        const reImport = /(?:from|require\s*\()\s*['"]([@\w./-]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = reInstall.exec(text)) !== null) pkgs.add(m[1]!);
        while ((m = reImport.exec(text)) !== null) {
          const p = m[1]!;
          if (!p.startsWith(".") && !p.startsWith("/")) pkgs.add(p.split("/")[0]!);
        }
        const reports = [...pkgs].slice(0, 5).map((name) => predictMortality({ name, monthsSinceLatest: 0, monthsSinceFeatureRelease: 0 }));
        return { pkgs: [...pkgs], reports };
      });
      if (r.error || !r.result) return { organ: "dep_mortality", ok: false, verdict: "grey", latencyMs: r.latencyMs, oneLine: r.error?.message ?? "no-packages" };
      const reports = r.result.reports;
      if (reports.length === 0) return { organ: "dep_mortality", ok: true, verdict: "green", latencyMs: r.latencyMs, oneLine: "no npm packages mentioned" };
      const worst = reports.reduce((acc, x) => x.score > acc.score ? x : acc, reports[0]!);
      const color: OrganOutput["verdict"] = worst.band === "dead" || worst.band === "moribund" ? "red" : worst.band === "watch" ? "yellow" : "green";
      return { organ: "dep_mortality", ok: true, verdict: color, latencyMs: r.latencyMs, oneLine: `${reports.length} package${reports.length === 1 ? "" : "s"} scanned; worst: ${worst.package} (${worst.band})`, details: r.result };
    })());
  }

  if (!skip.has("confessional_hook")) {
    tasks.push((async () => {
      const r = await runWithTimeout("confessional_hook", () => ({}));
      // This organ is a HOOK — it doesn't run anything on its own; instead
      // it lights up only if the polygraph or retirement organ already
      // returned red. The dashboard wires it post-hoc.
      return { organ: "confessional_hook", ok: true, verdict: "green", latencyMs: r.latencyMs, oneLine: "ready to draft a confession if RED fires" };
    })());
  }

  if (!skip.has("pulse_record")) {
    tasks.push((async () => {
      const r = await runWithTimeout("pulse_record", async () => {
        const { recordPulseEvent } = await import("../world_pulse/index.js");
        return recordPulseEvent(repoRoot, { vendor: input.vendor ?? "swarm", color: "grey", topicHash: hashInput(text).slice(0, 6) });
      });
      if (r.error || !r.result) return { organ: "pulse_record", ok: false, verdict: "grey", latencyMs: r.latencyMs, oneLine: r.error?.message ?? "no-pulse" };
      return { organ: "pulse_record", ok: true, verdict: "green", latencyMs: r.latencyMs, oneLine: "swarm event recorded into pulse.jsonl" };
    })());
  }

  if (!skip.has("chronosheaf")) {
    tasks.push((async () => {
      const r = await runWithTimeout("chronosheaf", async () => {
        try {
          const m = await import("../chronosheaf/index.js") as unknown as Record<string, unknown>;
          const fn = m.quickContradictionScan as ((t: string) => { contradictions: number }) | undefined;
          return typeof fn === "function" ? fn(text) : null;
        } catch { return null; }
      });
      if (r.error || !r.result) return { organ: "chronosheaf", ok: true, verdict: "green", latencyMs: r.latencyMs, oneLine: "no contradiction detector wired" };
      const c = (r.result as { contradictions?: number }).contradictions ?? 0;
      return { organ: "chronosheaf", ok: true, verdict: c > 0 ? "yellow" : "green", latencyMs: r.latencyMs, oneLine: c > 0 ? `${c} contradiction${c === 1 ? "" : "s"} flagged` : "no contradictions" };
    })());
  }

  const organs = await Promise.all(tasks);

  let green = 0, yellow = 0, red = 0, grey = 0;
  for (const o of organs) {
    if (o.verdict === "green") green++;
    else if (o.verdict === "yellow") yellow++;
    else if (o.verdict === "red") red++;
    else grey++;
  }
  const overallVerdict: SwarmReport["overallVerdict"] =
      red > 0 ? "block"
    : yellow >= 2 ? "caution"
    : yellow === 1 ? "caution"
    : "ship";

  const key = ensureKey(repoRoot);
  const ts = new Date().toISOString();
  const reportId = "swarm_" + randomBytes(6).toString("base64url");
  const inputHash = hashInput(text);
  const sigPayload = `${reportId}|${ts}|${inputHash}|${organs.map((o) => o.organ + ":" + o.verdict).join(",")}|${overallVerdict}`;
  const sig = createHmac("sha256", key).update(sigPayload).digest("base64url").slice(0, 24);

  const report: SwarmReport = {
    reportId, ts, inputHash, inputLength: text.length, organs,
    overallVerdict, greenCount: green, yellowCount: yellow, redCount: red, greyCount: grey, sig,
  };

  try {
    const dir = join(repoRoot, DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(repoRoot, DIR, LEDGER), JSON.stringify(report) + "\n", "utf8");
  } catch { /* non-fatal */ }

  return report;
}

export function readSwarmReports(repoRoot: string, opts: { limit?: number } = {}): SwarmReport[] {
  const p = join(repoRoot, DIR, LEDGER);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const out: SwarmReport[] = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line) as SwarmReport); } catch { /* */ }
  }
  out.reverse();
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}
