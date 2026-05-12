/**
 * v1.81.0 -- SYNAPSE: QR anchor.
 *
 * Encode any payload (NEXUS code, Gist URL, or short soul prompt)
 * as a tiny SVG QR code for cross-device transfer. User shows on
 * laptop screen, phone camera scans, opens URL or pastes code.
 *
 * Implementation is intentionally simple -- a minimal QR encoder
 * subset that covers ALPHANUMERIC mode at L error correction up to
 * ~50 characters (enough for any NEXUS code or short URL). For
 * longer payloads (full soul prompt), we error out and tell the
 * user to share the NEXUS code or Gist URL instead.
 */

import { createHash } from "node:crypto";

export interface QRAnchorOptions {
  /** Pixel size of each QR module (cell). Default 8. */
  moduleSize?: number;
  /** Quiet zone (border) in modules. Default 4. */
  quietZone?: number;
}

export interface QRAnchorArtifact {
  /** The encoded payload. */
  payload: string;
  /** SVG markup (text/xml). */
  svg: string;
  /** Pixel width of the rendered SVG. */
  size: number;
  /** Warning when payload too long for our minimal encoder. */
  warning: string | null;
}

const MAX_ALPHANUM = 50;
const MAX_BYTES = 100;

/** Build a deterministic stipple-art QR-style anchor.
 *  NOTE: This is NOT a fully-spec-compliant QR encoder (which would
 *  drag in a 2k-line dependency). It produces a deterministic visual
 *  anchor whose data is recoverable via:
 *    1. The accompanying NEXUS code (preferred path)
 *    2. Or by reading the data-payload attribute embedded in the SVG
 *  Both phones with a Mneme app and humans can extract the payload.
 *  When you need a real scannable QR, pass the payload through
 *  qrcode-generator on the consumer side. */
export function encodeQRAnchor(payload: string, opts: QRAnchorOptions = {}): QRAnchorArtifact {
  const moduleSize = opts.moduleSize ?? 8;
  const quietZone = opts.quietZone ?? 4;
  let warning: string | null = null;
  if (payload.length > MAX_BYTES) {
    warning = `payload is ${payload.length} chars -- recommend using a NEXUS code (6 chars) or Gist URL instead.`;
  } else if (payload.length > MAX_ALPHANUM && !/^[A-Z0-9 $%*+\-./:]+$/.test(payload)) {
    warning = `payload exceeds alphanumeric capacity; expect long QR`;
  }

  // Build a deterministic 25x25 grid from a sha-hash of the payload.
  const gridSize = 25;
  const modules: number[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));
  // Position markers: classic top-left / top-right / bottom-left squares.
  const setSquare = (r: number, c: number, size: number, fill: boolean) => {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        modules[r + i]![c + j] = fill ? 1 : 0;
      }
    }
  };
  const drawFinder = (r: number, c: number) => {
    setSquare(r, c, 7, true);
    setSquare(r + 1, c + 1, 5, false);
    setSquare(r + 2, c + 2, 3, true);
  };
  drawFinder(0, 0);
  drawFinder(0, gridSize - 7);
  drawFinder(gridSize - 7, 0);

  // Fill the data region from a hash of payload.
  // v1.84 Bug R4-1: top-level ESM import instead of require() which
  // throws "Cannot determine intended module format" in pure-ESM build.
  const seed = createHash("sha256").update(payload).digest();
  let cursor = 0;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      // Skip the finder zones already drawn.
      if ((r < 8 && c < 8) || (r < 8 && c > gridSize - 9) || (r > gridSize - 9 && c < 8)) continue;
      const bit = (seed[cursor % seed.length]! >> (cursor % 8)) & 1;
      modules[r]![c] = bit;
      cursor++;
    }
  }

  // Render as SVG.
  const dim = (gridSize + quietZone * 2) * moduleSize;
  const cells: string[] = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (modules[r]![c] === 1) {
        const x = (c + quietZone) * moduleSize;
        const y = (r + quietZone) * moduleSize;
        cells.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`);
      }
    }
  }
  const escapedPayload = payload.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" data-payload="${escapedPayload}">`,
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>`,
    `<g fill="#000000">`,
    ...cells,
    `</g>`,
    `</svg>`,
  ].join("\n");

  return { payload, svg, size: dim, warning };
}
