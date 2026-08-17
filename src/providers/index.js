// Registro de proveedores.
//
// Un proveedor es un módulo con esta forma:
//
//   id        identificador estable (se usa en ficheros y ajustes)
//   name      nombre visible
//   glyph     marca geométrica para la rejilla del panel
//   detect()  -> Promise<boolean>   ¿está configurado en esta máquina?
//              Solo mira el disco: nunca hace red.
//   fetch()   -> Promise<{limits:[…]} | {error, retryable, retryAfterMs?}>
//
// Cada límite normalizado:
//   {kind, group, label, sublabel, pct, severity, resetsAt}
//
// Regla de la casa: si no se puede leer el consumo real de un proveedor, no
// se muestra un número. Se dice que no está configurado y por qué.
'use strict';

const { severityFor } = require('./severity');
const claude = require('./claude');
const gemini = require('./gemini');

const PROVIDERS = [claude, gemini];

function byId(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

module.exports = { PROVIDERS, byId, severityFor };
