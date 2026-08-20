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

/** Mensaje de error que devuelve la API, para no tener que adivinarlo. */
async function apiMessage(res) {
  try {
    const j = await res.json();
    return (j && j.error && j.error.message) || null;
  } catch {
    return null;
  }
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

// Familias conocidas, de más capaz a menos: fija el orden de los medidores.
const FAMILIES = [
  [/pro/i, 'Pro', 0],
  [/flash-lite/i, 'Flash Lite', 2],
  [/flash/i, 'Flash', 1],
];

/**
 * La versión forma parte del nombre a propósito: la cuota real trae a la vez
 * `gemini-2.5-flash-lite` y `gemini-3.1-flash-lite`, y sin la versión los dos
 * medidores se llamarían igual.
 */
function describeModel(modelId) {
  const m = String(modelId || '').replace(/^models\//, '');
  if (!m) return { label: 'Cuota', rank: 9, version: 0 };
  const version = (m.match(/(\d+(?:\.\d+)?)/) || [])[1] || null;
  for (const [re, name, rank] of FAMILIES) {
    if (re.test(m)) {
      return {
        label: version ? `${name} ${version}` : name,
        rank,
        version: version ? parseFloat(version) : 0,
      };
    }
  }
  return { label: m, rank: 8, version: version ? parseFloat(version) : 0 };
}

function normalize(buckets) {
  const byKind = new Map();
  for (const b of buckets) {
    const modelId = b.modelId || b.model;
    const type = b.tokenType || null;
    // La clave es el modelo. Hoy solo llega tokenType REQUESTS, pero si
    // apareciera otro tipo para el mismo modelo no debe pisar al primero;
    // solo entonces se añade al identificador, para no romper el historial
    // ya acumulado con la clave simple.
    const kind =
      type && type !== 'REQUESTS'
        ? `${modelId || 'quota'}:${type}`
        : String(modelId || 'quota');
    const pct = Math.max(0, Math.min(100, Math.round((1 - b.remainingFraction) * 100)));
    const desc = describeModel(modelId);
    const limit = {
      kind,
      group: 'daily',
      label: desc.label,
      sublabel: type && type !== 'REQUESTS' ? String(type).toLowerCase() : null,
      pct,
      // La API de Gemini no reporta severidad: se calcula con umbrales.
      severity: severityFor(pct),
      resetsAt: b.resetTime || b.resetsAt || null,
      _rank: desc.rank,
      _version: desc.version,
    };
    // Si llegan dos buckets de la misma clave se queda el más consumido: en
    // una herramienta de aviso conviene errar hacia la advertencia.
    const prev = byKind.get(kind);
    if (!prev || limit.pct > prev.pct) byKind.set(kind, limit);
  }

  // Pro antes que Flash antes que Flash Lite; dentro de cada familia, la
  // versión más nueva primero.
  return [...byKind.values()]
    .sort(
      (a, b) =>
        a._rank - b._rank || b._version - a._version || a.label.localeCompare(b.label)
    )
    .map(({ _rank, _version, ...l }) => l);
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
  if (res.status === 401) return { error: 'expired', retryable: false };
  // Un 403 aqui NO es una sesion caducada: el token es valido y el servicio
  // esta rechazando la cuenta (tipicamente por falta de licencia de Code
  // Assist). Decirle al usuario que vuelva a iniciar sesion no le arregla
  // nada, asi que se distingue y se muestra el motivo que da la API.
  if (res.status === 403) {
    const detail = await apiMessage(res);
    return {
      error: /licen/i.test(detail || '') ? 'sin-licencia' : 'sin-permiso',
      retryable: false,
      detail,
    };
  }
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
