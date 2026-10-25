'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Fixtures = require('../js/engine/fixtures.js');
const Pricing = require('../js/engine/pricing.js');
const Memory = require('../js/engine/memory.js');
const Queue = require('../js/engine/queue.js');

const repoRoot = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(repoRoot, 'js/app.js'), 'utf8');

test('DOM Smoke 01: index.html starts with HTML5 doctype and lang=en', () => {
  assert.match(indexHtml.trimStart(), /^<!doctype html>/i);
  assert.match(indexHtml, /<html\s+lang="en">/i);
});

test('DOM Smoke 02: index.html contains UTF-8 charset and responsive viewport meta tags', () => {
  assert.match(indexHtml, /<meta\s+charset="utf-8">/i);
  assert.match(indexHtml, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1">/i);
});

test('DOM Smoke 03: index.html contains non-empty title, author, and meta description', () => {
  assert.match(indexHtml, /<title>TokenScope,\s*An Inference Planning Studio<\/title>/);
  assert.match(indexHtml, /<meta\s+name="description"\s+content="[^"]{40,}">/);
  assert.match(indexHtml, /<meta\s+name="author"\s+content="Aariv Patel">/);
});

test('DOM Smoke 04: OpenGraph meta tags and theme-color exist in <head>', () => {
  assert.match(indexHtml, /property="og:title"\s+content="[^"]+"/);
  assert.match(indexHtml, /property="og:description"\s+content="[^"]+"/);
  assert.match(indexHtml, /property="og:type"\s+content="website"/);
  assert.match(indexHtml, /<meta\s+name="theme-color"\s+content="#0b0e12">/);
});

test('DOM Smoke 05: inline SVG favicon link is present in <head>', () => {
  assert.match(indexHtml, /<link\s+rel="icon"\s+href="data:image\/svg\+xml,/);
});

test('DOM Smoke 06: index.html contains exactly one <h1> element', () => {
  const h1Matches = indexHtml.match(/<h1\b[^>]*>/gi) || [];
  assert.equal(h1Matches.length, 1);
});

test('DOM Smoke 07: heading hierarchy in index.html never skips levels', () => {
  const levels = [...indexHtml.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  assert.equal(levels.length, 20);
  assert.equal(levels[0], 1);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(
      levels[i] <= levels[i - 1] + 1,
      `Heading level jumped from h${levels[i - 1]} to h${levels[i]}`
    );
  }
});

test('DOM Smoke 08: all 80 id attributes in index.html are unique', () => {
  const ids = [...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 80);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, 'Duplicate IDs found in index.html');
});

test('DOM Smoke 09: accessible skip-link points to #main and target landmark exists', () => {
  assert.match(indexHtml, /<a\s+class="skip-link"\s+href="#main">/);
  assert.match(indexHtml, /<main\s+id="main"\s+class="studio">/);
});

test('DOM Smoke 10: <noscript> fallback banner is present inside <body>', () => {
  assert.match(indexHtml, /<noscript>[\s\S]*?<p\s+class="noscript-note"[\s\S]*?<\/noscript>/);
});

test('DOM Smoke 11: semantic landmarks (header, nav, main, footer) are present', () => {
  assert.match(indexHtml, /<header\b[^>]*>/);
  assert.match(indexHtml, /<nav\b[^>]*role="tablist"\s+aria-label="Studio Panels"/);
  assert.match(indexHtml, /<main\s+id="main"/);
  assert.match(indexHtml, /<footer\s+class="site-footer">/);
});

test('DOM Smoke 12: all four WAI-ARIA tab buttons and tabpanels match TAB_EL and PANEL_EL in app.js', () => {
  const pairs = [
    ['tab-planner', 'panel-planner'],
    ['tab-memory', 'panel-memory'],
    ['tab-sim', 'panel-sim'],
    ['tab-route', 'panel-route']
  ];
  for (const [tabId, panelId] of pairs) {
    assert.match(indexHtml, new RegExp(`role="tab"\\s+id="${tabId}"[^>]*aria-controls="${panelId}"`));
    assert.match(indexHtml, new RegExp(`id="${panelId}"[^>]*role="tabpanel"[^>]*aria-labelledby="${tabId}"`));
  }
});

test('DOM Smoke 13: every aria-labelledby and aria-controls target in index.html resolves to an existing ID', () => {
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const refs = [
    ...[...indexHtml.matchAll(/\baria-labelledby="([^"]+)"/g)].map((m) => m[1]),
    ...[...indexHtml.matchAll(/\baria-controls="([^"]+)"/g)].map((m) => m[1])
  ];
  assert.ok(refs.length >= 9);
  for (const ref of refs) {
    assert.ok(htmlIds.has(ref), `ARIA reference #${ref} is missing in index.html`);
  }
});

test('DOM Smoke 14: every label[for] attribute in index.html resolves to an existing form control ID', () => {
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const forIds = [...indexHtml.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(forIds.length >= 18);
  for (const id of forIds) {
    assert.ok(htmlIds.has(id), `label[for="${id}"] has no matching control ID`);
  }
});

test('DOM Smoke 15: all three data tables include accessible captions and scope="col" headers', () => {
  const captions = indexHtml.match(/<caption\b[^>]*>/g) || [];
  const colHeaders = indexHtml.match(/<th\s+scope="col"/g) || [];
  assert.equal(captions.length, 3);
  assert.ok(colHeaders.length >= 18);
});

test('DOM Smoke 16: all local script tags in index.html point to existing engine and app files', () => {
  const scripts = [...indexHtml.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(scripts.length, 7);
  for (const rel of scripts) {
    assert.ok(fs.existsSync(path.join(repoRoot, rel)), `Referenced script ${rel} does not exist`);
  }
});

test('DOM Smoke 17: aria-live polite regions exist across all four studio panels', () => {
  assert.match(indexHtml, /id="planner-results"[^>]*aria-live="polite"/);
  assert.match(indexHtml, /id="mem-results"[^>]*aria-live="polite"/);
  assert.match(indexHtml, /id="sim-detail"[^>]*aria-live="polite"/);
  assert.match(indexHtml, /id="route-summary"[^>]*aria-live="polite"/);
});

test('DOM Smoke 18: styles.css provides :focus-visible outline and reduced-motion guard', () => {
  assert.match(stylesCss, /:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(stylesCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('DOM Smoke 19: styles.css enforces tabular-nums for numeric alignment', () => {
  assert.match(stylesCss, /font-variant-numeric:\s*tabular-nums/);
});

test('DOM Smoke 20: zero em-dashes or en-dashes across HTML, CSS, and UI JS', () => {
  assert.equal(/[\u2013\u2014]/.test(indexHtml), false);
  assert.equal(/[\u2013\u2014]/.test(stylesCss), false);
  assert.equal(/[\u2013\u2014]/.test(appJs), false);
});

test('DOM Smoke 21: zero emoji characters across HTML, CSS, and UI JS', () => {
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(indexHtml), false);
  assert.equal(emojiRegex.test(stylesCss), false);
  assert.equal(emojiRegex.test(appJs), false);
});

test('DOM Smoke 22: zero uppercase CSS transforms in styles.css', () => {
  assert.equal(/text-transform\s*:\s*uppercase/i.test(stylesCss), false);
});

test('DOM Smoke 23: zero Todo/Fixme/Lorem placeholders or personal email leaks in HTML, CSS, and JS', () => {
  const combined = `${indexHtml}\n${stylesCss}\n${appJs}`;
  assert.equal(/\b(?:TODO|FIXME|XXX|HACK|lorem ipsum)\b/i.test(combined), false);
  assert.equal(/[a-z0-9._%+-]+@gmail\.com/i.test(combined), false);
});

test('DOM Smoke 24: Pricing and Memory engines compute deterministic results for default studio inputs', () => {
  const model = Fixtures.MODELS[0];
  const cost = Pricing.requestCost(model, 1200, 400);
  assert.ok(cost > 0);
  const mem = Memory.fitReport({
    paramsBillions: 8,
    layers: 32,
    kvHeads: 8,
    headDim: 128,
    contextTokens: 8192,
    weightQuant: 'int4',
    kvQuant: 'fp16',
    budgetGB: 24
  });
  assert.ok(mem.weightsGB > 0 && mem.weightsGB < 24);
  assert.equal(mem.fits, true);
});

test('DOM Smoke 25: Queue simulation engine produces identical sweep metrics for fixed seed 42', () => {
  const cfg = { arrivalRatePerSec: 2, serviceSecondsPerRequest: 0.3, batchSize: 4, maxRequests: 60, seed: 42 };
  const runA = Queue.simulateQueue(cfg);
  const runB = Queue.simulateQueue(cfg);
  assert.deepEqual(runA, runB);
});
