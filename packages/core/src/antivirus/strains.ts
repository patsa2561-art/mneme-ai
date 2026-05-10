import type { Strain, StrainId } from "./types.js";

/** Curated taxonomy of hallucination strains. Each entry is a real failure
 *  pattern observed in production AI agents (not a hypothetical). The
 *  signature regexes are conservative -- they match SURFACE shape only;
 *  the corresponding vaccine assay (vaccines.ts) confirms infection. */
export const STRAINS: Record<StrainId, Strain> = {
  citatio_viridis: {
    id: "citatio_viridis",
    scientificName: "Citatio viridis",
    commonName: "Phantom commit hash",
    pathogenesis:
      "AI cites a commit SHA (e.g., \"see commit a1b2c3d\" or \"0x9f8a7b6c\") that doesn't exist in the repo's git history. Hardest to spot because SHAs LOOK authoritative.",
    severity: 4,
    signature: {
      // v1.27.8 -- broadened to also match `0xHEXHEXHEX...` notation (which
      // some AI agents emit in place of bare hex). Two patterns:
      //   1. `commit|sha|@|#` prefix + 7-40 hex
      //   2. bare `0x` prefix + 7-40 hex (anywhere in text)
      patterns: [
        "\\b(?:commit|sha|@|#)?\\s*([0-9a-fA-F]{7,40})\\b",
        "\\b0x([0-9a-fA-F]{7,40})\\b",
      ],
      explanation: "7-40 character hex strings (with or without 0x prefix) that look like git SHAs.",
    },
  },
  persona_fictum: {
    id: "persona_fictum",
    scientificName: "Persona fictum",
    commonName: "Invented author",
    pathogenesis:
      "AI attributes a change to a person who never committed to this repo. Often invents plausible-sounding names from training data.",
    severity: 3,
    signature: {
      // "by John Doe" / "@username wrote" / "committed by ..."
      patterns: [
        "\\b(?:by|@|committed by|written by|authored by)\\s+([A-Z][\\w'.-]+(?:\\s+[A-Z][\\w'.-]+){0,2})\\b",
      ],
      explanation: "Capitalized names following attribution markers (by, @, etc.).",
    },
  },
  api_phantasma: {
    id: "api_phantasma",
    scientificName: "API phantasma",
    commonName: "Ghost function/method",
    pathogenesis:
      "AI references a function or method that doesn't exist in the codebase. Common when AI extrapolates from related libraries.",
    severity: 4,
    signature: {
      // identifier(...) or Class.method(...) where identifier is camelCase or snake_case.
      patterns: [
        "\\b([a-z_$][\\w$]*\\.[a-z_$][\\w$]*)\\s*\\(",
        "\\b([a-z_$][\\w$]{2,})\\s*\\(",
      ],
      explanation: "Function-call-shaped identifiers (foo(...) or foo.bar(...)).",
    },
  },
  depends_imaginarium: {
    id: "depends_imaginarium",
    scientificName: "Depends imaginarium",
    commonName: "Phantom npm package",
    pathogenesis:
      "AI suggests installing or imports a package that doesn't exist on npm or isn't a project dependency.",
    severity: 4,
    signature: {
      // v1.27.8 -- broadened to catch:
      //   1. `from "pkg"` / `require("pkg")` / `npm install pkg` (existing)
      //   2. Bare `@scope/pkg` mentioned near words like "package", "library",
      //      "module", "dep", "uses" (so prose mentions don't slip through)
      //   3. Bare `pkg` followed by " npm package " or " library "
      patterns: [
        "(?:from|require\\(|npm install|npm i|yarn add|pnpm add)\\s+['\"]?(@?[a-z0-9][\\w./-]*)['\"]?",
        "(@[a-z0-9][\\w-]*\\/[a-z0-9][\\w.-]*)(?=\\s+(?:npm|package|library|module|dep|uses|via|using))",
        "\\b([a-z0-9][\\w-]{2,})\\s+(?:npm package|npm module)\\b",
      ],
      explanation: "Package names following import/require/install markers OR bare scoped packages mentioned alongside 'npm', 'package', 'library', 'dep'.",
    },
  },
  tempus_perversum: {
    id: "tempus_perversum",
    scientificName: "Tempus perversum",
    commonName: "Time-warped event",
    pathogenesis:
      "AI cites a date that doesn't match when the event actually happened (e.g., commit date wrong, future date for past event).",
    severity: 2,
    signature: {
      patterns: [
        "\\b(?:on|in|since|at)\\s+(\\d{4}-\\d{2}-\\d{2})\\b",
        "\\b(\\d{4}-\\d{2}-\\d{2})\\b",
      ],
      explanation: "ISO-like date references.",
    },
  },
  confidens_cardinalis: {
    id: "confidens_cardinalis",
    scientificName: "Confidens cardinalis",
    commonName: "Off-by-N count",
    pathogenesis:
      "AI states a count (\"42 tests\", \"3 packages\", etc.) that's off by more than tolerance from reality.",
    severity: 2,
    signature: {
      patterns: [
        "\\b(\\d{1,6})\\s+(tests?|files?|commits?|packages?|lines?|functions?|errors?|warnings?)\\b",
      ],
      explanation: "Number followed by a countable noun.",
    },
  },
  structura_invenita: {
    id: "structura_invenita",
    scientificName: "Structura invenita",
    commonName: "Phantom file path",
    pathogenesis:
      "AI references a file or directory path that doesn't exist in the repo.",
    severity: 3,
    signature: {
      patterns: [
        "\\b([a-z_][\\w./\\-]*\\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|toml|py|go|rs|java|cs))\\b",
        "\\b((?:src|packages|tests?|docs|scripts|bin)\\/[\\w./\\-]+)\\b",
      ],
      explanation: "Paths ending in common file extensions OR rooted at known top-level dirs.",
    },
  },
  logica_circularis: {
    id: "logica_circularis",
    scientificName: "Logica circularis",
    commonName: "Circular reasoning",
    pathogenesis:
      "AI's argument has a cycle (claim A justified by B, B justified by A). Usually masks lack of evidence.",
    severity: 3,
    signature: {
      patterns: [
        "\\bbecause\\b",
        "\\btherefore\\b",
        "\\bsince\\b",
        "\\bas\\s+(?:we|I|it)\\s+(?:see|saw|noted|mentioned)\\b",
      ],
      explanation: "Causal/justification connectives that may chain into a cycle.",
    },
  },
};

/** Return all strains as an array (stable order: by severity desc then id). */
export function listStrains(): Strain[] {
  return Object.values(STRAINS).sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
}

/** Look up a strain by id; throws if unknown. Used by vaccines. */
export function getStrain(id: StrainId): Strain {
  const s = STRAINS[id];
  if (!s) throw new Error(`unknown strain: ${id}`);
  return s;
}

/** Compile a strain's surface-pattern regexes once. Pure / cached. */
const COMPILED_PATTERNS = new Map<StrainId, RegExp[]>();
export function compilePatterns(id: StrainId): RegExp[] {
  let cached = COMPILED_PATTERNS.get(id);
  if (cached) return cached;
  const strain = getStrain(id);
  cached = strain.signature.patterns.map((p) => new RegExp(p, "g"));
  COMPILED_PATTERNS.set(id, cached);
  return cached;
}
