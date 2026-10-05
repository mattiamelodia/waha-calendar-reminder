'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./harness');

const TRIGGER_HANDLERS = [
  'syncAppointmentsFromCalendar',
  'cleanupSentStatusProperties',
  'removeUnregisteredAppointmentsYesterday',
  'sendAutomaticReminders',
];

test('setup() keeps existing values', () => {
  const { ctx, state } = loadGas({
    props: { SHEET_ID: 'abc', MESSAGE_TEMPLATE: 'x', WORDS_TO_REMOVE: '["a"]' },
  });
  ctx.setup();
  assert.equal(state.props.SHEET_ID, 'abc');
  assert.equal(state.props.MESSAGE_TEMPLATE, 'x');
  assert.equal(state.props.WORDS_TO_REMOVE, '["a"]');
});

test('setup() fills only missing keys', () => {
  const { ctx, state } = loadGas({ props: { SHEET_ID: null } });
  assert.equal(state.props.COUNTRY_CODE, undefined);
  ctx.setup();
  assert.equal(state.props.COUNTRY_CODE, '39');
});

test('setup() never writes a SHEET_ID placeholder', () => {
  const { ctx, state } = loadGas({ props: { SHEET_ID: null } });
  ctx.setup();
  assert.equal('SHEET_ID' in state.props, false);
});

test('setup() recreates triggers', () => {
  const { ctx, state } = loadGas();
  ctx.setup();
  ctx.setup();
  for (const handler of TRIGGER_HANDLERS) {
    assert.equal(
      state.triggers.filter((t) => t.handler === handler).length,
      1,
      `expected exactly one trigger for ${handler}`
    );
  }
});

test('setIfMissing_ returns false and keeps the value when the key exists, even if empty', () => {
  const { ctx, state } = loadGas({ props: { FOO: 'kept', EMPTY: '' } });
  const props = ctx.PropertiesService.getScriptProperties();
  assert.equal(ctx.setIfMissing_(props, 'FOO', 'new'), false);
  assert.equal(ctx.setIfMissing_(props, 'EMPTY', 'new'), false);
  assert.equal(state.props.FOO, 'kept');
  assert.equal(state.props.EMPTY, '');
  assert.equal(ctx.setIfMissing_(props, 'BAR', 'v'), true);
  assert.equal(state.props.BAR, 'v');
});
