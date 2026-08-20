// AI Usage — app de bandeja que muestra el consumo de tus planes de IA.
// macOS: marca de medidor + "42%" en la barra de menú superior.
// Windows y Linux: icono con el número dentro, junto al reloj.
// Al hacer clic se abre un panel con una pestaña por proveedor.
'use strict';

const path = require('path');
const {
  app,
  Tray,
  Menu,
  BrowserWindow,
  ipcMain,
  screen,
  nativeTheme,
  systemPreferences,
  powerMonitor,
  Notification,
  shell,
} = require('electron');

const { Poller } = require('./src/poller');
const store = require('./src/store');
const { palette } = require('./src/color');
const { forecast, sparkline } = require('./src/forecast');
const { macTemplateIcon, percentIcon } = require('./src/trayIcon');
const { ensureAutoLaunch, setAutoLaunch, isEnabled } = require('./src/autoLaunch');
const { checkForUpdate } = require('./src/updateCheck');

const IS_MAC = process.platform === 'darwin';
const PANEL_WIDTH = 320;
const PANEL_MARGIN = 8;
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000;

let tray = null;
let panel = null;
let poller = null;
let updateInfo = null;
let notifiedVersion = null;

/* ---------- Datos para la interfaz ---------- */

/** Dentro de un proveedor: el límite elegido o, en automático, el más alto. */
function resolvePrimary(limits, setting) {
  if (!limits.length) return null;
  if (setting && setting !== 'auto') {
    const found = limits.find((l) => l.kind === setting);
    if (found) return found;
  }
  return limits.reduce((a, b) => (b.pct > a.pct ? b : a), limits[0]);
}

/** Proveedor que manda en la barra: el elegido o el más consumido. */
function resolveSelected(provs, selected) {
  const usable = provs.filter((p) => p.available);
  if (selected) {
    const found = provs.find((p) => p.id === selected);
    if (found) return found;
  }
  if (!usable.length) return provs[0] || null;
  return usable.reduce((a, b) => {
    const pa = a.primary ? a.primary.pct : -1;
    const pb = b.primary ? b.primary.pct : -1;
    return pb > pa ? b : a;
  }, usable[0]);
}

function buildPayload() {
  const settings = store.getSettings();
  const pal = palette();

  const providers = poller.states().map((s) => {
    const limits = s.limits.map((l) => ({ ...l, fc: forecast(l, s.history) }));
    const primary = resolvePrimary(limits, settings.barMetric);
    return {
      id: s.id,
      name: s.name,
      glyph: s.glyph,
      hint: s.hint,
      status: s.status,
      available: s.available,
      needsLogin: s.needsLogin,
      needsAction: s.needsAction,
      detail: s.detail,
      error: s.error,
      fetchedAt: s.fetchedAt,
      ageMs: s.ageMs,
      limits,
      primary,
      primaryKind: primary ? primary.kind : null,
      spark: primary ? sparkline(s.history, primary.kind) : [],
    };
  });

  const selected = resolveSelected(providers, settings.selected);

  return {
    providers,
    selectedId: selected ? selected.id : null,
    settings,
    loginItem: isEnabled(app),
    canAutoLaunch: app.isPackaged,
    palette: {
      accent: nativeTheme.shouldUseDarkColors ? pal.accentDark : pal.accentLight,
      severity: pal.severity,
    },
  };
}

function push() {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send('payload', buildPayload());
  }
}

/* ---------- Bandeja ---------- */

function updateTray(payload) {
  const sel = payload.providers.find((p) => p.id === payload.selectedId) || null;
  const primary = sel ? sel.primary : null;
  const pct = primary ? primary.pct : null;
  const sevColor = primary ? payload.palette.severity[primary.severity] : null;

  if (IS_MAC) {
    tray.setTitle(pct === null ? ' -' : ` ${pct}%`);
  } else {
    tray.setImage(percentIcon(pct === null ? '-' : String(pct), sevColor));
  }

  // El tooltip resume todos los proveedores, no solo el visible.
  const parts = payload.providers.map((p) => {
    if (!p.available) return `${p.name}: sin configurar`;
    if (!p.primary) return `${p.name}: cargando`;
    return `${p.name}: ${p.primary.pct} %`;
  });
  tray.setToolTip(parts.length ? parts.join(' · ') : 'Sin proveedores detectados');
}

function contextMenu(payload) {
  const items = [];

  if (updateInfo) {
    items.push({
      label: `⬆ Actualización disponible (v${updateInfo.latest})`,
      click: () => shell.openExternal(updateInfo.url),
    });
    items.push({ type: 'separator' });
  }

  items.push({ label: 'Abrir panel', click: () => showPanel() });

  // Cambiar de proveedor sin abrir el panel.
  const provs = payload.providers.filter((p) => p.available);
  if (provs.length > 1) {
    items.push({
      label: 'Mostrar en la barra',
      submenu: [
        {
          label: 'Automático (el más consumido)',
          type: 'radio',
          checked: !store.getSettings().selected,
          click: () => {
            store.setSetting('selected', null);
            const p = buildPayload();
            updateTray(p);
            push();
          },
        },
        ...provs.map((p) => ({
          label: p.name,
          type: 'radio',
          checked: store.getSettings().selected === p.id,
          click: () => {
            store.setSetting('selected', p.id);
            const pl = buildPayload();
            updateTray(pl);
            push();
          },
        })),
      ],
    });
  }

  items.push(
    { label: 'Actualizar ahora', click: () => poller.refreshAll({ manual: true }) },
    { label: 'Buscar actualizaciones', click: () => checkUpdates(true) },
    { type: 'separator' },
    {
      label: app.isPackaged
        ? 'Iniciar al encender el equipo'
        : 'Iniciar al encender el equipo (solo app instalada)',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: isEnabled(app),
      click: (item) => {
        setAutoLaunch(app, item.checked);
        push();
      },
    },
    { type: 'separator' },
    { label: `AI Usage v${app.getVersion()}`, enabled: false },
    { label: 'Salir', role: 'quit' }
  );

  return Menu.buildFromTemplate(items);
}

async function checkUpdates(manual = false) {
  const r = await checkForUpdate(app.getVersion());
  if (!r || r.error) {
    if (manual && Notification.isSupported()) {
      new Notification({
        title: 'AI Usage',
        body: 'No pude comprobar actualizaciones ahora mismo.',
      }).show();
    }
    return;
  }
  if (!r.updateAvailable) {
    updateInfo = null;
    if (manual && Notification.isSupported()) {
      new Notification({
        title: 'AI Usage',
        body: `Ya tienes la última versión (v${app.getVersion()}).`,
      }).show();
    }
    return;
  }
  updateInfo = { latest: r.latest, url: r.url };
  if ((manual || notifiedVersion !== r.latest) && Notification.isSupported()) {
    notifiedVersion = r.latest;
    const n = new Notification({
      title: 'AI Usage — actualización disponible',
      body: `La versión ${r.latest} ya está lista. Clic para descargarla.`,
    });
    n.on('click', () => shell.openExternal(updateInfo.url));
    n.show();
  }
}

/* ---------- Panel ---------- */

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: 460,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Sin vibrancia: junto a `transparent: true` no llega a pintar y la
    // tarjeta acabaría viendo el escritorio. La tarjeta pone su propio fondo.
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile(path.join(__dirname, 'src', 'panel', 'index.html'));
  panel.on('blur', () => {
    if (!panel.webContents.isDevToolsOpened()) hidePanel();
  });
}

function positionPanel() {
  const trayBounds = tray.getBounds();
  const { width, height } = panel.getBounds();
  const anchor = trayBounds.width
    ? { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y }
    : screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(anchor).workArea;

  let x = Math.round(anchor.x - width / 2);
  let y;
  if (IS_MAC) {
    y = Math.round(trayBounds.y + trayBounds.height + 6);
  } else {
    const trayAtTop = trayBounds.height && trayBounds.y < area.y + area.height / 2;
    y = trayAtTop
      ? Math.round(area.y + PANEL_MARGIN)
      : Math.round(area.y + area.height - height - PANEL_MARGIN);
    if (!trayBounds.width) x = Math.round(area.x + area.width - width - PANEL_MARGIN);
  }

  x = Math.max(area.x + PANEL_MARGIN, Math.min(x, area.x + area.width - width - PANEL_MARGIN));
  y = Math.max(area.y + PANEL_MARGIN, y);
  panel.setPosition(x, y, false);
}

function showPanel() {
  if (!panel || panel.isDestroyed()) return;
  positionPanel();
  panel.show();
  panel.focus();
  poller.setPanelOpen(true);
}

function hidePanel() {
  if (!panel || panel.isDestroyed() || !panel.isVisible()) return;
  panel.hide();
  poller.setPanelOpen(false);
}

function togglePanel() {
  if (panel && panel.isVisible()) hidePanel();
  else showPanel();
}

/* ---------- Avisos ---------- */

function resetPhrase(iso) {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const dt = at - Date.now();
  if (dt <= 0) return '';
  if (dt < 24 * 3600 * 1000) {
    const min = Math.round(dt / 60000);
    const h = Math.floor(min / 60);
    const m = min % 60;
    return ` Se reinicia en ${h ? (m ? `${h} h ${m} min` : `${h} h`) : `${min} min`}.`;
  }
  const d = new Date(at);
  return ` Se reinicia el ${d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}.`;
}

/** Un aviso por umbral, por ventana y por proveedor. */
function checkThresholds(provider) {
  const settings = store.getSettings();
  if (!settings.notifyThresholds || !Notification.isSupported()) return;
  const seen = store.getNotified();

  for (const l of provider.limits) {
    const crossed = settings.thresholds
      .filter((t) => l.pct >= t)
      .sort((a, b) => a - b)
      .filter((t) => !seen[`${provider.id}:${l.kind}:${l.resetsAt}:${t}`]);
    if (!crossed.length) continue;

    for (const t of crossed) store.markNotified(`${provider.id}:${l.kind}:${l.resetsAt}:${t}`);

    new Notification({
      title: `${provider.name} · ${l.label} al ${l.pct} %`,
      body: `Has cruzado el ${crossed[crossed.length - 1]} % de tu límite.${resetPhrase(l.resetsAt)}`,
    }).show();
  }
}

/* ---------- Arranque ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());

  app.whenReady().then(async () => {
    if (IS_MAC && app.dock) app.dock.hide();
    ensureAutoLaunch(app);

    tray = new Tray(IS_MAC ? macTemplateIcon() : percentIcon('-', null));
    tray.setToolTip('AI Usage — cargando…');
    if (IS_MAC) tray.setTitle(' …');
    tray.on('click', togglePanel);
    tray.on('right-click', () => tray.popUpContextMenu(contextMenu(buildPayload())));

    createPanel();

    poller = new Poller();
    poller.on('update', (id) => {
      const payload = buildPayload();
      updateTray(payload);
      push();
      if (!id) return;
      const prov = payload.providers.find((p) => p.id === id);
      if (prov && prov.status === 'ok') checkThresholds(prov);
    });
    await poller.start();

    powerMonitor.on('resume', () => poller.refreshAll());
    powerMonitor.on('unlock-screen', () => poller.refreshAll());

    nativeTheme.on('updated', push);
    try {
      systemPreferences.on('accent-color-changed', push);
    } catch {
      // No disponible en todas las plataformas.
    }

    ipcMain.on('request-payload', push);
    ipcMain.on('refresh', () => poller.refreshAll({ manual: true }));
    ipcMain.on('select-provider', (_e, id) => {
      store.setSetting('selected', id);
      const payload = buildPayload();
      updateTray(payload);
      push();
    });
    ipcMain.on('set-setting', (_e, { key, value }) => {
      store.setSetting(key, value);
      updateTray(buildPayload());
      push();
    });
    ipcMain.on('set-login-item', (_e, enabled) => {
      setAutoLaunch(app, !!enabled);
      push();
    });
    ipcMain.on('resize', (_e, height) => {
      if (!panel || panel.isDestroyed()) return;
      const h = Math.max(180, Math.min(760, Math.round(height)));
      if (panel.getBounds().height === h) return;
      panel.setBounds({ width: PANEL_WIDTH, height: h }, false);
      if (panel.isVisible()) positionPanel();
    });

    checkUpdates();
    setInterval(() => checkUpdates(), UPDATE_POLL_MS);
  });

  // App de solo-bandeja: no salir cuando no hay ventanas visibles.
  app.on('window-all-closed', () => {});
}
