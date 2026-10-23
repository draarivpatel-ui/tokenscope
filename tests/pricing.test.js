'use strict';
/*
 * TokenScope tests: pricing math for the Model Planner.
 * All fixtures come from js/engine/fixtures.js; nothing here is networked.
 */
const test = require('node:test');
const assert = require('node:assert');
const Pricing = require('../js/engine/pricing.js');
const Fixtures = require('../js/engine/fixtures.js');

const MODELS = Fixtures.MODELS;
const nano = MODELS[0];  // 0.10 in / 0.40 out per 1M, 120 ms TTFT, 180 tok/s
const core = MODELS[2];  // 0.80 in / 3.00 out per 1M
const pro = MODELS[3];   // 2.50 in / 10.00 out per 1M

function approx(actual, expected, eps, msg) {
  const tolerance = eps || 1e-9;
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    (msg || 'approx') + ': expected ' + expected + ', got ' + actual
  );
}

test('requestCost is zero for a zero token request', () => {
  assert.strictEqual(Pricing.requestCost(nano, 0, 0), 0);
});

test('requestCost matches hand computed nano price', () => {
  approx(Pricing.requestCost(nano, 1000, 500), 0.0003, 1e-12, 'nano 1000 in 500 out');
});

test('requestCost matches hand computed pro price', () => {
  approx(Pricing.requestCost(pro, 1000, 500), 0.0075, 1e-12, 'pro 1000 in 500 out');
});

test('requestCost scales linearly with tokens', () => {
  approx(
    Pricing.requestCost(nano, 2000, 1000),
    2 * Pricing.requestCost(nano, 1000, 500),
    1e-12,
    'doubling tokens doubles cost'
  );
});

test('costPer1kRequests multiplies the unit cost by 1000', () => {
  approx(Pricing.costPer1kRequests(core, 1000, 500), 2.3, 1e-6, 'core per 1k');
});

test('monthlyCost uses 30 days by default', () => {
  approx(Pricing.monthlyCost(nano, 2000, 1000, 500), 18, 1e-6, 'monthly default days');
});

test('monthlyCost honors an explicit day count', () => {
  approx(Pricing.monthlyCost(nano, 2000, 1000, 500, 14), 8.4, 1e-6, 'monthly 14 days');
});

test('requestLatencySeconds is TTFT plus decode time', () => {
  approx(Pricing.requestLatencySeconds(nano, 600), 0.12 + 600 / 180, 1e-9, 'nano latency');
});

test('requestLatencySeconds with no output tokens is just TTFT', () => {
  approx(Pricing.requestLatencySeconds(nano, 0), 0.12, 1e-12, 'ttft only');
});

test('compareModels returns one row per model', () => {
  assert.strictEqual(Pricing.compareModels(MODELS, { inputTokens: 1000, outputTokens: 500, requestsPerDay: 2000, days: 30 }).length, 5);
});

test('compareModels pro row carries the request cost', () => {
  const rows = Pricing.compareModels(MODELS, { inputTokens: 1000, outputTokens: 500, requestsPerDay: 2000, days: 30 });
  approx(rows.find(function (r) { return r.id === 'pro'; }).costPerRequest, 0.0075, 1e-12, 'pro row cost');
});

test('cheapestModel picks the lowest tier for the sample workload', () => {
  assert.strictEqual(Pricing.cheapestModel(MODELS, 1000, 500).id, 'nano');
});

test('fastestModel picks the highest output throughput fixture', () => {
  assert.strictEqual(Pricing.fastestModel(MODELS).id, 'nano');
});

test('requestCost flows through a user edited fixture model', () => {
  const edited = { id: 'edited', name: 'Edited', tier: 1, inputPerMillion: 1, outputPerMillion: 2, ttftMs: 100, tokensPerSecond: 100 };
  approx(Pricing.requestCost(edited, 1000, 500), 0.002, 1e-12, 'edited fixture cost');
});

test('formatUSD renders four decimal places', () => {
  assert.strictEqual(Pricing.formatUSD(2.3), '$2.3000');
});

test('formatUSD keeps small fixture costs readable', () => {
  assert.strictEqual(Pricing.formatUSD(0.0003), '$0.0003');
});

test('roundTo rounds half away from zero at the requested places', () => {
  assert.strictEqual(Pricing.roundTo(3.14159, 3), 3.142);
});
