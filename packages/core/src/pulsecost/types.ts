/**
 * v2.33.0 — PULSECOST types.
 *
 * "Pulse Cost: Negotiated Context Budget Between AI Agents and Their
 * Tools" (paper 5). MCP spec extension proposal:
 *
 *   Request header :  X-Context-Available-Tokens: <int>
 *   Response header:  X-Context-Used-Tokens:      <int>
 *   Response header:  X-Context-Trimmed:          true|false
 *
 * The tool agrees to fit its response within the available budget;
 * the agent can budget intelligently across many tool calls per turn.
 * Today every MCP server emits unbounded responses → agents waste
 * context on duplicated capability dumps.
 *
 * v2.33.0 ships the local enforcement primitive + spec markdown +
 * a `mneme.pulsecost.budget` MCP tool that demonstrates the protocol.
 * The header convention is proposed (not yet ratified) in the MCP
 * spec — we ship a reference implementation to prove it works.
 */

export interface PulseCostBudget {
  /** Total tokens the agent is willing to receive. */
  availableTokens: number;
  /** Conservative fallback when caller doesn't supply the header. */
  defaultBudget: number;
  /** Words-per-token ratio (rough; 0.75 is the common rule of thumb). */
  wordsPerToken: number;
}

export interface PulseCostResult {
  /** The trimmed output. */
  output: string;
  /** Estimated token count of the output. */
  usedTokens: number;
  /** Original (untrimmed) token estimate. */
  originalTokens: number;
  /** Was the output trimmed? */
  trimmed: boolean;
  /** Response headers the caller should emit alongside the output. */
  headers: Record<string, string>;
}

export interface PulseCostSpec {
  /** Spec version. */
  version: "0.1";
  /** Human-readable spec body (markdown). */
  body: string;
  /** Header names. */
  headers: {
    requestAvailable: string;
    responseUsed: string;
    responseTrimmed: string;
  };
}
