# Registro de cambios

## v1.1.1 — 2026-08-20

- Marcas oficiales de Gemini (estrella de cuatro puntas) y Kiro (fantasma) en
  la rejilla, como siluetas monocromas que heredan el color del texto. Antes
  eran aproximaciones geométricas que no correspondían a las marcas reales.

## v1.1.0 — 2026-08-20

- **Kiro** como tercer proveedor, verificado contra un plan KIRO POWER.
  Créditos consumidos con reinicio mensual, detalle del exceso y renovación
  automática del token por SSO OIDC.
- Los errores **403 ya no se confunden con sesiones caducadas**. Gemini
  responde 403 por falta de licencia con el token perfectamente válido, y el
  mensaje anterior mandaba a iniciar sesión en vano. Ahora se distingue 401 de
  403 y el panel cita el motivo que devuelve la API.

## v1.0.1 — 2026-08-17

- **Gemini verificado en vivo.** Se confirmó el contrato real del endpoint de
  cuota, y salió un fallo que solo se ve con datos reales: la API devuelve a la
  vez `gemini-2.5-flash-lite` y `gemini-3.1-flash-lite`, y ambos colapsaban a
  la misma etiqueta. La versión forma ahora parte del nombre.
- Instalador en Mac Intel: el patrón por sufijo también casaba con el `.dmg` de
  Apple Silicon, así que un Intel podía instalarse la build equivocada.
- Nombres de instalador deterministas, con la arquitectura siempre explícita.
- Publicación del Release con reintentos: un 503 transitorio de GitHub tumbaba
  una publicación cuyos instaladores ya estaban compilados.

## v1.0.0 — 2026-08-17

Primera versión. Arquitectura de proveedores como módulos, con Claude y Gemini.

- Panel con una pastilla por proveedor y un medidor por límite.
- Proyección de agotamiento por regresión, con el tramo de medición ajustado a
  la duración de cada ventana.
- Medidores con el color de acento del sistema, corregido si no contrasta.
- Resiliencia por proveedor: ritmo adaptativo, arranque escalonado, una sola
  petición en vuelo, backoff con jitter y caché persistente.
- Avisos al 80 % y 95 %, arranque automático y aviso de versión nueva.
- Instaladores para macOS, Windows y Linux, con firma ad-hoc en macOS.
