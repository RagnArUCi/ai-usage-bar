// Estado persistente, separado por proveedor: ajustes, última lectura buena
// e historial (que alimenta la tendencia y la proyección).
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const HISTORY_DAYS = 8;
const MIN_SAMPLE_GAP_MS = 60 * 1000;
const MAX_SAMPLES = 4000;

const DEFAULTS = {
  selected: null, // proveedor mostrado en la barra; null = el más consumido
  barMetric: 'auto', // dentro del proveedor: 'auto' o un kind concreto
  notifyThresholds: true,
  thresholds: [80, 95],
  hidden: [], // ids de proveedores que el usuario no quiere ver
};

function filePath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(name, value) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(filePath(name), JSON.stringify(value));
  } catch {
    // Persistir es best-effort: si falla, se sigue con el estado en memoria.
  }
}

let settings = null;
const caches = new Map();
const histories = new Map();
let notified = null;

function getSettings() {
  if (!settings) settings = { ...DEFAULTS, ...readJSON('settings.json', {}) };
  return settings;
}

function setSetting(key, value) {
  if (!(key in DEFAULTS)) return getSettings();
  settings = { ...getSettings(), [key]: value };
  writeJSON('settings.json', settings);
  return settings;
}

/* ---------- Por proveedor ---------- */

function getCache(id) {
  if (!caches.has(id)) caches.set(id, readJSON(`cache-${id}.json`, null));
  return caches.get(id);
}

function setCache(id, snapshot) {
  caches.set(id, snapshot);
  writeJSON(`cache-${id}.json`, snapshot);
}

function getHistory(id) {
  if (!histories.has(id)) {
    const raw = readJSON(`history-${id}.json`, []);
    histories.set(id, Array.isArray(raw) ? raw : []);
  }
  return histories.get(id);
}

function addSample(id, snapshot) {
  const h = getHistory(id);
  const last = h[h.length - 1];
  if (last && snapshot.fetchedAt - last.t < MIN_SAMPLE_GAP_MS) return h;

  const byKind = {};
  for (const l of snapshot.limits) byKind[l.kind] = l.pct;
  h.push({ t: snapshot.fetchedAt, byKind });

  const cutoff = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
  let pruned = h.filter((s) => s.t >= cutoff);
  if (pruned.length > MAX_SAMPLES) pruned = pruned.slice(pruned.length - MAX_SAMPLES);
  histories.set(id, pruned);
  writeJSON(`history-${id}.json`, pruned);
  return pruned;
}

/* ---------- Avisos ---------- */

function getNotified() {
  if (!notified) notified = readJSON('notified.json', {});
  return notified;
}

function markNotified(key) {
  notified = { ...getNotified(), [key]: Date.now() };
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  for (const k of Object.keys(notified)) {
    if (notified[k] < cutoff) delete notified[k];
  }
  writeJSON('notified.json', notified);
}

module.exports = {
  getSettings,
  setSetting,
  getCache,
  setCache,
  getHistory,
  addSample,
  getNotified,
  markNotified,
};
