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

const EVT_MARIA = { id: 'evt-maria@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 30) };
const CONTACTS = [
  { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 123 4567' }] },
];

test('withScriptLock_: returns { ran: false } when lock is busy without executing fn', () => {
  const { ctx, state } = loadGas({ lockBusy: true });
  let executed = false;
  const res = ctx.withScriptLock_(1000, () => {
    executed = true;
    return 'hello';
  });
  assert.strictEqual(res.ran, false);
  assert.strictEqual(executed, false);
  assert.deepStrictEqual(state.lock.tryLockCalls, [1000]);
  assert.strictEqual(state.lock.released, 0);
});

test('withScriptLock_: returns { ran: true, value } and releases lock when acquired', () => {
  const { ctx, state } = loadGas({ lockBusy: false });
  let executed = false;
  const res = ctx.withScriptLock_(5000, () => {
    executed = true;
    return 42;
  });
  assert.strictEqual(res.ran, true);
  assert.strictEqual(res.value, 42);
  assert.strictEqual(executed, true);
  assert.deepStrictEqual(state.lock.tryLockCalls, [5000]);
  assert.strictEqual(state.lock.released, 1);
});

test('withScriptLock_: releases lock even when fn throws', () => {
  const { ctx, state } = loadGas({ lockBusy: false });
  assert.throws(
    () => {
      ctx.withScriptLock_(2000, () => {
        throw new Error('boom');
      });
    },
    /boom/
  );
  assert.deepStrictEqual(state.lock.tryLockCalls, [2000]);
  assert.strictEqual(state.lock.released, 1);
});

test('syncAppointmentsFromCalendar: when lock is busy, does not write and does not throw', () => {
  const { ctx, state } = loadGas({
    lockBusy: true,
    sheets: emptySheets(),
    events: [EVT_MARIA],
    contacts: CONTACTS,
  });

  assert.doesNotThrow(() => {
    ctx.syncAppointmentsFromCalendar();
  });

  assert.strictEqual(state.writes, 0);
  assert.deepStrictEqual(state.lock.tryLockCalls, [0]);
});

test('forceSyncAndUpdatePhones: calls tryLock(30000) and returns busy message if locked', () => {
  const { ctx, state } = loadGas({
    lockBusy: true,
    sheets: emptySheets(),
    events: [EVT_MARIA],
    contacts: CONTACTS,
  });

  const msg = ctx.forceSyncAndUpdatePhones();
  assert.strictEqual(msg, 'Sincronizzazione già in corso, riprova tra poco.');
  assert.deepStrictEqual(state.lock.tryLockCalls, [30000]);
  assert.strictEqual(state.writes, 0);
});

test('forceSyncAndUpdatePhones: calls tryLock(30000) and returns success message if lock acquired', () => {
  const { ctx, state } = loadGas({
    lockBusy: false,
    sheets: emptySheets(),
    events: [EVT_MARIA],
    contacts: CONTACTS,
  });

  const msg = ctx.forceSyncAndUpdatePhones();
  assert.strictEqual(msg, 'Sincronizzazione completata con successo!');
  assert.deepStrictEqual(state.lock.tryLockCalls, [30000]);
  assert.strictEqual(state.lock.released, 1);
  assert(state.writes > 0);
});

test('two consecutive syncs on the same state: no duplicate rows in appointments or cache', () => {
  const { ctx, state } = loadGas({
    sheets: emptySheets(),
    events: [EVT_MARIA],
    contacts: CONTACTS,
  });

  // First sync runs fullSync
  ctx.syncAppointmentsFromCalendar();
  const appRowsFirst = state.sheets[APPOINTMENTS].length;
  const cacheRowsFirst = state.sheets[CACHE].length;
  assert.strictEqual(appRowsFirst, 2); // Header + 1 appointment
  assert.strictEqual(cacheRowsFirst, 2); // Header + 1 appointment

  // Second sync runs quickCheckSync (no changes detected)
  ctx.syncAppointmentsFromCalendar();
  assert.strictEqual(state.sheets[APPOINTMENTS].length, appRowsFirst);
  assert.strictEqual(state.sheets[CACHE].length, cacheRowsFirst);
});

test('cleanupSentStatusProperties: uses tryLock(20000) and skips silently if lock is busy', () => {
  const { ctx, state } = loadGas({
    lockBusy: true,
  });

  assert.doesNotThrow(() => {
    ctx.cleanupSentStatusProperties();
  });

  assert.deepStrictEqual(state.lock.tryLockCalls, [20000]);
});

test('removeUnregisteredAppointmentsYesterday: uses tryLock(20000) and skips silently if lock is busy', () => {
  const { ctx, state } = loadGas({
    lockBusy: true,
  });

  assert.doesNotThrow(() => {
    ctx.removeUnregisteredAppointmentsYesterday();
  });

  assert.deepStrictEqual(state.lock.tryLockCalls, [20000]);
});
