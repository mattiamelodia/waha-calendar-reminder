'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./harness');

const CLIENTS_HEADER = ['Nome', 'Telefono', 'Ultimo Appuntamento', 'Appuntamenti Totali'];
const APPOINTMENTS_HEADER = ['ID Appuntamento', 'Nome Cliente', 'Data', 'Ora'];
const CACHE_HEADER = ['ID Appuntamento', 'Nome Cliente', 'Telefono', 'Data', 'Ora'];

const CLIENTS = 'ALL_CLIENTS_SHEET_NAME';
const APPOINTMENTS = 'ALL_APPOINTMENTS_SHEET_NAME';
const CACHE = 'CACHED_APPOINTMENTS_SHEET_NAME';

function emptySheets() {
  return {
    [CLIENTS]: [CLIENTS_HEADER],
    [APPOINTMENTS]: [APPOINTMENTS_HEADER],
    [CACHE]: [CACHE_HEADER],
  };
}

test('needsPhoneRetry_: returns false when no phone is empty in cache', () => {
  const { ctx } = loadGas();
  const cacheData = [
    CACHE_HEADER,
    ['evt-1', 'Mario Rossi', '393471234567', '2026-10-05', '10:00'],
    ['evt-2', 'Luca Verdi', '393331112222', '2026-10-05', '11:00'],
  ];
  const nowMs = 1000000000;
  const lastMs = 0;
  const intervalMin = 10;

  assert.strictEqual(ctx.needsPhoneRetry_(cacheData, nowMs, lastMs, intervalMin), false);
});

test('needsPhoneRetry_: returns false when phone is empty but elapsed time (3 min) is less than interval (10 min)', () => {
  const { ctx } = loadGas();
  const cacheData = [
    CACHE_HEADER,
    ['evt-1', 'Mario Rossi', '', '2026-10-05', '10:00'],
  ];
  const lastMs = 1000000000;
  const nowMs = lastMs + 3 * 60 * 1000;
  const intervalMin = 10;

  assert.strictEqual(ctx.needsPhoneRetry_(cacheData, nowMs, lastMs, intervalMin), false);
});

test('needsPhoneRetry_: returns true when phone is empty and elapsed time (11 min) is greater than interval (10 min)', () => {
  const { ctx } = loadGas();
  const cacheData = [
    CACHE_HEADER,
    ['evt-1', 'Mario Rossi', '', '2026-10-05', '10:00'],
  ];
  const lastMs = 1000000000;
  const nowMs = lastMs + 11 * 60 * 1000;
  const intervalMin = 10;

  assert.strictEqual(ctx.needsPhoneRetry_(cacheData, nowMs, lastMs, intervalMin), true);
});

test('needsPhoneRetry_: header row is ignored', () => {
  const { ctx } = loadGas();
  const cacheData = [
    CACHE_HEADER,
  ];
  const lastMs = 0;
  const nowMs = 1000000000;
  const intervalMin = 10;

  assert.strictEqual(ctx.needsPhoneRetry_(cacheData, nowMs, lastMs, intervalMin), false);
});

test('markPhoneRetry_: saves timestamp in LAST_PHONE_RETRY_MS script property', () => {
  const { ctx, state } = loadGas();
  ctx.markPhoneRetry_(1700000000);
  assert.strictEqual(state.props.LAST_PHONE_RETRY_MS, '1700000000');
});

test('integration: missing phone retry flow across consecutive executions', () => {
  const t0 = new Date('2026-10-04T10:00:00+02:00');
  const t0Ms = t0.getTime();
  const evt = {
    id: 'evt-mario@google.com',
    title: 'Mario Rossi',
    start: new Date('2026-10-05T10:30:00+02:00'),
  };

  // Run 1 (T0): Event exists, contact NOT in People API yet.
  const run1 = loadGas({
    now: t0,
    sheets: emptySheets(),
    events: [evt],
    contacts: [],
  });

  run1.ctx.syncAppointmentsFromCalendar();

  // In run 1, contact was not found, phone is empty
  const clientRow1 = run1.state.sheets[CLIENTS][1];
  const cacheRow1 = run1.state.sheets[CACHE][1];
  assert.strictEqual(clientRow1[0], 'Mario Rossi');
  assert.strictEqual(clientRow1[1], '');
  assert.strictEqual(cacheRow1[1], 'Mario Rossi');
  assert.strictEqual(cacheRow1[2], '');

  // Now the contact is added in Google Contacts
  const contactMario = {
    displayName: 'Mario Rossi',
    phones: [{ type: 'mobile', value: '+39 347 123 4567' }],
  };

  // Run 2 (T0 + 5 min): 5 minutes elapsed, interval is 10 min -> NO People call
  const t5 = new Date(t0Ms + 5 * 60 * 1000);
  const run2 = loadGas({
    now: t5,
    sheets: run1.state.sheets,
    props: run1.state.props,
    events: [evt],
    contacts: [contactMario],
  });

  run2.ctx.syncAppointmentsFromCalendar();

  // No People API calls made during this execution
  assert.strictEqual(run2.state.peopleCalls.length, 0);
  // Phone is still empty
  assert.strictEqual(run2.state.sheets[CLIENTS][1][1], '');
  assert.strictEqual(run2.state.sheets[CACHE][1][2], '');

  // Run 3 (T0 + 11 min): 11 minutes elapsed >= 10 min -> triggers retry!
  const t11 = new Date(t0Ms + 11 * 60 * 1000);
  const run3 = loadGas({
    now: t11,
    sheets: run2.state.sheets,
    props: run2.state.props,
    events: [evt],
    contacts: [contactMario],
  });

  run3.ctx.syncAppointmentsFromCalendar();

  // Phone was found and updated in Clienti and Cache
  assert.strictEqual(run3.state.sheets[CLIENTS][1][1], '393471234567');
  assert.strictEqual(run3.state.sheets[CACHE][1][2], '393471234567');
  assert.strictEqual(run3.state.props.LAST_PHONE_RETRY_MS, String(t11.getTime()));

  // Run 4 (T0 + 25 min): Phone is already present -> no searches ever made
  const t25 = new Date(t0Ms + 25 * 60 * 1000);
  const run4 = loadGas({
    now: t25,
    sheets: run3.state.sheets,
    props: run3.state.props,
    events: [evt],
    contacts: [contactMario],
  });

  run4.ctx.syncAppointmentsFromCalendar();

  // No People API call because no row lacks a phone number
  assert.strictEqual(run4.state.peopleCalls.length, 0);
});
