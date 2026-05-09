import kleur from "kleur";

export async function mcpCommand(opts: { cwd: string }): Promise<number> {
  // Defer load — mcp package is heavy and only needed when launching the server.
  const { startMcpServer } = await import("@mneme-ai/mcp");
  // CRITICAL: MCP protocol uses STDOUT for JSON-RPC frames. Anything
  // non-JSON written to stdout breaks the client's parser → connection
  // closes immediately. Diagnostic prints MUST go to stderr.
  process.stderr.write(kleur.gray("[mneme mcp] starting MCP server on stdio …\n"));
  await startMcpServer({ cwd: opts.cwd });
  return 0;
}
