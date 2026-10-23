/*
 * TokenScope: fixture data for the whole studio.
 * MODELS: five generic tiers (Nano to Ultra) with editable price, latency
 * and throughput fixtures. These are NOT vendor quotes; they exist so the
 * math has something honest to chew on, and every cell is editable in the UI.
 * makeSyntheticLog: a labeled synthetic request log generated from a fixed
 * seed. Each entry carries a difficulty label: the minimum fixture tier that
 * the label says the request needs to be handled well.
 *
 * Browser global: TokenScopeFixtures. Node: module.exports.
 */
(function (root, factory) {
  'use strict';
  var api = (typeof module === 'object' && module.exports)
    ? factory(require('./random.js'))
    : factory(root.TokenScopeRandom);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TokenScopeFixtures = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Random) {
  'use strict';

  var MODELS = [
    { id: 'nano',  name: 'Nano',  tier: 0, inputPerMillion: 0.10, outputPerMillion: 0.40, ttftMs: 120, tokensPerSecond: 180 },
    { id: 'mini',  name: 'Mini',  tier: 1, inputPerMillion: 0.30, outputPerMillion: 1.20, ttftMs: 150, tokensPerSecond: 120 },
    { id: 'core',  name: 'Core',  tier: 2, inputPerMillion: 0.80, outputPerMillion: 3.00, ttftMs: 220, tokensPerSecond: 70 },
    { id: 'pro',   name: 'Pro',   tier: 3, inputPerMillion: 2.50, outputPerMillion: 10.00, ttftMs: 350, tokensPerSecond: 40 },
    { id: 'ultra', name: 'Ultra', tier: 4, inputPerMillion: 6.00, outputPerMillion: 24.00, ttftMs: 500, tokensPerSecond: 25 }
  ];

  var CATEGORIES = ['classify', 'extract', 'summarize', 'chat', 'code', 'reason'];

  /*
   * Token count and difficulty ranges per category. Difficulty is the
   * minimum model tier (index into MODELS) the label says the request needs.
   */
  var CATEGORY_PROFILES = {
    classify:  { inMin: 40,   inMax: 300,  outMin: 1,   outMax: 20,   diffMin: 0, diffMax: 0 },
    extract:   { inMin: 200,  inMax: 1500, outMin: 50,  outMax: 400,  diffMin: 0, diffMax: 1 },
    summarize: { inMin: 600,  inMax: 4000, outMin: 150, outMax: 600,  diffMin: 0, diffMax: 1 },
    chat:      { inMin: 100,  inMax: 1200, outMin: 80,  outMax: 500,  diffMin: 1, diffMax: 2 },
    code:      { inMin: 300,  inMax: 2500, outMin: 100, outMax: 900,  diffMin: 2, diffMax: 3 },
    reason:    { inMin: 200,  inMax: 3000, outMin: 200, outMax: 1400, diffMin: 3, diffMax: 4 }
  };

  function randInt(rand, min, max) {
    return Math.floor(rand() * (max - min + 1)) + min;
  }

  function makeSyntheticLog(seed, count) {
    var n = Math.max(1, Math.min(Math.floor(count) || 60, 500));
    var rand = Random.mulberry32(seed == null ? 7 : seed);
    var log = [];
    for (var i = 0; i < n; i++) {
      var category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
      var profile = CATEGORY_PROFILES[category];
      log.push({
        id: 'req-' + ('00' + (i + 1)).slice(-3),
        category: category,
        inputTokens: randInt(rand, profile.inMin, profile.inMax),
        outputTokens: randInt(rand, profile.outMin, profile.outMax),
        difficulty: randInt(rand, profile.diffMin, profile.diffMax),
        source: 'synthetic'
      });
    }
    return log;
  }

  function summarizeLog(log) {
    var byCategory = {};
    var byDifficulty = {};
    var totalInput = 0;
    var totalOutput = 0;
    log.forEach(function (entry) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      byDifficulty[entry.difficulty] = (byDifficulty[entry.difficulty] || 0) + 1;
      totalInput += entry.inputTokens;
      totalOutput += entry.outputTokens;
    });
    return {
      total: log.length,
      byCategory: byCategory,
      byDifficulty: byDifficulty,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput
    };
  }

  return {
    MODELS: MODELS,
    CATEGORIES: CATEGORIES,
    CATEGORY_PROFILES: CATEGORY_PROFILES,
    makeSyntheticLog: makeSyntheticLog,
    summarizeLog: summarizeLog
  };
});
