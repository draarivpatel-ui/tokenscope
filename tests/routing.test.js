'use strict';
/*
 * TokenScope tests: route policy replay.
 * Uses a three tier local model set with exact fixture prices so cost
 * totals can be hand verified:
 *   cheap: 0.10 in / 0.40 out per 1M, tier 0
 *   mid:   0.50 in / 2.00 out per 1M, tier 1
 *   top:   2.00 in / 8.00 out per 1M, tier 2
 */
const test = require('node:test');
const assert = require('node:assert');
const Routing = require('../js/engine/routing.js');

const MODELS = [
  { id: 'cheap', name: 'Cheap', tier: 0, inputPerMillion: 0.10, outputPerMillion: 0.40, ttftMs: 120, tokensPerSecond: 140 },
  { id: 'mid',   name: 'Mid',   tier: 1, inputPerMillion: 0.50, outputPerMillion: 2.00, ttftMs: 180, tokensPerSecond: 90 },
  { id: 'top',   name: 'Top',   tier: 2, inputPerMillion: 2.00, outputPerMillion: 8.00, ttftMs: 300, tokensPerSecond: 45 }
];

const EASY = { id: 'e1', category: 'chat', inputTokens: 1000, outputTokens: 500, difficulty: 0 };
const HARD = { id: 'e2', category: 'reason', inputTokens: 1000, outputTokens: 500, difficulty: 2 };

const RULES_REASON = [
  { id: 'r-reason', category: 'reason', minInputTokens: 0, targetModelId: 'top', escalateBelow: 0.8 }
];
const RULES_LENGTH = [
  { id: 'r-long', category: 'any', minInputTokens: 2000, targetModelId: 'top', escalateBelow: 0.8 }
];
const RULES_FIRST_WINS = [
  { id: 'r-a', category: 'reason', minInputTokens: 0, targetModelId: 'mid', escalateBelow: 0.5 },
  { id: 'r-b', category: 'reason', minInputTokens: 0, targetModelId: 'top', escalateBelow: 0.5 }
];
const RULES_NO_ESCALATE = [
  { id: 'r-noesc', category: 'any', minInputTokens: 0, targetModelId: 'top', escalateBelow: null }
];

const BASE_OPTS = { defaultModelId: 'cheap', escalateBelow: 0.8, jitter: 0 };

function approx(actual, expected, eps, msg) {
  const tolerance = eps || 1e-9;
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    (msg || 'approx') + ': expected ' + expected + ', got ' + actual
  );
}

test('confidenceFor gives 0.92 when tier meets difficulty', () => {
  approx(Routing.confidenceFor(0, 0), 0.92, 1e-12, 'tier 0 difficulty 0');
});

test('confidenceFor drops 0.15 per missing tier', () => {
  approx(Routing.confidenceFor(1, 2), 0.77, 1e-12, 'tier 1 difficulty 2');
});

test('confidenceFor reaches 0.62 two tiers short', () => {
  approx(Routing.confidenceFor(0, 2), 0.62, 1e-12, 'tier 0 difficulty 2');
});

test('confidenceFor stays positive for a four tier gap', () => {
  approx(Routing.confidenceFor(0, 4), 0.32, 1e-12, 'tier 0 difficulty 4');
});

test('confidenceFor does not exceed 0.92 above the difficulty', () => {
  approx(Routing.confidenceFor(2, 0), 0.92, 1e-12, 'tier 2 difficulty 0');
});

test('pickRoute falls back to the default model without rules', () => {
  const route = Routing.pickRoute(EASY, [], 'cheap');
  assert.strictEqual(route.modelId, 'cheap');
  assert.strictEqual(route.ruleId, null);
});

test('pickRoute matches a category rule', () => {
  assert.strictEqual(Routing.pickRoute(HARD, RULES_REASON, 'cheap').modelId, 'top');
});

test('pickRoute matches a minimum length rule', () => {
  const long = { id: 'e3', category: 'chat', inputTokens: 2500, outputTokens: 500, difficulty: 0 };
  assert.strictEqual(Routing.pickRoute(long, RULES_LENGTH, 'cheap').modelId, 'top');
});

test('pickRoute skips a minimum length rule that is too long', () => {
  const route = Routing.pickRoute(EASY, RULES_LENGTH, 'cheap');
  assert.strictEqual(route.modelId, 'cheap');
});

test('the first matching rule wins over later ones', () => {
  const res = Routing.replayLog([HARD], MODELS, RULES_FIRST_WINS, BASE_OPTS);
  assert.strictEqual(res.rows[0].finalModelId, 'mid');
});

test('an easy request lands on the first attempt', () => {
  const res = Routing.replayLog([EASY], MODELS, [], BASE_OPTS);
  assert.strictEqual(res.rows[0].success, true);
});

test('an easy request needs only one attempt', () => {
  const res = Routing.replayLog([EASY], MODELS, [], BASE_OPTS);
  assert.strictEqual(res.rows[0].attempts, 1);
});

test('a hard request escalates through every tier', () => {
  const res = Routing.replayLog([HARD], MODELS, [], BASE_OPTS);
  assert.strictEqual(res.rows[0].attempts, 3);
});

test('a hard request still lands after escalation', () => {
  const res = Routing.replayLog([HARD], MODELS, [], BASE_OPTS);
  assert.strictEqual(res.rows[0].success, true);
});

test('a hard request pays for all three attempts', () => {
  const res = Routing.replayLog([HARD], MODELS, [], BASE_OPTS);
  approx(res.rows[0].cost, 0.0078, 1e-12, 'hard request chain cost');
});

test('replay totals the exact cost of both requests', () => {
  const res = Routing.replayLog([EASY, HARD], MODELS, [], BASE_OPTS);
  approx(res.summary.totalCost, 0.0081, 1e-12, 'summary total cost');
});

test('replay counts one escalating request', () => {
  const res = Routing.replayLog([EASY, HARD], MODELS, [], BASE_OPTS);
  assert.strictEqual(res.summary.escalations, 1);
});

test('half of the two request log escalated', () => {
  const res = Routing.replayLog([EASY, HARD], MODELS, [], BASE_OPTS);
  approx(res.summary.escalationRate, 0.5, 1e-12, 'escalation rate');
});

test('savings versus all premium is exactly 32.5 percent', () => {
  const res = Routing.replayLog([EASY, HARD], MODELS, [], BASE_OPTS);
  approx(res.summary.savingsVsPremiumPct, 32.5, 1e-9, 'savings pct');
});

test('both requests land under the default policy', () => {
  const res = Routing.replayLog([EASY, HARD], MODELS, [], BASE_OPTS);
  assert.strictEqual(res.summary.successRate, 1);
});

test('a rule with a null threshold never escalates', () => {
  const res = Routing.replayLog([HARD], MODELS, RULES_NO_ESCALATE, BASE_OPTS);
  assert.strictEqual(res.rows[0].attempts, 1);
});

test('a no escalation route costs one top tier attempt', () => {
  const res = Routing.replayLog([HARD], MODELS, RULES_NO_ESCALATE, BASE_OPTS);
  approx(res.rows[0].cost, 0.006, 1e-12, 'no escalation cost');
});

test('escalation stops at the top tier even on an unreachable threshold', () => {
  const res = Routing.replayLog([HARD], MODELS, [], { defaultModelId: 'cheap', escalateBelow: 0.99, jitter: 0 });
  assert.strictEqual(res.rows[0].attempts, 3);
});

test('jittered replay stays deterministic for a fixed seed', () => {
  const a = Routing.replayLog([EASY, HARD], MODELS, [], { defaultModelId: 'cheap', escalateBelow: 0.8, jitter: 0.02, seed: 5 });
  const b = Routing.replayLog([EASY, HARD], MODELS, [], { defaultModelId: 'cheap', escalateBelow: 0.8, jitter: 0.02, seed: 5 });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
});

test('an empty log produces a zeroed summary', () => {
  const res = Routing.replayLog([], MODELS, [], BASE_OPTS);
  assert.strictEqual(res.summary.entries, 0);
});

test('an empty log has a zero success rate', () => {
  const res = Routing.replayLog([], MODELS, [], BASE_OPTS);
  assert.strictEqual(res.summary.successRate, 0);
});
