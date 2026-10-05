'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./harness');

// All names and numbers are fake.
const MOBILE = { type: 'mobile', value: '347 123 4567' };

test('exact match -> found, raw number and type', () => {
  const { ctx } = loadGas({ contacts: [{ displayName: 'Mario Rossi', phones: [MOBILE] }] });
  const r = ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.status, 'found');
  assert.strictEqual(r.contactsFound, 1);
  assert.strictEqual(r.phoneNumber, '347 123 4567');
  assert.strictEqual(r.numberType, 'mobile');
});

test('accent-insensitive: "Jose Rossi" in the address book, "José Rossi" searched', () => {
  const { ctx } = loadGas();
  // The harness fake matches tokens as plain substrings, so it would not return "Jose Rossi" for
  // "José": here the API is modelled as accent-insensitive, to test our own comparison.
  ctx.People = {
    People: {
      searchContacts: ({ query }) =>
        query
          ? { results: [{ person: { names: [{ displayName: 'Jose Rossi' }], phoneNumbers: [MOBILE] } }] }
          : { results: [] },
    },
  };
  const r = ctx.searchInPeople('José Rossi');
  assert.strictEqual(r.status, 'found');
  assert.strictEqual(r.phoneNumber, '347 123 4567');
});

test('inverted order: "Rossi Mario" in the address book, "Mario Rossi" searched', () => {
  const { ctx } = loadGas({ contacts: [{ displayName: 'Rossi Mario', phones: [MOBILE] }] });
  assert.strictEqual(ctx.searchInPeople('Mario Rossi').status, 'found');
});

test('mobile is preferred over the first phone; otherwise the first phone', () => {
  let g = loadGas({
    contacts: [{ displayName: 'Mario Rossi', phones: [{ type: 'home', value: '06 1234567' }, { type: 'Mobile', value: '347 123 4567' }] }],
  });
  let r = g.ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.phoneNumber, '347 123 4567');
  assert.strictEqual(r.numberType, 'Mobile');

  g = loadGas({
    contacts: [{ displayName: 'Mario Rossi', phones: [{ type: 'home', value: '06 1234567' }, { type: 'work', value: '06 7654321' }] }],
  });
  r = g.ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.phoneNumber, '06 1234567');
  assert.strictEqual(r.numberType, 'home');
});

test('phone without a type -> numberType "unknown"', () => {
  const { ctx } = loadGas({ contacts: [{ displayName: 'Mario Rossi', phones: [{ value: '347 123 4567' }] }] });
  const r = ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.status, 'found');
  assert.strictEqual(r.numberType, 'unknown');
});

test('no contact at all -> not_found', () => {
  const { ctx } = loadGas({ contacts: [] });
  const r = ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.status, 'not_found');
  assert.strictEqual(r.contactsFound, 0);
  assert.strictEqual(r.phoneNumber, null);
});

test('missing "results" in the response is treated as empty', () => {
  const { ctx } = loadGas();
  ctx.People = { People: { searchContacts: () => ({}) } };
  const r = ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.status, 'not_found');
  assert.strictEqual(r.contactsFound, 0);
});

test('results exist but none has the same name -> no_match', () => {
  const { ctx } = loadGas({ contacts: [{ displayName: 'Mario Rosso', phones: [MOBILE] }, { displayName: 'Mario Rossini', phones: [MOBILE] }] });
  const r = ctx.searchInPeople('Mario Ros');
  assert.strictEqual(r.status, 'no_match');
  assert.strictEqual(r.contactsFound, 2);
  assert.strictEqual(r.phoneNumber, null);
  assert.strictEqual(r.numberType, null);
});

test('a person whose second name entry matches is found', () => {
  const { ctx } = loadGas();
  ctx.People = {
    People: {
      searchContacts: ({ query }) =>
        query
          ? { results: [{ person: { names: [{ displayName: 'Mary Rossi' }, { displayName: 'Maria Rossi' }], phoneNumbers: [MOBILE] } }] }
          : { results: [] },
    },
  };
  const r = ctx.searchInPeople('Maria Rossi');
  assert.strictEqual(r.status, 'found');
  assert.strictEqual(r.phoneNumber, '347 123 4567');
});

test('matching contact without any number -> no_number', () => {
  const { ctx } = loadGas({ contacts: [{ displayName: 'Mario Rossi', phones: [] }] });
  const r = ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.status, 'no_number');
  assert.strictEqual(r.contactsFound, 1);
  assert.strictEqual(r.phoneNumber, null);
  assert.strictEqual(r.numberType, null);
});

test('phone entry with empty value -> no_number', () => {
  const { ctx } = loadGas({ contacts: [{ displayName: 'Mario Rossi', phones: [{ type: 'mobile', value: '' }] }] });
  assert.strictEqual(ctx.searchInPeople('Mario Rossi').status, 'no_number');
});

test('homonyms with different numbers -> ambiguous, never guess', () => {
  const { ctx } = loadGas({
    contacts: [
      { displayName: 'Mario Rossi', phones: [{ type: 'mobile', value: '347 123 4567' }] },
      { displayName: 'Rossi Mario', phones: [{ type: 'mobile', value: '348 765 4321' }] },
    ],
  });
  const r = ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.status, 'ambiguous');
  assert.strictEqual(r.contactsFound, 2);
  assert.strictEqual(r.phoneNumber, null);
  assert.strictEqual(r.numberType, null);
});

test('homonyms with the same number (different formatting) -> found', () => {
  const { ctx } = loadGas({
    contacts: [
      { displayName: 'Mario Rossi', phones: [{ type: 'mobile', value: '347 123 4567' }] },
      { displayName: 'Mario Rossi', phones: [{ type: 'mobile', value: '+39 347 1234567' }] },
    ],
  });
  const r = ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.status, 'found');
  assert.strictEqual(r.contactsFound, 2);
  assert.ok(['347 123 4567', '+39 347 1234567'].includes(r.phoneNumber));
});

test('homonyms: one with a number and one without -> found with that number', () => {
  const { ctx } = loadGas({
    contacts: [
      { displayName: 'Mario Rossi', phones: [] },
      { displayName: 'Mario Rossi', phones: [MOBILE] },
    ],
  });
  const r = ctx.searchInPeople('Mario Rossi');
  assert.strictEqual(r.status, 'found');
  assert.strictEqual(r.phoneNumber, '347 123 4567');
});

test('empty name -> default result, no People call', () => {
  const { ctx, state } = loadGas();
  const r = ctx.searchInPeople('   ');
  assert.strictEqual(r.contactsFound, 0);
  assert.strictEqual(r.phoneNumber, null);
  assert.deepStrictEqual(state.peopleCalls, []);
});

test('People throwing -> status error, no exception', () => {
  const { ctx } = loadGas();
  ctx.People = { People: { searchContacts: () => { throw new Error('boom'); } } };
  let r;
  assert.doesNotThrow(() => { r = ctx.searchInPeople('Mario Rossi'); });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.phoneNumber, null);
});

test('warm-up: three searches in one execution -> exactly one empty query, before the first real one', () => {
  const { ctx, state } = loadGas({ contacts: [{ displayName: 'Mario Rossi', phones: [MOBILE] }] });
  ctx.searchInPeople('Mario Rossi');
  ctx.searchInPeople('Mario Rossi');
  ctx.searchInPeople('Luigi Verdi');
  const empties = state.peopleCalls.filter((q) => q === '');
  assert.strictEqual(empties.length, 1);
  assert.strictEqual(state.peopleCalls[0], '');
  assert.strictEqual(state.peopleCalls.length, 4);
});

test('warm-up: a new execution warms up again', () => {
  const a = loadGas({ contacts: [{ displayName: 'Mario Rossi', phones: [MOBILE] }] });
  a.ctx.searchInPeople('Mario Rossi');
  const b = loadGas({ contacts: [{ displayName: 'Mario Rossi', phones: [MOBILE] }] });
  b.ctx.searchInPeople('Mario Rossi');
  assert.deepStrictEqual(b.state.peopleCalls, ['', 'Mario Rossi']);
});

test('warm-up: an execution without searches makes no People call', () => {
  const { state } = loadGas({ contacts: [{ displayName: 'Mario Rossi', phones: [MOBILE] }] });
  assert.deepStrictEqual(state.peopleCalls, []);
});

test('warm-up: a failing warm-up is swallowed and not retried in the same execution', () => {
  const { ctx } = loadGas();
  const queries = [];
  ctx.People = {
    People: {
      searchContacts: ({ query }) => {
        queries.push(query);
        if (query === '') throw new Error('warm-up failed');
        return { results: [{ person: { names: [{ displayName: 'Mario Rossi' }], phoneNumbers: [MOBILE] } }] };
      },
    },
  };
  assert.strictEqual(ctx.searchInPeople('Mario Rossi').status, 'found');
  assert.strictEqual(ctx.searchInPeople('Mario Rossi').status, 'found');
  assert.deepStrictEqual(queries, ['', 'Mario Rossi', 'Mario Rossi']);
});
