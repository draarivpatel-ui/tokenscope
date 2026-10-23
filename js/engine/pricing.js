/*
 * TokenScope: pricing math for the Model Planner.
 * All price and latency inputs are fixture values supplied by the caller
 * (the editable table in the UI). No vendor is quoted anywhere.
 *
 * INTEGRATION POINT: a live pricing source would replace the fixture models
 * with the same object shape; see "Where a Nebius Key Would Plug In" in the
 * README. This module never performs network requests.
 *
 * Browser global: TokenScopePricing. Node: module.exports.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TokenScopePricing = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function roundTo(value, places) {
    var f = Math.pow(10, places);
    return Math.round(value * f) / f;
  }

  /*
   * Cost of one request in USD:
   *   (input tokens / 1e6) * input price per 1M
   * + (output tokens / 1e6) * output price per 1M
   */
  function requestCost(model, inputTokens, outputTokens) {
    var input = (inputTokens / 1000000) * model.inputPerMillion;
    var output = (outputTokens / 1000000) * model.outputPerMillion;
    return roundTo(input + output, 9);
  }

  function costPer1kRequests(model, inputTokens, outputTokens) {
    return roundTo(requestCost(model, inputTokens, outputTokens) * 1000, 6);
  }

  function monthlyCost(model, requestsPerDay, inputTokens, outputTokens, days) {
    var d = (typeof days === 'number' && isFinite(days)) ? days : 30;
    return roundTo(requestCost(model, inputTokens, outputTokens) * requestsPerDay * d, 6);
  }

  /* Expected wall clock seconds for one response: TTFT plus decode time. */
  function requestLatencySeconds(model, outputTokens) {
    return model.ttftMs / 1000 + outputTokens / model.tokensPerSecond;
  }

  function cheapestModel(models, inputTokens, outputTokens) {
    var best = null;
    for (var i = 0; i < models.length; i++) {
      if (!best || requestCost(models[i], inputTokens, outputTokens) < requestCost(best, inputTokens, outputTokens)) {
        best = models[i];
      }
    }
    return best;
  }

  function fastestModel(models) {
    var best = null;
    for (var i = 0; i < models.length; i++) {
      if (!best || models[i].tokensPerSecond > best.tokensPerSecond) {
        best = models[i];
      }
    }
    return best;
  }

  /*
   * One comparison row per model for the planner results grid.
   * workload: { inputTokens, outputTokens, requestsPerDay, days }
   */
  function compareModels(models, workload) {
    return models.map(function (model) {
      return {
        id: model.id,
        name: model.name,
        tier: model.tier,
        costPerRequest: requestCost(model, workload.inputTokens, workload.outputTokens),
        costPer1k: costPer1kRequests(model, workload.inputTokens, workload.outputTokens),
        monthlyCost: monthlyCost(model, workload.requestsPerDay, workload.inputTokens, workload.outputTokens, workload.days),
        latencySeconds: requestLatencySeconds(model, workload.outputTokens),
        tokensPerSecond: model.tokensPerSecond
      };
    });
  }

  function formatUSD(value) {
    return '$' + value.toFixed(4);
  }

  return {
    roundTo: roundTo,
    requestCost: requestCost,
    costPer1kRequests: costPer1kRequests,
    monthlyCost: monthlyCost,
    requestLatencySeconds: requestLatencySeconds,
    cheapestModel: cheapestModel,
    fastestModel: fastestModel,
    compareModels: compareModels,
    formatUSD: formatUSD
  };
});
