'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

// El color de estado siempre viaja con una etiqueta: nunca informa por sí solo.
const SEVERITY_LABEL = {
  normal: 'Normal',
  good: 'Normal',
  warning: 'Atención',
  serious: 'Poco margen',
  critical: 'Casi agotado',
};

const $ = (id) => document.getElementById(id);
let last = null;

/* ---------- Formato ---------- */

function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function resetInfo(iso) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const dt = at - Date.now();
  if (dt <= 0) return { short: 'reiniciando…', long: 'reiniciando…' };
  if (dt < 24 * 3600 * 1000) {
    return { short: `quedan ${fmtDuration(dt)}`, long: `se reinicia en ${fmtDuration(dt)}` };
  }
  const d = new Date(at);
  const txt = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return { short: `hasta el ${txt}`, long: `se reinicia el ${txt}, ${hm}` };
}

function fmtAge(ms) {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 45) return `actualizado hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `actualizado hace ${m} min`;
  return `actualizado hace ${Math.round(m / 60)} h`;
}

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

/* ---------- Marcas ---------- */

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// `offset` importa: con 4 rayos, medio paso de desfase convierte el destello
// en una X. El destello lleva los rayos alineados con los ejes.
function radialGlyph(svg, count, lens, width, offset = Math.PI / count) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + offset;
    const len = 7.1 * lens[i % lens.length];
    svg.appendChild(
      svgEl('line', {
        x1: (8 + Math.cos(a) * 0.2).toFixed(2),
        y1: (8 + Math.sin(a) * 0.2).toFixed(2),
        x2: (8 + Math.cos(a) * len).toFixed(2),
        y2: (8 + Math.sin(a) * len).toFixed(2),
        stroke: 'currentColor',
        'stroke-width': width,
        'stroke-linecap': 'round',
      })
    );
  }
}

// Siluetas de las marcas de cada proveedor. Monocromas a proposito: heredan
// currentColor, asi se tinen solas en claro/oscuro y en la pastilla
// seleccionada. Un logo a todo color no se adaptaria a esos tres fondos.
const SHAPES = {
  // Fantasma de Kiro, con sus tres ondas y los ojos calados (evenodd), que
  // dejan ver el fondo de la pastilla igual que en el logo original.
  ghost: {
    d:
      'M3 13.2 V7.5 a5 5 0 0 1 10 0 V13.2 ' +
      'c-0.45 1.75 -2.88 1.75 -3.333 0 c-0.45 1.75 -2.88 1.75 -3.333 0 ' +
      'c-0.45 1.75 -2.88 1.75 -3.333 0 Z ' +
      'M6.35 6.6 a1 1 0 1 0 0 2 a1 1 0 1 0 0 -2 Z ' +
      'M9.65 6.6 a1 1 0 1 0 0 2 a1 1 0 1 0 0 -2 Z',
    rule: 'evenodd',
  },
  // Estrella de cuatro puntas de Gemini, con los lados concavos.
  gemini: {
    d:
      'M8 0.9 C8.45 5.6 10.4 7.55 15.1 8 C10.4 8.45 8.45 10.4 8 15.1 ' +
      'C7.55 10.4 5.6 8.45 0.9 8 C5.6 7.55 7.55 5.6 8 0.9 Z',
    rule: 'nonzero',
  },
};

/** Marca de cada proveedor. */
function buildGlyph(kind) {
  const svg = svgEl('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' });
  if (SHAPES[kind]) {
    svg.appendChild(
      svgEl('path', {
        d: SHAPES[kind].d,
        fill: 'currentColor',
        'fill-rule': SHAPES[kind].rule,
      })
    );
  } else if (kind === 'sunburst') {
    // El asterisco de Claude: doce rayos de longitudes alternas.
    radialGlyph(svg, 12, [1, 0.82, 0.93], '1.35');
  } else {
    // Barras de medidor, la marca por defecto.
    const heights = [0.5, 1, 0.72];
    heights.forEach((h, i) => {
      const w = 2.6;
      const x = 3.4 + i * 4.3;
      const bottom = 13;
      const top = bottom - 9.5 * h;
      svg.appendChild(
        svgEl('line', {
          x1: x, y1: bottom, x2: x, y2: top,
          stroke: 'currentColor',
          'stroke-width': w,
          'stroke-linecap': 'round',
        })
      );
    });
  }
  return svg;
}

/* ---------- Tendencia ---------- */

function drawSpark(points, accent) {
  const svg = $('spark');
  svg.replaceChildren();
  // `hidden` es propiedad de HTMLElement; <svg> es SVGElement, así que aquí
  // hay que tocar el atributo directamente.
  if (!points || points.length < 2) {
    svg.setAttribute('hidden', '');
    return;
  }
  svg.removeAttribute('hidden');
  const h = 32;
  const pad = 3;
  const w = svg.clientWidth || 272;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const t0 = points[0].t;
  const span = Math.max(1, points[points.length - 1].t - t0);
  // Dominio anclado en cero para no exagerar la pendiente.
  const top = Math.max(10, Math.max(...points.map((p) => p.pct)) * 1.25);
  const x = (t) => pad + ((t - t0) / span) * (w - pad * 2);
  const y = (p) => h - pad - (p / top) * (h - pad * 2);

  svg.appendChild(
    svgEl('path', {
      d: points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(' '),
      fill: 'none',
      stroke: 'var(--text-muted)',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      opacity: '0.55',
    })
  );

  const lastPt = points[points.length - 1];
  svg.appendChild(
    svgEl('circle', {
      cx: x(lastPt.t).toFixed(1),
      cy: y(lastPt.pct).toFixed(1),
      r: '4',
      fill: accent,
      // Anillo del color de la superficie: legible al cruzar la línea.
      stroke: 'var(--surface)',
      'stroke-width': '2',
    })
  );
}

/* ---------- Rejilla de proveedores ---------- */

function tileEl(prov, selected, accent, severityColors) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tile';
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-selected', String(selected));
  b.dataset.id = prov.id;

  const primary = prov.limits.find((l) => l.kind === prov.primaryKind) || prov.limits[0] || null;
  if (!prov.available || !primary) b.classList.add('off');

  const color = primary ? severityColors[primary.severity] || accent : accent;
  b.style.setProperty('--tfill', color);

  b.appendChild(buildGlyph(prov.glyph));

  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = prov.name;
  b.appendChild(name);

  const track = document.createElement('div');
  track.className = 'tile-track';
  const fill = document.createElement('div');
  fill.className = 'tile-fill';
  // Sin dato real no se dibuja relleno: mejor vacío que un número inventado.
  fill.style.width = primary ? `${primary.pct}%` : '0%';
  track.appendChild(fill);
  b.appendChild(track);

  b.title = prov.available
    ? primary
      ? `${prov.name} · ${primary.pct} % usado`
      : `${prov.name} · cargando`
    : `${prov.name} · no configurado`;

  b.addEventListener('click', () => window.api.select(prov.id));
  return b;
}

/* ---------- Medidores ---------- */

function meterEl(limit, accent, severityColors) {
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  wrap.style.setProperty('--fill', severityColors[limit.severity] || accent);

  const head = document.createElement('div');
  head.className = 'meter-head';
  const label = document.createElement('span');
  label.className = 'm-label';
  label.textContent = limit.sublabel ? `${limit.label} · ${limit.sublabel}` : limit.label;
  const val = document.createElement('span');
  val.className = 'm-val';
  val.textContent = `${limit.pct} %`;
  head.append(label, val);

  const track = document.createElement('div');
  track.className = 'track';
  const fill = document.createElement('div');
  fill.className = 'fill';
  fill.style.width = `${limit.pct}%`;
  track.appendChild(fill);

  wrap.append(head, track);

  const reset = resetInfo(limit.resetsAt);
  if (reset) {
    const sub = document.createElement('div');
    sub.className = 'm-sub';
    sub.textContent = reset.long;
    wrap.appendChild(sub);
  }
  return wrap;
}

/* ---------- Render ---------- */

function render(payload) {
  last = payload;
  const { providers, selectedId, palette, settings, loginItem } = payload;
  const accent = palette.accent;
  const sev = palette.severity;
  document.documentElement.style.setProperty('--accent', accent);

  // Rejilla: hasta 4 por fila, sin dejar huecos cuando hay menos.
  const tiles = $('tiles');
  tiles.style.gridTemplateColumns = `repeat(${Math.min(Math.max(providers.length, 1), 4)}, 1fr)`;
  tiles.replaceChildren();
  for (const p of providers) tiles.appendChild(tileEl(p, p.id === selectedId, accent, sev));

  const prov = providers.find((p) => p.id === selectedId) || providers[0] || null;
  const limits = prov ? prov.limits : [];
  const primary = limits.find((l) => l.kind === prov.primaryKind) || limits[0] || null;

  // Cifra principal
  if (primary) {
    $('heroPct').textContent = primary.pct;
    const reset = resetInfo(primary.resetsAt);
    $('heroCap').textContent = reset
      ? `${prov.name} · ${primary.label} · ${reset.short}`
      : `${prov.name} · ${primary.label}`;

    const s = primary.severity || 'normal';
    if (s === 'normal' || s === 'good') {
      $('chip').hidden = true;
    } else {
      $('chipDot').style.background = sev[s] || accent;
      $('chipText').textContent = SEVERITY_LABEL[s] || s;
      $('chip').hidden = false;
    }
  } else {
    $('heroPct').textContent = '–';
    $('heroCap').textContent = prov
      ? prov.available
        ? `${prov.name} · cargando…`
        : `${prov.name} · sin configurar`
      : 'Sin proveedores';
    $('chip').hidden = true;
  }

  // Proyección
  const fc = primary && primary.fc;
  const fcEl = $('forecast');
  if (fc && fc.etaAt && !fc.safeUntilReset) {
    fcEl.textContent = `A este ritmo se agota sobre las ${fmtClock(fc.etaAt)}`;
    fcEl.hidden = false;
  } else if (fc && fc.rate !== null && fc.safeUntilReset) {
    fcEl.textContent = 'A este ritmo te alcanza hasta el reinicio';
    fcEl.hidden = false;
  } else {
    fcEl.hidden = true;
  }

  drawSpark(prov ? prov.spark : null, accent);

  // Medidores
  const meters = $('meters');
  meters.replaceChildren();
  for (const l of limits) meters.appendChild(meterEl(l, accent, sev));

  // Aviso
  const notice = $('notice');
  if (prov && !prov.available) {
    notice.textContent = `${prov.name} no está configurado. ${prov.hint}`;
    notice.hidden = false;
  } else if (prov && prov.needsLogin) {
    notice.textContent = `La sesión de ${prov.name} caducó. ${prov.hint}`;
    notice.hidden = false;
  } else if (prov && prov.needsAction) {
    // No es una sesión caducada: la cuenta existe y el servicio la rechaza.
    // Se cita el motivo que da la API en vez de inventar una explicación.
    notice.textContent = prov.detail
      ? `${prov.name}: ${prov.detail}`
      : `${prov.name} rechazó la consulta (${prov.error}).`;
    notice.hidden = false;
  } else if (prov && prov.status === 'error') {
    notice.textContent = 'Todavía no hay datos. Reintentando…';
    notice.hidden = false;
  } else if (prov && prov.status === 'stale') {
    notice.textContent = 'Sin respuesta de la API ahora mismo; se muestra el último dato.';
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }

  $('age').textContent = prov && prov.fetchedAt ? fmtAge(prov.ageMs) : '';

  // Ajustes: la métrica se elige dentro del proveedor visible.
  const metric = $('metric');
  const options = [{ kind: 'auto', label: 'Automático' }, ...limits.map((l) => ({ kind: l.kind, label: l.label }))];
  const signature = `${selectedId}:${options.map((o) => o.kind).join(',')}`;
  if (metric.dataset.sig !== signature) {
    metric.dataset.sig = signature;
    metric.replaceChildren();
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'radio';
      b.textContent = o.label;
      b.dataset.kind = o.kind;
      b.addEventListener('click', () => window.api.setSetting('barMetric', o.kind));
      metric.appendChild(b);
    }
  }
  for (const b of metric.children) {
    b.setAttribute('aria-checked', String(b.dataset.kind === settings.barMetric));
  }

  $('notify').checked = !!settings.notifyThresholds;
  $('login').checked = !!loginItem;
  $('login').disabled = payload.canAutoLaunch === false;
  $('loginLabel').textContent =
    payload.canAutoLaunch === false
      ? 'Iniciar al encender (solo app instalada)'
      : 'Iniciar al encender el equipo';

  reportHeight();
}

let rafPending = false;
function reportHeight() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    window.api.resize(Math.ceil($('card').getBoundingClientRect().height));
  });
}

/* ---------- Arranque ---------- */

$('logo').replaceChildren(...buildGlyph('bars').childNodes);

$('gear').addEventListener('click', () => {
  const showing = !$('settings').hidden;
  $('settings').hidden = showing;
  $('main').hidden = !showing;
  $('gear').setAttribute('aria-pressed', String(!showing));
  reportHeight();
});

$('refresh').addEventListener('click', () => window.api.refresh());
$('notify').addEventListener('change', (e) =>
  window.api.setSetting('notifyThresholds', e.target.checked)
);
$('login').addEventListener('change', (e) => window.api.setLoginItem(e.target.checked));

window.api.onPayload(render);
window.api.request();

// Mantiene frescos los textos relativos ("quedan 2 h", "hace 30 s").
setInterval(() => {
  if (last) render(last);
}, 20000);

new ResizeObserver(reportHeight).observe($('card'));
