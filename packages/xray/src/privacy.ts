/**
 * The privacy moat, made provable. An X-Ray report is safe to ship to a cloud
 * surface ONLY if it carries no raw source. `xrayLeaksRaw` is a structural
 * scanner over the serialized report that flags anything that looks like a
 * code body, a secret value, or a long opaque blob. The gauntlet proves a
 * normal report passes and a tampered one (with source injected) is caught.
 *
 * This is the same discipline as MYCELIUM's `bundleLeaksRaw`: a fail-closed,
 * total function — never throws; treats malformed input as "leaks".
 */
import type { XRayReport } from "./types.js";

export interface LeakVerdict { leaks: boolean; reasons: string[] }

// Things that should NEVER appear in a metric-only report.
const CODE_SHAPES: Array<[RegExp, string]> = [
  [/\bfunction\s+\w+\s*\(/, "function definition"],
  [/=>\s*\{/, "arrow-function body"],
  [/\bclass\s+\w+\s*\{/, "class body"],
  [/\bimport\s+.+\s+from\s+['"]/, "import statement"],
  [/\b(const|let|var)\s+\w+\s*=/, "variable assignment"],
  [/-----BEGIN [A-Z ]+-----/, "PEM block"],
];

/**
 * Field-aware: symbol NAMES and signatures are allowed (they are structural),
 * but they live in known fields. We scan the JSON with those known structural
 * fields stripped, so a signature in `hotspots[].symbol` can't be mistaken for
 * a leak, while an injected code body anywhere else is caught.
 */
export function xrayLeaksRaw(report: unknown): LeakVerdict {
  // fail-closed: a non-report is not safe to emit.
  if (report === null || typeof report !== "object") {
    return { leaks: true, reasons: ["not a report object"] };
  }
  let json: string;
  try {
    const clone = JSON.parse(JSON.stringify(report)) as Record<string, unknown> & Partial<XRayReport>;
    // strip the legitimately-structural string fields before scanning
    if (clone && clone.complexity && Array.isArray(clone.complexity.hotspots)) {
      clone.complexity = { ...clone.complexity, hotspots: clone.complexity.hotspots.map((h) => ({ ...h, symbol: "" })) };
    }
    json = JSON.stringify(clone);
  } catch {
    return { leaks: true, reasons: ["report is not serializable JSON"] };
  }

  const reasons: string[] = [];
  for (const [re, label] of CODE_SHAPES) {
    if (re.test(json)) reasons.push(`contains ${label}`);
  }
  // very long unbroken token ⇒ likely an embedded blob/secret/source line
  if (/[^\s"]{200,}/.test(json)) reasons.push("contains a 200+ char unbroken token (possible blob)");

  return { leaks: reasons.length > 0, reasons };
}
