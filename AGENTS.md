# AGENTS.md

Instrucciones para agentes de IA que trabajen en este repositorio. Si eres una
persona, `CONTRIBUTING.md` cuenta lo mismo con menos aristas.

## Qué es esto

App de bandeja del sistema (Electron) que muestra el consumo de varios planes
de IA. Sin ventanas de escritorio: un icono con un porcentaje y un panel que
se abre al hacer clic.

```
npm install
npm test              # unitarios, sin red
npm run check-usage   # detecta proveedores y consulta de verdad, sin abrir la app
npm start             # ejecuta la app
npm run gen-icon      # regenera build/icon.png (se dibuja por código)
npm run dist          # compila el instalador de esta plataforma
```

## Reglas que no se negocian

**1. Si no se puede leer el consumo real, no se muestra un número.**
Es la regla central del producto. Nada de estimaciones, extrapolaciones ni
ceros de relleno. Si un proveedor no está configurado o su API rechaza la
consulta, su pastilla queda atenuada, sin barra, y el panel explica qué falta.
Un número inventado en una herramienta de medición es peor que no tener nada.

**2. Los tokens no se registran nunca.**
No los imprimas en logs, ni en mensajes de error, ni en salidas de depuración.
Solo viajan al endpoint oficial del proveedor. Si necesitas depurar
autenticación, imprime longitudes, fechas de caducidad o nombres de campo —
nunca el valor.

**3. No inventes contratos de API.**
Antes de escribir un proveedor, verifica el endpoint contra una cuenta real y
mira la respuesta cruda. Documenta lo que viste en `docs/providers/`. Si no
puedes verificarlo, dilo en el README en lugar de dar por bueno lo que
supones. En este repo hay varios casos en los que la documentación externa no
coincidía con la realidad.

**4. Cambios de configuración de compilación se validan compilando.**
`npm test` no detecta un `package.json` inválido. Ejecuta
`npx electron-builder --dir --mac --arm64` (o tu plataforma) antes de etiquetar
una versión. Hubo una release que falló en las tres plataformas por una clave
de comentario en `package.json`; electron-builder valida estricto y rechaza
propiedades desconocidas.

**5. Cuidado con el ritmo de las consultas.**
Estas APIs limitan. La capa de resiliencia existe por eso y no es decorativa:
si añades una llamada, hazla pasar por el poller. No metas `setInterval` con
llamadas de red por tu cuenta.

## Arquitectura

```
main.js                  proceso principal: bandeja, panel, IPC, avisos
src/poller.js            ritmo adaptativo, backoff, caché — la capa de resiliencia
src/store.js             ajustes, caché e historial, separados por proveedor
src/forecast.js          ritmo de consumo y proyección por mínimos cuadrados
src/color.js             acento del sistema con ajuste de contraste
src/trayIcon.js          iconos de bandeja generados en ejecución
src/png.js src/logo.js src/font.js   dibujo e codificación PNG, sin dependencias
src/providers/           un módulo por proveedor + registro
src/panel/               interfaz del panel (renderer aislado, sandbox)
src/preload.js           puente contextBridge
```

### Añadir un proveedor

Un módulo en `src/providers/`, registrarlo en `src/providers/index.js`, y
documentar el contrato en `docs/providers/<id>.md`.

```js
module.exports = {
  id: 'miproveedor',
  name: 'Mi Proveedor',
  glyph: 'bars',                 // 'sunburst' | 'gemini' | 'ghost' | 'bars'
  hint: 'Qué tiene que hacer el usuario para configurarlo.',
  async detect() { /* SOLO disco. Sin red. Rápido. */ },
  async fetch() {
    // -> { limits: [{kind, group, label, sublabel, pct, severity, resetsAt}] }
    // -> o { error, retryable, retryAfterMs?, detail? }
  },
};
```

- `group` elige el perfil de proyección: `session`, `daily`, `weekly`, `monthly`.
  Importa: extrapolar un ritmo horario a una ventana semanal predice el
  agotamiento para mañana, porque asume que nadie duerme.
- `severity`: si la API la reporta, respétala. Si no, `severityFor(pct)` de
  `src/providers/severity.js`. **No** la importes de `index.js`: ese módulo
  importa los proveedores, y la dependencia circular deja la función a medias.
- `detect()` no hace red porque corre al arrancar, para los tres proveedores.
- Añade el proveedor a `ACTIVITY_PATHS` en `src/poller.js` si su CLI deja
  rastro local al usarse; así se consulta seguido solo cuando el número puede
  moverse.

### Errores: 401 no es lo mismo que 403

Un **401** es sesión caducada: el mensaje correcto es "vuelve a iniciar sesión".
Un **403** suele ser que la sesión es válida y el servicio rechaza la cuenta
(falta de licencia, permisos). Mandar a iniciar sesión en ese caso no arregla
nada y hace perder el tiempo. Devuelve `detail` con el mensaje literal de la
API y el panel lo cita.

## Trampas ya pisadas

Están todas resueltas en el código; se listan para no reintroducirlas.

**CSS: `[hidden]` pierde contra un `display` explícito.** La hoja del navegador
trae `[hidden] { display: none }`, pero cualquier `display` de la hoja de autor
gana. Por eso `panel.css` refuerza `[hidden] { display: none !important }`.

**`hidden` no existe en SVG.** Es una propiedad de `HTMLElement`; un `<svg>` es
`SVGElement`. `svg.hidden = false` no quita el atributo: hay que usar
`removeAttribute('hidden')`.

**Nada de `<select>` nativo en el panel.** El panel se cierra al perder el
foco, y un desplegable nativo se lo quita. Usa el control segmentado de
botones que ya está.

**La tarjeta pinta su propio fondo opaco.** `transparent: true` y `vibrancy`
entran en conflicto en macOS: la vibrancia no llega a pintar y el texto queda
sobre el escritorio, ilegible con fondos claros. La legibilidad no puede
depender de lo que haya detrás de la ventana.

**El acento del sistema puede ser ilegible.** Lo elige el usuario y puede ser
cualquier color; un amarillo claro sobre fondo claro da contraste 1,05.
`src/color.js` mide el contraste real y ajusta la luminosidad hasta 3:1
conservando el matiz. No lo saltes.

**Los timestamps no siempre vienen en milisegundos.** Kiro devuelve
`nextDateReset` en segundos. Y trae un `daysUntilReset` que llega en 0 aunque
el reinicio sea dentro de once días: no te fíes de campos derivados, calcula
desde el timestamp.

**Las marcas de los proveedores son monocromas a propósito.** Heredan
`currentColor` para teñirse en claro, en oscuro y sobre la pastilla
seleccionada. Un logo a todo color no se adapta a esos tres fondos.

## Al preparar una release

El workflow compila en las tres plataformas y **un solo job** crea el Release.
No lo cambies para que publique cada plataforma por su cuenta: los tres jobs
intentarían crear el mismo Release a la vez y el último en escribir se lleva
por delante las subidas de los otros. Pasó, y el Release acabó con un solo
instalador de tres.

El Release queda en **borrador** a propósito; las notas se escriben a mano
antes de publicarlo con `gh release edit <tag> --draft=false`.

Los eventos de push de etiquetas en GitHub Actions **tardan**. Si tras empujar
la etiqueta no ves la ejecución, espera unos minutos antes de concluir que no
se disparó: re-empujar la etiqueta acumula ejecuciones duplicadas.

## Estilo

Español en comentarios, mensajes de interfaz y de commit. El comentario
explica **por qué**, no qué hace la línea. Sin dependencias de runtime: la app
no tiene ninguna y conviene que siga así (los iconos se dibujan con un
codificador PNG propio en `src/png.js`).
