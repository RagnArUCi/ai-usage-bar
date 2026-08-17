// Genera build/icon.png (512x512): fondo redondeado + marca de medidor.
// electron-builder lo convierte a .icns (mac), .ico (win) y .png (linux).
'use strict';

const fs = require('fs');
const path = require('path');
const { encodePNG } = require('../src/png');
const { drawBars, fillRoundedRect } = require('../src/logo');

const SIZE = 512;
const rgba = Buffer.alloc(SIZE * SIZE * 4);

fillRoundedRect(rgba, SIZE, SIZE, 100, [42, 120, 214]); // #2a78d6
drawBars(rgba, SIZE, SIZE, {
  cx: SIZE / 2,
  cy: SIZE / 2,
  size: SIZE * 0.52,
  color: [252, 252, 251],
});

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePNG(SIZE, SIZE, rgba));
console.log(`OK: ${out}`);
