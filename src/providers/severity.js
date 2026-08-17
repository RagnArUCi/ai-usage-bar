// Umbrales locales de severidad, para proveedores cuya API no la reporta.
// (Claude sí la manda calculada por el servidor y entonces se respeta.)
//
// Vive en su propio módulo a propósito: si estuviera en el registro de
// proveedores, cada proveedor tendría que importar el registro que a su vez
// los importa a ellos, y la dependencia circular dejaría la función a medio
// cargar.
'use strict';

function severityFor(pct) {
  if (pct >= 95) return 'critical';
  if (pct >= 90) return 'serious';
  if (pct >= 80) return 'warning';
  return 'normal';
}

module.exports = { severityFor };
