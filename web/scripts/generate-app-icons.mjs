// Original geometric bottle drawing, created for this project on 2026-10-08.
// No reference image, logo, downloaded bitmap, font or third-party icon is used.
// Coordinates use a 100 x 100 canvas; output is a standard RGBA PNG.
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const colors = { paper: [255, 252, 247], gold: [232, 185, 54], ink: [20, 46, 77] };
function roundedRect(x, y, left, top, width, height, radius) {
  if (x < left || x > left + width || y < top || y > top + height) return false;
  const cx = Math.max(left + radius, Math.min(x, left + width - radius));
  const cy = Math.max(top + radius, Math.min(y, top + height - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
function pixel(x, y) {
  let color = colors.paper;
  if (roundedRect(x, y, 28, 33, 44, 48, 9)) color = colors.ink;
  if (roundedRect(x, y, 33, 38, 34, 38, 5)) color = colors.gold;
  if (roundedRect(x, y, 32, 25, 36, 12, 4)) color = colors.ink;
  if (roundedRect(x, y, 38, 29, 24, 4, 1)) color = colors.paper;
  if (roundedRect(x, y, 44, 15, 12, 14, 5)) color = colors.ink;
  if (roundedRect(x, y, 48, 19, 4, 10, 2)) color = colors.paper;
  if ((x >= 52 && x <= 61 && y >= 48 && y <= 51) ||
      (x >= 52 && x <= 58 && y >= 58 && y <= 61)) color = colors.ink;
  return color;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, checksum]);
}
for (const size of [192, 512]) {
  const stride = 1 + size * 4, raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Four samples smooth the edges without an external graphics dependency.
    const rgb = [0, 0, 0];
    for (const dy of [.25, .75]) for (const dx of [.25, .75]) {
      const sample = pixel((x + dx) * 100 / size, (y + dy) * 100 / size);
      for (let i = 0; i < 3; i++) rgb[i] += sample[i] / 4;
    }
    const offset = y * stride + 1 + x * 4;
    for (let i = 0; i < 3; i++) raw[offset + i] = Math.round(rgb[i]);
    raw[offset + 3] = 255;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  await writeFile(new URL(`../public/icon-${size}.png`, import.meta.url), png);
}
console.log("Generated original 192 x 192 and 512 x 512 bottle app icons.");
