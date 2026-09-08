'use strict';
const { nativeImage } = require('electron');
const { Bitmap, arc, disc, roundedRect } = require('./util/raster');
const { encodePNG } = require('./util/png');

const OK = [74, 222, 128];
const WARN = [251, 191, 36];
const CRIT = [248, 113, 113];
const IDLE = [148, 163, 184];

/** Severity colour for a 0-100 utilisation. */
function statusColor(used) {
  if (used === null || used === undefined || Number.isNaN(used)) return IDLE;
  if (used >= 85) return CRIT;
  if (used >= 60) return WARN;
  return OK;
}

function statusName(used) {
  if (used === null || used === undefined || Number.isNaN(used)) return 'idle';
  if (used >= 85) return 'critical';
  if (used >= 60) return 'warning';
  return 'ok';
}

// A 3x5 bitmap font, just enough for a two-digit percentage in the tray.
const GLYPHS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

function drawDigits(bmp, text, x, y, scale, color, alpha = 1) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) {
      cx += 2 * scale;
      continue;
    }
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (g[row][col] !== '1') continue;
        roundedRect(bmp, cx + col * scale, y + row * scale, scale, scale, 0, color, alpha);
      }
    }
    cx += 4 * scale;
  }
  return cx - scale; // width consumed, minus the trailing gap
}

/**
 * Draw the gauge ring.
 * @param {number} size    square pixel size
 * @param {number|null} used  0-100 utilisation, or null when unknown
 * @param {object} opts
 */
function drawGauge(size, used, { dark = true, showPercent = false, muted = false } = {}) {
  const bmp = new Bitmap(size, size);
  const c = size / 2;
  const radius = size * 0.345;
  const width = size * (showPercent ? 0.1 : 0.14);
  const color = muted ? IDLE : statusColor(used);
  const track = dark ? [255, 255, 255] : [15, 23, 42];

  arc(bmp, c, c, radius, width, 1, track, dark ? 0.24 : 0.18);

  const sweep = used === null || used === undefined ? 0 : Math.max(0, Math.min(100, used)) / 100;
  if (sweep > 0) arc(bmp, c, c, radius, width, sweep, color, 1);

  if (showPercent) {
    const value = used === null || used === undefined ? null : Math.round(used);
    const text = value === null ? '' : String(Math.min(99, value));
    if (text) {
      // Keep the digits comfortably inside the ring's inner diameter.
      const innerWidth = (radius - width / 2) * 2 * 0.8;
      let scale = Math.max(1, Math.round(size / 16));
      while (scale > 1 && text.length * 4 * scale - scale > innerWidth) scale--;
      const textWidth = text.length * 4 * scale - scale;
      drawDigits(bmp, text, Math.round(c - textWidth / 2), Math.round(c - (5 * scale) / 2), scale, color, 1);
    }
  } else if (used !== null && used !== undefined) {
    disc(bmp, c, c, size * 0.075, color, 0.9);
  }

  return bmp;
}

/** Tray image: rendered at 2x and tagged so Windows/macOS pick the crisp one. */
function trayImage(used, opts = {}) {
  const size = 32;
  const bmp = drawGauge(size, used, opts);
  return nativeImage.createFromBuffer(encodePNG(bmp.data, size, size), {
    width: size,
    height: size,
    scaleFactor: 2,
  });
}

/** Larger mark used for window icons and the About box. */
function appIconPNG(size = 256) {
  const bmp = new Bitmap(size, size);
  const c = size / 2;
  roundedRect(bmp, 0, 0, size, size, size * 0.22, [17, 20, 28], 1);
  arc(bmp, c, c, size * 0.3, size * 0.1, 1, [255, 255, 255], 0.16);
  arc(bmp, c, c, size * 0.3, size * 0.1, 0.68, OK, 1);
  disc(bmp, c, c, size * 0.06, OK, 0.95);
  return encodePNG(bmp.data, size, size);
}

function appIcon(size = 256) {
  return nativeImage.createFromBuffer(appIconPNG(size), { width: size, height: size, scaleFactor: 1 });
}

module.exports = { trayImage, appIcon, appIconPNG, statusColor, statusName, drawGauge };
