/**
 * Atrophy Lens — code lenses above each function/class declaration.
 *
 * Headline innovation. For any TS/JS/Python/Go file, we walk the source
 * with a simple multi-language regex, extract function/class declaration
 * lines, and render a code lens above each one summarising team
 * knowledge of THAT FILE (not the symbol — the underlying data is
 * file-grain). The lens reads:
 *
 *   🟢 fresh — last expert touched 6 days ago (98%)
 *   🟡 fading — top knower 41% fresh, last touched 198 days ago — refresh recommended
 *   🔴 ghost — no live expert, deep history lost (4 prior touches)
 *
 * Performance: a per-file LRU of size 32, TTL 60s. Recompute on save
 * only — never on cursor movement.
 *
 * The pure helpers (`parseFunctionDeclarations`, `formatLensTitle`,
 * `LruCache`) are exported so we can unit-test them without booting a
 * vscode instance.
 */

import type { FileKnowledge } from "@mneme-ai/core/public";
import { bandForScore, humanDays, type AtrophyBand } from "../util/iconText.js";

// Avoid hard-importing 'vscode' at module-load — tests run in node-only
// environments and the module is not available there. We require it
// lazily inside the provider class below.
type VsCodeNs = typeof import("vscode");

export interface DeclarationRange {
  /** 0-indexed line where the declaration appears. */
  line: number;
  /** Symbol name (best-effort; may be empty for anonymous symbols). */
  name: string;
  /** "function" / "class" / "method" — informational only. */
  kind: string;
}

/**
 * Cheap multi-language declaration scanner. We deliberately use regex
 * rather than parsing — Atrophy Lens runs on every save and must stay
 * < 5ms even for 5K-line files. The lens is a hint, not a refactor
 * tool, so missed edge-cases are acceptable.
 */
export function parseFunctionDeclarations(
  text: string,
  langId: string,
): DeclarationRange[] {
  const lines = text.split(/\r?\n/);
  const out: DeclarationRange[] = [];
  const lang = (langId || "").toLowerCase();

  // Pre-compile per-language regex set. Each pattern produces ONE match
  // per line — we don't care about column positions.
  const patterns: Array<{ rx: RegExp; kind: string }> = [];

  if (lang === "typescript" || lang === "javascript" || lang === "typescriptreact" || lang === "javascriptreact") {
    patterns.push(
      { rx: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
      { rx: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
      // method-ish: `  foo(arg): Ret {` or `async foo(arg) {`
      { rx: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/, kind: "method" },
      // arrow / const fn: `export const foo = (...) =>`
      { rx: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=].*=>/, kind: "function" },
    );
  } else if (lang === "python") {
    patterns.push(
      { rx: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, kind: "function" },
      { rx: /^\s*class\s+([A-Za-z_][\w]*)/, kind: "class" },
    );
  } else if (lang === "go") {
    patterns.push(
      { rx: /^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)/, kind: "function" },
      { rx: /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/, kind: "class" },
    );
  } else {
    return out;
  }

  const seenLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.length === 0 || line.length > 400) continue;
    for (const { rx, kind } of patterns) {
      const m = line.match(rx);
      if (m && !seenLines.has(i)) {
        seenLines.add(i);
        out.push({ line: i, name: m[1] ?? "", kind });
        break;
      }
    }
  }
  return out;
}

/**
 * Render the lens title from an atrophy result. Plain English, no jargon.
 *
 * Returns one line ≤ ~80 chars suitable for a CodeLens title.
 */
export function formatLensTitle(file: FileKnowledge | null): string {
  if (!file || file.allKnowers.length === 0) {
    return "🔘 Mneme — no commit history for this file yet";
  }

  const top = file.allKnowers[0]!;
  const pct = Math.round(top.knowledge * 100);
  const band: AtrophyBand = bandForScore(top.knowledge);
  const when = humanDays(top.lastTouchDaysAgo);

  if (band === "ghosted") {
    const deep = file.totalTouches >= 2;
    const tail = deep
      ? `deep history lost (${file.totalTouches} prior touches)`
      : `only ${file.totalTouches} prior touch${file.totalTouches === 1 ? "" : "es"}`;
    return `🔴 ghost — no live expert, ${tail}`;
  }
  if (band === "fading") {
    return `🟡 fading — top knower ${pct}% fresh, last touched ${when} — refresh recommended`;
  }
  if (band === "warm") {
    return `🟢 warm — top knower ${pct}% fresh, last touched ${when}`;
  }
  return `🟢 fresh — last expert touched ${when} (${pct}%)`;
}

// ─── LRU cache for atrophy results ────────────────────────────────────

export interface LruEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Tiny insertion-order LRU. Map preserves insertion order in JS so
 * we promote on access by deleting + re-setting.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, LruEntry<V>>();
  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // promote
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ─── The CodeLensProvider ─────────────────────────────────────────────

/**
 * Resolves a relative-to-repo file path. We match what `mneme atrophy
 * --file` does so the same DB row keys.
 */
export function relativeToRepo(repoRoot: string, fileFsPath: string): string {
  const norm = (s: string) => s.replace(/\\/g, "/");
  const root = norm(repoRoot).replace(/\/+$/, "");
  const f = norm(fileFsPath);
  if (f.startsWith(root + "/")) return f.slice(root.length + 1);
  return f;
}

export interface AtrophyLookupFn {
  (relativeFilePath: string): FileKnowledge | null;
}

/** Bridge function so we can mock the lookup in tests. */
export interface AtrophyLensDeps {
  vscode: VsCodeNs;
  /** Returns the current repo root, or null if Mneme isn't indexed. */
  getRepoRoot: () => string | null;
  /** Synchronous lookup — caller is responsible for caching. */
  lookupAtrophy: AtrophyLookupFn;
  /** When false, the provider returns no lenses (used to honour user setting). */
  isEnabled: () => boolean;
}

export function createAtrophyLensProvider(deps: AtrophyLensDeps): {
  provider: import("vscode").CodeLensProvider;
  refresh: () => void;
  cache: LruCache<string, FileKnowledge | null>;
} {
  const { vscode } = deps;
  const cache = new LruCache<string, FileKnowledge | null>(32, 60_000);
  const emitter = new vscode.EventEmitter<void>();

  const provider: import("vscode").CodeLensProvider = {
    onDidChangeCodeLenses: emitter.event,
    provideCodeLenses: (document) => {
      if (!deps.isEnabled()) return [];
      const repoRoot = deps.getRepoRoot();
      if (!repoRoot) return [];
      const rel = relativeToRepo(repoRoot, document.uri.fsPath);
      let result = cache.get(rel);
      if (result === undefined) {
        try {
          result = deps.lookupAtrophy(rel);
        } catch {
          result = null;
        }
        cache.set(rel, result);
      }

      const decls = parseFunctionDeclarations(document.getText(), document.languageId);
      if (decls.length === 0) return [];
      const title = formatLensTitle(result);
      return decls.map((d) => {
        const range = new vscode.Range(
          new vscode.Position(d.line, 0),
          new vscode.Position(d.line, 0),
        );
        return new vscode.CodeLens(range, {
          title,
          command: "mneme.openAtrophyDetail",
          arguments: [document.uri],
        });
      });
    },
  };

  return {
    provider,
    refresh: () => emitter.fire(),
    cache,
  };
}
