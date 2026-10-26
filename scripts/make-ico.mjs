// Packs PNG-compressed .ico from square PNGs. Usage:
//   node scripts/make-ico.mjs <out.ico> <16.png> <32.png> <48.png>
// ponytail: ICO with PNG entries is a tiny header — stdlib only, no raster dep
// (Chrome headless --screenshot renders the SVG source).
import { readFileSync, writeFileSync } from 'node:fs';

const [out, ...pngPaths] = process.argv.slice(2);
if (!out || pngPaths.length === 0) {
  console.error('usage: node scripts/make-ico.mjs <out.ico> <png...>');
  process.exit(1);
}
const images = pngPaths.map((p) => {
  const data = readFileSync(p);
  // PNG IHDR: width/height are big-endian u32 at offsets 16/20.
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== height || width > 256) throw new Error(`not a square icon PNG: ${p}`);
  return { data, size: width === 256 ? 0 : width };
});

const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // .ico
header.writeUInt16LE(images.length, 4); // count
let offset = header.length;
images.forEach((img, i) => {
  const o = 6 + i * 16;
  header.writeUInt8(img.size, o); // width (0 = 256)
  header.writeUInt8(img.size, o + 1); // height
  header.writeUInt8(0, o + 2); // palette colors
  header.writeUInt8(0, o + 3); // reserved
  header.writeUInt16LE(1, o + 4); // planes
  header.writeUInt16LE(32, o + 6); // bpp
  header.writeUInt32LE(img.data.length, o + 8);
  header.writeUInt32LE(offset, o + 12);
  offset += img.data.length;
});
writeFileSync(out, Buffer.concat([header, ...images.map((i) => i.data)]));

// Verify by re-reading the directory.
const back = readFileSync(out);
const count = back.readUInt16LE(4);
const sizes = Array.from({ length: count }, (_, i) => back.readUInt8(6 + i * 16) || 256);
console.log(`ico ok: ${count} entries (${sizes.join('/')}) -> ${out}`);
