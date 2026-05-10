/**
 * Path 12 -- Quantum easter egg + honest education.
 *
 * Quantum computing does not solve the AI-agent-trigger problem.
 * The bottleneck is architecture (AI clients only run inference on
 * user input), not compute. Quantum is amazing for: factoring (Shor),
 * unstructured search (Grover, sqrt(N) speedup), quantum simulation,
 * and certain optimization problems. None of those map to "make the
 * AI client wake up by itself".
 *
 * This module is small + educational. It includes:
 *   - quantumFitness(): Big O comparison helper. Not used in real
 *     code paths -- pure pedagogy.
 *   - whyNotQuantum(): plain-English explainer the CLI prints.
 *   - groverIterations(N): expected iterations for Grover-style
 *     unstructured search over N items. Useful for thought
 *     experiments (e.g., "if Mneme had a quantum chunk index,
 *     how many lookups would it take?").
 *
 * If a future paper finds a real quantum speedup for any Mneme
 * subsystem, the module will grow real callers. Today it's a thought
 * experiment + a fun `mneme quantum` CLI command.
 */

export interface ComplexityBreakdown {
  classical: { name: string; bigO: string; example: string };
  quantum: { name: string; bigO: string; example: string };
  speedup: string;
  applicableToMneme: boolean;
  reason: string;
}

export const COMPLEXITY_TABLE: ComplexityBreakdown[] = [
  {
    classical: { name: "linear search", bigO: "O(N)", example: "scan all chunks for a query token" },
    quantum: { name: "Grover's algorithm", bigO: "O(sqrt(N))", example: "amplitude-amplify the matching chunk" },
    speedup: "quadratic (sqrt(N))",
    applicableToMneme: false,
    reason: "Mneme uses BM25 + vector ANN -- already sub-linear classically. Grover would help only if we had no index; we do.",
  },
  {
    classical: { name: "integer factoring", bigO: "O(exp(N^(1/3)))", example: "RSA key cracking" },
    quantum: { name: "Shor's algorithm", bigO: "O(N^3)", example: "polynomial-time RSA crack" },
    speedup: "exponential",
    applicableToMneme: false,
    reason: "Mneme doesn't factor numbers. Our HMAC signatures use SHA-256 which Grover at best halves bits to 128; still infeasible.",
  },
  {
    classical: { name: "molecular dynamics", bigO: "O(2^N)", example: "simulating protein folding" },
    quantum: { name: "quantum simulation", bigO: "O(N)", example: "natural-fit on quantum hardware" },
    speedup: "exponential",
    applicableToMneme: false,
    reason: "Mneme's nucleus 'mutates' is a metaphor; no quantum chemistry involved.",
  },
  {
    classical: { name: "AI inference trigger gap", bigO: "O(user_keystroke)", example: "AI client waits for user input" },
    quantum: { name: "(no quantum equivalent)", bigO: "n/a", example: "no quantum API for 'wake up the AI client'" },
    speedup: "n/a",
    applicableToMneme: false,
    reason: "This is an ARCHITECTURE bottleneck, not a compute bottleneck. Quantum cannot help. Solve it with notifier channels + autonomous Mneme agent.",
  },
];

export function whyNotQuantum(): string {
  return [
    "Mneme has been asked: 'should we use quantum to break the AI-agent trigger gap?'",
    "",
    "Honest answer: no.",
    "",
    "Quantum computing solves COMPUTE problems (factoring, search, simulation,",
    "certain optimization). The AI-agent-trigger gap is an ARCHITECTURE problem:",
    "MCP clients (Claude Code, Cursor, etc.) only run AI inference when the user",
    "types something. There is no quantum API for 'make the client wake up by",
    "itself'. The right solution is a multi-channel notifier system + an",
    "autonomous Mneme agent that runs a local LLM (Ollama) when you have a GPU.",
    "",
    "We DO have an opt-in quantum-curious surface: future versions may use",
    "Grover's algorithm to amplify vector-search recall on quantum hardware",
    "via IBM's free Q tier. But Mneme today shouldn't pretend that's necessary.",
  ].join("\n");
}

/** Expected Grover iterations to find one matching item among N. */
export function groverIterations(N: number): number {
  if (N <= 1) return 0;
  return Math.floor((Math.PI / 4) * Math.sqrt(N));
}

/** Big-O speedup factor of Grover vs classical search at N items. */
export function quantumSpeedupAt(N: number): number {
  if (N <= 1) return 1;
  return N / Math.max(1, groverIterations(N));
}
