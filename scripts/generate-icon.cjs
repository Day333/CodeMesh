// Reproducible PNG and Windows ICO without external image tooling.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.join(__dirname, "..", "assets");
fs.mkdirSync(root, { recursive: true });

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const label = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([size, label, data, checksum]);
}

function rounded(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function sample(x, y) {
  if (!rounded(x, y, 9, 9, 247, 247, 55)) return [0, 0, 0, 0];
  const mix = y / 256;
  let color = [
    Math.round(28 - 14 * mix),
    Math.round(53 - 27 * mix),
    Math.round(85 - 30 * mix),
    255,
  ];
  if (
    rounded(x, y, 18, 18, 238, 238, 49) &&
    !rounded(x, y, 21, 21, 235, 235, 46)
  )
    color = [91, 132, 167, 255];
  const tiles = [
    [63, 63, 119, 119, [142, 190, 251, 255]],
    [137, 63, 193, 119, [108, 222, 198, 255]],
    [63, 137, 119, 193, [108, 222, 198, 255]],
    [137, 137, 193, 193, [142, 190, 251, 255]],
  ];
  for (const [left, top, right, bottom, fill] of tiles) {
    if (rounded(x, y, left, top, right, bottom, 14)) color = fill;
  }
  if (rounded(x, y, 121, 121, 135, 135, 7)) color = [238, 251, 248, 255];
  return color;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const accum = [0, 0, 0, 0];
      for (let sy = 0; sy < 2; sy++)
        for (let sx = 0; sx < 2; sx++) {
          const rgba = sample(
            ((x + (sx + 0.5) / 2) * 256) / size,
            ((y + (sy + 0.5) / 2) * 256) / size,
          );
          rgba.forEach((value, index) => {
            accum[index] += value / 4;
          });
        }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let channel = 0; channel < 4; channel++)
        raw[offset + channel] = Math.round(accum[channel]);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes = [16, 32, 48, 256];
const images = sizes.map(png);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const position = 6 + index * 16;
  header[position] = sizes[index] === 256 ? 0 : sizes[index];
  header[position + 1] = sizes[index] === 256 ? 0 : sizes[index];
  header[position + 2] = 0;
  header[position + 3] = 0;
  header.writeUInt16LE(1, position + 4);
  header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(image.length, position + 8);
  header.writeUInt32LE(offset, position + 12);
  offset += image.length;
});
fs.writeFileSync(
  path.join(root, "icon.ico"),
  Buffer.concat([header, ...images]),
);
fs.writeFileSync(path.join(root, "icon.png"), images.at(-1));
console.log("Generated assets/icon.ico and assets/icon.png");
