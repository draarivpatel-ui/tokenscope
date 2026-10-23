/*
 * TokenScope: KV cache and weight memory arithmetic for Memory Fit.
 * The formulas are the standard transformer serving estimates:
 *   KV bytes per token = 2 (K and V) * layers * kv heads * head dim * bytes per element
 *   Weight bytes       = parameters * 1e9 * bytes per element
 * kvHeads is the number of key/value heads (grouped query attention models
 * keep this smaller than the query head count); the panel shows the real
 * arithmetic step by step so every line can be audited.
 *
 * GB in this module means decimal gigabytes (1e9 bytes); GiB is separate.
 *
 * Browser global: TokenScopeMemory. Node: module.exports.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TokenScopeMemory = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var QUANT_BYTES = {
    fp16: 2,
    bf16: 2,
    int8: 1,
    int4: 0.5
  };

  function kvBytesPerToken(cfg) {
    var bytes = QUANT_BYTES[cfg.kvQuant] != null ? QUANT_BYTES[cfg.kvQuant] : 2;
    return 2 * cfg.layers * cfg.kvHeads * cfg.headDim * bytes;
  }

  function kvCacheBytes(cfg) {
    return kvBytesPerToken(cfg) * cfg.contextTokens;
  }

  function weightBytes(paramsBillions, weightQuant) {
    var bytes = QUANT_BYTES[weightQuant] != null ? QUANT_BYTES[weightQuant] : 2;
    return paramsBillions * 1e9 * bytes;
  }

  function toGB(bytes) {
    return bytes / 1e9;
  }

  function toGiB(bytes) {
    return bytes / 1073741824;
  }

  /* How many full context sequences fit in a KV budget. */
  function maxConcurrentSequences(kvPerSequenceBytes, budgetBytes) {
    if (!(kvPerSequenceBytes > 0) || !(budgetBytes > 0)) {
      return 0;
    }
    return Math.max(0, Math.floor(budgetBytes / kvPerSequenceBytes));
  }

  /*
   * cfg: { paramsBillions, layers, kvHeads, headDim, contextTokens,
   *        weightQuant, kvQuant, budgetGB }
   */
  function fitReport(cfg) {
    var perToken = kvBytesPerToken(cfg);
    var perSequence = perToken * cfg.contextTokens;
    var weights = weightBytes(cfg.paramsBillions, cfg.weightQuant);
    var budgetBytes = cfg.budgetGB * 1e9;
    var freeForKv = Math.max(0, budgetBytes - weights);
    var maxSeqs = maxConcurrentSequences(perSequence, freeForKv);
    return {
      kvBytesPerTokenValue: perToken,
      kvPerSequenceBytes: perSequence,
      kvPerSequenceGB: toGB(perSequence),
      weightsBytes: weights,
      weightsGB: toGB(weights),
      budgetGB: cfg.budgetGB,
      freeForKvBytes: freeForKv,
      freeForKvGB: toGB(freeForKv),
      maxSequences: maxSeqs,
      fits: weights <= budgetBytes && maxSeqs >= 1
    };
  }

  function fmtInt(value) {
    return Math.round(value).toLocaleString('en-US');
  }

  function fmtDec(value, places) {
    return value.toFixed(places == null ? 2 : places);
  }

  /*
   * Human readable arithmetic lines for the Step By Step panel. Each entry
   * carries a label, the full expression, and the computed value.
   */
  function buildSteps(cfg) {
    var report = fitReport(cfg);
    var kvBytes = QUANT_BYTES[cfg.kvQuant] != null ? QUANT_BYTES[cfg.kvQuant] : 2;
    var wBytes = QUANT_BYTES[cfg.weightQuant] != null ? QUANT_BYTES[cfg.weightQuant] : 2;
    var steps = [];

    steps.push({
      label: 'Bytes Per KV Token',
      expression: '2 x ' + cfg.layers + ' layers x ' + cfg.kvHeads + ' kv heads x ' +
        cfg.headDim + ' head dim x ' + kvBytes + ' bytes = ' + fmtInt(report.kvBytesPerTokenValue),
      value: report.kvBytesPerTokenValue
    });
    steps.push({
      label: 'KV Cache For One Sequence',
      expression: fmtInt(report.kvBytesPerTokenValue) + ' x ' + fmtInt(cfg.contextTokens) +
        ' context tokens = ' + fmtInt(report.kvPerSequenceBytes) + ' bytes',
      value: report.kvPerSequenceBytes
    });
    steps.push({
      label: 'KV Cache For One Sequence In GB',
      expression: fmtInt(report.kvPerSequenceBytes) + ' / 1e9 = ' + fmtDec(report.kvPerSequenceGB) + ' GB',
      value: report.kvPerSequenceGB
    });
    steps.push({
      label: 'Weight Memory',
      expression: fmtDec(cfg.paramsBillions, 1) + 'B parameters x 1e9 x ' + wBytes +
        ' bytes = ' + fmtInt(report.weightsBytes) + ' bytes = ' + fmtDec(report.weightsGB) + ' GB',
      value: report.weightsBytes
    });
    steps.push({
      label: 'Memory Left For KV',
      expression: fmtDec(cfg.budgetGB) + ' GB budget - ' + fmtDec(report.weightsGB) +
        ' GB weights = ' + fmtDec(report.freeForKvGB) + ' GB',
      value: report.freeForKvBytes
    });
    steps.push({
      label: 'Max Concurrent Sequences',
      expression: 'floor(' + fmtInt(report.freeForKvBytes) + ' / ' + fmtInt(report.kvPerSequenceBytes) +
        ') = ' + fmtInt(report.maxSequences) + ' sequences',
      value: report.maxSequences
    });
    return steps;
  }

  return {
    QUANT_BYTES: QUANT_BYTES,
    kvBytesPerToken: kvBytesPerToken,
    kvCacheBytes: kvCacheBytes,
    weightBytes: weightBytes,
    toGB: toGB,
    toGiB: toGiB,
    maxConcurrentSequences: maxConcurrentSequences,
    fitReport: fitReport,
    buildSteps: buildSteps
  };
});
