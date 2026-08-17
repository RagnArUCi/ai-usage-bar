// Prueba sin Electron: detecta los proveedores configurados y consulta su
// consumo. Muestra SOLO porcentajes, nunca tokens.
'use strict';

const { PROVIDERS } = require('../src/providers');

(async () => {
  for (const p of PROVIDERS) {
    let detected = false;
    try {
      detected = await p.detect();
    } catch (e) {
      console.log(`${p.name}: fallo al detectar (${e.code || e.message})`);
      continue;
    }
    if (!detected) {
      console.log(`${p.name}: sin configurar — ${p.hint}`);
      continue;
    }
    const r = await p.fetch();
    if (r.error) {
      console.log(`${p.name}: error ${r.error}${r.retryable ? ' (reintentable)' : ''}`);
      continue;
    }
    console.log(`${p.name}:`);
    for (const l of r.limits) {
      const reset = l.resetsAt ? ` · reinicia ${new Date(l.resetsAt).toLocaleString()}` : '';
      console.log(`   ${l.label}: ${l.pct} % [${l.severity}]${reset}`);
    }
  }
})();
