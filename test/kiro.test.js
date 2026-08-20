// Fijado contra la respuesta real de GetUsageLimits en un plan KIRO POWER.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalize, planTitle } = require('../src/providers/kiro');

// Recorte fiel de lo que devolvio la API (sin el userInfo).
const REAL = {
  daysUntilReset: 0,
  limits: [],
  nextDateReset: 1788220800,
  overageConfiguration: { overageStatus: 'DISABLED' },
  subscriptionInfo: { subscriptionTitle: 'KIRO POWER', type: 'Q_DEVELOPER_STANDALONE_POWER' },
  usageBreakdownList: [
    {
      bonuses: [],
      currency: 'USD',
      currentOverages: 0,
      currentOveragesWithPrecision: 0,
      currentUsage: 6,
      currentUsageWithPrecision: 6.5,
      displayName: 'Credit',
      displayNamePlural: 'Credits',
      nextDateReset: 1788220800,
      overageCap: 10000,
      overageCharges: 0,
      overageRate: 0.04,
      resourceType: 'CREDIT',
      unit: 'INVOCATIONS',
      usageLimit: 10000,
      usageLimitWithPrecision: 10000,
    },
  ],
};

test('lee el consumo real de usageBreakdownList', () => {
  const [l] = normalize(REAL);
  assert.strictEqual(l.pct, 0, '6,5 de 10000 redondea a 0 %');
  assert.strictEqual(l.label, 'Créditos');
  assert.strictEqual(l.kind, 'credit');
  assert.strictEqual(l.group, 'monthly');
  assert.strictEqual(l.severity, 'normal');
});

// Con 6,5 sobre 10.000 el porcentaje es 0 y no dice nada: el detalle es lo
// unico que informa de verdad.
test('el subtitulo lleva las cifras absolutas', () => {
  const [l] = normalize(REAL);
  assert.match(l.sublabel, /6,5/);
  assert.match(l.sublabel, /10\.000/);
});

test('usa nextDateReset y no daysUntilReset, que llega en 0', () => {
  const [l] = normalize(REAL);
  assert.strictEqual(l.resetsAt, new Date(1788220800 * 1000).toISOString());
  assert.ok(Date.parse(l.resetsAt) > Date.parse('2026-08-25'), 'el reinicio es futuro');
});

test('el timestamp se interpreta en segundos, no en milisegundos', () => {
  const [l] = normalize(REAL);
  assert.strictEqual(new Date(l.resetsAt).getUTCFullYear(), 2026);
});

test('lee el titulo del plan', () => {
  assert.strictEqual(planTitle(REAL), 'KIRO POWER');
  assert.strictEqual(planTitle({}), null);
});

test('calcula el porcentaje cuando el consumo es alto', () => {
  const alto = { usageBreakdownList: [{ ...REAL.usageBreakdownList[0], currentUsageWithPrecision: 9200 }] };
  const [l] = normalize(alto);
  assert.strictEqual(l.pct, 92);
  assert.strictEqual(l.severity, 'serious');
});

test('anota el exceso cuando lo hay', () => {
  const conExceso = {
    usageBreakdownList: [
      { ...REAL.usageBreakdownList[0], currentUsageWithPrecision: 10000, currentOverages: 250, currentOveragesWithPrecision: 250, overageCharges: 10 },
    ],
  };
  const [l] = normalize(conExceso);
  assert.strictEqual(l.pct, 100);
  assert.match(l.sublabel, /250 de exceso/);
  assert.match(l.sublabel, /10 USD/);
});

test('recorre todos los recursos, no solo el primero', () => {
  const varios = {
    usageBreakdownList: [
      REAL.usageBreakdownList[0],
      { ...REAL.usageBreakdownList[0], resourceType: 'SPEC', displayNamePlural: 'Specs', currentUsageWithPrecision: 3, usageLimitWithPrecision: 10 },
    ],
  };
  const res = normalize(varios);
  assert.strictEqual(res.length, 2);
  assert.deepStrictEqual(res.map((l) => l.kind), ['credit', 'spec']);
  assert.strictEqual(res[1].pct, 30);
});

test('descarta entradas sin limite en vez de dividir por cero', () => {
  const roto = {
    usageBreakdownList: [
      { resourceType: 'X', currentUsageWithPrecision: 5, usageLimitWithPrecision: 0 },
      { resourceType: 'Y', currentUsageWithPrecision: 5 },
      { resourceType: 'Z' },
    ],
  };
  assert.deepStrictEqual(normalize(roto), []);
});

test('no revienta si falta usageBreakdownList', () => {
  for (const v of [{}, { usageBreakdownList: null }, { usageBreakdownList: [] }]) {
    assert.deepStrictEqual(normalize(v), []);
  }
});
