/**
 * v1.57.0 -- SOVEREIGNTY KERNEL public API.
 *
 * Three surfaces:
 *
 *   - sovereignAsk(opts)  -- one-shot grounded answer (the main entry)
 *   - buildContext()      -- exposed for the explainer / debug
 *   - ollamaHealth()      -- caller can pre-flight check before spawning UI
 */

export { sovereignAsk, type SovereignAnswer, type SovereignAskOptions, type AnswerVerdict } from "./answer.js";
export { buildContext, type BuiltContext, type ContextSlice } from "./context_builder.js";
export { ollamaHealth, ollamaGenerate, type OllamaGenerateOptions, type OllamaResponse } from "./ollama_client.js";
