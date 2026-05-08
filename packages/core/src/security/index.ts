/**
 * Security primitives — opt-in cryptographic hardening.
 *
 *   • vault     — AES-256-GCM at-rest encryption (scrypt KDF)
 *   • audit-log — HMAC-SHA-256 chained tamper-evident log
 *
 * All are opt-in. Default behaviour preserved for backward compat.
 */
export * as vault from "./vault.js";
export * as auditLog from "./audit-log.js";
export * as keyRotate from "./key-rotate.js";
export * as scrubber from "./scrubber.js";
export * as compliance from "./compliance.js";
export * from "./auto.js";
