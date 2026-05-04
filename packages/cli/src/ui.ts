import kleur from "kleur";

export const ui = {
  banner: () => {
    const lines = [
      "",
      kleur.magenta("  ╭──────────────────────────────────╮"),
      kleur.magenta("  │") + kleur.bold().white("  μνήμη  ") + kleur.gray("·") + kleur.italic().cyan("  Mneme  ") + kleur.magenta("              │"),
      kleur.magenta("  │") + kleur.gray("  the memory layer of your code   ") + kleur.magenta("│"),
      kleur.magenta("  ╰──────────────────────────────────╯"),
      "",
    ];
    process.stdout.write(lines.join("\n") + "\n");
  },
  info: (msg: string) => process.stdout.write(`${kleur.cyan("ℹ")} ${msg}\n`),
  success: (msg: string) => process.stdout.write(`${kleur.green("✓")} ${msg}\n`),
  warn: (msg: string) => process.stdout.write(`${kleur.yellow("!")} ${msg}\n`),
  error: (msg: string) => process.stderr.write(`${kleur.red("✗")} ${msg}\n`),
  dim: (msg: string) => process.stdout.write(kleur.gray(msg) + "\n"),
  step: (label: string, msg: string) =>
    process.stdout.write(`${kleur.gray("›")} ${kleur.bold(label)}  ${msg}\n`),
  raw: (msg: string) => process.stdout.write(msg),
};

export function formatProgress(current: number, total: number, width = 24): string {
  if (total <= 0) return "";
  const ratio = Math.min(1, current / total);
  const filled = Math.round(ratio * width);
  const bar = kleur.cyan("█".repeat(filled)) + kleur.gray("░".repeat(width - filled));
  return `${bar} ${kleur.bold(`${Math.round(ratio * 100)}%`)} ${kleur.gray(`(${current}/${total})`)}`;
}
