/**
 * Public surface of the periodic table — Layer 1-3 of the Element /
 * Atom / Molecule architecture. Importing this module triggers the
 * catalog's side-effect registrations so consumers see a fully-populated
 * registry on first read.
 */
export * from "./manifest.js";
export * from "./registry.js";
import "./catalog.js";
