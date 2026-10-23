/*
 * TokenScope: route policy replay for the Route Builder.
 * A policy is an ordered rule list plus a default model. The first rule
 * whose category and minimum input token length match a request wins and
 * sends it to a target model. After the first attempt, a confidence proxy
 * decides escalation: while confidence sits below the active threshold the
 * request retries on the next tier up, until it passes or no tier is left.
 *
 * confidenceFor is a deterministic synthetic proxy, not a measured score:
 *   0.92 when the model tier meets the labeled difficulty,
 *   minus 0.15 per tier it falls short, floored at 0.05.
 * Success is judged against the labeled difficulty of the synthetic log:
 * the final model tier must be at least the difficulty.
 *
 * Total cost counts every attempt, because a real deployment pays for the
 * cheap try and the escalated retry both.
 *
 * Browser global: TokenScopeRouting. Node: module.exports.
 */
(function (root, factory) {
  'use strict';
  var api = (typeof module === 'object' && module.exports)
    ? factory(require('./random.js'), require('./pricing.js'))
    : factory(root.TokenScopeRandom, root.TokenScopePricing);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TokenScopeRouting = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Random, Pricing) {
  'use strict';

  function roundTo(value, places) {
    var f = Math.pow(10, places);
    return Math.round(value * f) / f;
  }

  function clampConfidence(x) {
    return Math.min(0.99, Math.max(0.01, x));
  }

  /* Deterministic confidence proxy for a model tier against a difficulty. */
  function confidenceFor(tier, difficulty) {
    var gap = Math.max(0, difficulty - tier);
    return roundTo(0.92 - 0.15 * gap, 6);
  }

  /*
   * First matching rule wins. A rule matches when its category is 'any' or
   * equals the entry category, and the entry has at least minInputTokens.
   */
  function pickRoute(entry, rules, defaultModelId) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.category && rule.category !== 'any' && rule.category !== entry.category) {
        continue;
      }
      if (rule.minInputTokens && entry.inputTokens < rule.minInputTokens) {
        continue;
      }
      return { modelId: rule.targetModelId, ruleId: rule.id, reason: 'rule' };
    }
    return { modelId: defaultModelId, ruleId: null, reason: 'default' };
  }

  function ruleById(rules, id) {
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].id === id) {
        return rules[i];
      }
    }
    return null;
  }

  /*
   * Replay one request. See replayLog for opts. Returns a row describing
   * every attempt, the final model, cost and label verdict.
   */
  function replayEntry(entry, models, rules, opts) {
    opts = opts || {};
    var defaultModelId = opts.defaultModelId || (models[0] ? models[0].id : null);
    var globalThreshold = (opts.escalateBelow == null) ? 0.75 : opts.escalateBelow;
    var jitter = opts.jitter || 0;
    var seed = (opts.seed == null) ? 1 : opts.seed;

    var sorted = models.slice().sort(function (a, b) { return a.tier - b.tier; });
    var byId = {};
    models.forEach(function (m) { byId[m.id] = m; });

    var route = pickRoute(entry, rules, defaultModelId);
    var startModel = byId[route.modelId] || sorted[0];
    var rule = route.ruleId ? ruleById(rules, route.ruleId) : null;
    var threshold = rule ? (rule.escalateBelow == null ? null : rule.escalateBelow) : globalThreshold;
    var startIdx = Math.max(0, sorted.indexOf(startModel));
    var rand = Random.mulberry32(Random.hashSeed(seed, entry.id));

    var attempts = [];
    var idx = startIdx;
    for (;;) {
      var model = sorted[idx];
      var conf = confidenceFor(model.tier, entry.difficulty);
      if (jitter > 0) {
        conf = clampConfidence(conf + (rand() - 0.5) * 2 * jitter);
      }
      conf = roundTo(conf, 4);
      attempts.push({
        modelId: model.id,
        confidence: conf,
        cost: Pricing.requestCost(model, entry.inputTokens, entry.outputTokens)
      });
      if (threshold == null) { break; }
      if (conf >= threshold) { break; }
      if (idx >= sorted.length - 1) { break; }
      idx += 1;
    }

    var finalAttempt = attempts[attempts.length - 1];
    var finalModel = byId[finalAttempt.modelId];
    var totalCost = roundTo(attempts.reduce(function (s, a) { return s + a.cost; }, 0), 9);

    return {
      id: entry.id,
      category: entry.category,
      difficulty: entry.difficulty,
      initialModelId: startModel.id,
      finalModelId: finalModel.id,
      chain: attempts.map(function (a) { return a.modelId; }),
      attempts: attempts.length,
      confidence: finalAttempt.confidence,
      cost: totalCost,
      escalated: attempts.length > 1,
      success: finalModel.tier >= entry.difficulty
    };
  }

  /*
   * Replay a whole log under one policy.
   * opts: { defaultModelId, escalateBelow, jitter, seed }
   * The summary also reports what the same log would cost if every request
   * went to the top tier once, and if every request went to the cheapest.
   */
  function replayLog(log, models, rules, opts) {
    opts = opts || {};
    var rows = log.map(function (entry) {
      return replayEntry(entry, models, rules, opts);
    });

    var sorted = models.slice().sort(function (a, b) { return a.tier - b.tier; });
    var premium = sorted[sorted.length - 1];
    var cheap = sorted[0];
    var n = rows.length;
    var totalCost = roundTo(rows.reduce(function (s, r) { return s + r.cost; }, 0), 9);
    var allPremiumCost = roundTo(log.reduce(function (s, e) {
      return s + Pricing.requestCost(premium, e.inputTokens, e.outputTokens);
    }, 0), 9);
    var allCheapCost = roundTo(log.reduce(function (s, e) {
      return s + Pricing.requestCost(cheap, e.inputTokens, e.outputTokens);
    }, 0), 9);
    var attemptsSum = rows.reduce(function (s, r) { return s + r.attempts; }, 0);
    var escalations = rows.filter(function (r) { return r.escalated; }).length;
    var successes = rows.filter(function (r) { return r.success; }).length;

    return {
      rows: rows,
      summary: {
        entries: n,
        successes: successes,
        successRate: n > 0 ? successes / n : 0,
        escalations: escalations,
        escalationRate: n > 0 ? escalations / n : 0,
        extraAttempts: rows.reduce(function (s, r) { return s + (r.attempts - 1); }, 0),
        attemptsPerRequest: n > 0 ? attemptsSum / n : 0,
        totalCost: totalCost,
        allPremiumCost: allPremiumCost,
        allCheapCost: allCheapCost,
        savingsVsPremiumPct: allPremiumCost > 0 ? roundTo((1 - totalCost / allPremiumCost) * 100, 4) : 0,
        savingsVsCheapPct: allCheapCost > 0 ? roundTo((totalCost / allCheapCost - 1) * 100, 4) : 0
      }
    };
  }

  return {
    confidenceFor: confidenceFor,
    pickRoute: pickRoute,
    replayEntry: replayEntry,
    replayLog: replayLog
  };
});
