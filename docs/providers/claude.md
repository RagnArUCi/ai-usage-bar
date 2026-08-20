# Claude

Verificado contra planes de suscripción de Claude Code.

## Credenciales

La sesión que Claude Code ya guarda:

- macOS: Llavero, servicio `Claude Code-credentials`
- Todos: `~/.claude/.credentials.json`

Estructura: `claudeAiOauth` con `accessToken`, `refreshToken`, `expiresAt`
(milisegundos), `scopes`, `subscriptionType`.

Pueden existir **las dos fuentes a la vez** (un fichero viejo y el Llavero al
día), así que se elige la de `expiresAt` más lejano.

## Consumo

```
POST(GET) https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <accessToken>
anthropic-beta: oauth-2025-04-20
Content-Type: application/json
```

### Respuesta

Lo importante es el array **`limits`**, que es autodescriptivo:

```json
{
  "limits": [
    { "kind": "session", "group": "session", "percent": 22,
      "severity": "normal", "resets_at": "...", "is_active": true },
    { "kind": "weekly_all", "group": "weekly", "percent": 21, "...": "..." }
  ]
}
```

Dos cosas que lo hacen el proveedor más cómodo de los tres:

1. **La severidad la calcula el servidor** (`normal`, `warning`, `serious`,
   `critical`). No hay que inventar umbrales.
2. **Es autodescriptivo**: si Anthropic añade un límite nuevo (Opus, Sonnet,
   Cowork), su medidor aparece solo sin tocar la app.

También llegan los campos sueltos `five_hour`, `seven_day`, `seven_day_opus`…
con `utilization` en lugar de `percent`. Se usan **solo como respaldo** si
`limits` desapareciera.

La respuesta trae además `spend` y `extra_usage` (créditos adicionales), que
esta app todavía no muestra.

## Renovación del token

```
POST https://console.anthropic.com/v1/oauth/token
Content-Type: application/json

{ "grant_type": "refresh_token", "refresh_token": "...", "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e" }
```

Ese `client_id` es el público de Claude Code, embebido en la propia CLI.

**Los refresh tokens rotan**: el nuevo hay que guardarlo en la misma fuente de
donde salió (Llavero o fichero), o la siguiente renovación falla con
`invalid_grant`.

## Sobre el 429

Este endpoint limita, y el mismo token lo usa también Claude Code. Consultar
cada 60 segundos de forma incondicional lo provoca: unas 1.440 peticiones
diarias solo desde la app, sumadas a las de la CLI. La capa de resiliencia
(`src/poller.js`) baja eso a unas 290 y hace invisibles los fallos
transitorios. No la esquives.

Las respuestas 200 **no traen cabeceras de límite**, así que no se puede
anticipar cuánto margen queda: solo reaccionar al `Retry-After` del 429.
