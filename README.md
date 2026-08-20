# AI Usage Bar

Muestra el consumo de **todos tus planes de IA** a la vez, sin abrir nada:

- **macOS** — el porcentaje en la barra de menú superior.
- **Windows / Linux** — un icono con el número dentro (estilo indicador de batería) en la bandeja del sistema.

Al hacer clic se abre un panel con una pastilla por proveedor: cambias entre ellos con un toque y ves sus medidores, la tendencia y una proyección de cuándo se te agota al ritmo actual.

## Proveedores

| Proveedor | Estado | De dónde sale el dato |
|---|---|---|
| **Claude** | Verificado | Sesión de Claude Code (Llavero o `~/.claude/.credentials.json`) → endpoint oficial de uso. Sesión de 5 h y semanal, con la severidad que calcula el propio servidor. |
| **Gemini** | Verificado | Sesión del CLI de Gemini (`~/.gemini/oauth_creds.json`) → cuota de Gemini Code Assist. Un medidor por modelo (Pro, Flash, Flash Lite), con reinicio diario. |
| **Kiro** | Verificado | Sesión de IAM Identity Center que Kiro guarda en la caché de AWS SSO → `GetUsageLimits` de CodeWhisperer. Créditos consumidos del plan, con reinicio mensual y detalle del exceso si lo hay. |

**La regla de la casa: si no se puede leer el consumo real de un proveedor, no se muestra un número.** La pastilla aparece atenuada, sin barra, y el panel explica qué falta para configurarlo. Nunca se rellena con estimaciones.

### Por qué no están otros

- **Copilot** — GitHub no expone la cuota de *premium requests* en ninguna API pública. Solo existe un endpoint interno que usan los editores, sin documentar ni garantías.
- **Codex** — el endpoint existe (`chatgpt.com/backend-api/wham/usage`, leyendo `~/.codex/auth.json`), pendiente de verificarlo contra una sesión real del CLI.
- **Cursor, z.ai, MiniMax** — pendientes de poder verificar sus endpoints contra una cuenta real. Añadir uno es escribir un módulo (ver más abajo), no tocar la app.

### Cuando un proveedor rechaza la consulta

No todos los fallos son sesiones caducadas, y decir lo contrario manda al usuario a iniciar sesión en vano. La app distingue un **401** (la sesión sí caducó) de un **403** (la sesión es válida y el servicio rechaza la cuenta, por ejemplo por falta de licencia), y en ese caso **cita el motivo que devuelve la API** en lugar de inventar una explicación.

## Instalación

### Con un comando (recomendado)

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/RagnArUCi/ai-usage-bar/main/scripts/install.sh | sh
```

**Windows** (PowerShell)
```powershell
irm https://raw.githubusercontent.com/RagnArUCi/ai-usage-bar/main/scripts/install.ps1 | iex
```

Detecta tu sistema, baja el instalador correcto del último Release, lo instala y abre la app. En macOS quita la marca de cuarentena por ti.

### Descarga manual

| Sistema | Archivo |
|---|---|
| macOS (Apple Silicon) | `AI-Usage-x.x.x-arm64.dmg` |
| macOS (Intel) | `AI-Usage-x.x.x-x64.dmg` |
| Windows | `AI-Usage-Setup-x.x.x.exe` |
| Linux | `AI-Usage-x.x.x-x86_64.AppImage` |

Los instaladores llevan firma ad-hoc pero no están notarizados (eso exige cuenta de desarrollador de Apple de pago), así que la primera vez el sistema avisa. En macOS:

```bash
xattr -cr "/Applications/AI Usage.app"
```

En Windows, en el aviso de SmartScreen: **Más información → Ejecutar de todas formas**.

## Qué muestra el panel

- **Rejilla de proveedores** con un mini medidor cada uno, para ver de un vistazo cuál va más apretado.
- **Cifra principal** del proveedor seleccionado (o del más consumido, en automático).
- **Proyección** — "a este ritmo se agota sobre las 18:40". El tramo que se mide depende de la ventana: 1 hora para una sesión de 5 h, 12 para una diaria, 48 para una semanal, 7 días para una mensual. Extrapolar un ritmo horario a 7 días asumiría que trabajas sin dormir.
- **Tendencia** de la ventana actual.
- **Avisos** al cruzar el 80 % y el 95 %, una vez por umbral, ventana y proveedor.

Los medidores usan el **color de acento de tu sistema**. Como ese color lo eliges tú y puede ser cualquiera, la app mide el contraste real y ajusta la luminosidad hasta 3:1 conservando el matiz. Cuando un límite entra en zona de riesgo, el medidor pasa a colores de estado **acompañados de una etiqueta de texto**: el color nunca informa por sí solo.

## Cómo no acaba dando 429

Con varios proveedores el número de peticiones se multiplica, así que el control importa más que con uno solo:

1. **Ritmo adaptativo por proveedor.** Se vigila la actividad local de cada CLI y solo entonces se consulta cada 90 s. En reposo, cada 5 minutos.
2. **Arranque escalonado**, para que los proveedores no consulten todos en el mismo instante.
3. **Una sola petición en vuelo** por proveedor, y espera exponencial con jitter respetando `Retry-After`.
4. **Caché persistente e independiente.** Un fallo en un proveedor no afecta a los demás, y nunca borra su último dato bueno: el panel lo marca como "no reciente" en vez de dar error.

## Añadir un proveedor

Un módulo en `src/providers/` con esta forma, y registrarlo en `src/providers/index.js`:

```js
module.exports = {
  id: 'miproveedor',
  name: 'Mi Proveedor',
  glyph: 'bars',                  // 'sunburst' | 'gemini' | 'ghost' | 'bars'
  hint: 'Qué hacer para configurarlo.',
  async detect() { /* solo disco, sin red */ },
  async fetch() {
    // -> { limits: [{kind, group, label, sublabel, pct, severity, resetsAt}] }
    // -> o { error, retryable, retryAfterMs }
  },
};
```

`group` elige el perfil de proyección: `session`, `daily`, `weekly` o `monthly`. Si la API no reporta severidad, usa `severityFor(pct)` de `src/providers/severity.js`.

## Privacidad

Los tokens **nunca** salen de tu máquina ni se registran en logs: solo viajan a la API oficial de cada proveedor. La comprobación de actualizaciones consulta únicamente la API pública de releases de GitHub. No hay analítica ni servidores propios. El historial se guarda solo en tu equipo.

## Desarrollo

```bash
npm install
npm run gen-icon      # el icono se dibuja por código, sin binarios en el repo
npm run check-usage   # detecta proveedores y consulta su uso, sin abrir la app
npm test
npm start
npm run dist
```

## Documentación

| | |
|---|---|
| [Contratos de los proveedores](docs/providers/) | Credenciales, endpoints y forma de la respuesta de cada uno, tal y como se verificaron |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Cómo añadir un proveedor y qué se pide en un PR |
| [AGENTS.md](AGENTS.md) | Para agentes de IA: arquitectura, invariantes y trampas ya pisadas |
| [SECURITY.md](SECURITY.md) | Qué hace la app con tus credenciales, y qué no |
| [CHANGELOG.md](CHANGELOG.md) | Registro de cambios |

## Licencia

MIT — ver [LICENSE](LICENSE).
