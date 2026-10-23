'use strict';
/*
 * TokenScope tests: KV cache and weight memory arithmetic.
 * Known value used across this file: a 32 layer, 8 kv head, 128 head dim
 * model at fp16 needs 131072 bytes per token of context.
 */
const test = require('node:test');
const assert = require('node:assert');
const Memory = require('../js/engine/memory.js');

const CFG = {
  paramsBillions: 8,
  layers: 32,
  kvHeads: 8,
  headDim: 128,
  contextTokens: 8192,
  weightQuant: 'fp16',
  kvQuant: 'fp16',
  budgetGB: 24
};

test('quantization table maps fp16 to two bytes', () => {
  assert.strictEqual(Memory.QUANT_BYTES.fp16, 2);
});

test('quantization table maps int4 to half a byte', () => {
  assert.strictEqual(Memory.QUANT_BYTES.int4, 0.5);
});

test('kvBytesPerToken matches the hand computed 2LHD product', () => {
  assert.strictEqual(Memory.kvBytesPerToken(CFG), 131072);
});

test('kvBytesPerToken halves under int8 KV precision', () => {
  assert.strictEqual(Memory.kvBytesPerToken(Object.assign({}, CFG, { kvQuant: 'int8' })), 65536);
});

test('kvBytesPerToken doubles when kv head count doubles', () => {
  assert.strictEqual(Memory.kvBytesPerToken(Object.assign({}, CFG, { kvHeads: 16 })), 262144);
});

test('kvCacheBytes at 4096 context is the known 512 MiB value', () => {
  assert.strictEqual(Memory.kvCacheBytes(Object.assign({}, CFG, { contextTokens: 4096 })), 536870912);
});

test('weightBytes for 8B parameters at fp16 is 16 GB in bytes', () => {
  assert.strictEqual(Memory.weightBytes(8, 'fp16'), 16000000000);
});

test('weightBytes for 8B parameters at int4 is 4 GB in bytes', () => {
  assert.strictEqual(Memory.weightBytes(8, 'int4'), 4000000000);
});

test('toGB converts decimal gigabytes', () => {
  assert.strictEqual(Memory.toGB(16000000000), 16);
});

test('toGiB converts one binary gibibyte exactly', () => {
  assert.strictEqual(Memory.toGiB(1073741824), 1);
});

test('maxConcurrentSequences floors the budget division', () => {
  assert.strictEqual(Memory.maxConcurrentSequences(1e9, 8e9), 8);
});

test('maxConcurrentSequences returns zero for a zero per sequence cost', () => {
  assert.strictEqual(Memory.maxConcurrentSequences(0, 100), 0);
});

test('maxConcurrentSequences floors a partial fit', () => {
  assert.strictEqual(Memory.maxConcurrentSequences(3, 10), 3);
});

test('fitReport leaves headroom for 7 concurrent sequences at 24 GB', () => {
  assert.strictEqual(Memory.fitReport(CFG).maxSequences, 7);
});

test('fitReport reports 16 GB of weights for the default shape', () => {
  assert.strictEqual(Memory.fitReport(CFG).weightsGB, 16);
});

test('fitReport says the default shape fits its budget', () => {
  assert.strictEqual(Memory.fitReport(CFG).fits, true);
});

test('fitReport flags a 10 GB budget as over budget', () => {
  assert.strictEqual(Memory.fitReport(Object.assign({}, CFG, { budgetGB: 10 })).fits, false);
});

test('fitReport gives zero sequences when weights swallow the budget', () => {
  assert.strictEqual(Memory.fitReport(Object.assign({}, CFG, { budgetGB: 10 })).maxSequences, 0);
});

test('buildSteps produces at least six arithmetic lines', () => {
  assert.ok(Memory.buildSteps(CFG).length >= 6);
});

test('buildSteps lines all carry a label and an expression', () => {
  assert.ok(Memory.buildSteps(CFG).every(function (s) { return s.label.length > 0 && s.expression.length > 0; }));
});

test('buildSteps shows the full context byte count with separators', () => {
  const joined = Memory.buildSteps(CFG).map(function (s) { return s.expression; }).join(' ');
  assert.ok(joined.indexOf('1,073,741,824') !== -1);
});

test('buildSteps shows the per token byte count', () => {
  const joined = Memory.buildSteps(CFG).map(function (s) { return s.expression; }).join(' ');
  assert.ok(joined.indexOf('131,072') !== -1);
});
