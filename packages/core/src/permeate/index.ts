/**
 * v1.74.0 -- PERMEATE PROTOCOL.
 *
 * Reaching every AI tool on Earth via four paths:
 *
 *   P1 USERSCRIPT GENERATOR     Tampermonkey-ready .user.js for
 *                                ChatGPT/Gemini/Claude.ai/Copilot/DeepSeek/Qwen
 *                                NO store approval, NO cloud, NO backend.
 *   P2 BOOKMARKLET GENERATOR    single-line javascript: URI fallback.
 *                                Works even if userscript isn't installed.
 *   P3 EDITOR INTEGRATION MAP    matrix of 15 AI tools + how Mneme
 *                                connects to each (most via MCP; no work
 *                                needed for editor-based tools).
 *   P4 TRANSPORT MENU            4 ranked cross-machine transfer methods
 *                                (clipboard / Gist / Wanderer / QR).
 */

export * as userscriptGenerator from "./userscript_generator.js";
export * as bookmarkletGenerator from "./bookmarklet_generator.js";
export * as editorIntegrationMap from "./editor_integration_map.js";
export * as transportMenu from "./transport_menu.js";

export {
  generateUserscript, type UserscriptOptions, type UserscriptArtifact,
} from "./userscript_generator.js";
export {
  generateBookmarklet, type BookmarkletOptions, type BookmarkletArtifact,
} from "./bookmarklet_generator.js";
export {
  EDITOR_INTEGRATIONS, reportIntegrations, filterIntegrations,
  type EditorIntegration, type IntegrationKind, type IntegrationReport,
} from "./editor_integration_map.js";
export {
  TRANSPORT_OPTIONS, recommendTransport,
  type TransportOption, type TransportMethod, type TransportRecommendation,
} from "./transport_menu.js";
