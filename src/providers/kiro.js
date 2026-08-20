// Proveedor: Kiro (AWS).
//
// Kiro se autentica con IAM Identity Center y guarda su sesión en la caché de
// AWS SSO. El consumo se pide al servicio de CodeWhisperer, que es el backend
// sobre el que corre.
//
// El plan se mide en créditos con reinicio mensual, así que un solo medidor
// suele bastar; aun así se recorre toda la lista que devuelve la API, porque
// puede traer más de un recurso.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { severityFor } = require('./severity');

const CACHE_DIR = path.join(os.homedir(), '.aws', 'sso', 'cache');
const TOKEN_FILE = path.join(CACHE_DIR, 'kiro-auth-token.json');
const TARGET = 'AmazonCodeWhispererService.GetUsageLimits';

// Vocabulario propio de Kiro; si aparece otro recurso se usa su nombre tal cual.
const LABELS = {
  Credits: 'Créditos',
  Credit: 'Créditos',
  Specs: 'Specs',
  Vibes: 'Vibes',
};

function readToken() {
  try {
    const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return t && t.accessToken ? t : null;
  } catch {
    return null;
  }
}

function isExpired(t) {
  const at = Date.parse(t.expiresAt);
  return Number.isFinite(at) ? Date.now() > at - 60 * 1000 : false;
}

/**
 * El registro OIDC vive en el mismo directorio, en un fichero cuyo nombre es
 * el `clientIdHash` del token. Ahí están el clientId y el clientSecret que
 * hacen falta para renovar.
 */
function readRegistration(clientIdHash) {
  if (!clientIdHash) return null;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${clientIdHash}.json`), 'utf8'));
    if (!r.clientId || !r.clientSecret) return null;
    if (r.expiresAt && Date.now() > Date.parse(r.expiresAt)) return null;
    return r;
  } catch {
    return null;
  }
}

/** Renueva por SSO OIDC y guarda en el mismo fichero que usa Kiro. */
async function refresh(token) {
  if (!token.refreshToken) return null;
  const reg = readRegistration(token.clientIdHash);
  if (!reg) return null;
  const region = token.region || 'us-east-1';

  let res;
  try {
    res = await fetch(`https://oidc.${region}.amazonaws.com/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: reg.clientId,
        clientSecret: reg.clientSecret,
        grantType: 'refresh_token',
        refreshToken: token.refreshToken,
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let tok;
  try {
    tok = await res.json();
  } catch {
    return null;
  }
  if (!tok.accessToken && !tok.access_token) return null;

  const updated = {
    ...token,
    accessToken: tok.accessToken || tok.access_token,
    expiresAt: new Date(Date.now() + (tok.expiresIn || tok.expires_in || 3600) * 1000).toISOString(),
  };
  const nuevoRefresh = tok.refreshToken || tok.refresh_token;
  if (nuevoRefresh) updated.refreshToken = nuevoRefresh;
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(updated), { mode: 0o600 });
  } catch {
    // Si no se puede guardar, el token sirve igual para esta consulta.
  }
  return updated;
}

function labelFor(entry) {
  const raw = entry.displayNamePlural || entry.displayName || entry.resourceType || 'Uso';
  return LABELS[raw] || String(raw);
}

function num(...vals) {
  for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/** Formatea un número de créditos sin decimales inútiles. */
function fmtCredits(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}

/**
 * `usageBreakdownList` es donde están los números; `limits` suele venir vacío.
 * `nextDateReset` llega en segundos, no en milisegundos.
 */
function normalize(data) {
  const entries = Array.isArray(data.usageBreakdownList) ? data.usageBreakdownList : [];
  const out = [];

  for (const e of entries) {
    const used = num(e.currentUsageWithPrecision, e.currentUsage);
    const limit = num(e.usageLimitWithPrecision, e.usageLimit);
    if (used === null || !limit) continue;

    const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
    const resetSecs = num(e.nextDateReset, data.nextDateReset);
    const overage = num(e.currentOveragesWithPrecision, e.currentOverages) || 0;

    // El detalle "6,5 de 10.000" dice más que el porcentaje solo cuando el
    // consumo es una fracción diminuta del límite.
    let sublabel = `${fmtCredits(used)} de ${limit.toLocaleString('es')}`;
    if (overage > 0) {
      const cargo = num(e.overageCharges) || 0;
      sublabel += ` · ${fmtCredits(overage)} de exceso`;
      if (cargo > 0) sublabel += ` (${cargo} ${e.currency || ''})`.trimEnd();
    }

    out.push({
      kind: String(e.resourceType || labelFor(e)).toLowerCase(),
      group: 'monthly',
      label: labelFor(e),
      sublabel,
      pct,
      // La API no reporta severidad: se calcula con umbrales.
      severity: severityFor(pct),
      resetsAt: resetSecs ? new Date(resetSecs * 1000).toISOString() : null,
    });
  }

  return out;
}

/** Título del plan, para el subtítulo del panel. */
function planTitle(data) {
  return (data.subscriptionInfo && data.subscriptionInfo.subscriptionTitle) || null;
}

async function detect() {
  return !!readToken();
}

async function fetchUsage() {
  let token = readToken();
  if (!token) return { error: 'no-credentials', retryable: false };

  if (isExpired(token)) {
    const renewed = await refresh(token);
    if (!renewed) return { error: 'expired', retryable: false };
    token = renewed;
  }

  const region = token.region || 'us-east-1';
  let res;
  try {
    res = await fetch(`https://codewhisperer.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': TARGET,
      },
      body: '{}',
    });
  } catch {
    return { error: 'network', retryable: true };
  }

  if (res.status === 401 || res.status === 403) {
    // Puede estar revocado sin haber vencido: un refresh y un reintento.
    const renewed = await refresh(token);
    if (!renewed) return { error: 'expired', retryable: false };
    try {
      res = await fetch(`https://codewhisperer.${region}.amazonaws.com/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${renewed.accessToken}`,
          'Content-Type': 'application/x-amz-json-1.0',
          'X-Amz-Target': TARGET,
        },
        body: '{}',
      });
    } catch {
      return { error: 'network', retryable: true };
    }
    if (res.status === 401 || res.status === 403) return { error: 'expired', retryable: false };
  }

  if (res.status === 429) return { error: 'rate-limit', retryable: true };
  if (res.status >= 500) return { error: `http-${res.status}`, retryable: true };
  if (!res.ok) return { error: `http-${res.status}`, retryable: false };

  let data;
  try {
    data = await res.json();
  } catch {
    return { error: 'parse', retryable: true };
  }

  const limits = normalize(data);
  if (!limits.length) return { error: 'formato', retryable: false };
  return { limits, plan: planTitle(data) };
}

module.exports = {
  id: 'kiro',
  name: 'Kiro',
  glyph: 'ghost',
  hint: 'Abre Kiro e inicia sesión.',
  detect,
  fetch: fetchUsage,
  normalize,
  planTitle,
};
