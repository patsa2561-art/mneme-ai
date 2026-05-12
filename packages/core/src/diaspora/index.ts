/**
 * v1.72.0 -- DIASPORA PROTOCOL.
 *
 * Four wild axes that crack open the cross-machine + cross-vendor +
 * cross-app barriers that kept Mneme local:
 *
 *   D1 GHOST SNIPER GITIGNORE  auto-append AI-tooling artifacts
 *                              on every inject (privacy-leak-proof)
 *   D2 SPORE DEFAULT-ON        git remote detected -> auto-enable
 *                              cross-machine sync (no manual opt-in)
 *   D3 PORTABLE SESSION CAPSULE  vendor A saves; vendor B resumes.
 *                              HMAC-signed; soul-mirror records the
 *                              inheritance event.
 *   D4 HTTP BRIDGE             localhost HTTP API + OpenAPI 3.1
 *                              spec + Custom GPT template. ChatGPT
 *                              Custom GPT "Actions" can call this.
 */

export * as gitignoreWriter from "./gitignore_writer.js";
export * as sporeAutostart from "./spore_autostart.js";
export * as sessionCapsule from "./session_capsule.js";
export * as httpBridge from "./http_bridge.js";

export {
  ensureGitignoreEntries, ensureSingleGitignoreEntry, readManagedEntries, PRIVATE_AI_ARTIFACTS,
} from "./gitignore_writer.js";
export {
  autoStartSpore, readGitRemotes, readSporeConfig, disableSpore,
  type SporeConfig, type GitRemote, type AutoStartResult,
} from "./spore_autostart.js";
export {
  saveCapsule, resumeCapsule, listCapsules,
  type SessionCapsule, type ResumeVerdict, type ResumeResult,
} from "./session_capsule.js";
export {
  startBridge, openapiSpec, customGptTemplate,
  type BridgeOptions, type BridgeHandle, type BridgeHandlers,
} from "./http_bridge.js";
