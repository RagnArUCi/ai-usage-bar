# Seguridad

Esta app lee credenciales locales. Merece que digamos exactamente qué hace con
ellas.

## Qué hace y qué no

**Qué hace.** Lee las sesiones que los CLI y las apps de cada proveedor ya han
guardado en tu máquina, y las usa para consultar el endpoint oficial de consumo
de ese proveedor. Cuando un token caduca, lo renueva contra el endpoint de
autenticación oficial y guarda el nuevo en el mismo sitio de donde salió, para
no romper la sesión del CLI.

**Qué no hace.**

- No registra tokens en logs, mensajes de error ni salidas de depuración.
- No envía nada a ningún servidor propio: no hay servidor propio.
- No tiene analítica, telemetría ni informes de errores remotos.
- No pide credenciales al usuario. No hay ningún campo donde pegar un token.
- No escribe secretos en el repositorio. Cuando hace falta un secreto de
  cliente OAuth para renovar, se lee en ejecución del paquete instalado del
  proveedor.

## Dónde lee

| Proveedor | Origen |
|---|---|
| Claude | Llavero de macOS (`Claude Code-credentials`) o `~/.claude/.credentials.json` |
| Gemini | `~/.gemini/oauth_creds.json` |
| Kiro | `~/.aws/sso/cache/kiro-auth-token.json` |

A dónde salen: únicamente a `api.anthropic.com`, `cloudcode-pa.googleapis.com`,
`codewhisperer.<región>.amazonaws.com` y sus endpoints de renovación
correspondientes. La comprobación de actualizaciones consulta solo la API
pública de releases de GitHub y no envía ningún dato tuyo.

## Qué se guarda en tu equipo

En el directorio de datos de la app:

- `cache-<proveedor>.json` — la última lectura correcta (porcentajes y fechas)
- `history-<proveedor>.json` — historial de porcentajes, hasta 8 días
- `settings.json`, `notified.json` — preferencias y avisos ya mostrados

Ninguno contiene credenciales. El historial son porcentajes con su hora.

## Firma de los instaladores

Los binarios de macOS llevan **firma ad-hoc** pero **no están notarizados**:
notarizar exige una cuenta de desarrollador de Apple de pago. Consecuencias
prácticas:

- macOS avisará la primera vez y hay que autorizar la app a mano.
- La firma ad-hoc garantiza que el paquete no se ha alterado **después** de
  compilarse, pero no acredita quién lo compiló.

Si esa garantía no te vale, compila desde el código: `npm install && npm run dist`.
El workflow de GitHub Actions es la única fuente de los binarios publicados y
su registro de ejecución es público.

## Reportar una vulnerabilidad

Si encuentras algo que exponga credenciales o permita filtrarlas, **no abras
una incidencia pública**. Usa el aviso privado de seguridad de GitHub en este
repositorio (pestaña *Security* → *Report a vulnerability*).

Incluye, si puedes, cómo reproducirlo y qué versión usas. Y por favor no
adjuntes tus tokens reales en el reporte: describe el camino, no el secreto.
