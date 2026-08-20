# Contratos de los proveedores

Un documento por proveedor con lo que hace falta para leer su consumo:
credenciales, endpoint, forma de la respuesta y renovación del token.

Todo lo de aquí está **verificado contra cuentas reales**, no deducido de la
documentación oficial. En varios casos la documentación externa no coincidía
con lo que devuelve la API.

| Proveedor | Estado | Documento |
|---|---|---|
| Claude | Verificado | [claude.md](claude.md) |
| Gemini | Verificado | [gemini.md](gemini.md) |
| Kiro | Verificado | [kiro.md](kiro.md) |

## Proveedores descartados o pendientes

**Copilot — no es posible.** GitHub no expone la cuota de *premium requests* en
ninguna API pública. Existe un endpoint interno que usan los editores, sin
documentar ni garantías de estabilidad. Preferimos no tener el proveedor a
tener una barra que se rompa sin avisar.

**Codex — pendiente de verificar.** El endpoint existe
(`POST https://chatgpt.com/backend-api/wham/usage`, leyendo el token de
`~/.codex/auth.json`), pero no lo hemos comprobado contra una sesión real del
CLI. No se añade hasta poder verlo funcionar.

**Cursor, z.ai, MiniMax — pendientes.** Sin cuenta con la que verificar sus
endpoints.

Si tienes cuenta en alguno y quieres añadirlo, `CONTRIBUTING.md` explica qué se
pide.
