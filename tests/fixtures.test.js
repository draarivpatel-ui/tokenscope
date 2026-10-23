'use strict';
/*
 * TokenScope tests: fixture data integrity.
 * The synthetic log is the only request source in the studio, so its
 * determinism and label ranges are pinned here.
 */
const test = require('node:test');
const assert = require('node:assert');
const Fixtures = require('../js/engine/fixtures.js');

test('the fixture table ships five model tiers', () => {
  assert.strictEqual(Fixtures.MODELS.length, 5);
});

test('fixture tiers run from zero to four in order', () => {
  assert.strictEqual(Fixtures.MODELS.map(function (m) { return m.tier; }).join(','), '0,1,2,3,4');
});

test('every fixture model has positive prices and throughput', () => {
  assert.ok(Fixtures.MODELS.every(function (m) {
    return m.inputPerMillion > 0 && m.outputPerMillion > 0 && m.tokensPerSecond > 0 && m.ttftMs > 0;
  }));
});

test('the synthetic log generates the requested entry count', () => {
  assert.strictEqual(Fixtures.makeSyntheticLog(7, 60).length, 60);
});

test('the synthetic log is reproducible from the seed', () => {
  const a = JSON.stringify(Fixtures.makeSyntheticLog(7, 60));
  const b = JSON.stringify(Fixtures.makeSyntheticLog(7, 60));
  assert.strictEqual(a, b);
});

test('synthetic log entry ids are unique', () => {
  const log = Fixtures.makeSyntheticLog(7, 60);
  assert.strictEqual(new Set(log.map(function (e) { return e.id; })).size, 60);
});

test('synthetic difficulties stay inside the zero to four range', () => {
  assert.ok(Fixtures.makeSyntheticLog(7, 60).every(function (e) {
    return Number.isInteger(e.difficulty) && e.difficulty >= 0 && e.difficulty <= 4;
  }));
});

test('synthetic categories all come from the known set', () => {
  assert.ok(Fixtures.makeSyntheticLog(7, 60).every(function (e) {
    return Fixtures.CATEGORIES.indexOf(e.category) !== -1;
  }));
});

test('summarizeLog reports the full log length', () => {
  assert.strictEqual(Fixtures.summarizeLog(Fixtures.makeSyntheticLog(7, 60)).total, 60);
});

test('summarizeLog accumulates positive token totals', () => {
  const s = Fixtures.summarizeLog(Fixtures.makeSyntheticLog(7, 60));
  assert.ok(s.totalInputTokens > 0 && s.totalOutputTokens > 0);
});

test('different seeds produce different logs', () => {
  const a = JSON.stringify(Fixtures.makeSyntheticLog(7, 60));
  const b = JSON.stringify(Fixtures.makeSyntheticLog(8, 60));
  assert.notStrictEqual(a, b);
});
