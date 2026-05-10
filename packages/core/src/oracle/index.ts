/**
 * MNEME ORACLE -- precognition cache for AI tool calls.
 *
 *   import * as oracle from "@mneme-ai/core/oracle";
 *
 *   oracle.recordObservation(repo, "mneme.who_knows", ["query"]);
 *   oracle.predictNext(repo, "mneme.who_knows", 3);
 *   oracle.dreamCycle(repo);
 *   oracle.peekCache(repo);
 *   oracle.oracleStats(repo);
 *
 * See types.ts for the algorithm explanation. Three layers:
 *   1. Markov bigram   (stationary "what follows what")
 *   2. ACO pheromone   (time-decaying "what's hot right now")
 *   3. Dream loop      (proactive pre-fetch in idle daemon time)
 */

export * from "./types.js";
export {
  buildBigrams, transitionProbabilities, topKMarkov, uniqueTools,
} from "./markov.js";
export {
  evaporate, reinforce, pheromoneScores, tauOf,
} from "./pheromone.js";
export {
  recordObservation, predictNext, dreamCycle,
  peekCache, oracleStats, resetOracle, renderOracleHint,
} from "./oracle.js";
