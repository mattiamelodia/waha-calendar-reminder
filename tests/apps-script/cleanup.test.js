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

test('removeClientsWithoutPhone: keeps client without phone if they have an appointment in Cache', () => {
  const { ctx, state } = loadGas({
    sheets: {
      [CLIENTS]: [CLIENTS_HEADER, ['Mario Rossi', '', '', '']],
      [CACHE]: [CACHE_HEADER, ['evt-1', 'Mario Rossi', '', '2026-10-05', '10:00']],
    },
  });

  const removed = ctx.removeClientsWithoutPhone();
  assert.strictEqual(removed, 0);
  assert.strictEqual(state.sheets[CLIENTS].length, 2);
  assert.strictEqual(state.sheets[CLIENTS][1][0], 'Mario Rossi');
  assert.strictEqual(state.sheets.Archivio, undefined);
});

test('removeClientsWithoutPhone: removes client without phone if no appointment in Cache, and archives them', () => {
  const { ctx, state } = loadGas({
    sheets: {
      [CLIENTS]: [CLIENTS_HEADER, ['Sconosciuto SenzaNumero', '', '', '']],
      [CACHE]: [CACHE_HEADER],
    },
  });

  const removed = ctx.removeClientsWithoutPhone();
  assert.strictEqual(removed, 1);
  assert.strictEqual(state.sheets[CLIENTS].length, 1);
  assert.ok(state.sheets.Archivio, 'Archivio sheet must be created');
  assert.strictEqual(state.sheets.Archivio.length, 2);
  assert.strictEqual(state.sheets.Archivio[1][0], 'Sconosciuto SenzaNumero');
  assert.strictEqual(state.sheets.Archivio[1][1], '2026-10-04');
});

test('removeClientsWithoutPhone: keeps client with a phone number even if no appointments in Cache', () => {
  const { ctx, state } = loadGas({
    sheets: {
      [CLIENTS]: [CLIENTS_HEADER, ['Luca Verdi', '393471234567', '', '']],
      [CACHE]: [CACHE_HEADER],
    },
  });

  const removed = ctx.removeClientsWithoutPhone();
  assert.strictEqual(removed, 0);
  assert.strictEqual(state.sheets[CLIENTS].length, 2);
  assert.strictEqual(state.sheets[CLIENTS][1][0], 'Luca Verdi');
});

test('removeUnregisteredAppointmentsYesterday: exits without error when sheets have only header', () => {
  const { ctx } = loadGas({
    sheets: {
      [CLIENTS]: [CLIENTS_HEADER],
      [APPOINTMENTS]: [APPOINTMENTS_HEADER],
    },
  });

  assert.doesNotThrow(() => {
    ctx.removeUnregisteredAppointmentsYesterday();
  });
});

test('triggers: cleanupSentStatusProperties and removeUnregisteredAppointmentsYesterday run at different times', () => {
  const { ctx, state } = loadGas();
  ctx.setupDailyCleanupTrigger();
  ctx.setupDailyCleanupYesterdayTrigger();

  const cleanupTrigger = state.triggers.find((t) => t.handler === 'cleanupSentStatusProperties');
  const yesterdayTrigger = state.triggers.find((t) => t.handler === 'removeUnregisteredAppointmentsYesterday');

  assert.ok(cleanupTrigger, 'cleanupSentStatusProperties trigger exists');
  assert.ok(yesterdayTrigger, 'removeUnregisteredAppointmentsYesterday trigger exists');

  // Specs are stored on the trigger object in harness
  const yesterdaySpecs = yesterdayTrigger.spec || yesterdayTrigger.entry?.spec || [];
  const hasNearMinute30 = yesterdaySpecs.some(([name, val]) => name === 'nearMinute' && val === 30);
  assert.ok(hasNearMinute30, 'yesterdayTrigger must use nearMinute(30)');
});

test('cleanupSentStatusProperties: deletes SHORT_* and obsolete CONFIRM_* properties', () => {
  const now = new Date(2026, 9, 4, 10, 0, 0);
  const oldCreatedAt = now.getTime() - 4 * 86400 * 1000; // 4 days ago
  const recentCreatedAt = now.getTime() - 1 * 86400 * 1000; // 1 day ago

  const { ctx, state } = loadGas({
    now,
    props: {
      'SHORT_ken=abc12345': 'https://tinyurl.com/xyz',
      'SHORT_ken=def67890': 'https://tinyurl.com/abc',
      'CONFIRM_old_token': JSON.stringify({ eventId: 'evt-old', createdAt: oldCreatedAt }),
      'EVENT_CONFIRM_evt-old': 'old_token',
      'CONFIRM_recent_token': JSON.stringify({ eventId: 'evt-recent', createdAt: recentCreatedAt }),
      'EVENT_CONFIRM_evt-recent': 'recent_token',
      'SALON_NAME': 'Test Salon',
    },
  });

  ctx.cleanupSentStatusProperties();

  // SHORT_* keys must be deleted
  assert.strictEqual(state.props['SHORT_ken=abc12345'], undefined);
  assert.strictEqual(state.props['SHORT_ken=def67890'], undefined);

  // Obsolete CONFIRM_* (>3 days) must be deleted
  assert.strictEqual(state.props['CONFIRM_old_token'], undefined);
  assert.strictEqual(state.props['EVENT_CONFIRM_evt-old'], undefined);

  // Recent CONFIRM_* (<3 days) must be preserved
  assert.ok(state.props['CONFIRM_recent_token']);
  assert.strictEqual(state.props['EVENT_CONFIRM_evt-recent'], 'recent_token');

  // Standard config must not be touched
  assert.strictEqual(state.props['SALON_NAME'], 'Test Salon');
});

test('cleanupObsoleteProperties_: removes all SHORT_*, old RUNSTATS_* and old CONFIRM_* from script properties', () => {
  const now = new Date(2026, 9, 15, 10, 0, 0); // Oct 15, 2026
  const { ctx, state } = loadGas({
    now,
    props: {
      'SHORT_ken=111': 'https://tinyurl.com/1',
      'SHORT_ken=222': 'https://tinyurl.com/2',
      'RUNSTATS_2026-10-01': JSON.stringify({ runs: 5 }), // 14 days ago -> delete
      'RUNSTATS_2026-10-14': JSON.stringify({ runs: 2 }), // 1 day ago -> keep
      'WAHA_SESSION': 'default',
    },
  });

  ctx.cleanupObsoleteProperties_();

  assert.strictEqual(state.props['SHORT_ken=111'], undefined);
  assert.strictEqual(state.props['SHORT_ken=222'], undefined);
  assert.strictEqual(state.props['RUNSTATS_2026-10-01'], undefined);
  assert.ok(state.props['RUNSTATS_2026-10-14']);
  assert.strictEqual(state.props['WAHA_SESSION'], 'default');
});

