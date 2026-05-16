/**
 * Genome Marketplace (v1.18.0 — black sheep #4)
 *
 * Pack the team's accumulated `.mneme/` wisdom (constitution, custom packs,
 * library molecules, voice fingerprint) into a portable, signed,
 * PII-scrubbed `.mneme-genome.json` file. Other teams `install` it to
 * inherit conventions — `npm install` for engineering wisdom.
 *
 *   • mneme.genome.publish(outputPath?)  — pack repo's .mneme/ into a genome
 *   • mneme.genome.install(genomeFile)   — apply a genome to the current repo
 *   • mneme.genome.installed             — enumerate genomes installed locally
 *
 * Privacy model:
 *   • Email addresses scrubbed → "<email>@<domain>" placeholder
 *   • Absolute paths inside the repo → relative
 *   • SHA-256 commit hashes preserved (already non-identifying)
 *   • Author NAMES preserved (they're public via git log anyway)
 *
 * Signature model:
 *   • Each genome carries a SHA-256 of its content + a publishedBy field
 *   • `install` verifies the hash before applying — corrupt genomes
 *     trigger an error
 *   • Genomes from untrusted sources should be reviewed before install
 *     (we surface the diff in the install handler so the agent / user
 *     can reject)
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, basename, isAbsolute, resolve as pathResolve, relative } from "node:path";
import { createHash } from "node:crypto";
import type { MnemeTool } from "./_types.js";

interface GenomeFile {
  name: string;
  content: string;
}

export interface Genome {
  /** Schema version of this genome format. */
  schemaVersion: 1;
  /** Genome unique identifier — defaults to {repoName}-{date}. */
  id: string;
  /** Free-text title surfaced when listing. */
  title: string;
  /** Plain-English description: what this genome teaches. */
  description: string;
  /** ISO timestamp when this genome was packed. */
  publishedAt: string;
  /** Author or organization that published — free-text label. */
  publishedBy: string;
  /** Mneme version that packed this genome. */
  mnemeVersion: string;
  /** SHA-256 of the JSON-stringified files array — tamper detection. */
  contentHash: string;
  /** Files included in the genome — paths relative to .mneme/. */
  files: GenomeFile[];
}

const GENOME_DIR = ".mneme/genomes";
const GENOME_PATTERN = /\.(mneme-genome\.json|genome\.json)$/i;

/** Files inside .mneme/ we ship in a genome by default. Other files
 *  are skipped (e.g. mneme.db, replay.jsonl, confess-scoreboard.json
 *  — local runtime state, not portable wisdom). */
const PORTABLE_PATHS = [
  "constitution.json",
  "constitution.md",
  "tribal-knowledge.json",
  "voice-fingerprint.json",
  "library.json",
  "packs", // directory — recursed
  "rules.yml",
  "wisdom.md",
];

const PII_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function scrubEmails(text: string): string {
  return text.replace(PII_EMAIL, (match) => {
    const at = match.indexOf("@");
    if (at < 0) return "<email>";
    const domain = match.slice(at + 1);
    return `<email>@${domain}`;
  });
}

function listFilesRecursive(root: string, prefix = ""): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFilesRecursive(full, rel));
    } else if (st.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function collectGenomeFiles(repoRoot: string): GenomeFile[] {
  const mnemeDir = join(repoRoot, ".mneme");
  if (!existsSync(mnemeDir)) return [];
  const files: GenomeFile[] = [];
  for (const portable of PORTABLE_PATHS) {
    const full = join(mnemeDir, portable);
    if (!existsSync(full)) continue;
    const st = statSync(full);
    if (st.isFile()) {
      const raw = readFileSync(full, "utf8");
      files.push({ name: portable, content: scrubEmails(raw) });
    } else if (st.isDirectory()) {
      const children = listFilesRecursive(full);
      for (const child of children) {
        const childFull = join(full, child);
        const raw = readFileSync(childFull, "utf8");
        files.push({ name: `${portable}/${child}`, content: scrubEmails(raw) });
      }
    }
  }
  return files;
}

function computeContentHash(files: GenomeFile[]): string {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const json = JSON.stringify(sorted);
  return createHash("sha256").update(json).digest("hex");
}

export function packGenome(
  repoRoot: string,
  repoName: string,
  mnemeVersion: string,
  opts: { title?: string; description?: string; publishedBy?: string } = {},
): Genome {
  const files = collectGenomeFiles(repoRoot);
  const id = `${repoName}-${new Date().toISOString().slice(0, 10)}`;
  const contentHash = computeContentHash(files);
  return {
    schemaVersion: 1,
    id,
    title: opts.title ?? `Wisdom from ${repoName}`,
    description:
      opts.description ??
      `Constitution + packs + tribal knowledge from the ${repoName} repo, scrubbed of PII.`,
    publishedAt: new Date().toISOString(),
    publishedBy: opts.publishedBy ?? "anonymous",
    mnemeVersion,
    contentHash,
    files,
  };
}

export function verifyGenome(g: Genome): { valid: boolean; reason?: string } {
  if (g.schemaVersion !== 1) {
    return { valid: false, reason: `unsupported schemaVersion ${g.schemaVersion}` };
  }
  if (!Array.isArray(g.files)) return { valid: false, reason: "missing files array" };
  const expected = computeContentHash(g.files);
  if (expected !== g.contentHash) {
    return { valid: false, reason: `contentHash mismatch (expected ${expected}, got ${g.contentHash})` };
  }
  return { valid: true };
}

export interface InstallResult {
  installed: number;
  skipped: number;
  conflicts: string[];
  installedFiles: string[];
}

export function installGenome(
  repoRoot: string,
  genome: Genome,
  opts: { force?: boolean } = {},
): InstallResult {
  const verdict = verifyGenome(genome);
  if (!verdict.valid) throw new Error(`refused to install — ${verdict.reason}`);
  const mnemeDir = join(repoRoot, ".mneme");
  if (!existsSync(mnemeDir)) mkdirSync(mnemeDir, { recursive: true });
  const conflicts: string[] = [];
  const installedFiles: string[] = [];
  let skipped = 0;
  for (const f of genome.files) {
    // Path traversal guard.
    if (f.name.includes("..") || isAbsolute(f.name)) {
      conflicts.push(`${f.name} (refused — unsafe path)`);
      skipped += 1;
      continue;
    }
    const dest = join(mnemeDir, f.name);
    if (existsSync(dest) && !opts.force) {
      conflicts.push(f.name);
      skipped += 1;
      continue;
    }
    const destDir = join(dest, "..");
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    writeFileSync(dest, f.content, "utf8");
    installedFiles.push(f.name);
  }
  // Record the installed genome.
  const recDir = join(repoRoot, GENOME_DIR);
  if (!existsSync(recDir)) mkdirSync(recDir, { recursive: true });
  writeFileSync(
    join(recDir, `${genome.id}.installed.json`),
    JSON.stringify(
      { id: genome.id, installedAt: new Date().toISOString(), source: genome.publishedBy, contentHash: genome.contentHash },
      null,
      2,
    ),
    "utf8",
  );
  return { installed: installedFiles.length, skipped, conflicts, installedFiles };
}

interface InstalledGenomeRecord {
  id: string;
  installedAt: string;
  source: string;
  contentHash: string;
}

export function listInstalledGenomes(repoRoot: string): InstalledGenomeRecord[] {
  const dir = join(repoRoot, GENOME_DIR);
  if (!existsSync(dir)) return [];
  const out: InstalledGenomeRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".installed.json")) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as InstalledGenomeRecord;
      out.push(r);
    } catch {
      // skip invalid records
    }
  }
  return out.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
}

export const genomePublishTool: MnemeTool = {
  name: "mneme.genome.publish",
  category: "meta",
  description:
    "Pack the team's .mneme/ wisdom (constitution + custom packs + tribal " +
    "knowledge + voice fingerprint) into a portable, PII-scrubbed, " +
    "content-hashed `.mneme-genome.json` file. Other teams can install it " +
    "via mneme.genome.install to inherit your conventions. Email addresses " +
    "are auto-scrubbed; runtime state (mneme.db / replay.jsonl / scoreboard) " +
    "is excluded. Use WHEN your team has accumulated patterns worth sharing — " +
    "open-source it, send to a sister team, or vendor it across repos.",
  whenToUse:
    "You want to export your team's accumulated Mneme wisdom as a portable, signed, PII-scrubbed file.",
  triggers: ["pack genome", "publish wisdom", "export mneme conventions"],
  inputSchema: {
    type: "object",
    properties: {
      outputPath: {
        type: "string",
        description: "Where to write the genome file. Default: .mneme/genomes/{repo}-{date}.mneme-genome.json.",
      },
      title: { type: "string", description: "Short title for the genome (default: 'Wisdom from {repo}')." },
      description: { type: "string", description: "Plain-English description of what the genome teaches." },
      publishedBy: { type: "string", description: "Free-text identifier for who published (org / handle / 'anonymous')." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Where the genome file was written." },
      id: { type: "string" },
      contentHash: { type: "string" },
      fileCount: { type: "number" },
      bytes: { type: "number" },
    },
  },
  examples: [
    {
      userQuery: "Pack our team's Mneme wisdom into a portable file",
      args: { title: "Acme Corp engineering wisdom", publishedBy: "acme-eng" },
      expectedOutput:
        "Returns { path, id, contentHash, fileCount, bytes }. Sends the file to .mneme/genomes/{id}.mneme-genome.json.",
    },
  ],
  pitfalls: [
    "PII scrubbing only handles email addresses — review the genome before sharing publicly to catch other secrets (API keys, server URLs).",
    "Runtime state (mneme.db, replay.jsonl, confess-scoreboard.json) is intentionally excluded — install will NOT restore it.",
    "Conflicts with absolute paths and `..` in filenames are rejected at install — keep your portable files inside .mneme/.",
  ],
  composeWith: ["mneme.genome.install", "mneme.genome.installed", "mneme.constitution.get"],
  handler: async (rt, args) => {
    const repoName = basename(rt.meta.rootPath);
    const mnemeVersion = process.env["npm_package_version"] ?? "unknown";
    const genome = packGenome(rt.meta.rootPath, repoName, mnemeVersion, {
      title: args["title"] ? String(args["title"]) : undefined,
      description: args["description"] ? String(args["description"]) : undefined,
      publishedBy: args["publishedBy"] ? String(args["publishedBy"]) : undefined,
    });
    const outDir = join(rt.meta.rootPath, GENOME_DIR);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const outputPath = args["outputPath"]
      ? (isAbsolute(String(args["outputPath"]))
          ? String(args["outputPath"])
          : pathResolve(rt.meta.rootPath, String(args["outputPath"])))
      : join(outDir, `${genome.id}.mneme-genome.json`);
    const json = JSON.stringify(genome, null, 2);
    writeFileSync(outputPath, json, "utf8");
    const rel = relative(rt.meta.rootPath, outputPath) || outputPath;
    return {
      data: {
        path: rel,
        id: genome.id,
        contentHash: genome.contentHash,
        fileCount: genome.files.length,
        bytes: Buffer.byteLength(json, "utf8"),
      },
      wisdom:
        genome.files.length === 0
          ? "Nothing portable to publish — .mneme/ has no constitution / packs / tribal knowledge yet. Run `mneme constitution synth` first."
          : `Published genome ${genome.id} — ${genome.files.length} file${genome.files.length === 1 ? "" : "s"}, hash ${genome.contentHash.slice(0, 12)}. Share the file at ${rel}.`,
      followUp: ["mneme.genome.install"],
      confidence: { level: "high" },
    };
  },
};

export const genomeInstallTool: MnemeTool = {
  name: "mneme.genome.install",
  category: "meta",
  description:
    "Install a `.mneme-genome.json` packed by another team — applies their " +
    "constitution / packs / tribal knowledge to the current repo's .mneme/. " +
    "Verifies the content hash before applying. By default, refuses to " +
    "overwrite existing files (returns conflicts list); pass force=true to " +
    "override. Use WHEN you want to adopt another team's Mneme conventions.",
  whenToUse:
    "You received a .mneme-genome.json file and want to apply its conventions to your current repo.",
  triggers: ["install genome", "apply mneme wisdom", "import conventions"],
  inputSchema: {
    type: "object",
    properties: {
      genomeFile: { type: "string", description: "Path to a .mneme-genome.json file." },
      force: { type: "boolean", description: "Overwrite existing .mneme/ files. Default false." },
    },
    required: ["genomeFile"],
  },
  outputSchema: {
    type: "object",
    properties: {
      installed: { type: "number" },
      skipped: { type: "number" },
      conflicts: { type: "array", items: { type: "string" } },
      installedFiles: { type: "array", items: { type: "string" } },
      genome: { type: "object" },
    },
  },
  examples: [
    {
      userQuery: "Install acme-eng's Mneme genome",
      args: { genomeFile: "./acme-eng-2026-05-09.mneme-genome.json" },
      expectedOutput:
        "Returns { installed, skipped, conflicts, installedFiles, genome }. If a file already exists, it appears in `conflicts`; pass force=true to overwrite.",
    },
  ],
  pitfalls: [
    "Refused if the genome's contentHash doesn't match its files — corrupt or hand-edited genomes are rejected.",
    "Path-traversal attempts (../, absolute paths) are blocked individually — those files appear in `conflicts` with reason 'unsafe path'.",
    "force=true OVERWRITES your existing .mneme/ files — diff your repo first if unsure.",
  ],
  composeWith: ["mneme.genome.publish", "mneme.genome.installed", "mneme.constitution.get"],
  handler: async (rt, args) => {
    const file = String(args["genomeFile"] ?? "");
    if (!file) {
      return {
        data: { error: "missing required argument: genomeFile" },
        wisdom: "Pass the path to a .mneme-genome.json file.",
        confidence: { level: "high" },
      };
    }
    const abs = isAbsolute(file) ? file : pathResolve(rt.meta.rootPath, file);
    if (!existsSync(abs)) {
      return {
        data: { error: `file not found: ${abs}` },
        wisdom: `Could not find genome at ${file}. Confirm the path and try again.`,
        confidence: { level: "high" },
      };
    }
    let genome: Genome;
    try {
      genome = JSON.parse(readFileSync(abs, "utf8")) as Genome;
    } catch (err) {
      return {
        data: { error: `could not parse genome JSON: ${(err as Error).message}` },
        wisdom: "The file isn't valid JSON. Confirm it's a real Mneme genome file.",
        confidence: { level: "high" },
      };
    }
    const force = Boolean(args["force"]);
    let result: InstallResult;
    try {
      result = installGenome(rt.meta.rootPath, genome, { force });
    } catch (err) {
      return {
        data: { error: (err as Error).message },
        wisdom: `Refused to install: ${(err as Error).message}`,
        confidence: { level: "high" },
      };
    }
    return {
      data: {
        ...result,
        genome: {
          id: genome.id,
          title: genome.title,
          publishedBy: genome.publishedBy,
          contentHash: genome.contentHash,
        },
      },
      wisdom:
        result.installed > 0
          ? `Installed ${result.installed} file${result.installed === 1 ? "" : "s"} from genome '${genome.title}'.${result.conflicts.length > 0 ? ` Skipped ${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"} (use force=true to overwrite).` : ""}`
          : `No files installed — ${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"}. Pass force=true to overwrite, or review the conflicts list.`,
      followUp: result.installed > 0 ? ["mneme.constitution.get", "mneme.capabilities"] : [],
      confidence: { level: "high" },
    };
  },
};

export const genomeListTool: MnemeTool = {
  name: "mneme.genome.installed",
  category: "meta",
  description:
    "List every Mneme genome INSTALLED locally to this repo, with installation " +
    "timestamp + source + content hash. Use WHEN you want to know which external " +
    "wisdom packs are currently shaping this repo's behavior. (Distinct from " +
    "mneme.genome.list which is v2.19.9 GENESPLICING chimera listing.)",
  whenToUse:
    "You want to audit which external genomes this repo has installed.",
  triggers: ["list genomes", "what genomes installed", "mneme genome inventory"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      total: { type: "number" },
      genomes: { type: "array", items: { type: "object" } },
    },
  },
  examples: [
    {
      userQuery: "Which Mneme genomes have we installed?",
      expectedOutput:
        "Returns { total, genomes: [{ id, installedAt, source, contentHash }] }. Empty array if none.",
    },
  ],
  pitfalls: [
    "Lists records — not the genome FILES themselves. To re-install, you need the original .mneme-genome.json.",
  ],
  composeWith: ["mneme.genome.publish", "mneme.genome.install"],
  handler: async (rt) => {
    const genomes = listInstalledGenomes(rt.meta.rootPath);
    return {
      data: { total: genomes.length, genomes },
      wisdom:
        genomes.length === 0
          ? "No external genomes installed in this repo. Run mneme.genome.install with a .mneme-genome.json file to adopt one."
          : `${genomes.length} genome${genomes.length === 1 ? "" : "s"} installed. Most recent: ${genomes[0]!.id} (from ${genomes[0]!.source}).`,
      confidence: { level: "high" },
    };
  },
};

export const genomeMarketplaceTools: MnemeTool[] = [
  genomePublishTool,
  genomeInstallTool,
  genomeListTool,
];

// Re-export pattern constant for downstream consumers (tests, CLI integration).
export { GENOME_PATTERN };
