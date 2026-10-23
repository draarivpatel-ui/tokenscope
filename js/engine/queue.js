/*
 * TokenScope: deterministic batch queueing simulation.
 * Model: requests arrive with seeded exponential gaps (reproducible from a
 * fixed seed), a single server forms batches of up to B waiting requests,
 * and one batch finishes in one service window. Waits come from queueing,
 * not from randomness in service time, so runs with the same seed and
 * settings are identical.
 *
 * Iterations are capped at a small request count on purpose; this is a
 * planning sketch, not a load test.
 *
 * Browser global: TokenScopeQueue. Node: module.exports.
 */
(function (root, factory) {
  'use strict';
  var api = (typeof module === 'object' && module.exports)
    ? factory(require('./random.js'))
    : factory(root.TokenScopeRandom);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TokenScopeQueue = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Random) {
  'use strict';

  var HARD_REQUEST_CAP = 200;

  function roundTo(value, places) {
    var f = Math.pow(10, places);
    return Math.round(value * f) / f;
  }

  /*
   * Linear interpolated percentile of an ascending sorted array.
   * Returns null for an empty array.
   */
  function percentile(sorted, p) {
    if (!sorted || sorted.length === 0) {
      return null;
    }
    if (sorted.length === 1) {
      return sorted[0];
    }
    var idx = p * (sorted.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) {
      return sorted[lo];
    }
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  /*
   * opts: {
   *   arrivalRatePerSec,        requests per second (0 means no arrivals)
   *   serviceSecondsPerRequest, one service window per batch
   *   batchSize,                max requests per batch, minimum 1
   *   maxRequests,              capped at HARD_REQUEST_CAP
   *   seed                      any integer, default 42
   * }
   */
  function simulateQueue(opts) {
    opts = opts || {};
    var rate = Number(opts.arrivalRatePerSec) || 0;
    var service = Math.max(0.000001, Number(opts.serviceSecondsPerRequest) || 0);
    var batch = Math.max(1, Math.floor(Number(opts.batchSize) || 1));
    var maxRequests = Math.max(1, Math.min(Math.floor(Number(opts.maxRequests) || 120), HARD_REQUEST_CAP));
    var seed = (opts.seed == null) ? 42 : (Number(opts.seed) >>> 0);
    var rand = Random.mulberry32(seed);

    var arrivals = [];
    if (rate > 0) {
      var t = 0;
      for (var i = 0; i < maxRequests; i++) {
        arrivals.push({ id: i, arrival: t });
        var u = rand();
        t += -Math.log(1 - u) / rate;
      }
    }

    var completions = [];
    var queue = [];
    var nextIdx = 0;
    var now = 0;
    var busy = 0;

    while (nextIdx < arrivals.length || queue.length > 0) {
      if (queue.length === 0) {
        /* Server idle: jump to the next arrival, never backwards in time. */
        now = Math.max(now, arrivals[nextIdx].arrival);
      }
      while (nextIdx < arrivals.length && arrivals[nextIdx].arrival <= now) {
        queue.push(arrivals[nextIdx]);
        nextIdx++;
      }
      var members = queue.splice(0, batch);
      var start = now;
      var end = start + service;
      busy += service;
      now = end;
      for (var m = 0; m < members.length; m++) {
        var a = members[m];
        completions.push({
          id: a.id,
          arrival: a.arrival,
          start: start,
          end: end,
          wait: start - a.arrival,
          sojourn: end - a.arrival
        });
      }
    }

    var n = completions.length;
    var sojourns = completions.map(function (c) { return c.sojourn; }).sort(function (x, y) { return x - y; });
    var waits = completions.map(function (c) { return c.wait; });
    var horizon = n > 0 ? completions[n - 1].end : 0;
    var firstArrival = n > 0 ? completions[0].arrival : 0;

    return {
      completions: completions,
      count: n,
      p50: n > 0 ? roundTo(percentile(sojourns, 0.5), 6) : null,
      p95: n > 0 ? roundTo(percentile(sojourns, 0.95), 6) : null,
      meanWait: n > 0 ? roundTo(waits.reduce(function (s, w) { return s + w; }, 0) / n, 6) : null,
      maxWait: n > 0 ? roundTo(Math.max.apply(null, waits), 6) : null,
      utilization: horizon > 0 ? roundTo(busy / horizon, 6) : 0,
      throughput: (n >= 2 && horizon > firstArrival) ? roundTo(n / (horizon - firstArrival), 6) : 0,
      batchSize: batch,
      seed: seed
    };
  }

  /*
   * Run the same settings across several arrival rates. Same seed for every
   * row so rate comparisons are apples to apples.
   */
  function sweep(rates, opts) {
    opts = opts || {};
    return rates.map(function (rate) {
      var res = simulateQueue({
        arrivalRatePerSec: rate,
        serviceSecondsPerRequest: opts.serviceSecondsPerRequest,
        batchSize: opts.batchSize,
        maxRequests: opts.maxRequests,
        seed: opts.seed
      });
      return {
        arrivalRate: rate,
        batchSize: res.batchSize,
        completed: res.count,
        p50: res.p50,
        p95: res.p95,
        meanWait: res.meanWait,
        maxWait: res.maxWait,
        utilization: res.utilization,
        throughput: res.throughput
      };
    });
  }

  return {
    HARD_REQUEST_CAP: HARD_REQUEST_CAP,
    percentile: percentile,
    simulateQueue: simulateQueue,
    sweep: sweep
  };
});
