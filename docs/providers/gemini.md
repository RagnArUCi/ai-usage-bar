# Gemini

Verificado el 2026-08-20 contra el CLI de Gemini con sesión personal.

## Credenciales

`~/.gemini/oauth_creds.json` con `access_token`, `refresh_token`, `expiry_date`
(milisegundos), `scope`, `id_token`.

## Consumo

```
POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
Authorization: Bearer <access_token>
Content-Type: application/json

{}            # o {"project": "<projectId>"}
```

El `projectId` sale de `cloudaicompanionProject` en:

```
POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
{ "metadata": { "ideType": "GEMINI_CLI", "pluginType": "GEMINI" } }
```

**Pero no siempre viene.** En la cuenta verificada, `loadCodeAssist` devolvió
solo `allowedTiers` e `ineligibleTiers`, sin proyecto — y la cuota funciona
igual con cuerpo vacío.

### Respuesta

El envoltorio es `buckets`, y cada entrada trae:

```json
{ "modelId": "gemini-2.5-pro", "remainingFraction": 1, "resetTime": "...", "tokenType": "REQUESTS" }
```

Cuatro observaciones que cuestan tiempo si no se saben:

1. **`remainingFraction` es lo que QUEDA**, no lo consumido. Hay que invertirlo.
2. **Llegan dos modelos de la misma familia**: `gemini-2.5-flash-lite` y
   `gemini-3.1-flash-lite`. Sin la versión en la etiqueta, dos medidores
   acaban llamándose igual.
3. **`tokenType` hoy es siempre `REQUESTS`**, pero si apareciera otro tipo para
   el mismo modelo no debe pisar al primero.
4. **El endpoint es interno** (`v1internal`) y su envoltorio no está
   documentado. Por eso el parser busca los objetos con `remainingFraction`
   donde estén, en lugar de asumir el nombre de la clave contenedora.

La ventana es **diaria**. La API no reporta severidad.

## Renovación del token

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...&refresh_token=...&grant_type=refresh_token
```

El `client_id`/`client_secret` son las credenciales públicas de un cliente
nativo (RFC 8252) y **se leen en ejecución** del paquete instalado del CLI:

```
@google/gemini-cli-core/dist/src/code_assist/oauth2.js
```

buscando las constantes `OAUTH_CLIENT_ID` y `OAUTH_CLIENT_SECRET`. Se puede
sobrescribir con `GEMINI_OAUTH_CLIENT_ID` / `GEMINI_OAUTH_CLIENT_SECRET`, o
apuntar a otro fichero con `GEMINI_OAUTH2_JS_PATH`. **No están en este repo.**

## 403 no es sesión caducada

Gemini devuelve **403** con `"You do not have a valid license of this product"`
cuando la cuenta no tiene licencia de Code Assist — con el token perfectamente
válido y renovándose bien. Tratarlo como sesión caducada manda al usuario a
iniciar sesión una y otra vez sin que sirva de nada.

El proveedor distingue 401 de 403 y propaga el mensaje literal de la API en el
campo `detail`, que el panel muestra.
