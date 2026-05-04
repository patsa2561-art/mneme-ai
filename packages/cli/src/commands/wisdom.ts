import kleur from "kleur";
import { ui } from "../ui.js";
import {
  MEDITATIONS,
  meditationByIndex,
  meditationOfTheDay,
  type Meditation,
} from "../meditations.js";

export interface WisdomOptions {
  /** Pick a specific meditation (1-indexed). Otherwise: meditation of the day. */
  index?: number;
  /** Print the entire canon. */
  all?: boolean;
  /** JSON output. */
  json?: boolean;
}

export async function wisdomCommand(opts: WisdomOptions): Promise<number> {
  if (opts.all) {
    if (opts.json) {
      process.stdout.write(JSON.stringify(MEDITATIONS, null, 2) + "\n");
      return 0;
    }
    for (let i = 0; i < MEDITATIONS.length; i++) {
      printMeditation(MEDITATIONS[i]!, i + 1);
      process.stdout.write("\n");
    }
    return 0;
  }

  let chosen: Meditation;
  if (opts.index !== undefined) {
    const m = meditationByIndex(opts.index);
    if (!m) {
      ui.error(
        `No meditation #${opts.index}. Range is 1..${MEDITATIONS.length}.`,
      );
      return 1;
    }
    chosen = m;
  } else {
    chosen = meditationOfTheDay();
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(chosen, null, 2) + "\n");
    return 0;
  }

  const idx = MEDITATIONS.findIndex((m) => m.id === chosen.id) + 1;
  printMeditation(chosen, idx);
  process.stdout.write(
    "\n" +
      kleur.gray(
        `  see also:  mneme wisdom --all     ·     mneme wisdom --n <1..${MEDITATIONS.length}>     ·     mneme manifesto`,
      ) +
      "\n",
  );
  return 0;
}

function printMeditation(m: Meditation, n: number): void {
  const total = MEDITATIONS.length;
  const lines: string[] = [];
  lines.push("");
  lines.push(
    kleur.magenta("  ╭───────────────────────────────────────────╮"),
  );
  lines.push(
    kleur.magenta("  │  ") +
      kleur.gray(`meditation ${n} of ${total}`).padEnd(50, " ") +
      kleur.magenta("│"),
  );
  lines.push(
    kleur.magenta("  ╰───────────────────────────────────────────╯"),
  );
  lines.push("");
  lines.push(kleur.bold().cyan(`  ${m.title}`));
  lines.push("");
  for (const para of m.body.split("\n")) {
    lines.push(`  ${kleur.white(wrap(para, 68, "  "))}`);
  }
  lines.push("");
  lines.push(kleur.italic().yellow(`  — ${m.aphorism}`));
  process.stdout.write(lines.join("\n") + "\n");
}

function wrap(s: string, width: number, indent: string): string {
  if (s.length <= width) return s;
  const words = s.split(" ");
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trimStart().length > width) {
      out.push(line.trimStart());
      line = indent + w;
    } else {
      line += (line ? " " : "") + w;
    }
  }
  if (line.trim()) out.push(line.trimStart());
  return out.join("\n  ");
}

export async function manifestoCommand(opts: { json?: boolean }): Promise<number> {
  if (opts.json) {
    process.stdout.write(JSON.stringify({ meditations: MEDITATIONS }, null, 2) + "\n");
    return 0;
  }
  ui.banner();
  process.stdout.write(
    kleur.bold().cyan("  Mneme — A Manifesto in Meditations") + "\n",
  );
  process.stdout.write(
    kleur.gray(
      "  μνήμη was the Greek personification of memory, mother of the muses.\n" +
        "  These are the principles that shape the tool that bears her name.\n",
    ) + "\n",
  );
  for (let i = 0; i < MEDITATIONS.length; i++) {
    printMeditation(MEDITATIONS[i]!, i + 1);
    process.stdout.write("\n");
  }
  process.stdout.write(
    kleur.gray("  ──\n") +
      kleur.italic().gray(
        "  Read more in MEDITATIONS.md, or ask a single one with `mneme wisdom`.\n",
      ),
  );
  return 0;
}
