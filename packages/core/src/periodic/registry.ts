/**
 * Periodic-table registry — single source of truth for every primitive.
 *
 * This is the runtime equivalent of the chemistry textbook's periodic
 * table poster. Primitives register their manifest at module load; the
 * registry deduplicates, validates, and exposes browsing/lookup APIs to
 * `mneme periodic-table`, the compiler, and MCP tooling.
 */

import {
  type AnyManifest,
  type ElementManifest,
  type AtomManifest,
  type MoleculeManifest,
  type CompoundManifest,
  type Kind,
  validateManifest,
} from "./manifest.js";

class Registry {
  private readonly byId = new Map<string, AnyManifest>();
  private readonly byKind = new Map<Kind, AnyManifest[]>();
  private readonly byTag = new Map<string, AnyManifest[]>();

  register(m: AnyManifest): void {
    const issues = validateManifest(m);
    if (issues.length > 0) {
      throw new Error(`Manifest "${m.id}" invalid: ${issues.join("; ")}`);
    }
    if (this.byId.has(m.id)) {
      // Duplicate id — likely a hot-reload during testing. Silently
      // overwrite rather than throw so vitest's reload loop is happy.
      const old = this.byId.get(m.id)!;
      this.removeFromIndex(old);
    }
    this.byId.set(m.id, m);
    let kindBucket = this.byKind.get(m.kind);
    if (!kindBucket) {
      kindBucket = [];
      this.byKind.set(m.kind, kindBucket);
    }
    kindBucket.push(m);
    for (const tag of m.tags) {
      let tagBucket = this.byTag.get(tag);
      if (!tagBucket) {
        tagBucket = [];
        this.byTag.set(tag, tagBucket);
      }
      tagBucket.push(m);
    }
  }

  private removeFromIndex(m: AnyManifest): void {
    const kindBucket = this.byKind.get(m.kind);
    if (kindBucket) {
      const i = kindBucket.indexOf(m);
      if (i >= 0) kindBucket.splice(i, 1);
    }
    for (const tag of m.tags) {
      const tagBucket = this.byTag.get(tag);
      if (tagBucket) {
        const i = tagBucket.indexOf(m);
        if (i >= 0) tagBucket.splice(i, 1);
      }
    }
  }

  /** Look up by exact id (e.g. "git.log"). */
  get(id: string): AnyManifest | undefined {
    return this.byId.get(id);
  }

  /** All manifests across every kind. */
  all(): AnyManifest[] {
    return Array.from(this.byId.values());
  }

  elements(): ElementManifest[] {
    return (this.byKind.get("element") ?? []) as ElementManifest[];
  }
  atoms(): AtomManifest[] {
    return (this.byKind.get("atom") ?? []) as AtomManifest[];
  }
  molecules(): MoleculeManifest[] {
    return (this.byKind.get("molecule") ?? []) as MoleculeManifest[];
  }
  compounds(): CompoundManifest[] {
    return (this.byKind.get("compound") ?? []) as CompoundManifest[];
  }

  /** All manifests bearing ANY of these tags. */
  byTags(tags: string[]): AnyManifest[] {
    const out = new Set<AnyManifest>();
    for (const t of tags) {
      for (const m of this.byTag.get(t) ?? []) out.add(m);
    }
    return Array.from(out);
  }

  /** Validate the whole registry — used by the integration test that
   *  ensures every registered primitive has a sane manifest AND every
   *  cross-reference (atom.element, molecule.composes) resolves. */
  validateAll(): { ok: boolean; issues: string[] } {
    const issues: string[] = [];
    for (const m of this.byId.values()) {
      const localIssues = validateManifest(m);
      for (const i of localIssues) issues.push(`${m.id}: ${i}`);
      if (m.kind === "atom") {
        const a = m as AtomManifest;
        if (!this.byId.has(a.element)) {
          issues.push(`${m.id}: references unknown element "${a.element}"`);
        } else if (this.byId.get(a.element)!.kind !== "element") {
          issues.push(`${m.id}: parent "${a.element}" must be an element`);
        }
      }
      if (m.kind === "molecule" || m.kind === "compound") {
        const x = m as MoleculeManifest | CompoundManifest;
        for (const ref of x.composes) {
          if (!this.byId.has(ref)) {
            issues.push(`${m.id}: composes unknown primitive "${ref}"`);
          }
        }
      }
    }
    return { ok: issues.length === 0, issues };
  }

  /** Reset state — for tests. */
  clear(): void {
    this.byId.clear();
    this.byKind.clear();
    this.byTag.clear();
  }
}

/** Process-singleton registry. Primitives register against this at
 *  module load; consumers read from it. */
export const registry = new Registry();

export { Registry };

/** Convenience helper: register a manifest, return it for chaining. */
export function declare<T extends AnyManifest>(m: T): T {
  registry.register(m);
  return m;
}
