'use strict';
// Generates build/icon.ico from the same renderer the tray uses, so the
// installer, taskbar and tray all share one mark. No image assets in the repo.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// icon.js pulls in electron for nativeImage; stub it so this runs under plain node.
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { nativeImage: { createFromBuffer: () => ({}) } };
  return origLoad.call(this, request, ...rest);
};

const { appIconPNG } = require('../src/main/icon.js');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16;
    entries[e] = size >= 256 ? 0 : size; // 0 means 256
    entries[e + 1] = size >= 256 ? 0 : size;
    entries[e + 2] = 0; // palette
    entries[e + 3] = 0; // reserved
    entries.writeUInt16LE(1, e + 4); // colour planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(data.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });

  return Buffer.concat([header, entries, ...pngs.map((p) => p.data)]);
}

const pngs = SIZES.map((size) => ({ size, data: appIconPNG(size) }));
const ico = buildIco(pngs);

const out = path.join(__dirname, '..', 'build', 'icon.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, ico);

// A 256px PNG is handy for docs and for Linux packaging later.
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), pngs[pngs.length - 1].data);

console.log(`wrote ${out} (${ico.length} bytes, sizes: ${SIZES.join(', ')})`);
