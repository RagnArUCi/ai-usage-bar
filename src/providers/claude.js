// Proveedor: Claude Code.
//
// Reutiliza la sesión OAuth que Claude Code guarda en la máquina y consulta
// el endpoint oficial de uso de la suscripción. La API devuelve un array
// `limits[]` autodescriptivo con severidad ya calculada por el servidor, así
// que aquí no se inventan umbrales.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getOAuth, refresh } = require('./claudeCredentials');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const LABELS = {
  session: 'Sesión',
  weekly_all: 'Semana',
  weekly_opus: 'Semana · Opus',
  weekly_sonnet: 'Semana · Sonnet',
  weekly_oauth_apps: 'Semana · Apps',
  weekly_cowork: 'Semana · Cowork',
};

const SUBLABELS = {
  session: 'ventana de 5 horas',
  weekly_all: 'todos los modelos',
};

function clampPct(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function labelFor(kind) {
  return LABELS[kind] || String(kind || 'Límite').replace(/_/g, ' ');
}

function parseLimits(data) {
  const out = [];

  if (Array.isArray(data.limits)) {
    for (const l of data.limits) {
      if (!l || typeof l.percent !== 'number' || Number.isNaN(l.percent)) continue;
      out.push({
        kind: l.kind || 'unknown',
        group: l.group || l.kind || 'unknown',
        label: labelFor(l.kind),
        sublabel: SUBLABELS[l.kind] || null,
        pct: clampPct(l.percent),
        severity: l.severity || 'normal',
        resetsAt: l.resets_at || null,
      });
    }
  }

  // Respaldo por si `limits` desapareciera de la respuesta.
  if (!out.length) {
    const legacy = [
      ['session', data.five_hour],
      ['weekly_all', data.seven_day],
      ['weekly_opus', data.seven_day_opus],
    ];
    for (const [kind, b] of legacy) {
      if (!b || typeof b.utilization !== 'number') continue;
      out.push({
        kind,
        group: kind === 'session' ? 'session' : 'weekly',
        label: labelFor(kind),
        sublabel: SUBLABELS[kind] || null,
        pct: clampPct(b.utilization),
        severity: 'normal',
        resetsAt: b.resets_at || null,
      });
    }
  }

  return out;
}

function call(accessToken) {
  return fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'Content-Type': 'application/json',
    },
  });
}

function parseRetryAfter(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : null;
}

async function detect() {
  if (fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'))) return true;
  if (process.platform !== 'darwin') return false;
  // En macOS lo normal es que esté en el Llavero; leerlo es la única forma
  // de saberlo, y getOAuth ya lo hace sin exponer el token.
  try {
    const entry = await getOAuth();
    return !!entry;
  } catch {
    return false;
  }
}

async function fetchUsage() {
  let entry;
  try {
    entry = await getOAuth();
  } catch {
    entry = null;
  }
  if (!entry) return { error: 'no-credentials', retryable: false };
  if (entry.expired) return { error: 'expired', retryable: false };

  let res;
  try {
    res = await call(entry.oauth.accessToken);
    if (res.status === 401) {
      const refreshed = await refresh(entry);
      if (!refreshed) return { error: 'expired', retryable: false };
      res = await call(refreshed.oauth.accessToken);
    }
  } catch {
    return { error: 'network', retryable: true };
  }

  if (res.status === 429) {
    return { error: 'rate-limit', retryable: true, retryAfterMs: parseRetryAfter(res) };
  }
  if (res.status === 401 || res.status === 403) return { error: 'expired', retryable: false };
  if (res.status >= 500) {
    return { error: `http-${res.status}`, retryable: true, retryAfterMs: parseRetryAfter(res) };
  }
  if (!res.ok) return { error: `http-${res.status}`, retryable: false };

  let data;
  try {
    data = await res.json();
  } catch {
    return { error: 'parse', retryable: true };
  }

  const limits = parseLimits(data);
  if (!limits.length) return { error: 'formato', retryable: false };
  return { limits };
}

module.exports = {
  id: 'claude',
  name: 'Claude',
  glyph: 'sunburst',
  hint: 'Abre Claude Code e inicia sesión.',
  detect,
  fetch: fetchUsage,
  parseLimits,
};
