/**
 * Environment probes — detect Ollama, OpenAI, and machine specs to make
 * `mneme init` actually helpful instead of just writing a config file.
 *
 * The recommendation engine answers the single most common new-user question:
 *
 *   "Do I need to install Ollama? My laptop has no GPU."
 *
 * Honest answer: no. Mneme works on every machine with three fallbacks.
 * The probe figures out which fallback is best for THIS user and tells them.
 */

import { totalmem, cpus, platform, arch } from "node:os";

export interface OllamaProbe {
  reachable: boolean;
  baseUrl: string;
  /** Names of pulled models, if reachable. */
  models?: string[];
  /** Is the recommended embedding model already pulled? */
  hasEmbedModel?: boolean;
  error?: string;
}

export interface OpenAIProbe {
  hasKey: boolean;
  /** Last 4 chars of the key for confirmation, never the full key. */
  keyTail?: string;
}

export interface HardwareProbe {
  platform: string;
  arch: string;
  ramGB: number;
  cpuCount: number;
  /** "weak" (< 4GB RAM), "modest" (4-8GB), "good" (8-16GB), "strong" (≥ 16GB) */
  tier: "weak" | "modest" | "good" | "strong";
}

export interface EmbedderRecommendation {
  /** The chosen path. */
  pick: "ollama" | "openai" | "bundled" | "hash";
  /** Short, plain-language reason ("you have Ollama running with nomic-embed-text"). */
  reason: string;
  /** What the user should run next, if anything. */
  action?: string;
  /** Quality tier (★★ to ★★★★★). */
  qualityStars: 2 | 3 | 4 | 5;
}

// 127.0.0.1 (NOT localhost) — Node 18+/undici prefers IPv6 (::1) which
// Ollama doesn't listen on by default. Causes silent fetch failures on Windows.
const OLLAMA_DEFAULT = "http://127.0.0.1:11434";
const RECOMMENDED_EMBED_MODEL = "nomic-embed-text";

export async function probeOllama(baseUrl: string = OLLAMA_DEFAULT): Promise<OllamaProbe> {
  // Auto-rewrite localhost → 127.0.0.1 if the caller passes their own URL.
  const url = baseUrl.replace(/^http:\/\/localhost(:|$|\/)/i, "http://127.0.0.1$1");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${url}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { reachable: false, baseUrl: url, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    const hasEmbedModel = models.some((n) => n.startsWith(RECOMMENDED_EMBED_MODEL));
    return { reachable: true, baseUrl: url, models, hasEmbedModel };
  } catch (err) {
    return {
      reachable: false,
      baseUrl: url,
      error: (err as Error).message ?? "unknown error",
    };
  }
}

export function probeOpenAI(): OpenAIProbe {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.length < 8) return { hasKey: false };
  return { hasKey: true, keyTail: key.slice(-4) };
}

export function probeHardware(): HardwareProbe {
  const ramGB = Math.round(totalmem() / 1024 ** 3);
  const cpuCount = cpus().length;
  const tier: HardwareProbe["tier"] =
    ramGB < 4 ? "weak" : ramGB < 8 ? "modest" : ramGB < 16 ? "good" : "strong";
  return { platform: platform(), arch: arch(), ramGB, cpuCount, tier };
}

/**
 * Choose the best embedder for THIS user — the heart of the "smart" init.
 * Pure function over probe results, easy to test.
 */
export function recommendEmbedder(
  ollama: OllamaProbe,
  openai: OpenAIProbe,
  hw: HardwareProbe,
): EmbedderRecommendation {
  // 1. Ollama with the embedding model already pulled — best out-of-box path.
  if (ollama.reachable && ollama.hasEmbedModel) {
    return {
      pick: "ollama",
      reason: `Ollama is running and ${RECOMMENDED_EMBED_MODEL} is pulled — local, free, high quality.`,
      qualityStars: 4,
    };
  }

  // 2. Ollama running but model not pulled — easy fix.
  if (ollama.reachable && !ollama.hasEmbedModel) {
    return {
      pick: "ollama",
      reason: "Ollama is running but the embedding model is not pulled.",
      action: `ollama pull ${RECOMMENDED_EMBED_MODEL}`,
      qualityStars: 4,
    };
  }

  // 3. OpenAI key — paid but no install needed.
  if (openai.hasKey) {
    return {
      pick: "openai",
      reason: `OPENAI_API_KEY detected (…${openai.keyTail}). Best quality, ~$0.05 to index 5k commits.`,
      qualityStars: 5,
    };
  }

  // 4. Bundled WASM model — ZERO setup. Auto-downloads ~25MB on first index.
  //    This is THE happy-path for someone who just ran `npm i -g mneme-ai`.
  //    Quality is ★★★ (real semantic embeddings), better than hash, slightly
  //    less than nomic-embed-text but more than enough for 95% of queries.
  if (hw.tier === "good" || hw.tier === "strong") {
    return {
      pick: "bundled",
      reason: `No setup needed — Mneme will use a built-in WASM model (~25MB, downloads on first index). For ★★★★ quality, install Ollama (optional).`,
      qualityStars: 3,
    };
  }

  // 5. Weak hardware (<4GB RAM) — bundled WASM might be too heavy.
  //    Bundled still works but hash is safer; recommend hash with
  //    upgrade hint.
  return {
    pick: "bundled",
    reason: `Hardware is modest. Bundled WASM model still works on every machine — it just runs slower. Hash fallback (★★) is also available via --embedder hash.`,
    qualityStars: 3,
  };
}

export interface ProbeReport {
  ollama: OllamaProbe;
  openai: OpenAIProbe;
  hardware: HardwareProbe;
  recommendation: EmbedderRecommendation;
}

export async function runFullProbe(baseUrl?: string): Promise<ProbeReport> {
  const [ollama, openai, hardware] = [
    await probeOllama(baseUrl),
    probeOpenAI(),
    probeHardware(),
  ];
  const recommendation = recommendEmbedder(ollama, openai, hardware);
  return { ollama, openai, hardware, recommendation };
}
