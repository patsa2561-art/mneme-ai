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
  pick: "ollama" | "openai" | "hash";
  /** Short, plain-language reason ("you have Ollama running with nomic-embed-text"). */
  reason: string;
  /** What the user should run next, if anything. */
  action?: string;
  /** Quality tier (★★ to ★★★★★). */
  qualityStars: 2 | 3 | 4 | 5;
}

const OLLAMA_DEFAULT = "http://localhost:11434";
const RECOMMENDED_EMBED_MODEL = "nomic-embed-text";

export async function probeOllama(baseUrl: string = OLLAMA_DEFAULT): Promise<OllamaProbe> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { reachable: false, baseUrl, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    const hasEmbedModel = models.some((n) => n.startsWith(RECOMMENDED_EMBED_MODEL));
    return { reachable: true, baseUrl, models, hasEmbedModel };
  } catch (err) {
    return {
      reachable: false,
      baseUrl,
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

  // 4. No Ollama, no OpenAI key, but capable hardware → recommend Ollama install.
  if (hw.tier === "good" || hw.tier === "strong") {
    return {
      pick: "hash",
      reason: `No embedder configured. Hash fallback works (★★ quality). For ★★★★, install Ollama.`,
      action: `https://ollama.com  →  ollama pull ${RECOMMENDED_EMBED_MODEL}`,
      qualityStars: 2,
    };
  }

  // 5. Weak/modest hardware → hash is genuinely the right call.
  return {
    pick: "hash",
    reason: `Hash fallback — works on every machine, no install, deterministic. Quality is ★★ but the tool is genuinely useful.`,
    qualityStars: 2,
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
