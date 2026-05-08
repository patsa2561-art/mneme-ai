/**
 * `mneme periodic-table` — browse the Element / Atom / Molecule catalog.
 *
 * The visualisation maps Mneme's compositional layers onto a chemistry
 * metaphor: elements (primitive operations), atoms (parameterised
 * elements), molecules (today's commands), compounds (cross-domain).
 *
 * Three modes:
 *   mneme periodic-table                 # full catalog grouped by kind
 *   mneme periodic-table <id>            # detail for one primitive
 *   mneme periodic-table --json          # machine-readable for AI / MCP
 */

import kleur from "kleur";
import { periodic } from "@mneme-ai/core";
import { ui, header, section, kv, divider, nextSteps } from "../ui.js";

export interface PeriodicTableOptions {
  /** Optional manifest id to focus on. */
  id?: string;
  /** Filter by kind: element / atom / molecule / compound. */
  kind?: string;
  /** Filter by tag. */
  tag?: string;
  /** Machine-readable output. */
  json?: boolean;
  /** Quiet — no banner, no decorative chars. */
  quiet?: boolean;
}

export async function periodicTableCommand(opts: PeriodicTableOptions): Promise<number> {
  const all = periodic.registry.all();

  if (opts.id) {
    const m = periodic.registry.get(opts.id);
    if (!m) {
      ui.error(`No primitive with id "${opts.id}". Try \`mneme periodic-table\` to browse.`);
      return 1;
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify(m, null, 2) + "\n");
      return 0;
    }
    renderDetail(m);
    return 0;
  }

  let view = all;
  if (opts.kind) {
    view = view.filter((m) => m.kind === opts.kind);
  }
  if (opts.tag) {
    view = view.filter((m) => m.tags.includes(opts.tag!));
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ primitives: view }, null, 2) + "\n");
    return 0;
  }

  if (!opts.quiet) ui.banner();
  process.stdout.write(
    header(
      "🧪",
      "Periodic Table",
      "Element / Atom / Molecule catalog — every primitive Mneme can compose.",
      "Browse the building blocks of every Mneme command. Pass an id (`mneme periodic-table git.log`) for full detail.",
    ) + "\n",
  );

  if (view.length === 0) {
    ui.warn("No primitives match the filter.");
    return 0;
  }

  const elements = view.filter((m) => m.kind === "element");
  const atoms = view.filter((m) => m.kind === "atom");
  const molecules = view.filter((m) => m.kind === "molecule");
  const compounds = view.filter((m) => m.kind === "compound");

  process.stdout.write(
    "\n" +
      kv("counts", `${elements.length} elements · ${atoms.length} atoms · ${molecules.length} molecules · ${compounds.length} compounds`) +
      "\n\n",
  );

  if (elements.length > 0) {
    process.stdout.write(section("⚛  Elements", "primitive operations — atoms-of-different-types in chemistry") + "\n\n");
    for (const m of elements) renderRow(m);
    process.stdout.write("\n");
  }
  if (atoms.length > 0) {
    process.stdout.write(section("⚙  Atoms", "elements bound to specific parameters") + "\n\n");
    for (const m of atoms) renderRow(m);
    process.stdout.write("\n");
  }
  if (molecules.length > 0) {
    process.stdout.write(section("🧬  Molecules", "atom compositions — today's user-facing commands") + "\n\n");
    for (const m of molecules) renderRow(m);
    process.stdout.write("\n");
  }
  if (compounds.length > 0) {
    process.stdout.write(section("⚗  Compounds", "cross-domain molecules") + "\n\n");
    for (const m of compounds) renderRow(m);
    process.stdout.write("\n");
  }

  process.stdout.write(divider("📘 How to read") + "\n");
  process.stdout.write(
    "  " +
      kleur.gray(
        "Element  = a single primitive operation (one git command, one regex match).\n" +
          "  Atom     = an element with bound parameters (git.log{since:'90d'}).\n" +
          "  Molecule = a composition of atoms — today's commands live here.\n" +
          "  Compound = a multi-domain molecule (people + history + security).\n" +
          "  Cost     = io class · cpu class · ms_p50 — used by the v0.41 compiler.\n" +
          "  Tags     = browse axis. Filter with --tag <tag>.",
      ) +
      "\n\n",
  );

  process.stdout.write(
    nextSteps([
      { cmd: `mneme periodic-table git.log`, why: "deep-dive on a single primitive" },
      { cmd: `mneme periodic-table --kind atom`, why: "list only atoms" },
      { cmd: `mneme periodic-table --tag security`, why: "filter by tag" },
      { cmd: `mneme periodic-table --json`, why: "machine-readable for AI / MCP" },
    ]) + "\n",
  );
  return 0;
}

function renderRow(m: periodic.AnyManifest): void {
  const idTinted =
    m.kind === "element" ? kleur.cyan(m.id)
    : m.kind === "atom" ? kleur.magenta(m.id)
    : m.kind === "molecule" ? kleur.green(m.id)
    : kleur.yellow(m.id);
  const cost = `${m.cost.cpu}·${m.cost.msP50}ms`;
  process.stdout.write(
    `  ${idTinted.padEnd(40)}  ${kleur.gray(`[${cost}]`.padEnd(18))}  ${kleur.white(m.summary)}\n`,
  );
}

function renderDetail(m: periodic.AnyManifest): void {
  ui.banner();
  const kindIcon =
    m.kind === "element" ? "⚛" : m.kind === "atom" ? "⚙" : m.kind === "molecule" ? "🧬" : "⚗";
  process.stdout.write(`  ${kleur.bold().cyan(`${kindIcon}  ${m.id}`)}  ${kleur.gray(`(${m.kind})`)}\n\n`);
  process.stdout.write(`  ${kleur.bold(m.summary)}\n\n`);
  process.stdout.write(`  ${kleur.gray(m.description)}\n\n`);

  process.stdout.write(section("Inputs") + "\n");
  for (const [k, v] of Object.entries(m.inputs)) {
    process.stdout.write(`    ${kleur.cyan(k)}  ${kleur.gray(v)}\n`);
  }
  process.stdout.write(`\n  ${kleur.gray("→ output:")} ${kleur.white(m.output)}\n\n`);

  process.stdout.write(section("Cost") + "\n");
  process.stdout.write(
    kv("io", m.cost.io) +
      "\n" +
      kv("cpu", m.cost.cpu) +
      "\n" +
      kv("ms_p50", `${m.cost.msP50} ms`) +
      "\n" +
      kv("deterministic", String(m.deterministic)) +
      "\n" +
      kv("side effect", m.sideEffect) +
      "\n",
  );

  if (m.kind === "atom") {
    const a = m as periodic.AtomManifest;
    process.stdout.write("\n" + section("Atom binding") + "\n");
    process.stdout.write(kv("parent element", a.element) + "\n");
    process.stdout.write(kv("bound", JSON.stringify(a.bind)) + "\n");
  }
  if (m.kind === "molecule" || m.kind === "compound") {
    const x = m as periodic.MoleculeManifest;
    process.stdout.write("\n" + section("Composes") + "\n");
    for (const ref of x.composes) {
      process.stdout.write(`    ${kleur.cyan("●")} ${kleur.bold(ref)}\n`);
    }
    if (x.reactions && x.reactions.length > 0) {
      process.stdout.write("\n" + section("Reactions") + "\n");
      for (const r of x.reactions) {
        process.stdout.write(`    ${kleur.yellow("⚡")} ${kleur.gray(r)}\n`);
      }
    }
  }

  process.stdout.write("\n" + section("Tags") + "\n");
  process.stdout.write(`    ${m.tags.map((t) => kleur.gray(`#${t}`)).join("  ")}\n\n`);

  if (m.modulePath) {
    process.stdout.write(section("Implementation") + "\n");
    process.stdout.write(kv("module", m.modulePath) + "\n");
    if (m.exportName) process.stdout.write(kv("export", m.exportName) + "\n");
    process.stdout.write("\n");
  }
}
