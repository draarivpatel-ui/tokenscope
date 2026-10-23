/*
 * TokenScope: seeded pseudo random helpers.
 * Every random process in the studio draws from these generators so that
 * simulations and replays are reproducible from a fixed seed.
 * Browser global: TokenScopeRandom. Node: module.exports.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TokenScopeRandom = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * Mulberry32: a tiny, fast, seedable PRNG. Same seed always produces the
   * same stream of values in [0, 1).
   */
  function mulberry32(seed) {
    var a = (seed >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* FNV style mix so (seed, string key) pairs map to stable new seeds. */
  function hashSeed(base, key) {
    var h = ((base >>> 0) ^ 0x9E3779B9) >>> 0;
    var s = String(key);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  return {
    mulberry32: mulberry32,
    hashSeed: hashSeed
  };
});
