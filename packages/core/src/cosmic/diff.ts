/**
 * v2.13.0 — Minimal JSON Patch (RFC 6902 subset) for cosmic incremental
 * publishes.
 *
 * Why not pull a dep? Cosmic state is small (typically < 4KB), the patch
 * shape is bounded (publishes are version + commit + timestamp updates),
 * and the cosmic server is single-file zero-deps. A 100-line implementation
 * we control beats a 50KB transitive tree we don't.
 *
 * Supported ops: add / replace / remove. Move/copy/test omitted as they
 * don't appear in any cosmic state-update pattern.
 *
 * Path encoding follows RFC 6901 (JSON Pointer): "/a/b" → state.a.b.
 * "/" is the root. ~0 escapes ~, ~1 escapes /.
 */

export interface JsonPatchOp {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

type JsonValue = unknown;
type JsonRecord = Record<string, JsonValue>;

function isObject(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function escapePart(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapePart(s: string): string {
  return s.replace(/~1/g, "/").replace(/~0/g, "~");
}

function pointerToParts(ptr: string): string[] {
  if (ptr === "" || ptr === "/") return [];
  return ptr.split("/").slice(1).map(unescapePart);
}

/**
 * Diff two JSON values; returns a list of patch ops that, applied to `before`,
 * produce `after`. Optimised for cosmic state shape (objects of scalars +
 * small arrays). Arrays are handled by full-replace when they differ — a
 * cosmic publish never makes large array edits, so structural array diffing
 * isn't worth the byte cost.
 */
export function makePatch(before: JsonValue, after: JsonValue, prefix = ""): JsonPatchOp[] {
  // Same reference / primitive equal — no-op.
  if (before === after) return [];
  if (typeof before !== typeof after || Array.isArray(before) !== Array.isArray(after) || (before === null) !== (after === null)) {
    return [{ op: "replace", path: prefix || "/", value: after }];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    // Compare structurally; if arrays match shallowly, no op. Otherwise replace.
    if (before.length === after.length && before.every((v, i) => deepEqual(v, after[i]))) return [];
    return [{ op: "replace", path: prefix || "/", value: after }];
  }
  if (isObject(before) && isObject(after)) {
    const ops: JsonPatchOp[] = [];
    // Removals first — keys present in before but not after.
    for (const k of Object.keys(before)) {
      if (!(k in after)) ops.push({ op: "remove", path: `${prefix}/${escapePart(k)}` });
    }
    // Additions / replacements.
    for (const k of Object.keys(after)) {
      const path = `${prefix}/${escapePart(k)}`;
      if (!(k in before)) ops.push({ op: "add", path, value: after[k] });
      else if (!deepEqual(before[k], after[k])) {
        // Recurse so we get fine-grained patches inside nested objects.
        ops.push(...makePatch(before[k], after[k], path));
      }
    }
    return ops;
  }
  // Both are scalars and differ.
  return [{ op: "replace", path: prefix || "/", value: after }];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** Apply a patch list to a deep copy of `state` and return the new value. */
export function applyPatch(state: JsonValue, ops: JsonPatchOp[]): JsonValue {
  let cur: JsonValue = JSON.parse(JSON.stringify(state ?? null));
  for (const op of ops) {
    cur = applyOne(cur, op);
  }
  return cur;
}

function applyOne(state: JsonValue, op: JsonPatchOp): JsonValue {
  const parts = pointerToParts(op.path);
  if (parts.length === 0) {
    // Operating on root.
    if (op.op === "remove") return null;
    return op.value ?? null;
  }
  const last = parts[parts.length - 1]!;
  let cur: JsonValue = state;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (!isObject(cur) && !Array.isArray(cur)) throw new Error(`patch path traverses non-object at ${parts.slice(0, i + 1).join("/")}`);
    cur = (cur as JsonRecord)[k];
    if (cur === undefined) throw new Error(`patch path missing at ${parts.slice(0, i + 1).join("/")}`);
  }
  if (!isObject(cur) && !Array.isArray(cur)) throw new Error(`patch parent not container for ${op.path}`);
  if (op.op === "remove") {
    if (Array.isArray(cur)) cur.splice(parseInt(last, 10), 1);
    else delete (cur as JsonRecord)[last];
  } else {
    if (Array.isArray(cur)) cur[parseInt(last, 10)] = op.value;
    else (cur as JsonRecord)[last] = op.value;
  }
  return state;
}

/**
 * Decide whether a patch is "worth shipping" vs sending the full state.
 * For cosmic, shipping the patch is only smarter than the full state when
 * the patch is materially smaller. We require at least 30% reduction OR
 * a 200-byte savings — below that, the round-trip risk (server applies
 * patch wrong, drift) outweighs the byte win.
 */
export function patchIsWorthIt(beforeBytes: number, patchBytes: number): boolean {
  const saving = beforeBytes - patchBytes;
  if (saving <= 0) return false;
  const ratio = saving / beforeBytes;
  return ratio >= 0.3 || saving >= 200;
}
