# Cómo contribuir

Gracias por pasarte. Este proyecto es pequeño y las reglas son pocas, pero hay
una que importa más que el resto.

## La regla central

**Si no se puede leer el consumo real de un proveedor, no se muestra un número.**

Nada de estimaciones, extrapolaciones ni ceros de relleno. Si un proveedor no
está configurado, o su API rechaza la consulta, su pastilla queda atenuada y el
panel explica qué falta. Un número inventado en una herramienta cuyo único
trabajo es medir es peor que no tener nada: destruye la confianza en todos los
demás números.

Cualquier cambio que rompa esto no entra, por bien escrito que esté.

## Empezar

```bash
git clone https://github.com/RagnArUCi/ai-usage-bar
cd ai-usage-bar
npm install
npm test              # unitarios, no tocan la red
npm run check-usage   # detecta proveedores y consulta de verdad, sin abrir la app
npm start             # ejecuta la app
```

`npm run check-usage` es la vía rápida para trabajar en un proveedor: dice qué
detecta, qué responde cada API y con qué porcentajes, sin arrancar Electron.
Solo imprime porcentajes, nunca tokens.

## Añadir un proveedor

Es el tipo de contribución más útil. Un módulo en `src/providers/`, registrarlo
en `src/providers/index.js`, y documentar el contrato en `docs/providers/`.

```js
module.exports = {
  id: 'miproveedor',
  name: 'Mi Proveedor',
  glyph: 'bars',
  hint: 'Qué tiene que hacer el usuario para configurarlo.',
  async detect() { /* solo disco, sin red */ },
  async fetch() {
    // -> { limits: [{kind, group, label, sublabel, pct, severity, resetsAt}] }
    // -> o { error, retryable, retryAfterMs?, detail? }
  },
};
```

Lo que se pide de un proveedor nuevo:

1. **Verificado contra una cuenta real.** Pega en el PR la forma de la
   respuesta (sin tokens ni identificadores personales). Si no has podido
   verificarlo, dilo: se acepta marcándolo como no verificado en el README,
   pero no se presenta como si funcionara.
2. **`docs/providers/<id>.md`** con el contrato: dónde están las credenciales,
   el endpoint exacto, la forma de la respuesta y cómo se renueva el token.
   Este documento es lo que evita que el siguiente tenga que reverse-ingeniar
   lo mismo.
3. **Tests del parser** con un recorte real de la respuesta. No hace falta
   mockear la red: basta con probar la normalización, que es donde están los
   errores de verdad.
4. **Tolerancia al formato.** Si el endpoint no está documentado, no asumas el
   nombre de la clave contenedora. El proveedor de Gemini busca los buckets de
   cuota donde estén, y eso lo salvó cuando resultó que el envoltorio se
   llamaba `buckets`.

### Credenciales

Se **leen**, nunca se piden. La app reutiliza la sesión que el CLI o la app del
proveedor ya guardó en la máquina. No añadas campos donde el usuario pegue un
token: es una superficie de riesgo que no hace falta.

Si un secreto de cliente OAuth es necesario para renovar, léelo en tiempo de
ejecución del paquete instalado del proveedor (como hace `src/providers/gemini.js`).
**No lo escribas en el repositorio.**

## Antes de abrir el PR

```bash
npm test
npx electron-builder --dir   # solo si tocaste package.json o el workflow
```

Lo segundo importa: `npm test` no detecta una configuración de compilación
inválida. Ya hubo una release que falló en las tres plataformas por eso.

## Estilo

- Español en comentarios, textos de interfaz y mensajes de commit.
- El comentario explica **por qué**, no qué hace la línea. Si el código
  necesita que expliques qué hace, reescribe el código.
- **Sin dependencias de runtime.** La app no tiene ninguna y merece la pena
  mantenerlo: los iconos se generan con un codificador PNG propio en
  `src/png.js`. Una dependencia nueva necesita justificación.
- Nada de formateadores automáticos en el PR: los cambios de estilo masivos
  entierran el cambio real.

## Errores

Al reportar un fallo, ayuda mucho incluir la salida de `npm run check-usage`
—que no expone tokens— y el sistema operativo. Si es un fallo visual, una
captura del panel.

Si el problema es de autenticación, revisa antes si es un **401** (sesión
caducada de verdad) o un **403** (la sesión vale y el servicio rechaza la
cuenta). La app los distingue y cita el motivo que da la API; ese texto es la
pista más útil que puedes pegar.

## Seguridad

Si encuentras algo que exponga tokens o credenciales, mira `SECURITY.md` antes
de abrir una incidencia pública.

## Agentes de IA

Si trabajas con un asistente de código, `AGENTS.md` recoge la arquitectura, los
invariantes y una lista de trampas ya pisadas que conviene no reintroducir.
