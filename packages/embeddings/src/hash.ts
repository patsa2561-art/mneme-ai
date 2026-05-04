import type { EmbeddingProvider } from "@mneme-ai/core";

/**
 * Deterministic hashing-trick embedder. Zero dependencies, zero infrastructure.
 * Useful for: testing, CI, "I just want to try mneme right now without installing Ollama".
 *
 * Quality is much lower than nomic-embed, but the architecture downstream is identical
 * so users can upgrade by changing one line.
 */
export class HashEmbedder implements EmbeddingProvider {
  readonly name = "hash:fnv-256";
  readonly dimensions: number;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions);
    const tokens = tokenize(text);
    for (const tok of tokens) {
      const h1 = fnv1a(tok) % this.dimensions;
      const h2 = fnv1a(`#${tok}`) % this.dimensions;
      vec[h1]! += 1;
      vec[h2]! += 0.5;
    }
    let n = 0;
    for (let i = 0; i < vec.length; i++) n += vec[i]! * vec[i]!;
    const norm = Math.sqrt(n) || 1;
    for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
    return vec;
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
