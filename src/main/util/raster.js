'use strict';
// Tiny anti-aliased software rasterizer. Just enough to draw gauge rings and
// discs into an RGBA buffer that png.js can encode.

const SS = 4; // supersampling factor per axis

class Bitmap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
  }

  // source-over compositing of a straight-alpha colour
  blend(x, y, [r, g, b], a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    const da = d[i + 3] / 255;
    const outA = a + da * (1 - a);
    if (outA <= 0) return;
    d[i] = Math.round((r * a + d[i] * da * (1 - a)) / outA);
    d[i + 1] = Math.round((g * a + d[i + 1] * da * (1 - a)) / outA);
    d[i + 2] = Math.round((b * a + d[i + 2] * da * (1 - a)) / outA);
    d[i + 3] = Math.round(outA * 255);
  }

  // Fill every pixel whose supersampled coverage of `inside(px,py)` is > 0.
  fill(inside, color, alpha = 1, bounds = null) {
    const x0 = Math.max(0, Math.floor(bounds ? bounds[0] : 0));
    const y0 = Math.max(0, Math.floor(bounds ? bounds[1] : 0));
    const x1 = Math.min(this.w, Math.ceil(bounds ? bounds[2] : this.w));
    const y1 = Math.min(this.h, Math.ceil(bounds ? bounds[3] : this.h));
    const step = 1 / SS;
    const off = step / 2;
    const total = SS * SS;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            if (inside(x + sx * step + off, y + sy * step + off)) hits++;
          }
        }
        if (hits) this.blend(x, y, color, alpha * (hits / total));
      }
    }
  }
}

// Angle measured clockwise from 12 o'clock, in turns (0..1).
function turnAt(x, y, cx, cy) {
  const t = Math.atan2(x - cx, cy - y) / (Math.PI * 2);
  return t < 0 ? t + 1 : t;
}

function disc(bmp, cx, cy, r, color, alpha = 1) {
  bmp.fill(
    (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r,
    color,
    alpha,
    [cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1]
  );
}

/**
 * Stroke an arc of a ring with rounded caps.
 * @param {number} sweep portion of the full circle to draw, 0..1
 */
function arc(bmp, cx, cy, radius, width, sweep, color, alpha = 1) {
  if (sweep <= 0) return;
  const inner = radius - width / 2;
  const outer = radius + width / 2;
  const capR = width / 2;
  const full = sweep >= 1;
  const end = Math.min(sweep, 1);
  // rounded cap centres at the two ends of the arc
  const capAt = (t) => [cx + radius * Math.sin(t * Math.PI * 2), cy - radius * Math.cos(t * Math.PI * 2)];
  const [sx, sy] = capAt(0);
  const [ex, ey] = capAt(end);

  const inside = (x, y) => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (d2 <= inner * inner || d2 >= outer * outer) {
      if (full) return false;
      // still allow the rounded caps to bulge past the band
      return (x - sx) ** 2 + (y - sy) ** 2 <= capR * capR || (x - ex) ** 2 + (y - ey) ** 2 <= capR * capR;
    }
    if (full) return true;
    const t = turnAt(x, y, cx, cy);
    if (t <= end) return true;
    return (x - sx) ** 2 + (y - sy) ** 2 <= capR * capR || (x - ex) ** 2 + (y - ey) ** 2 <= capR * capR;
  };

  bmp.fill(inside, color, alpha, [cx - outer - 1, cy - outer - 1, cx + outer + 1, cy + outer + 1]);
}

function roundedRect(bmp, x0, y0, w, h, r, color, alpha = 1) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  const inside = (x, y) => {
    if (x < x0 || y < y0 || x > x1 || y > y1) return false;
    const qx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
    const qy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
    return (x - qx) ** 2 + (y - qy) ** 2 <= r * r;
  };
  bmp.fill(inside, color, alpha, [x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
}

module.exports = { Bitmap, arc, disc, roundedRect };
