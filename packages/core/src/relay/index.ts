/**
 * v1.85.0 -- RELAY: paste-backed cross-vendor brain transport.
 *
 * paste_backend     -- upload soul to public anonymous paste services
 * encrypted_payload -- AES-256-GCM with NEXUS code as derived key
 * mobile_recipe     -- single-line prompt + QR for mobile AI apps
 *
 * Net effect: PC mints NEXUS code + encrypts soul + uploads to a public
 * paste service. Mobile user gets ONE LINE to paste in Gemini/Claude/
 * ChatGPT. The AI fetches, decrypts, resumes. No cloud deploy on our
 * side; no Mneme install on destination.
 */

export * from "./paste_backend.js";
export * from "./encrypted_payload.js";
export * from "./mobile_recipe.js";
export * from "./deep_link.js";
export * from "./handoff_artifact.js";
