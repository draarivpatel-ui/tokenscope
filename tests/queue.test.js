'use strict';
/*
 * TokenScope tests: deterministic queueing simulation.
 * Every run here uses fixed seeds, so expected values are stable.
 */
const test = require('node:test');
const assert = require('node:assert');
const Queue = require('../js/engine/queue.js');
const Random = require('../js/engine/random.js');

function approx(actual, expected, eps, msg) {
  const tolerance = eps || 1e-9;
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    (msg || 'approx') + ': expected ' + expected + ', got ' + actual
  );
}

test('mulberry32 is reproducible for a fixed seed', () => {
  const a = Random.mulberry32(7);
  const b = Random.mulberry32(7);
  const xs = [];
  const ys = [];
  for (let i = 0; i < 5; i++) { xs.push(a()); }
  for (let i = 0; i < 5; i++) { ys.push(b()); }
  assert.strictEqual(xs.join(','), ys.join(','));
});

test('mulberry32 streams differ across seeds', () => {
  const a = Random.mulberry32(7);
  const c = Random.mulberry32(8);
  const xs = [];
  const ys = [];
  for (let i = 0; i < 5; i++) { xs.push(a()); }
  for (let i = 0; i < 5; i++) { ys.push(c()); }
  assert.notStrictEqual(xs.join(','), ys.join(','));
});

test('percentile of an empty array is null', () => {
  assert.strictEqual(Queue.percentile([], 0.5), null);
});

test('percentile of a single value array is that value', () => {
  assert.strictEqual(Queue.percentile([5], 0.99), 5);
});

test('percentile interpolates between order statistics', () => {
  approx(Queue.percentile([1, 2, 3, 4], 0.5), 2.5, 1e-12, 'p50 of four values');
});

test('percentile at 0.95 of three values lands in the top interval', () => {
  approx(Queue.percentile([10, 20, 30], 0.95), 29, 1e-9, 'p95 interpolation');
});

test('percentile at the median of an odd length array is the middle value', () => {
  assert.strictEqual(Queue.percentile([1, 2, 3, 4, 5], 0.5), 3);
});

test('a zero arrival rate completes nothing', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 0, serviceSecondsPerRequest: 0.3, batchSize: 1, maxRequests: 10, seed: 7 });
  assert.strictEqual(res.count, 0);
});

test('a zero arrival rate has no p50', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 0, serviceSecondsPerRequest: 0.3, batchSize: 1, maxRequests: 10, seed: 7 });
  assert.strictEqual(res.p50, null);
});

test('a zero arrival rate has zero utilization', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 0, serviceSecondsPerRequest: 0.3, batchSize: 1, maxRequests: 10, seed: 7 });
  assert.strictEqual(res.utilization, 0);
});

test('a standard run completes exactly the requested count', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 1, maxRequests: 60, seed: 7 });
  assert.strictEqual(res.count, 60);
});

test('no request waits a negative time', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 1, maxRequests: 60, seed: 7 });
  const minWait = Math.min.apply(null, res.completions.map(function (c) { return c.wait; }));
  assert.ok(minWait >= 0, 'min wait was ' + minWait);
});

test('sojourn time is never smaller than wait time', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 1, maxRequests: 60, seed: 7 });
  const minSlack = Math.min.apply(null, res.completions.map(function (c) { return c.sojourn - c.wait; }));
  assert.ok(minSlack >= 0, 'min slack was ' + minSlack);
});

test('utilization stays between zero and one', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 1, maxRequests: 60, seed: 7 });
  assert.ok(res.utilization > 0 && res.utilization <= 1, 'utilization was ' + res.utilization);
});

test('the first arrival lands at time zero', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 1, maxRequests: 60, seed: 7 });
  assert.strictEqual(res.completions[0].arrival, 0);
});

test('completion times never move backwards', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 2, maxRequests: 60, seed: 7 });
  let monotonic = true;
  let last = -Infinity;
  for (const c of res.completions) {
    if (c.end < last) { monotonic = false; }
    last = c.end;
  }
  assert.ok(monotonic, 'completion ends were not nondecreasing');
});

test('identical seeds reproduce identical runs', () => {
  const a = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 4, maxRequests: 60, seed: 7 });
  const b = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 4, maxRequests: 60, seed: 7 });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
});

test('a saturated single server queues past its service time', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 6, serviceSecondsPerRequest: 0.4, batchSize: 1, maxRequests: 100, seed: 7 });
  assert.ok(res.p95 > 0.4, 'p95 was ' + res.p95);
});

test('a larger batch never increases p95 in the congested case', () => {
  const one = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.4, batchSize: 1, maxRequests: 100, seed: 7 });
  const four = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.4, batchSize: 4, maxRequests: 100, seed: 7 });
  assert.ok(four.p95 <= one.p95, 'batch 4 p95 ' + four.p95 + ' exceeded batch 1 p95 ' + one.p95);
});

test('sweep returns one row per arrival rate', () => {
  const rows = Queue.sweep([0.5, 1, 2], { serviceSecondsPerRequest: 0.3, batchSize: 4, maxRequests: 60, seed: 7 });
  assert.strictEqual(rows.length, 3);
});

test('sweep rows keep p50 at or below p95', () => {
  const rows = Queue.sweep([0.5, 1, 2], { serviceSecondsPerRequest: 0.3, batchSize: 4, maxRequests: 60, seed: 7 });
  assert.ok(rows.every(function (r) { return r.p50 === null || r.p95 === null || r.p50 <= r.p95; }));
});

test('sweep rows carry their arrival rate', () => {
  const rows = Queue.sweep([0.5, 1, 2], { serviceSecondsPerRequest: 0.3, batchSize: 4, maxRequests: 60, seed: 7 });
  assert.strictEqual(rows[0].arrivalRate, 0.5);
});

test('the hard request cap holds even for large inputs', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.2, batchSize: 1, maxRequests: 5000, seed: 7 });
  assert.strictEqual(res.count, Queue.HARD_REQUEST_CAP);
});

test('a batch size below one is coerced to one', () => {
  const res = Queue.simulateQueue({ arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.1, batchSize: 0, maxRequests: 20, seed: 7 });
  assert.strictEqual(res.batchSize, 1);
});
