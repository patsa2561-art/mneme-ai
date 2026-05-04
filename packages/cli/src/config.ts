import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { configPath, mnemeDir } from "./paths.js";

export interface MnemeConfig {
  schemaVersion: number;
  embeddings: {
    provider: "auto" | "ollama" | "openai" | "hash";
    model?: string;
    baseUrl?: string;
  };
  index: {
    since?: string;
    maxCount?: number;
  };
  incidents?: {
    sentry?: { orgSlug: string; projectId: string };
    datadog?: { site: string };
  };
  webPort?: number;
}

export const DEFAULT_CONFIG: MnemeConfig = {
  schemaVersion: 1,
  embeddings: { provider: "auto" },
  index: { maxCount: 5000 },
  webPort: 4711,
};

export function readConfig(repoRoot: string): MnemeConfig {
  const path = configPath(repoRoot);
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    const raw = readFileSync(path, "utf8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeConfig(repoRoot: string, cfg: MnemeConfig): void {
  const path = configPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(mnemeDir(repoRoot), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), "utf8");
}
