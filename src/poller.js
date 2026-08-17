// Capa de resiliencia, ahora con un estado independiente por proveedor.
//
// Se mantienen las cuatro medidas que en la app de Claude eliminaron los 429,
// y aquí importan más todavía: con varios proveedores el número de peticiones
// se multiplica si no se controla.
//
//   1. Ritmo adaptativo por proveedor: se vigila la actividad local de cada
//      CLI y solo entonces se consulta seguido. En reposo, cada 5 minutos.
//   2. Una sola petición en vuelo por proveedor.
//   3. Espera exponencial con jitter, respetando Retry-After.
//   4. Caché persistente: un fallo transitorio nunca borra el último dato
//      bueno; la interfaz lo marca como "no reciente" en lugar de dar error.
//
// Además los proveedores se consultan escalonados, no todos en el mismo
// instante, para no provocar una ráfaga cada vez que toca refrescar.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PROVIDERS } = require('./providers');
const store = require('./store');

const IDLE_MS = 5 * 60 * 1000;
const ACTIVE_MS = 90 * 1000;
const PANEL_OPEN_MS = 60 * 1000;
const ACTIVITY_WINDOW_MS = 10 * 60 * 1000;
const MANUAL_FLOOR_MS = 10 * 1000;
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;
const STALE_FACTOR = 2.5;
// Separación entre proveedores al arrancar, para escalonar sus ciclos.
const STAGGER_MS = 4 * 1000;

const AUTH_ERRORS = new Set(['no-credentials', 'expired', 'sin-client-oauth']);

// Qué rutas locales indican que un proveedor se está usando ahora mismo.
const ACTIVITY_PATHS = {
  claude: [
    { p: '.claude/projects', recursive: true },
    { p: '.claude/history.jsonl', recursive: false },
  ],
  gemini: [
    { p: '.gemini/tmp', recursive: true },
    { p: '.gemini/oauth_creds.json', recursive: false },
  ],
};

class Poller extends EventEmitter {
  constructor() {
    super();
    this.panelOpen = false;
    this.watchers = [];
    // Estado por proveedor.
    this.st = new Map();
    for (const p of PROVIDERS) {
      this.st.set(p.id, {
        provider: p,
        available: null, // null = todavía sin detectar
        timer: null,
        inFlight: null,
        failures: 0,
        lastAttempt: 0,
        lastActivity: 0,
        lastError: null,
        nextAttemptAt: 0,
      });
    }
  }

  async start() {
    // La detección es solo disco: rápida y sin red.
    await Promise.all(
      PROVIDERS.map(async (p) => {
        const s = this.st.get(p.id);
        try {
          s.available = await p.detect();
        } catch {
          s.available = false;
        }
      })
    );
    this.emit('update');

    this.watchActivity();

    let delay = 0;
    for (const p of PROVIDERS) {
      if (!this.st.get(p.id).available) continue;
      this.schedule(p.id, delay);
      delay += STAGGER_MS;
    }
  }

  stop() {
    for (const s of this.st.values()) {
      if (s.timer) clearTimeout(s.timer);
      s.timer = null;
    }
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {}
    }
    this.watchers = [];
  }

  watchActivity() {
    for (const [id, targets] of Object.entries(ACTIVITY_PATHS)) {
      const s = this.st.get(id);
      if (!s || !s.available) continue;
      for (const { p, recursive } of targets) {
        try {
          const w = fs.watch(
            path.join(os.homedir(), p),
            { recursive, persistent: false },
            () => {
              s.lastActivity = Date.now();
            }
          );
          w.on('error', () => {});
          this.watchers.push(w);
        } catch {
          // Si la ruta no existe se pierde reactividad, no correctitud.
        }
      }
    }
  }

  setPanelOpen(open) {
    this.panelOpen = open;
    for (const s of this.st.values()) {
      if (!s.available) continue;
      if (open) this.refresh(s.provider.id);
      else this.schedule(s.provider.id);
    }
  }

  intervalMs(s) {
    if (this.panelOpen) return PANEL_OPEN_MS;
    return Date.now() - s.lastActivity < ACTIVITY_WINDOW_MS ? ACTIVE_MS : IDLE_MS;
  }

  backoffMs(s, res) {
    if (res && typeof res.retryAfterMs === 'number' && res.retryAfterMs > 0) {
      return Math.min(res.retryAfterMs, BACKOFF_MAX_MS);
    }
    const raw = Math.min(BACKOFF_BASE_MS * 2 ** (s.failures - 1), BACKOFF_MAX_MS);
    return Math.round(raw * (0.8 + Math.random() * 0.4));
  }

  schedule(id, delay) {
    const s = this.st.get(id);
    if (!s || !s.available) return;
    if (s.timer) clearTimeout(s.timer);

    let ms = typeof delay === 'number' ? delay : this.intervalMs(s);

    // Si una ventana se reinicia antes, consultar justo tras el reinicio.
    const snap = store.getCache(id);
    if (snap && Array.isArray(snap.limits)) {
      const now = Date.now();
      for (const l of snap.limits) {
        if (!l.resetsAt) continue;
        const at = Date.parse(l.resetsAt);
        if (!Number.isFinite(at)) continue;
        const until = at - now + 5000;
        if (until > 0 && until < ms) ms = until;
      }
    }

    s.nextAttemptAt = Date.now() + ms;
    s.timer = setTimeout(() => this.refresh(id), ms);
    if (s.timer.unref) s.timer.unref();
  }

  refresh(id, opts = {}) {
    const s = this.st.get(id);
    if (!s || !s.available) return Promise.resolve();
    if (s.inFlight) return s.inFlight;

    if (opts.manual && Date.now() - s.lastAttempt < MANUAL_FLOOR_MS) {
      this.emit('update');
      return Promise.resolve();
    }

    s.lastAttempt = Date.now();
    s.inFlight = Promise.resolve()
      .then(() => s.provider.fetch())
      .then((res) => this.handle(id, res))
      .catch(() => this.handle(id, { error: 'parse', retryable: true }))
      .finally(() => {
        s.inFlight = null;
      });
    return s.inFlight;
  }

  /** Refresca todos los proveedores disponibles (menú "Actualizar ahora"). */
  refreshAll(opts = {}) {
    return Promise.all([...this.st.keys()].map((id) => this.refresh(id, opts)));
  }

  handle(id, res) {
    const s = this.st.get(id);
    if (res.error) {
      s.failures += 1;
      s.lastError = res.error;
      const delay = AUTH_ERRORS.has(res.error)
        ? Math.max(this.intervalMs(s), 5 * 60 * 1000)
        : this.backoffMs(s, res);
      this.schedule(id, delay);
    } else {
      s.failures = 0;
      s.lastError = null;
      const snapshot = { limits: res.limits, fetchedAt: Date.now() };
      store.setCache(id, snapshot);
      store.addSample(id, snapshot);
      this.schedule(id);
    }
    this.emit('update', id);
  }

  /** Estado de un proveedor. Nunca pierde el último dato bueno. */
  stateOf(id) {
    const s = this.st.get(id);
    const snap = store.getCache(id);
    const ageMs = snap ? Date.now() - snap.fetchedAt : null;

    let status;
    if (!s.available) status = 'unavailable';
    else if (!snap) status = s.lastError ? 'error' : 'loading';
    else if (s.lastError || ageMs > this.intervalMs(s) * STALE_FACTOR) status = 'stale';
    else status = 'ok';

    return {
      id,
      name: s.provider.name,
      glyph: s.provider.glyph,
      hint: s.provider.hint,
      status,
      available: !!s.available,
      limits: snap ? snap.limits : [],
      fetchedAt: snap ? snap.fetchedAt : null,
      ageMs,
      error: s.lastError,
      needsLogin: AUTH_ERRORS.has(s.lastError),
      history: store.getHistory(id),
    };
  }

  states() {
    return [...this.st.keys()].map((id) => this.stateOf(id));
  }
}

module.exports = { Poller };
