# Kiro

Verificado el 2026-08-20 contra un plan **KIRO POWER**.

Kiro se autentica con AWS IAM Identity Center y su backend es CodeWhisperer, así
que el consumo se pide al servicio de CodeWhisperer y no a un endpoint propio
de Kiro.

## Credenciales

`~/.aws/sso/cache/kiro-auth-token.json`

```
accessToken     string
refreshToken    string
expiresAt       ISO-8601
clientIdHash    string   -> nombre del fichero de registro OIDC
authMethod      "IdC"
provider        "Enterprise"
region          "us-east-1"
```

**Este fichero no trae `profileArn`**, aunque parte de la documentación externa
dice que sí. No hace falta: ver más abajo.

## Consumo

```
POST https://codewhisperer.<region>.amazonaws.com/
Authorization: Bearer <accessToken>
Content-Type: application/x-amz-json-1.0
X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits

{}
```

Responde **200 con cuerpo vacío**. No se necesita `profileArn`.

### Respuesta

```json
{
  "daysUntilReset": 0,
  "limits": [],
  "nextDateReset": 1788220800,
  "overageConfiguration": { "overageStatus": "DISABLED" },
  "subscriptionInfo": {
    "subscriptionTitle": "KIRO POWER",
    "type": "Q_DEVELOPER_STANDALONE_POWER",
    "overageCapability": "OVERAGE_CAPABLE"
  },
  "usageBreakdownList": [
    {
      "currentUsage": 6,
      "currentUsageWithPrecision": 6.5,
      "usageLimit": 10000,
      "usageLimitWithPrecision": 10000,
      "currentOverages": 0,
      "currentOveragesWithPrecision": 0,
      "overageCap": 10000,
      "overageRate": 0.04,
      "overageCharges": 0,
      "currency": "USD",
      "displayName": "Credit",
      "displayNamePlural": "Credits",
      "resourceType": "CREDIT",
      "unit": "INVOCATIONS",
      "nextDateReset": 1788220800,
      "bonuses": []
    }
  ],
  "userInfo": { "userId": "..." }
}
```

### Tres trampas del formato

1. **Los números están en `usageBreakdownList`**, no en `limits`. El campo
   `limits` llega vacío.
2. **`nextDateReset` viene en SEGUNDOS**, no en milisegundos. Hay que
   multiplicar por 1000.
3. **`daysUntilReset` llega en 0** aunque el reinicio sea dentro de once días.
   No te fíes de campos derivados: calcula desde `nextDateReset`.

La ventana es **mensual**. La API no reporta severidad, así que se calcula con
umbrales locales.

Cuando el consumo es una fracción diminuta del límite (14 de 10.000 créditos
redondea a 0 %), el porcentaje no informa de nada: el medidor muestra también
las cifras absolutas.

## Renovación del token

```
POST https://oidc.<region>.amazonaws.com/token
Content-Type: application/json

{ "clientId": "...", "clientSecret": "...", "grantType": "refresh_token", "refreshToken": "..." }
```

`clientId` y `clientSecret` están en `~/.aws/sso/cache/<clientIdHash>.json`,
donde `<clientIdHash>` es el campo del mismo nombre del fichero de token. Ese
registro tiene su propio `expiresAt`, de meses.

El token nuevo se guarda en `kiro-auth-token.json`, el mismo fichero que usa
Kiro, para no romper su sesión.
