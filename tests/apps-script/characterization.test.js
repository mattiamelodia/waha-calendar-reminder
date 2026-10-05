'use strict';

// Characterization tests: they pin what the Apps Script does TODAY, so later refactors can be
// verified against it. If one fails, the test describes the current behaviour wrongly (or the
// behaviour changed on purpose): do not "fix" the code to satisfy it without deciding that first.

const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./harness');

// Same list Setup.js setup() writes as the WORDS_TO_REMOVE default.
const WORDS_TO_REMOVE = JSON.stringify(['piedi', 'm+p', 'm +p', 'm + p', 'm+ p', 'rico', 'refil', 'refill']);

const CLIENTS_HEADER = ['Nome', 'Telefono', 'Ultimo Appuntamento', 'Appuntamenti Totali'];
const APPOINTMENTS_HEADER = ['ID Appuntamento', 'Nome Cliente', 'Data', 'Ora'];
const CACHE_HEADER = ['ID Appuntamento', 'Nome Cliente', 'Telefono', 'Data', 'Ora'];

// Sync.js looks the sheets up with getClientSheet(CONFIG_KEYS.X_SHEET_NAME), i.e. by the LITERAL key
// name, not by the value configured in the script properties (Clienti / Storico / CachePromemoria).
// The sheets are therefore named after the keys; see the "ignores the configured sheet names" test.
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

// "Today" in the harness is 2026-10-04 10:00 Europe/Rome: the sync window is 10-04 00:00 .. 10-07 00:00.
const EVT_MARIA = { id: 'evt-maria@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 30) };
const EVT_LUCA = { id: 'evt-luca@google.com', title: 'Luca Verdi', start: new Date(2026, 9, 5, 15, 0) };
const CONTACTS = [
  { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 123 4567' }] },
  { displayName: 'Luca Verdi', phones: [{ type: 'mobile', value: '333 111 2222' }] },
];

// Clienti columns 3-4 hold formulas; only name and phone are pinned.
const namePhone = (rows) => rows.map((r) => r.slice(0, 2));

// Runs one full sync starting from empty sheets and returns the resulting state.
function firstSync(events = [EVT_MARIA, EVT_LUCA], contacts = CONTACTS) {
  const { ctx, state } = loadGas({ sheets: emptySheets(), events, contacts });
  ctx.fullSync(false);
  return state;
}

test('harness loads every file', () => {
  const { ctx } = loadGas();
  assert.strictEqual(typeof ctx.syncAppointmentsFromCalendar, 'function');
});

test('formatContactName strips configured trailing words', () => {
  const { ctx } = loadGas({ props: { WORDS_TO_REMOVE } });
  assert.strictEqual(ctx.formatContactName('Maria Bianchi m+p'), 'Maria Bianchi');
});

test('formatContactName collapses and trims whitespace', () => {
  const { ctx } = loadGas({ props: { WORDS_TO_REMOVE } });
  assert.strictEqual(ctx.formatContactName('  Maria   Bianchi '), 'Maria Bianchi');
});

test('formatContactName removes nothing when WORDS_TO_REMOVE is not configured', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatContactName('Maria Bianchi m+p'), 'Maria Bianchi m+p');
});

test('formatPhoneNumber normalizes Italian numbers to 39XXXXXXXXXX', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatPhoneNumber('+39 347 123 4567'), '393471234567');
  assert.strictEqual(ctx.formatPhoneNumber('347 123 4567'), '393471234567');
  assert.strictEqual(ctx.formatPhoneNumber('(+39) 347-123-4567'), '393471234567');
});

test('formatPhoneNumber keeps a 39-prefixed landline of unusual length', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatPhoneNumber('+39 06 1234567'), '39061234567');
});

test('formatPhoneNumber returns null for empty or unrecognised numbers', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatPhoneNumber(''), null);
  assert.strictEqual(ctx.formatPhoneNumber('12345'), null);
});

test('formatPhoneForDisplay formats 12-digit Italian numbers', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.formatPhoneForDisplay('393471234567'), '+39 347 123 4567');
});

test('personalizeMessage replaces %NOME%, %DATA% and %ORE%', () => {
  const { ctx } = loadGas();
  assert.strictEqual(
    ctx.personalizeMessage('Ciao %NOME%, il %DATA% alle %ORE%.', 'Maria', '2026-10-05', '10:30'),
    'Ciao Maria, il 2026-10-05 alle 10:30.'
  );
});

test('personalizeMessage replaces only the first occurrence of each placeholder', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.personalizeMessage('%NOME% e %NOME%', 'Maria', 'd', 't'), 'Maria e %NOME%');
});

test('fullSync (a): two events and two contacts fill the clients, appointments and cache sheets', () => {
  const state = firstSync();

  assert.deepStrictEqual(namePhone(state.sheets[CLIENTS]), [
    ['Nome', 'Telefono'],
    ['Luca Verdi', '393331112222'],
    ['Maria Bianchi', '393471234567'],
  ]);
  for (const row of state.sheets[CLIENTS].slice(1)) {
    assert.match(row[2], /^=/, 'Ultimo Appuntamento is a formula');
    assert.match(row[3], /^=/, 'Appuntamenti Totali is a formula');
  }

  assert.deepStrictEqual(state.sheets[APPOINTMENTS], [
    APPOINTMENTS_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '2026-10-05', '10:30'],
    ['evt-luca@google.com', 'Luca Verdi', '2026-10-05', '15:00'],
  ]);

  assert.deepStrictEqual(state.sheets[CACHE], [
    ['ID Appuntamento', 'Nome Cliente', 'Telefono', 'Data', 'Ora'],
    ['evt-maria@google.com', 'Maria Bianchi', '393471234567', '2026-10-05', '10:30'],
    ['evt-luca@google.com', 'Luca Verdi', '393331112222', '2026-10-05', '15:00'],
  ]);

  // warm-up added by Task 4
  assert.strictEqual(state.peopleCalls[0], '');
  assert.deepStrictEqual(state.peopleCalls.slice(1), ['Maria Bianchi', 'Luca Verdi']);
});

test('fullSync (b): an event moved to another time updates its Appuntamenti and cache rows', () => {
  const first = firstSync();
  const moved = { ...EVT_MARIA, start: new Date(2026, 9, 5, 11, 0) };

  const { ctx, state } = loadGas({
    now: new Date(2026, 9, 4, 10, 1),
    sheets: first.sheets,
    events: [moved, EVT_LUCA],
    contacts: CONTACTS,
  });
  ctx.fullSync(false);

  assert.deepStrictEqual(state.sheets[APPOINTMENTS], [
    APPOINTMENTS_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '2026-10-05', '11:00'],
    ['evt-luca@google.com', 'Luca Verdi', '2026-10-05', '15:00'],
  ]);
  assert.deepStrictEqual(
    state.sheets[CACHE].map((r) => [r[0], r[4]]),
    [['ID Appuntamento', 'Ora'], ['evt-maria@google.com', '11:00'], ['evt-luca@google.com', '15:00']]
  );
  assert.deepStrictEqual(state.peopleCalls, [], 'phones already in Clienti: no People lookup when not forced');
});

test('fullSync (c): an event deleted inside the window removes its Appuntamenti row and cache row', () => {
  const first = firstSync();

  const { ctx, state } = loadGas({
    now: new Date(2026, 9, 4, 10, 1),
    sheets: first.sheets,
    events: [EVT_MARIA],
    contacts: CONTACTS,
  });
  ctx.fullSync(false);

  assert.deepStrictEqual(state.sheets[APPOINTMENTS], [
    APPOINTMENTS_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '2026-10-05', '10:30'],
  ]);
  assert.deepStrictEqual(state.sheets[CACHE], [
    CACHE_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '393471234567', '2026-10-05', '10:30'],
  ]);
  assert.deepStrictEqual(
    namePhone(state.sheets[CLIENTS]).map((r) => r[0]),
    ['Nome', 'Luca Verdi', 'Maria Bianchi'],
    'the client of the deleted event stays in Clienti'
  );
});

test('fullSync (d): an event titled "Messaggi Appuntamenti" is ignored', () => {
  const marker = { id: 'evt-marker@google.com', title: 'Messaggi Appuntamenti', start: new Date(2026, 9, 5, 9, 0) };
  const state = firstSync([EVT_MARIA, marker]);

  assert.deepStrictEqual(state.sheets[APPOINTMENTS], [
    APPOINTMENTS_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '2026-10-05', '10:30'],
  ]);
  assert.deepStrictEqual(namePhone(state.sheets[CLIENTS]), [['Nome', 'Telefono'], ['Maria Bianchi', '393471234567']]);
  assert.deepStrictEqual(
    state.sheets[CACHE].map((r) => r[0]),
    ['ID Appuntamento', 'evt-maria@google.com']
  );
});

test('quickCheckSync (e): false when the cache matches the calendar', () => {
  const first = firstSync();

  const { ctx, state } = loadGas({
    now: new Date(2026, 9, 4, 10, 1),
    sheets: first.sheets,
    events: [EVT_MARIA, EVT_LUCA],
    contacts: CONTACTS,
  });
  assert.strictEqual(ctx.quickCheckSync(), false);
  assert.deepStrictEqual(state.sheets[CACHE], first.sheets[CACHE]);
});

test('quickCheckSync: the no-change path does not write (fixed in Task 8)', () => {
  const first = firstSync();
  const { ctx, state } = loadGas({
    now: new Date(2026, 9, 4, 10, 1),
    sheets: first.sheets,
    events: [EVT_MARIA, EVT_LUCA],
  });
  ctx.quickCheckSync();
  assert.strictEqual(state.writes, 0);
});

test('quickCheckSync: true when the cache holds only the header', () => {
  const { ctx } = loadGas({ sheets: emptySheets(), events: [EVT_MARIA] });
  assert.strictEqual(ctx.quickCheckSync(), true);
});

test('quickCheckSync: true when an event moved', () => {
  const first = firstSync();
  const moved = { ...EVT_MARIA, start: new Date(2026, 9, 5, 11, 0) };
  const { ctx } = loadGas({ sheets: first.sheets, events: [moved, EVT_LUCA] });
  assert.strictEqual(ctx.quickCheckSync(), true);
});

test('quickCheckSync: a "Messaggi Appuntamenti" event is ignored (Ruling R9 / Task 8)', () => {
  const marker = { id: 'evt-marker@google.com', title: 'Messaggi Appuntamenti', start: new Date(2026, 9, 5, 9, 0) };
  const first = firstSync([EVT_MARIA, marker]);
  const { ctx } = loadGas({ sheets: first.sheets, events: [EVT_MARIA, marker] });
  assert.strictEqual(ctx.quickCheckSync(), false);
});

test('fullSync (f): a client without a contact gets an empty phone in Clienti and cache', () => {
  const state = firstSync([{ id: 'evt-anna@google.com', title: 'Anna Rossi', start: new Date(2026, 9, 6, 9, 0) }], []);

  assert.deepStrictEqual(namePhone(state.sheets[CLIENTS]), [['Nome', 'Telefono'], ['Anna Rossi', '']]);
  assert.deepStrictEqual(state.sheets[CACHE], [
    CACHE_HEADER,
    ['evt-anna@google.com', 'Anna Rossi', '', '2026-10-06', '09:00'],
  ]);
  // warm-up added by Task 4
  assert.strictEqual(state.peopleCalls[0], '');
  assert.deepStrictEqual(state.peopleCalls.slice(1), ['Anna Rossi']);
});

test('fullSync ignores the configured sheet names: it reads and writes sheets named after the config keys', () => {
  const { ctx, state } = loadGas({
    props: {
      ALL_CLIENTS_SHEET_NAME: 'Clienti',
      ALL_APPOINTMENTS_SHEET_NAME: 'Storico',
      CACHED_APPOINTMENTS_SHEET_NAME: 'CachePromemoria',
    },
    sheets: { Clienti: [CLIENTS_HEADER], Storico: [APPOINTMENTS_HEADER], CachePromemoria: [CACHE_HEADER] },
    events: [EVT_MARIA],
    contacts: CONTACTS,
  });
  ctx.fullSync(false);

  assert.deepStrictEqual(Object.keys(state.sheets).sort(), [
    'ALL_APPOINTMENTS_SHEET_NAME',
    'ALL_CLIENTS_SHEET_NAME',
    'CACHED_APPOINTMENTS_SHEET_NAME',
    'CachePromemoria',
    'Clienti',
    'Storico',
  ]);
  assert.deepStrictEqual(state.sheets.Clienti, [CLIENTS_HEADER], 'configured sheet is left untouched');
  assert.strictEqual(state.sheets[CLIENTS].length, 2);
});

test('getAllClientNames, unlike the sync, reads the sheet named by the configured value', () => {
  const { ctx } = loadGas({
    props: { ALL_CLIENTS_SHEET_NAME: 'Clienti' },
    sheets: { Clienti: [CLIENTS_HEADER, ['Maria Bianchi', '393471234567', '', '']] },
  });
  assert.deepStrictEqual(Array.from(ctx.getAllClientNames()), ['Maria Bianchi']);
});

test('removeUnregisteredAppointmentsYesterday deletes yesterday Date rows whose client is not registered', () => {
  // Real Sheets turns an appended yyyy-MM-dd string into a Date cell, which is what the function relies on
  // (`instanceof Date`); the fake does not auto-parse, so the Date cells are seeded explicitly.
  const yesterday = new Date(2026, 9, 3);
  const { ctx, state } = loadGas({
    sheets: {
      [CLIENTS]: [CLIENTS_HEADER, ['Maria Bianchi', '393471234567', '', '']],
      [APPOINTMENTS]: [
        APPOINTMENTS_HEADER,
        ['evt-1@google.com', 'Sconosciuta Tizia', yesterday, '09:00'],
        ['evt-2@google.com', 'Maria Bianchi', yesterday, '10:00'],
        ['evt-3@google.com', 'Altra Persona', '2026-10-03', '11:00'],
        ['evt-4@google.com', 'Altra Persona', new Date(2026, 9, 2), '11:00'],
      ],
    },
  });
  ctx.removeUnregisteredAppointmentsYesterday();

  assert.deepStrictEqual(
    state.sheets[APPOINTMENTS].map((r) => r[0]),
    ['ID Appuntamento', 'evt-2@google.com', 'evt-3@google.com', 'evt-4@google.com'],
    'only the unregistered name on a yesterday Date cell is removed (string dates and other days are kept)'
  );
});

test('removeUnregisteredAppointmentsYesterday handles a header-only appointments sheet without throwing (fixed in Task 7)', () => {
  const { ctx } = loadGas({ sheets: emptySheets() });
  assert.doesNotThrow(
    () => ctx.removeUnregisteredAppointmentsYesterday()
  );
});

test('harness: calendar times are Dates of the script context and empty sheets give a 1x1 data range', () => {
  const { ctx } = loadGas({ events: [EVT_MARIA], sheets: { Empty: [] } });
  const calendar = ctx.getCalendar();
  const [event] = calendar.getEvents(new ctx.Date(2026, 9, 4), new ctx.Date(2026, 9, 7));
  assert.ok(event.getStartTime() instanceof ctx.Date);
  const range = ctx.SpreadsheetApp.openById('x').getSheetByName('Empty').getDataRange();
  assert.deepStrictEqual(Array.from(range.getValues(), (r) => Array.from(r)), [['']]);
  assert.throws(() => ctx.SpreadsheetApp.openById('x').getSheetByName('Empty').getRange(2, 1, 0, 4), /at least 1/);
});
