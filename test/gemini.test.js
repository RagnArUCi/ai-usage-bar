// El endpoint de cuota de Gemini es interno y su envoltorio no está
// documentado, así que el parser busca los buckets donde estén. Estos tests
// fijan ese comportamiento: mientras cada bucket tenga `remainingFraction`,
// da igual cómo se llame la clave que los contiene.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { collectBuckets, normalize } = require('../src/providers/gemini');
const { severityFor } = require('../src/providers/severity');

test('encuentra buckets dentro de cualquier envoltorio', () => {
  const variantes = [
    { quotaBuckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.4 }] },
    { userQuota: { buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.4 }] } },
    { data: { nested: { deep: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.4 }] } } },
    [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.4 }],
  ];
  for (const v of variantes) {
    assert.strictEqual(collectBuckets(v).length, 1, JSON.stringify(v));
  }
});

test('ignora objetos sin remainingFraction numérica', () => {
  const res = collectBuckets({
    a: { modelId: 'x' },
    b: { remainingFraction: 'mucho' },
    c: { remainingFraction: null },
    d: { modelId: 'y', remainingFraction: 0.5 },
  });
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].modelId, 'y');
});

test('no revienta con entradas vacías o raras', () => {
  for (const v of [null, undefined, 0, '', [], {}]) {
    assert.deepStrictEqual(collectBuckets(v), []);
  }
});

test('invierte la fracción restante a porcentaje consumido', () => {
  const [l] = normalize([{ modelId: 'gemini-2.5-pro', remainingFraction: 0.25 }]);
  assert.strictEqual(l.pct, 75);
});

test('los extremos quedan en 0 y 100', () => {
  assert.strictEqual(normalize([{ modelId: 'a', remainingFraction: 1 }])[0].pct, 0);
  assert.strictEqual(normalize([{ modelId: 'b', remainingFraction: 0 }])[0].pct, 100);
  // Fuera de rango: se recorta en vez de propagar un número imposible.
  assert.strictEqual(normalize([{ modelId: 'c', remainingFraction: 1.4 }])[0].pct, 0);
  assert.strictEqual(normalize([{ modelId: 'd', remainingFraction: -0.4 }])[0].pct, 100);
});

test('Pro va antes que Flash, Flash antes de Flash Lite, y el resto al final', () => {
  const orden = normalize([
    { modelId: 'gemini-2.5-flash-lite', remainingFraction: 0.9 },
    { modelId: 'otra-cosa', remainingFraction: 0.9 },
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.9 },
    { modelId: 'gemini-2.5-flash', remainingFraction: 0.9 },
  ]).map((l) => l.label);
  assert.deepStrictEqual(orden, ['Pro 2.5', 'Flash 2.5', 'Flash Lite 2.5', 'otra-cosa']);
});

// Caso real de la API: llegan dos Flash Lite de versiones distintas y sin la
// versión en el nombre los dos medidores se llamaban igual.
test('la versión distingue modelos de la misma familia', () => {
  const etiquetas = normalize([
    { modelId: 'gemini-2.5-flash-lite', remainingFraction: 1 },
    { modelId: 'gemini-3.1-flash-lite', remainingFraction: 1 },
  ]).map((l) => l.label);
  assert.deepStrictEqual(etiquetas, ['Flash Lite 3.1', 'Flash Lite 2.5'], 'la más nueva primero');
  assert.strictEqual(new Set(etiquetas).size, 2, 'no puede haber dos etiquetas iguales');
});

test('los cuatro modelos reales de la API salen con nombres únicos', () => {
  const res = normalize([
    { modelId: 'gemini-2.5-flash', remainingFraction: 1, tokenType: 'REQUESTS' },
    { modelId: 'gemini-2.5-flash-lite', remainingFraction: 1, tokenType: 'REQUESTS' },
    { modelId: 'gemini-2.5-pro', remainingFraction: 1, tokenType: 'REQUESTS' },
    { modelId: 'gemini-3.1-flash-lite', remainingFraction: 1, tokenType: 'REQUESTS' },
  ]);
  assert.strictEqual(res.length, 4);
  assert.strictEqual(new Set(res.map((l) => l.label)).size, 4);
  assert.strictEqual(new Set(res.map((l) => l.kind)).size, 4);
  // tokenType REQUESTS no ensucia la clave ni añade subetiqueta.
  assert.strictEqual(res[0].kind, 'gemini-2.5-pro');
  assert.strictEqual(res[0].sublabel, null);
});

test('un tokenType distinto de REQUESTS no pisa al del mismo modelo', () => {
  const res = normalize([
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.9, tokenType: 'REQUESTS' },
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.2, tokenType: 'TOKENS' },
  ]);
  assert.strictEqual(res.length, 2, 'son dos cuotas distintas, no un duplicado');
  const tokens = res.find((l) => l.kind === 'gemini-2.5-pro:TOKENS');
  assert.ok(tokens, 'la clave incluye el tipo cuando no es REQUESTS');
  assert.strictEqual(tokens.sublabel, 'tokens');
});

test('ante duplicados del mismo modelo se queda el más consumido', () => {
  const res = normalize([
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.5 },
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.1 },
  ]);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].pct, 90, 'gana el peor caso, no el orden de llegada');
});

test('conserva la hora de reinicio con cualquiera de los dos nombres', () => {
  assert.strictEqual(
    normalize([{ modelId: 'a', remainingFraction: 0.5, resetTime: '2026-08-18T00:00:00Z' }])[0].resetsAt,
    '2026-08-18T00:00:00Z'
  );
  assert.strictEqual(
    normalize([{ modelId: 'b', remainingFraction: 0.5, resetsAt: '2026-08-18T00:00:00Z' }])[0].resetsAt,
    '2026-08-18T00:00:00Z'
  );
});

test('la severidad escala con el consumo', () => {
  assert.strictEqual(severityFor(10), 'normal');
  assert.strictEqual(severityFor(79), 'normal');
  assert.strictEqual(severityFor(80), 'warning');
  assert.strictEqual(severityFor(90), 'serious');
  assert.strictEqual(severityFor(95), 'critical');
  assert.strictEqual(severityFor(100), 'critical');
});
