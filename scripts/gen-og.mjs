/**
 * Generate the social share image (OG / Twitter card) → packages/xray/public/og.png (1200×630).
 * Branded hub card for the Cross-Layer Accountability Suite — static PNG (no emoji: the rasterizer has
 * no emoji font, so icons are simple glyphs). Run: node scripts/gen-og.mjs
 */
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const W = 1200, H = 630;
const checks = [
  ["⟲", "Review"], ["◎", "Impact Radar"], ["⬡", "Drop Safety"], ["⇄", "Agent Collision"], ["✦", "Scope Covenant"],
  ["✎", "Commit Honesty"], ["⚗", "Test Gap"], ["◉", "Risk Hotspots"], ["⚿", "Authz Gap"], ["➤", "Onboarding"],
];
const chips = checks.map((c, i) => {
  const col = i % 5, rowI = Math.floor(i / 5);
  const x = 70 + col * 215, y = 392 + rowI * 70;
  return `<g transform="translate(${x},${y})"><rect width="200" height="54" rx="11" fill="#0f1b2e" stroke="#1f2937"/>` +
    `<text x="18" y="34" font-size="22" fill="#22d3ee">${c[0]}</text>` +
    `<text x="46" y="34" font-size="17" fill="#cbd5e1" font-family="-apple-system,Segoe UI,Roboto,sans-serif">${c[1]}</text></g>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
<radialGradient id="bg" cx="22%" cy="-10%"><stop offset="0" stop-color="#11203a"/><stop offset="70%" stop-color="#0b1220"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="22" fill="none" stroke="#1f2937" stroke-width="2"/>
<text x="70" y="118" font-size="26" font-weight="800" fill="#22d3ee" letter-spacing="1">MNEME</text>
<text x="70" y="210" font-size="74" font-weight="900" fill="url(#g)">Cross-Layer</text>
<text x="70" y="288" font-size="74" font-weight="900" fill="#e5e7eb">Accountability</text>
<text x="70" y="340" font-size="27" fill="#94a3b8">Paste any repo → a graded report across code · data · api · business.</text>
${chips}
<rect x="70" y="540" width="560" height="48" rx="10" fill="#0b1220" stroke="#2b3a52"/>
<text x="92" y="571" font-size="21" font-family="ui-monospace,Menlo,Consolas,monospace" fill="#67e8f9">$ npm i -g mneme-ai &amp;&amp; mneme review</text>
<text x="${W - 70}" y="571" text-anchor="end" font-size="19" fill="#64748b">deterministic · no LLM · signed</text>
</svg>`;

mkdirSync("packages/xray/public", { recursive: true });
await sharp(Buffer.from(svg)).png().toFile("packages/xray/public/og.png");
console.log("wrote packages/xray/public/og.png (1200x630)");
