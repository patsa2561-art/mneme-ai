/**
 * `mneme ecosystem` — detect which ecosystems are present + show
 * the dynamic tool catalog Mneme would expose for THIS specific repo.
 *
 * The wild card capability: every other MCP server has a static tool
 * surface. Mneme's surface adapts to your codebase.
 */

import kleur from "kleur";
import { ui } from "../ui.js";
import { git, dynamic } from "@mneme-ai/core";

export interface EcosystemOptions {
  cwd: string;
  json?: boolean;
}

export async function ecosystemCommand(opts: EcosystemOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);

  const detection = dynamic.detectEcosystems(meta.rootPath);
  const catalog = dynamic.buildDynamicToolCatalog(detection);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ detection, catalog }, null, 2) + "\n");
    return 0;
  }

  ui.banner();
  process.stdout.write(
    kleur.bold(`\n  🧬 Dynamic MCP — ecosystem detection\n\n`) +
      `  Detected:           ${kleur.cyan(`${detection.signals.length}`)} ecosystem(s)\n` +
      `  Tools to add:       ${kleur.green(`+${detection.toolsToAdd}`)} (on top of base 98+)\n` +
      `  Detection time:     ${detection.detectedAt}\n\n`,
  );

  if (detection.signals.length === 0) {
    process.stdout.write(
      kleur.gray("  No ecosystems detected. The base 98+ Mneme tools still apply.\n\n") +
        kleur.gray("  Add a package.json dependency or a recognised import to activate ecosystem-specific tools.\n\n"),
    );
    return 0;
  }

  process.stdout.write(kleur.bold("  ◆ Ecosystem signals\n\n"));
  for (const sig of detection.signals) {
    const conf = `${(sig.confidence * 100).toFixed(0)}%`;
    process.stdout.write(
      `    ${kleur.cyan(`${sig.id.padEnd(10)}`)} ${kleur.gray(`(confidence ${conf})`)}\n` +
        `      evidence: ${sig.evidence.join(", ")}\n` +
        `      tools:    ${sig.tools.join(", ")}\n\n`,
    );
  }

  process.stdout.write(
    kleur.gray(
      "  These ecosystem-specific tools spawn at MCP cold start — your AI client\n" +
        "  sees a tool surface tailored to YOUR codebase.\n\n",
    ),
  );
  return 0;
}
