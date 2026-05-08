/**
 * Meta — informational tools that don't compute over the repo:
 * doctor, wisdom meditation, manifesto, advanced command list.
 */

import { passthroughHandler } from "./_runtime.js";
import type { MnemeTool } from "./_types.js";

const meta = (
  name: string,
  description: string,
  triggers: string[],
  cli: string,
  argMap: (a: Record<string, unknown>) => string[] = () => [],
  inputSchema: MnemeTool["inputSchema"] = { type: "object", properties: {} },
  wisdom: (d: unknown) => string = () => "Result returned.",
): MnemeTool => ({
  name,
  category: "meta",
  description,
  triggers,
  inputSchema,
  handler: passthroughHandler(cli, argMap, { wisdom, confidence: "high" }),
});

export const metaTools: MnemeTool[] = [
  meta(
    "mneme.meta.doctor",
    "Environment probe: hardware, embedder availability (Ollama/OpenAI/HuggingFace), Mneme readiness. Use WHEN user asks: 'is Mneme set up?', 'doctor', 'environment check'.",
    ["is mneme set up", "doctor probe"],
    "doctor",
    () => [],
    { type: "object", properties: {} },
    () => "Environment probe complete. Use the data fields to advise on missing dependencies.",
  ),
  meta(
    "mneme.meta.wisdom",
    "Pull a short meditation from the Mneme manifesto. Use WHEN user asks: 'wisdom of the day', 'manifesto quote'.",
    ["wisdom quote", "manifesto meditation"],
    "wisdom",
    (a) => (a["count"] ? ["-n", String(a["count"])] : []),
    { type: "object", properties: { count: { type: "number" } } },
  ),
  meta(
    "mneme.meta.manifesto",
    "Read the full Mneme manifesto canon. Use WHEN user asks: 'show the manifesto', 'philosophy of Mneme'.",
    ["show manifesto", "Mneme philosophy"],
    "manifesto",
  ),
  meta(
    "mneme.meta.advanced",
    "List every Mneme command including hidden phase-2/3/4 ones. Use WHEN user asks: 'list everything', 'all commands including hidden'.",
    ["list every command", "all hidden commands"],
    "advanced",
  ),
];
