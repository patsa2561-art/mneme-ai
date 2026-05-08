/**
 * G4 — CRISPR (precise tool surgery).
 *
 * Like CRISPR-Cas9 in biology: target a specific DNA sequence, cut it,
 * insert a replacement. We apply this to MCP packs:
 *
 *   • Target — a regex/predicate identifying a section of pack YAML
 *   • Cut    — remove that section (validated)
 *   • Insert — substitute new content
 *   • Verify — re-validate the resulting pack against the schema
 *
 * The diff is cryptographic (SHA-256 before/after) and audit-logged.
 * Failed validation = NO change applied (fail closed).
 *
 * Pure functions over Pack objects. Caller writes the result back to disk.
 */

import { createHash } from "node:crypto";
import { validatePack, type Pack, type ToolDefinition } from "../dynamic/pack-schema.js";

export type CrisprTargetKind =
  | "tool-by-id"
  | "tool-by-pattern"
  | "detection-pattern";

export type CrisprOpKind = "delete" | "replace-tool" | "add-tool" | "patch-detection";

export interface CrisprEdit {
  target: {
    kind: CrisprTargetKind;
    /** For "tool-by-id": the tool id. For "tool-by-pattern": regex. */
    selector: string;
  };
  op: CrisprOpKind;
  /** Payload for replace-tool / add-tool. */
  newTool?: ToolDefinition;
  /** Payload for patch-detection. */
  detectionPatch?: Partial<Pack["detection"]>;
}

export interface CrisprResult {
  ok: boolean;
  /** SHA-256 of the pack before edit. */
  beforeHash: string;
  /** SHA-256 of the pack after edit (if ok). */
  afterHash?: string;
  /** Edit that was applied. */
  edit: CrisprEdit;
  /** Human description of the change. */
  summary: string;
  /** When ok=false: structured error reason. */
  error?: { reason: string; details?: unknown };
  /** When ok=true: the edited pack (caller writes back). */
  newPack?: Pack;
}

function hashPack(p: Pack): string {
  return createHash("sha256").update(JSON.stringify(p)).digest("hex");
}

/**
 * Apply a CRISPR edit to a pack. Pure function — input pack unchanged.
 * Returns the edited pack OR a structured error.
 */
export function crisprEdit(pack: Pack, edit: CrisprEdit): CrisprResult {
  const beforeHash = hashPack(pack);
  let modified: Pack;

  try {
    modified = applyEdit(pack, edit);
  } catch (err) {
    return {
      ok: false,
      beforeHash,
      edit,
      summary: "edit could not be applied",
      error: { reason: "apply-error", details: (err as Error).message },
    };
  }

  // Re-validate against schema. Fail closed.
  const validated = validatePack(modified);
  if (!validated.ok) {
    return {
      ok: false,
      beforeHash,
      edit,
      summary: "post-edit pack failed schema validation — change rejected",
      error: { reason: "schema-validation", details: validated.errors },
    };
  }

  const afterHash = hashPack(validated.pack);
  return {
    ok: true,
    beforeHash,
    afterHash,
    edit,
    summary: describeEdit(edit, modified),
    newPack: validated.pack,
  };
}

function applyEdit(pack: Pack, edit: CrisprEdit): Pack {
  // Deep clone to avoid mutating input
  const clone: Pack = JSON.parse(JSON.stringify(pack)) as Pack;

  if (edit.op === "delete") {
    if (edit.target.kind === "tool-by-id") {
      clone.tools = clone.tools.filter((t) => t.id !== edit.target.selector);
    } else if (edit.target.kind === "tool-by-pattern") {
      const re = new RegExp(edit.target.selector);
      clone.tools = clone.tools.filter((t) => !re.test(t.id));
    } else {
      throw new Error("delete: unsupported target kind");
    }
    return clone;
  }

  if (edit.op === "replace-tool") {
    if (!edit.newTool) throw new Error("replace-tool: newTool is required");
    if (edit.target.kind !== "tool-by-id") throw new Error("replace-tool requires target.kind = tool-by-id");
    const idx = clone.tools.findIndex((t) => t.id === edit.target.selector);
    if (idx === -1) throw new Error(`replace-tool: no tool with id '${edit.target.selector}'`);
    clone.tools[idx] = edit.newTool;
    return clone;
  }

  if (edit.op === "add-tool") {
    if (!edit.newTool) throw new Error("add-tool: newTool is required");
    if (clone.tools.some((t) => t.id === edit.newTool!.id)) {
      throw new Error(`add-tool: tool id '${edit.newTool.id}' already exists`);
    }
    clone.tools = [...clone.tools, edit.newTool];
    return clone;
  }

  if (edit.op === "patch-detection") {
    if (!edit.detectionPatch) throw new Error("patch-detection: detectionPatch is required");
    clone.detection = { ...clone.detection, ...edit.detectionPatch };
    return clone;
  }

  throw new Error(`unknown op: ${(edit as { op: string }).op}`);
}

function describeEdit(edit: CrisprEdit, _pack: Pack): string {
  switch (edit.op) {
    case "delete":
      return `Deleted tool(s) matching '${edit.target.selector}' (${edit.target.kind})`;
    case "replace-tool":
      return `Replaced tool '${edit.target.selector}' with new definition`;
    case "add-tool":
      return `Added new tool '${edit.newTool?.id}'`;
    case "patch-detection":
      return `Patched detection with: ${Object.keys(edit.detectionPatch ?? {}).join(", ")}`;
  }
}

/** Apply multiple edits sequentially. Stops at first failure. */
export function crisprEditChain(pack: Pack, edits: CrisprEdit[]): CrisprResult[] {
  const results: CrisprResult[] = [];
  let current = pack;
  for (const e of edits) {
    const r = crisprEdit(current, e);
    results.push(r);
    if (!r.ok) break;
    current = r.newPack!;
  }
  return results;
}
