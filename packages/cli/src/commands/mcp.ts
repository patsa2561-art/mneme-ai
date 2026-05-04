import { ui } from "../ui.js";
import kleur from "kleur";

export async function mcpCommand(opts: { cwd: string }): Promise<number> {
  // Defer load — mcp package is heavy and only needed when launching the server.
  const { startMcpServer } = await import("@mneme-ai/mcp");
  ui.dim(kleur.gray("[mneme mcp] starting MCP server on stdio …"));
  await startMcpServer({ cwd: opts.cwd });
  return 0;
}
