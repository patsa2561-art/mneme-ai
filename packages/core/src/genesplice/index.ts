/**
 * v1.73.0 -- GENESPLICE PROTOCOL.
 *
 * Genetic engineering for AI brains. Six axes that together make
 * Mneme's memory cross-vendor portable WITHOUT requiring browser
 * extensions, cloud deploys, or vendor approval:
 *
 *   G1 SOUL PROMPT             ~500-token paste-able brain
 *   G2 GENOME RECOMBINATION    merge N vendor genomes via CRDT
 *   G3 GIST BRAIN TRANSFER     user's GitHub gist = portable cloud
 *   G4 CHROMOSOMAL CROSSOVER   preserve disagreements, not majority-rule
 *   G5 PHENOTYPE EXPRESSION    vendor-specific behavior from same genome
 *   G6 BROWSER PASTE PROTOCOL  universal format that works in any chat
 *
 * Vision: user pastes 500 tokens into Gemini -> Gemini knows everything
 * from the Claude Code session. ZERO install. Works TODAY.
 */

export * as soulPrompt from "./soul_prompt.js";
export * as genomeRecombine from "./genome_recombine.js";
export * as gistTransmit from "./gist_transmit.js";
export * as phenotype from "./phenotype.js";

export {
  compressToSoulPrompt, parseSoulPrompt,
  type SoulPrompt, type SoulPromptInput, type ParsedSoulPrompt,
} from "./soul_prompt.js";

export {
  recombineGenome, uniqueWisdom, consensusWisdom,
  type HybridCapsule, type RecombineInput,
} from "./genome_recombine.js";

export {
  packageGist, parseGistUrl, extractSoulFromGist,
  type GistPackage, type GistTransmitInput, type ParsedGistUrl,
} from "./gist_transmit.js";

export {
  expressPhenotype, expressSoulForVendor,
  type VendorPhenotype, type PhenotypeStyle,
} from "./phenotype.js";
