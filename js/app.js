/*
 * TokenScope app wiring: tabs, panel renders, canvas sweep chart and the
 * guided tour. All computation comes from the engine modules in
 * js/engine; this file only reads inputs, calls engines and paints the DOM.
 * No network calls are made anywhere in this file.
 */
(function () {
  'use strict';

  var Fixtures = window.TokenScopeFixtures;
  var Pricing = window.TokenScopePricing;
  var Memory = window.TokenScopeMemory;
  var Queue = window.TokenScopeQueue;
  var Routing = window.TokenScopeRouting;

  var TAB_IDS = ['planner', 'memory', 'sim', 'route'];
  var TAB_EL = {
    planner: 'tab-planner',
    memory: 'tab-memory',
    sim: 'tab-sim',
    route: 'tab-route'
  };
  var PANEL_EL = {
    planner: 'panel-planner',
    memory: 'panel-memory',
    sim: 'panel-sim',
    route: 'panel-route'
  };

  var SWEEP_RATES = [0.5, 1, 2, 3, 4, 6];
  var CATEGORIES = Fixtures.CATEGORIES;

  var FIXTURE_FIELDS = [
    { key: 'inputPerMillion', step: '0.01', min: '0', aria: 'input price in USD per million tokens' },
    { key: 'outputPerMillion', step: '0.01', min: '0', aria: 'output price in USD per million tokens' },
    { key: 'ttftMs', step: '1', min: '0', aria: 'first token latency in milliseconds' },
    { key: 'tokensPerSecond', step: '1', min: '1', aria: 'output tokens per second' }
  ];

  /*
   * INTEGRATION POINT: NEBIUS. state.models is the single source of pricing
   * and latency fixtures for every panel. A future live build would hydrate
   * this array from a Nebius inference API through a small server side
   * proxy; see README, "Where a Nebius Inference API Key Would Plug In".
   * No such call exists in this build and nothing here touches the network.
   */
  var state = {
    models: clone(Fixtures.MODELS),
    defaultModels: clone(Fixtures.MODELS),
    workload: { inputTokens: 1200, outputTokens: 600, requestsPerDay: 2000, days: 30 },
    rules: [
      { id: 'rule-1', category: 'reason', minInputTokens: 0, targetModelId: 'pro', escalateBelow: 0.8 },
      { id: 'rule-2', category: 'code', minInputTokens: 0, targetModelId: 'core', escalateBelow: 0.75 },
      { id: 'rule-3', category: 'any', minInputTokens: 4000, targetModelId: 'mini', escalateBelow: null }
    ],
    log: Fixtures.makeSyntheticLog(7, 60)
  };

  var currentTab = 'planner';
  var lastSweep = [];
  var ruleCounter = 3;

  /* ---------- helpers ---------- */

  function $(id) {
    return document.getElementById(id);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readNum(id, fallback) {
    var v = parseFloat($(id).value);
    return isFinite(v) ? v : fallback;
  }

  function motionOk() {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function fmtUSD2(v) {
    return '$' + v.toFixed(2);
  }

  function fmtSec(v) {
    if (v == null) { return 'n/a'; }
    return v.toFixed(3) + ' s';
  }

  function fmtPct(v) {
    return (v * 100).toFixed(1) + '%';
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(fn, ms);
    };
  }

  function modelName(id) {
    for (var i = 0; i < state.models.length; i++) {
      if (state.models[i].id === id) { return state.models[i].name; }
    }
    return id;
  }

  function tierName(tier) {
    for (var i = 0; i < state.models.length; i++) {
      if (state.models[i].tier === tier) { return state.models[i].name; }
    }
    return 'Tier ' + tier;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text != null) { node.textContent = text; }
    return node;
  }

  function statBlock(label, value) {
    var div = el('div', 'stat');
    div.appendChild(el('span', 'stat-label', label));
    div.appendChild(el('span', 'stat-value', value));
    return div;
  }

  function addBadge(host, text, modifier) {
    var badge = el('span', 'badge' + (modifier ? ' ' + modifier : ''), text);
    host.appendChild(badge);
  }

  /* ---------- tabs ---------- */

  function activatePanel(name) {
    currentTab = name;
    TAB_IDS.forEach(function (tab) {
      var active = tab === name;
      var tabEl = $(TAB_EL[tab]);
      var panelEl = $(PANEL_EL[tab]);
      tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
      tabEl.tabIndex = active ? 0 : -1;
      if (active) {
        panelEl.removeAttribute('hidden');
      } else {
        panelEl.setAttribute('hidden', '');
      }
    });
    if (name === 'sim') {
      drawSimChart(lastSweep);
    }
  }

  function wireTabs() {
    TAB_IDS.forEach(function (tab) {
      $(TAB_EL[tab]).addEventListener('click', function () {
        activatePanel(tab);
      });
    });
    $('panel-tabs').addEventListener('keydown', function (e) {
      var idx = TAB_IDS.indexOf(currentTab);
      var next = null;
      if (e.key === 'ArrowRight') { next = (idx + 1) % TAB_IDS.length; }
      else if (e.key === 'ArrowLeft') { next = (idx - 1 + TAB_IDS.length) % TAB_IDS.length; }
      else if (e.key === 'Home') { next = 0; }
      else if (e.key === 'End') { next = TAB_IDS.length - 1; }
      if (next !== null) {
        e.preventDefault();
        activatePanel(TAB_IDS[next]);
        $(TAB_EL[TAB_IDS[next]]).focus();
      }
    });
  }

  /* ---------- model planner ---------- */

  function renderPlannerFixtures() {
    var body = $('planner-fixture-body');
    body.innerHTML = '';
    state.models.forEach(function (model) {
      var tr = document.createElement('tr');
      var nameTh = document.createElement('th');
      nameTh.scope = 'row';
      nameTh.textContent = model.name;
      tr.appendChild(nameTh);
      tr.appendChild(el('td', null, String(model.tier)));
      FIXTURE_FIELDS.forEach(function (f) {
        var td = document.createElement('td');
        var input = document.createElement('input');
        input.className = 'num-input';
        input.type = 'number';
        input.min = f.min;
        input.step = f.step;
        input.value = model[f.key];
        input.setAttribute('aria-label', model.name + ' ' + f.aria);
        input.dataset.model = model.id;
        input.dataset.field = f.key;
        input.addEventListener('input', onFixtureEdit);
        td.appendChild(input);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function onFixtureEdit(e) {
    var id = e.target.dataset.model;
    var field = e.target.dataset.field;
    var value = parseFloat(e.target.value);
    state.models.forEach(function (model) {
      if (model.id === id && isFinite(value)) {
        model[field] = value;
      }
    });
    renderPlannerResults();
  }

  function readWorkload() {
    state.workload = {
      inputTokens: readNum('wl-input-tokens', 1200),
      outputTokens: readNum('wl-output-tokens', 600),
      requestsPerDay: readNum('wl-rpd', 2000),
      days: readNum('wl-days', 30)
    };
    return state.workload;
  }

  function renderPlannerResults() {
    var workload = readWorkload();
    var rows = Pricing.compareModels(state.models, workload);
    var cheapestId = Pricing.cheapestModel(state.models, workload.inputTokens, workload.outputTokens).id;
    var fastestId = Pricing.fastestModel(state.models).id;
    var host = $('planner-results');
    host.innerHTML = '';

    rows.slice().sort(function (a, b) { return a.costPerRequest - b.costPerRequest; }).forEach(function (row) {
      var card = el('article', 'model-card' + (row.id === cheapestId ? ' is-best' : ''));
      var header = document.createElement('header');
      header.appendChild(el('h4', null, row.name));
      header.appendChild(el('span', 'tier-chip', 'Tier ' + row.tier));
      card.appendChild(header);

      var big = el('p', 'big-value', Pricing.formatUSD(row.costPerRequest));
      big.appendChild(el('small', null, 'per request'));
      card.appendChild(big);

      var dl = document.createElement('dl');
      [
        ['Per 1K Requests', Pricing.formatUSD(row.costPer1k)],
        ['Monthly At Workload', fmtUSD2(row.monthlyCost)],
        ['Expected Latency', fmtSec(row.latencySeconds)],
        ['Throughput', row.tokensPerSecond + ' tok/s']
      ].forEach(function (pair) {
        var wrap = document.createElement('div');
        wrap.appendChild(el('dt', null, pair[0]));
        wrap.appendChild(el('dd', null, pair[1]));
        dl.appendChild(wrap);
      });
      card.appendChild(dl);

      var badges = el('p', 'badges');
      if (row.id === cheapestId) { addBadge(badges, 'Lowest Cost', ''); }
      if (row.id === fastestId) { addBadge(badges, 'Highest Throughput', 'badge-violet'); }
      if (badges.childNodes.length) { card.appendChild(badges); }

      host.appendChild(card);
    });
  }

  function wirePlanner() {
    ['wl-input-tokens', 'wl-output-tokens', 'wl-rpd', 'wl-days'].forEach(function (id) {
      $(id).addEventListener('input', renderPlannerResults);
    });
    $('planner-reset').addEventListener('click', function () {
      state.models = clone(state.defaultModels);
      renderPlannerFixtures();
      renderPlannerResults();
    });
  }

  /* ---------- memory fit ---------- */

  function readMemoryCfg() {
    return {
      paramsBillions: readNum('mem-params', 8),
      layers: readNum('mem-layers', 32),
      kvHeads: readNum('mem-kv-heads', 8),
      headDim: readNum('mem-head-dim', 128),
      contextTokens: readNum('mem-context', 8192),
      weightQuant: $('mem-weight-quant').value,
      kvQuant: $('mem-kv-quant').value,
      budgetGB: readNum('mem-budget', 24)
    };
  }

  function renderMemory() {
    var cfg = readMemoryCfg();
    var report = Memory.fitReport(cfg);

    var stepsHost = $('mem-steps');
    stepsHost.innerHTML = '';
    Memory.buildSteps(cfg).forEach(function (step, i) {
      var li = document.createElement('li');
      li.appendChild(el('span', 'step-num', String(i + 1)));
      var text = el('div');
      text.appendChild(el('p', 'step-label', step.label));
      text.appendChild(el('p', 'step-expr', step.expression));
      li.appendChild(text);
      stepsHost.appendChild(li);
    });

    var host = $('mem-results');
    host.innerHTML = '';
    host.appendChild(statBlock('Weights', report.weightsGB.toFixed(2) + ' GB'));
    host.appendChild(statBlock('KV Per Sequence', report.kvPerSequenceGB.toFixed(2) + ' GB'));
    host.appendChild(statBlock('KV Bytes Per Token', report.kvBytesPerTokenValue.toLocaleString('en-US')));
    host.appendChild(statBlock('Memory Left For KV', report.freeForKvGB.toFixed(2) + ' GB'));
    host.appendChild(statBlock('Max Concurrent Sequences', String(report.maxSequences)));

    var verdict = $('mem-verdict');
    if (report.weightsBytes > cfg.budgetGB * 1e9) {
      verdict.className = 'verdict is-over';
      verdict.textContent = 'Over Budget. Weights alone need ' + report.weightsGB.toFixed(2) +
        ' GB, more than the ' + cfg.budgetGB + ' GB budget.';
    } else if (report.maxSequences < 1) {
      verdict.className = 'verdict is-tight';
      verdict.textContent = 'Tight. Weights fit, but the leftover budget covers no full context sequence.';
    } else {
      verdict.className = 'verdict is-ok';
      verdict.textContent = 'Fits. Weights take ' + report.weightsGB.toFixed(2) +
        ' GB and the remaining budget covers ' + report.maxSequences +
        ' concurrent sequence' + (report.maxSequences === 1 ? '' : 's') + ' at full context.';
    }
  }

  function wireMemory() {
    ['mem-params', 'mem-layers', 'mem-kv-heads', 'mem-head-dim', 'mem-context', 'mem-budget'].forEach(function (id) {
      $(id).addEventListener('input', renderMemory);
    });
    ['mem-weight-quant', 'mem-kv-quant'].forEach(function (id) {
      $(id).addEventListener('change', renderMemory);
    });
  }

  /* ---------- batch simulator ---------- */

  function readSimOpts() {
    return {
      arrivalRatePerSec: readNum('sim-rate', 2),
      serviceSecondsPerRequest: readNum('sim-service', 0.35),
      batchSize: readNum('sim-batch', 4),
      maxRequests: readNum('sim-max', 120),
      seed: readNum('sim-seed', 42)
    };
  }

  function renderSimData() {
    var opts = readSimOpts();
    var current = Queue.simulateQueue(opts);
    lastSweep = Queue.sweep(SWEEP_RATES, opts);

    var body = $('sim-table-body');
    body.innerHTML = '';
    lastSweep.forEach(function (row) {
      var tr = document.createElement('tr');
      [
        row.arrivalRate.toFixed(1),
        String(row.batchSize),
        String(row.completed),
        fmtSec(row.p50),
        fmtSec(row.p95),
        fmtPct(row.utilization),
        row.throughput.toFixed(2)
      ].forEach(function (text) {
        tr.appendChild(el('td', null, text));
      });
      body.appendChild(tr);
    });

    var detail = $('sim-detail');
    detail.innerHTML = '';
    detail.appendChild(statBlock('Completed', String(current.count)));
    detail.appendChild(statBlock('p50 Latency', fmtSec(current.p50)));
    detail.appendChild(statBlock('p95 Latency', fmtSec(current.p95)));
    detail.appendChild(statBlock('Mean Wait', fmtSec(current.meanWait)));
    detail.appendChild(statBlock('Utilization', fmtPct(current.utilization)));
    detail.appendChild(statBlock('Throughput', current.throughput.toFixed(2) + ' per second'));

    drawSimChart(lastSweep);
  }

  function drawSimChart(rows) {
    var canvas = $('sim-chart');
    if (!canvas || !canvas.getContext) { return; }
    var cssWidth = canvas.clientWidth;
    if (cssWidth < 60) { return; }
    var dpr = window.devicePixelRatio || 1;
    var height = 260;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(height * dpr);

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, height);

    var m = { top: 26, right: 16, bottom: 42, left: 56 };
    var plotW = cssWidth - m.left - m.right;
    var plotH = height - m.top - m.bottom;
    if (plotW < 40 || plotH < 40) { return; }

    var rates = rows.map(function (r) { return r.arrivalRate; });
    var p95s = rows.map(function (r) { return r.p95 || 0; });
    var maxY = Math.max.apply(null, p95s.concat([0.0001])) * 1.1;
    var xMin = Math.min.apply(null, rates);
    var xMax = Math.max.apply(null, rates);

    function xPos(v) {
      if (xMax === xMin) { return m.left + plotW / 2; }
      return m.left + ((v - xMin) / (xMax - xMin)) * plotW;
    }
    function yPos(v) {
      return m.top + plotH - (v / maxY) * plotH;
    }

    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    var gridLines = 4;
    for (var g = 0; g <= gridLines; g++) {
      var vy = maxY * g / gridLines;
      var py = yPos(vy);
      ctx.strokeStyle = 'rgba(35, 45, 66, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.left, py);
      ctx.lineTo(m.left + plotW, py);
      ctx.stroke();
      ctx.fillStyle = '#6b7891';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(vy.toFixed(2), m.left - 8, py);
    }

    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6b7891';
    rows.forEach(function (r) {
      ctx.fillText(r.arrivalRate.toFixed(1), xPos(r.arrivalRate), m.top + plotH + 8);
    });

    ctx.fillStyle = '#9aa7bc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Latency, seconds', m.left, 10);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Arrival Rate, requests per second', m.left + plotW / 2, height - 16);

    function drawSeries(key, color) {
      var pts = rows.filter(function (r) { return r[key] != null; });
      if (pts.length === 0) { return; }
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(function (r, i) {
        var px = xPos(r.arrivalRate);
        var py = yPos(r[key]);
        if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      });
      ctx.stroke();
      pts.forEach(function (r) {
        ctx.beginPath();
        ctx.arc(xPos(r.arrivalRate), yPos(r[key]), 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    drawSeries('p50', '#3fd6c2');
    drawSeries('p95', '#8b7cff');
  }

  function wireSim() {
    ['sim-rate', 'sim-batch', 'sim-service', 'sim-max', 'sim-seed'].forEach(function (id) {
      $(id).addEventListener('input', debounce(renderSimData, 160));
    });
    $('sim-run').addEventListener('click', renderSimData);
  }

  /* ---------- route builder ---------- */

  function modelOption(value, label) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    return opt;
  }

  function fillModelSelect(select, selectedId) {
    select.innerHTML = '';
    state.models.forEach(function (model) {
      select.appendChild(modelOption(model.id, model.name + ', Tier ' + model.tier));
    });
    select.value = selectedId;
  }

  function renderRouteControls() {
    fillModelSelect($('route-default'), 'nano');
    renderRuleRows();
  }

  function renderRuleRows() {
    var host = $('route-rules');
    host.innerHTML = '';
    state.rules.forEach(function (rule, i) {
      var row = el('div', 'rule-row');

      var catField = el('div', 'field');
      var catLabel = el('label', null, 'Category');
      catLabel.setAttribute('for', 'rule-cat-' + i);
      var catSelect = document.createElement('select');
      catSelect.id = 'rule-cat-' + i;
      catSelect.appendChild(modelOption('any', 'Any'));
      CATEGORIES.forEach(function (c) {
        catSelect.appendChild(modelOption(c, c.charAt(0).toUpperCase() + c.slice(1)));
      });
      catSelect.value = rule.category;
      catSelect.addEventListener('change', function () { rule.category = catSelect.value; });
      catField.appendChild(catLabel);
      catField.appendChild(catSelect);
      row.appendChild(catField);

      var minField = el('div', 'field');
      var minLabel = el('label', null, 'Min Input Tokens');
      minLabel.setAttribute('for', 'rule-min-' + i);
      var minInput = document.createElement('input');
      minInput.id = 'rule-min-' + i;
      minInput.type = 'number';
      minInput.min = '0';
      minInput.step = '1';
      minInput.value = rule.minInputTokens;
      minInput.setAttribute('aria-label', 'Rule ' + (i + 1) + ' minimum input tokens');
      minInput.addEventListener('input', function () {
        var v = parseFloat(minInput.value);
        rule.minInputTokens = isFinite(v) && v > 0 ? v : 0;
      });
      minField.appendChild(minLabel);
      minField.appendChild(minInput);
      row.appendChild(minField);

      var targetField = el('div', 'field');
      var targetLabel = el('label', null, 'Target Model');
      targetLabel.setAttribute('for', 'rule-target-' + i);
      var targetSelect = document.createElement('select');
      targetSelect.id = 'rule-target-' + i;
      fillModelSelect(targetSelect, rule.targetModelId);
      targetSelect.addEventListener('change', function () { rule.targetModelId = targetSelect.value; });
      targetField.appendChild(targetLabel);
      targetField.appendChild(targetSelect);
      row.appendChild(targetField);

      var thrField = el('div', 'field');
      var thrLabel = el('label', null, 'Escalate Below');
      thrLabel.setAttribute('for', 'rule-thr-' + i);
      var thrInput = document.createElement('input');
      thrInput.id = 'rule-thr-' + i;
      thrInput.type = 'number';
      thrInput.min = '0';
      thrInput.max = '1';
      thrInput.step = '0.05';
      thrInput.placeholder = 'Never';
      if (rule.escalateBelow != null) { thrInput.value = rule.escalateBelow; }
      thrInput.setAttribute('aria-label', 'Rule ' + (i + 1) + ' escalate below confidence, blank means never');
      thrInput.addEventListener('input', function () {
        var v = parseFloat(thrInput.value);
        rule.escalateBelow = isFinite(v) ? v : null;
      });
      thrField.appendChild(thrLabel);
      thrField.appendChild(thrInput);
      row.appendChild(thrField);

      var removeBtn = el('button', 'btn btn-ghost btn-small', 'Remove');
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', 'Remove Rule ' + (i + 1));
      removeBtn.addEventListener('click', function () {
        state.rules = state.rules.filter(function (r) { return r !== rule; });
        renderRuleRows();
      });
      row.appendChild(removeBtn);

      host.appendChild(row);
    });
  }

  function renderRouteReplay() {
    var opts = {
      defaultModelId: $('route-default').value,
      escalateBelow: readNum('route-threshold', 0.75),
      jitter: 0,
      seed: 1
    };
    var result = Routing.replayLog(state.log, state.models, state.rules, opts);
    var s = result.summary;

    var summary = $('route-summary');
    summary.innerHTML = '';
    summary.appendChild(statBlock('Total Cost', Pricing.formatUSD(s.totalCost)));
    summary.appendChild(statBlock('All Premium Cost', Pricing.formatUSD(s.allPremiumCost)));
    summary.appendChild(statBlock('Savings Vs Premium', s.savingsVsPremiumPct.toFixed(1) + '%'));
    summary.appendChild(statBlock('Success Rate', fmtPct(s.successRate)));
    summary.appendChild(statBlock('Escalation Rate', fmtPct(s.escalationRate)));
    summary.appendChild(statBlock('Attempts Per Request', s.attemptsPerRequest.toFixed(2)));

    var body = $('route-table-body');
    body.innerHTML = '';
    result.rows.forEach(function (row) {
      var tr = document.createElement('tr');

      tr.appendChild(el('td', null, row.id));
      tr.appendChild(el('td', null, row.category));
      tr.appendChild(el('td', null, tierName(row.difficulty) + ' (' + row.difficulty + ')'));

      var routeTd = document.createElement('td');
      row.chain.forEach(function (id, i) {
        if (i > 0) {
          routeTd.appendChild(el('span', 'route-arrow', '→'));
        }
        routeTd.appendChild(document.createTextNode(modelName(id)));
      });
      tr.appendChild(routeTd);

      tr.appendChild(el('td', null, String(row.attempts)));
      tr.appendChild(el('td', null, fmtPct(row.confidence)));
      tr.appendChild(el('td', null, Pricing.formatUSD(row.cost)));

      var verdictTd = el('td', row.success ? 'result-ok' : 'result-miss', row.success ? 'Sufficient' : 'Insufficient');
      tr.appendChild(verdictTd);

      body.appendChild(tr);
    });

    renderLogSummary();
  }

  function renderLogSummary() {
    var host = $('route-log-summary');
    var s = Fixtures.summarizeLog(state.log);
    host.innerHTML = '';

    var totalLine = el('p', null, 'Seeded synthetic log: ' + s.total +
      ' requests, generated locally from seed 7. It regenerates identically on every load.');
    host.appendChild(totalLine);

    var catLine = el('p');
    catLine.appendChild(document.createTextNode('Categories: '));
    CATEGORIES.forEach(function (c, i) {
      if (i > 0) { catLine.appendChild(document.createTextNode(', ')); }
      catLine.appendChild(document.createTextNode(c + ' ' + (s.byCategory[c] || 0)));
    });
    host.appendChild(catLine);

    var diffLine = el('p');
    diffLine.appendChild(document.createTextNode('Difficulty labels: '));
    Object.keys(s.byDifficulty).sort().forEach(function (d, i) {
      if (i > 0) { diffLine.appendChild(document.createTextNode(', ')); }
      diffLine.appendChild(document.createTextNode(tierName(Number(d)) + ' ' + s.byDifficulty[d]));
    });
    host.appendChild(diffLine);
  }

  function wireRoute() {
    $('route-add').addEventListener('click', function () {
      ruleCounter += 1;
      state.rules.push({
        id: 'rule-' + ruleCounter,
        category: 'any',
        minInputTokens: 0,
        targetModelId: state.models[1] ? state.models[1].id : state.models[0].id,
        escalateBelow: 0.8
      });
      renderRuleRows();
    });
    $('route-replay').addEventListener('click', renderRouteReplay);
    $('route-default').addEventListener('change', renderRouteReplay);
    $('route-threshold').addEventListener('input', debounce(renderRouteReplay, 200));
  }

  /* ---------- guided tour ---------- */

  var TOUR_STEPS = [
    {
      panel: null,
      selector: null,
      title: 'Welcome To TokenScope',
      body: 'TokenScope is an inference planning studio for people shipping LLM features. Every number here is an editable fixture and the whole page runs offline. This tour takes about one minute.'
    },
    {
      panel: 'planner',
      selector: '#planner-workload-card',
      title: 'Plan Your Workload',
      body: 'Start with tokens per request and daily volume. The planner turns these into cost and latency estimates for every model tier.'
    },
    {
      panel: 'planner',
      selector: '#planner-fixture-card',
      title: 'Edit The Fixture Table',
      body: 'Prices, first token latency and throughput are fixtures you can edit. Type in any cell and the estimates update instantly. Nothing here quotes a real vendor.'
    },
    {
      panel: 'memory',
      selector: '#mem-steps-card',
      title: 'Check Memory Fit',
      body: 'KV cache and weight memory are computed with the arithmetic shown line by line, so every result can be audited before you trust it.'
    },
    {
      panel: 'sim',
      selector: '#sim-chart-card',
      title: 'Simulate A Queue',
      body: 'A deterministic, seeded simulation shows how p50 and p95 latency react as arrival rate and batch size change. Request counts stay small so it stays instant.'
    },
    {
      panel: 'route',
      selector: '#route-rules-card',
      title: 'Build A Route',
      body: 'Compose cheap model first routing with confidence based escalation, then replay it against a labeled synthetic request log to see cost and quality tradeoffs.'
    },
    {
      panel: null,
      selector: '#footer-note',
      title: 'Where Live Data Would Go',
      body: 'This build makes no network requests. The README documents exactly where a Nebius inference API key would plug in when you want a live build. That is the tour; enjoy the studio.'
    }
  ];

  var tour = { active: false, step: 0, opener: null };
  var tourEls = {};

  function ensureTourDom() {
    if (tourEls.overlay) { return; }
    var overlay = el('div');
    overlay.id = 'tour-overlay';
    overlay.innerHTML =
      '<div id="tour-spotlight" aria-hidden="true"></div>' +
      '<div id="tour-card" role="dialog" aria-label="Guided Tour" aria-live="polite">' +
      '<p class="tour-progress" id="tour-progress"></p>' +
      '<h2 id="tour-title"></h2>' +
      '<p id="tour-body"></p>' +
      '<div class="tour-actions">' +
      '<button id="tour-back" class="btn btn-ghost btn-small" type="button">Back</button>' +
      '<button id="tour-end" class="btn btn-ghost btn-small" type="button">End Tour</button>' +
      '<button id="tour-next" class="btn btn-primary btn-small" type="button">Next</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    tourEls.overlay = overlay;
    tourEls.spotlight = $('tour-spotlight');
    tourEls.card = $('tour-card');
    $('tour-back').addEventListener('click', function () { showTourStep(tour.step - 1); });
    $('tour-next').addEventListener('click', function () {
      if (tour.step >= TOUR_STEPS.length - 1) { endTour(); } else { showTourStep(tour.step + 1); }
    });
    $('tour-end').addEventListener('click', endTour);
  }

  function placeTourCard(target) {
    var rect = target.getBoundingClientRect();
    var pad = 10;
    var spot = tourEls.spotlight;
    spot.style.top = (rect.top - pad) + 'px';
    spot.style.left = (rect.left - pad) + 'px';
    spot.style.width = (rect.width + pad * 2) + 'px';
    spot.style.height = (rect.height + pad * 2) + 'px';

    var card = tourEls.card;
    var cardW = Math.min(380, window.innerWidth - 32);
    card.style.width = cardW + 'px';
    var cardH = card.offsetHeight || 200;
    var spaceBelow = window.innerHeight - rect.bottom;
    var top;
    if (spaceBelow > cardH + 28) {
      top = rect.bottom + 14;
    } else if (rect.top > cardH + 28) {
      top = rect.top - cardH - 14;
    } else {
      top = Math.max(16, (window.innerHeight - cardH) / 2);
    }
    var left = Math.min(Math.max(16, rect.left), window.innerWidth - cardW - 16);
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  }

  function positionTour() {
    if (!tour.active) { return; }
    var step = TOUR_STEPS[tour.step];
    var target = step.selector ? document.querySelector(step.selector) : null;
    var card = tourEls.card;
    if (!target) {
      tourEls.spotlight.style.display = 'none';
      card.classList.add('is-centered');
      card.style.top = '';
      card.style.left = '';
      return;
    }
    tourEls.spotlight.style.display = '';
    card.classList.remove('is-centered');
    target.scrollIntoView({
      behavior: motionOk() ? 'smooth' : 'auto',
      block: 'center'
    });
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        placeTourCard(target);
      });
    });
  }

  function showTourStep(i) {
    tour.step = Math.max(0, Math.min(i, TOUR_STEPS.length - 1));
    var step = TOUR_STEPS[tour.step];
    if (step.panel) { activatePanel(step.panel); }
    $('tour-progress').textContent = 'Step ' + (tour.step + 1) + ' of ' + TOUR_STEPS.length;
    $('tour-title').textContent = step.title;
    $('tour-body').textContent = step.body;
    $('tour-back').disabled = tour.step === 0;
    $('tour-next').textContent = tour.step === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
    positionTour();
    $('tour-next').focus({ preventScroll: true });
  }

  /* Geometry only: keeps the spotlight glued to the target while the page
   * scrolls without re-triggering smooth scrolling. */
  function repositionTourCard() {
    if (!tour.active) { return; }
    var step = TOUR_STEPS[tour.step];
    var target = step.selector ? document.querySelector(step.selector) : null;
    if (!target || tourEls.card.classList.contains('is-centered')) { return; }
    placeTourCard(target);
  }

  function startTour() {
    ensureTourDom();
    tour.opener = document.activeElement;
    tour.active = true;
    tourEls.overlay.classList.add('open');
    showTourStep(0);
  }

  function endTour() {
    tour.active = false;
    tourEls.overlay.classList.remove('open');
    if (tour.opener && typeof tour.opener.focus === 'function') {
      tour.opener.focus();
    }
  }

  function wireTour() {
    $('tour-start').addEventListener('click', startTour);
    $('tour-start-hero').addEventListener('click', startTour);
    $('jump-planner').addEventListener('click', function () {
      activatePanel('planner');
      $('panel-planner').scrollIntoView({ behavior: motionOk() ? 'smooth' : 'auto', block: 'start' });
    });
    document.addEventListener('keydown', function (e) {
      if (!tour.active) { return; }
      if (e.key === 'Escape') { endTour(); }
      else if (e.key === 'ArrowRight') { showTourStep(tour.step + 1); }
      else if (e.key === 'ArrowLeft') { showTourStep(tour.step - 1); }
    });
    window.addEventListener('scroll', repositionTourCard, true);
  }

  /* ---------- init ---------- */

  function init() {
    wireTabs();
    wirePlanner();
    wireMemory();
    wireSim();
    wireRoute();
    wireTour();

    renderPlannerFixtures();
    renderPlannerResults();
    renderMemory();
    renderSimData();
    renderRouteControls();
    renderRouteReplay();

    window.addEventListener('resize', debounce(function () {
      drawSimChart(lastSweep);
      if (tour.active) { positionTour(); }
    }, 120));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
