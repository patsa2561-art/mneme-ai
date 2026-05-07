// One-time placeholder icon generator. Produces a 128×128 PNG with a
// dark indigo Mneme-purple gradient. Replace media/icon.png with a
// real designed asset before publishing to the Marketplace.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const W = 128;
const H = 128;

function crc32(buf) {
  let r = 0xffffffff;
  for (const b of buf) {
    r ^= b;
    for (let i = 0; i < 8; i++) r = (r >>> 1) ^ (0xedb88320 & -(r & 1));
  }
  return (r ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;     // bit depth
ihdr[9] = 2;     // color type RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const px = [];
for (let y = 0; y < H; y++) {
  px.push(0); // filter byte
  for (let x = 0; x < W; x++) {
    // mneme-y dark gradient
    const r = Math.floor(11 + (x / W) * 60);
    const g = Math.floor(11 + (y / H) * 40);
    const b = Math.floor(20 + (x / W) * 200);
    px.push(r, g, b);
  }
}

const idat = zlib.deflateSync(Buffer.from(px));
const out = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);

const target = path.resolve(__dirname, "..", "media", "icon.png");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out);
console.log("wrote", target, out.length, "bytes");
