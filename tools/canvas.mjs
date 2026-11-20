/**
 * بذرة Canvas 2D للرسم — تُستخدم من أدوات التوليد.
 * أُبقيت منفصلة صغيرة: شرائح + أشكال أساسية مع حواف ناعمة.
 */
export function createCanvas(size) {
  const data = Buffer.alloc(size * size * 4);
  const lerp = (a, b, t) => a + (b - a) * t;
  const api = {
    size,
    data,
    blend(x, y, [r, g, b], a = 1) {
      if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
      const i = (y * size + x) * 4;
      const alpha = Math.min(1, a);
      data[i] = Math.round(lerp(data[i], r, alpha));
      data[i + 1] = Math.round(lerp(data[i + 1], g, alpha));
      data[i + 2] = Math.round(lerp(data[i + 2], b, alpha));
      data[i + 3] = Math.round(lerp(data[i + 3], 255, alpha));
    },
    /** تغطية مستطيل مستدير مع تنعيم حواف (SSAA) */
    roundRect(x0, y0, w, h, radius, color) {
      const x1 = x0 + w;
      const y1 = y0 + h;
      for (let y = Math.floor(y0 - 1); y < y1 + 1; y++) {
        for (let x = Math.floor(x0 - 1); x < x1 + 1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const cx = Math.min(Math.max(px, x0 + radius), x1 - radius);
          const cy = Math.min(Math.max(py, y0 + radius), y1 - radius);
          const d = Math.hypot(px - cx, py - cy);
          const cvg = Math.max(0, Math.min(1, radius - d + 0.5));
          const insideXY = px >= x0 ? Math.min(1, px - x0 + 0.5) : 0;
          const insideX2 = px <= x1 ? Math.min(1, x1 - px + 0.5) : 0;
          const insideY = py >= y0 ? Math.min(1, py - y0 + 0.5) : 0;
          const insideY2 = py <= y1 ? Math.min(1, y1 - py + 0.5) : 0;
          const cover = Math.min(cvg, insideXY, insideX2, insideY, insideY2);
          if (cover > 0) api.blend(x, y, color, cover);
        }
      }
    },
    circle(cx, cy, r, color) {
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
        for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const cover = Math.max(0, Math.min(1, r - d + 0.5));
          if (cover > 0) api.blend(x, y, color, cover);
        }
      }
    },
    /** ظل ناعم لشكل مستطيل مستدير (تدرّج تجاه الخارج) */
    shadow(x0, y0, w, h, radius, blur, color, opacity) {
      for (let y = Math.floor(y0 - blur); y < y0 + h + blur; y++) {
        for (let x = Math.floor(x0 - blur); x < x0 + w + blur; x++) {
          const px = Math.max(x0 + radius, Math.min(x + 0.5, x0 + w - radius));
          const py = Math.max(y0 + radius, Math.min(y + 0.5, y0 + h - radius));
          const dx = Math.max(x0 - (x + 0.5), 0, x + 0.5 - (x0 + w));
          const dy = Math.max(y0 - (y + 0.5), 0, y + 0.5 - (y0 + h));
          const outside = Math.hypot(
            x + 0.5 - Math.min(Math.max(x + 0.5, x0 + radius), x0 + w - radius),
            y + 0.5 - Math.min(Math.max(y + 0.5, y0 + radius), y0 + h - radius)
          );
          const dist = Math.hypot(dx, dy) || Math.max(0, outside - radius);
          if (dist > blur) continue;
          api.blend(x, y, color, opacity * (1 - dist / blur) ** 2);
        }
      }
    },
    heart(cx, cy, r, color) {
      for (let y = Math.floor(cy - r * 1.2); y <= cy + r * 1.2; y++) {
        for (let x = Math.floor(cx - r * 1.2); x <= cx + r * 1.2; x++) {
          const nx = (x + 0.5 - cx) / r;
          const ny = -(y + 0.5 - cy) / r;
          const f = (nx * nx + ny * ny - 1) ** 3 - nx * nx * ny ** 3;
          if (f <= 0) api.blend(x, y, color, 1);
        }
      }
    },
  };
  return api;
}
