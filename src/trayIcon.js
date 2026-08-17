// Iconos de la bandeja, generados en tiempo de ejecución.
'use strict';

const { nativeImage } = require('electron');
const { encodePNG } = require('./png');
const { drawBars, fillRoundedRect } = require('./logo');

const BRAND = [42, 120, 214]; // #2a78d6
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return null;
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blanco o tinta oscura, según lo que contraste con el fondo. */
function inkFor([r, g, b]) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? [26, 26, 25] : WHITE;
}

/**
 * macOS: marca de medidor como "template image", que la barra de menú tiñe
 * automáticamente según el tema. El porcentaje va como texto con setTitle.
 */
function macTemplateIcon() {
  const make = (size) => {
    const rgba = Buffer.alloc(size * size * 4);
    drawBars(rgba, size, size, {
      cx: size / 2,
      cy: size / 2,
      size: size * 0.82,
      color: BLACK,
    });
    return encodePNG(size, size, rgba);
  };
  const img = nativeImage.createFromBuffer(make(18), { scaleFactor: 1 });
  img.addRepresentation({ scaleFactor: 2, buffer: make(36) });
  img.setTemplateImage(true);
  return img;
}

/**
 * Windows y Linux: la bandeja no admite texto al lado, así que el porcentaje
 * se dibuja dentro del icono (estilo indicador de batería). El color de fondo
 * lo marca la severidad.
 */
function percentIcon(text, severityColor) {
  const { drawText, textWidth } = require('./font');
  const size = 32;
  const rgba = Buffer.alloc(size * size * 4);
  const bg = hexToRgb(severityColor) || BRAND;
  fillRoundedRect(rgba, size, size, 7, bg);

  const scale = text.length <= 2 ? 3 : 2;
  const x = Math.round((size - textWidth(text, scale)) / 2);
  const y = Math.round((size - 7 * scale) / 2);
  drawText(rgba, size, size, text, x, y, scale, inkFor(bg));

  return nativeImage.createFromBuffer(encodePNG(size, size, rgba));
}

module.exports = { macTemplateIcon, percentIcon, BRAND };
