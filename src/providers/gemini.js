// Proveedor: Gemini CLI / Antigravity (Gemini Code Assist).
//
// Reutiliza la sesión OAuth del CLI de Gemini (~/.gemini/oauth_creds.json) y
// consulta la cuota por modelo. La API devuelve fracción RESTANTE, así que se
// invierte para hablar de consumido, como el resto de la app.
//
// El client_id/secret de OAuth se leen del paquete instalado del CLI en
// tiempo de ejecución: son las credenciales públicas de un cliente nativo
// (RFC 8252), no un secreto del usuario, y así no viajan en este repo.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { severityFor } = require('./severity');

const CREDS = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BASE = 'https://cloudcode-pa.googleapis.com/v1internal';

// Dónde puede estar instalado @google/gemini-cli-core.
const OAUTH2_CANDIDATES = [
  path.join(os.homedir(), '.config/yarn/global/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js'),
  '/opt/homebrew/lib/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js',
  '/usr/local/lib/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js',
  path.join(os.homedir(), '.npm-global/lib/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js'),
  path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js'),
];

function clientCredentials() {
  if (process.env.GEMINI_OAUTH_CLIENT_ID && process.env.GEMINI_OAUTH_CLIENT_SECRET) {
    return {
      id: process.env.GEMINI_OAUTH_CLIENT_ID,
      secret: process.env.GEMINI_OAUTH_CLIENT_SECRET,
    };
  }
  const candidates = process.env.GEMINI_OAUTH2_JS_PATH
    ? [process.env.GEMINI_OAUTH2_JS_PATH, ...OAUTH2_CANDIDATES]
    : OAUTH2_CANDIDATES;
  for (const p of candidates) {
    try {
      const src = fs.readFileSync(p, 'utf8');
      const id = (src.match(/OAUTH_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/) || [])[1];
      const secret = (src.match(/OAUTH_CLIENT_SECRET\s*=\s*['"]([^'"]+)['"]/) || [])[1];
      if (id && secret) return { id, secret };
    } catch {
      // Siguiente candidato.
    }
  }
  return null;
}

function readCreds() {
  try {
    const c = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
    return c && c.access_token ? c : null;
  } catch {
    return null;
  }
}

function isExpired(c) {
  return !c.expiry_date || Date.now() > c.expiry_date - 60 * 1000;
}

/** Renueva y guarda en el mismo fichero, para no romper la sesión del CLI. */
async function refresh(creds) {
  if (!creds.refresh_token) return null;
  const cc = clientCredentials();
  if (!cc) return null;

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cc.id,
        client_secret: cc.secret,
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token',
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
  if (!tok.access_token) return null;

  const updated = {
    ...creds,
    access_token: tok.access_token,
    expiry_date: Date.now() + (tok.expires_in || 3600) * 1000,
  };
  if (tok.refresh_token) updated.refresh_token = tok.refresh_token;
  if (tok.id_token) updated.id_token = tok.id_token;
  try {
    fs.writeFileSync(CREDS, JSON.stringify(updated), { mode: 0o600 });
  } catch {
    // Si no se puede guardar, el token sirve igual para esta consulta.
  }
  return updated;
}

function post(pathname, token, body) {
  return fetch(`${BASE}:${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Recorre la respuesta y recoge todo objeto que tenga `remainingFraction`
 * numérica, sin depender de cómo se llame el contenedor. La forma exacta de
 * este endpoint interno no está documentada y puede cambiar de nombre; lo que
 * no cambia es el contenido de cada bucket.
 */
function collectBuckets(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectBuckets(item, out);
    return out;
  }
  if (typeof node.remainingFraction === 'number') out.push(node);
  for (const v of Object.values(node)) collectBuckets(v, out);
  return out;
}

function prettyModel(modelId) {
  if (!modelId) return 'Cuota';
  const m = String(modelId);
  if (/pro/i.test(m)) return 'Pro';
  if (/flash-lite/i.test(m)) return 'Flash Lite';
  if (/flash/i.test(m)) return 'Flash';
  return m.replace(/^models\//, '');
}

function normalize(buckets) {
  const byKind = new Map();
  for (const b of buckets) {
    const kind = String(b.modelId || b.model || 'quota');
    const pct = Math.max(0, Math.min(100, Math.round((1 - b.remainingFraction) * 100)));
    const limit = {
      kind,
      group: 'daily',
      label: prettyModel(b.modelId || b.model),
      sublabel: null,
      pct,
      // La API de Gemini no reporta severidad: se calcula con umbrales.
      severity: severityFor(pct),
      resetsAt: b.resetTime || b.resetsAt || null,
    };
    // Si llegan dos buckets del mismo modelo se queda el más consumido: en una
    // herramienta de aviso conviene errar hacia la advertencia.
    const prev = byKind.get(kind);
    if (!prev || limit.pct > prev.pct) byKind.set(kind, limit);
  }
  const out = [...byKind.values()];
  // Pro primero, luego Flash, luego el resto: es el orden en que importan.
  const rank = (l) => (/^Pro/.test(l.label) ? 0 : /^Flash/.test(l.label) ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

async function detect() {
  return !!readCreds();
}

async function fetchUsage() {
  let creds = readCreds();
  if (!creds) return { error: 'no-credentials', retryable: false };

  if (isExpired(creds)) {
    const renewed = await refresh(creds);
    if (!renewed) {
      return {
        error: clientCredentials() ? 'expired' : 'sin-client-oauth',
        retryable: false,
      };
    }
    creds = renewed;
  }

  // El proyecto viene de loadCodeAssist; si no llega, la cuota se pide sin él.
  let project = null;
  try {
    const r = await post('loadCodeAssist', creds.access_token, {
      metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' },
    });
    if (r.status === 401) return { error: 'expired', retryable: false };
    if (r.ok) {
      const j = await r.json();
      project = j.cloudaicompanionProject || null;
    }
  } catch {
    return { error: 'network', retryable: true };
  }

  let res;
  try {
    res = await post('retrieveUserQuota', creds.access_token, project ? { project } : {});
  } catch {
    return { error: 'network', retryable: true };
  }

  if (res.status === 429) return { error: 'rate-limit', retryable: true };
  if (res.status === 401 || res.status === 403) return { error: 'expired', retryable: false };
  if (res.status >= 500) return { error: `http-${res.status}`, retryable: true };
  if (!res.ok) return { error: `http-${res.status}`, retryable: false };

  let data;
  try {
    data = await res.json();
  } catch {
    return { error: 'parse', retryable: true };
  }

  const limits = normalize(collectBuckets(data));
  if (!limits.length) return { error: 'formato', retryable: false };
  return { limits };
}

module.exports = {
  id: 'gemini',
  name: 'Gemini',
  glyph: 'sparkle',
  hint: 'Ejecuta `gemini` en la terminal e inicia sesión.',
  detect,
  fetch: fetchUsage,
  collectBuckets,
  normalize,
};
