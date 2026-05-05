/**
 * Tiny animated spinner for CLI feedback during retrieval / synthesis.
 *
 * Why not a library? Adding ora / cli-spinners adds 100KB and a maintenance
 * surface. This is 50 lines and does what we need: braille frames, optional
 * label, stops cleanly on Ctrl-C.
 */

import kleur from "kleur";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 80;

export class Spinner {
  private timer: NodeJS.Timeout | undefined;
  private frame = 0;
  private label = "";
  private active = false;

  /** Start the spinner with the given label. Idempotent. */
  start(label: string): void {
    if (this.active) {
      this.label = label;
      return;
    }
    this.active = true;
    this.label = label;
    if (!process.stdout.isTTY) {
      // Non-TTY (CI, piped) — no animation, just print the label once.
      process.stdout.write(`  ${kleur.cyan(label)}\n`);
      return;
    }
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.render();
    }, FRAME_MS);
  }

  /** Update label without restarting. */
  update(label: string): void {
    this.label = label;
    if (this.active && process.stdout.isTTY) this.render();
  }

  /** Stop the spinner and replace it with a final line. */
  succeed(message: string): void {
    this.stop();
    process.stdout.write(`  ${kleur.green("✓")} ${message}\n`);
  }

  fail(message: string): void {
    this.stop();
    process.stdout.write(`  ${kleur.red("✗")} ${message}\n`);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (process.stdout.isTTY) {
      // Erase the spinner line.
      process.stdout.write("\r\x1b[K");
    }
  }

  private render(): void {
    const f = FRAMES[this.frame] ?? "⠋";
    process.stdout.write(`\r  ${kleur.cyan(f)} ${kleur.gray(this.label)}`);
  }
}
