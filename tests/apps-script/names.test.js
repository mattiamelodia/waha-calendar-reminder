'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./harness');

test('normalizeName: accents, case, punctuation and spaces', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.normalizeName('José  Rossi'), 'jose rossi');
  assert.strictEqual(ctx.normalizeName('  D\'Angelo,  M. Rossi '), 'dangelo m rossi');
  assert.strictEqual(ctx.normalizeName('D’Angelo'), 'dangelo');
  assert.strictEqual(ctx.normalizeName('Niccolò\tBianchi'), 'niccolo bianchi');
});

test('normalizeName: non-string or empty -> empty string', () => {
  const { ctx } = loadGas();
  for (const v of [null, undefined, 42, {}, '', '   ', '. , \'']) {
    assert.strictEqual(ctx.normalizeName(v), '');
  }
});

test('namesMatch: equal after normalization', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.namesMatch('Jose Rossi', 'José ROSSI'), true);
  assert.strictEqual(ctx.namesMatch('M. Rossi', 'M Rossi'), true);
});

test('namesMatch: same words in a different order', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.namesMatch('Rossi Mario', 'Mario Rossi'), true);
  assert.strictEqual(ctx.namesMatch('Anna Maria Verdi', 'Verdi Anna Maria'), true);
});

test('namesMatch: different people never match', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.namesMatch('Mario Rossi', 'Mario Rosso'), false);
  assert.strictEqual(ctx.namesMatch('Mario Rossi', 'Mario'), false);
  assert.strictEqual(ctx.namesMatch('Mario Rossi', 'Mario Rossi Rossi'), false);
  assert.strictEqual(ctx.namesMatch('Mario Mario Rossi', 'Mario Rossi Rossi'), false);
});

test('namesMatch: empty or non-string never matches', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.namesMatch('', ''), false);
  assert.strictEqual(ctx.namesMatch(null, null), false);
  assert.strictEqual(ctx.namesMatch('Mario Rossi', ''), false);
  assert.strictEqual(ctx.namesMatch(undefined, 'Mario Rossi'), false);
});
