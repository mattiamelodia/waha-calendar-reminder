'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./harness');

// All numbers are fake.
const cases = [
  ['+39 347 123 4567', '393471234567'], ['347 123 4567', '393471234567'],
  ['0039 347 1234567', '393471234567'], ['(+39) 347-123-4567', '393471234567'],
  ['391 234 5678', '393912345678'], ['393 123 4567', '393931234567'],
  ['+41 79 123 45 67', '41791234567'], ['0041 79 123 45 67', '41791234567'],
  ['+44 7911 123456', '447911123456'], ['+39 06 1234567', '39061234567'],
  ['', null], [null, null], ['abc', null], ['12345', null],
];

for (const [input, expected] of cases) {
  test(`formatPhoneNumber(${JSON.stringify(input)}) -> ${JSON.stringify(expected)}`, () => {
    const { ctx } = loadGas();
    assert.strictEqual(ctx.formatPhoneNumber(input), expected);
  });
}

test('formatPhoneNumber: undefined -> null', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatPhoneNumber(undefined), null);
});

test('formatPhoneNumber: dots and slashes are stripped', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatPhoneNumber('347.123/4567'), '393471234567');
});

test('formatPhoneNumber: a number with stray letters is never guessed', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatPhoneNumber('+39 347 123 4567 abc'), null);
});

test('formatPhoneNumber: COUNTRY_CODE=41 does not break an already-international input', () => {
  const { ctx } = loadGas({ props: { COUNTRY_CODE: '41' } });
  assert.strictEqual(ctx.formatPhoneNumber('+39 347 123 4567'), '393471234567');
  assert.strictEqual(ctx.formatPhoneNumber('0044 7911 123456'), '447911123456');
});

test('formatPhoneForDisplay: Italian, foreign and empty', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatPhoneForDisplay('393471234567'), '+39 347 123 4567');
  assert.strictEqual(ctx.formatPhoneForDisplay('41791234567'), '+41791234567');
  assert.strictEqual(ctx.formatPhoneForDisplay(''), '');
});
