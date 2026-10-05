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

const namePhone = (rows) => rows.map((r) => r.slice(0, 2));

test('golden (a): two events and two contacts fill clients, appointments and cache', () => {
  const events = [
    { id: 'evt-maria@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 30) },
    { id: 'evt-luca@google.com', title: 'Luca Verdi', start: new Date(2026, 9, 5, 15, 0) },
  ];
  const contacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 123 4567' }] },
    { displayName: 'Luca Verdi', phones: [{ type: 'mobile', value: '333 111 2222' }] },
  ];

  const { ctx, state } = loadGas({ sheets: emptySheets(), events, contacts });
  ctx.fullSync(false);

  assert.deepStrictEqual(namePhone(state.sheets[CLIENTS]), [
    ['Nome', 'Telefono'],
    ['Luca Verdi', '393331112222'],
    ['Maria Bianchi', '393471234567'],
  ]);

  assert.deepStrictEqual(state.sheets[APPOINTMENTS], [
    APPOINTMENTS_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '2026-10-05', '10:30'],
    ['evt-luca@google.com', 'Luca Verdi', '2026-10-05', '15:00'],
  ]);

  assert.deepStrictEqual(state.sheets[CACHE], [
    CACHE_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '393471234567', '2026-10-05', '10:30'],
    ['evt-luca@google.com', 'Luca Verdi', '393331112222', '2026-10-05', '15:00'],
  ]);
});

test('golden (b): event moved to another time updates appointments and cache rows', () => {
  const events = [
    { id: 'evt-maria@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 30) },
    { id: 'evt-luca@google.com', title: 'Luca Verdi', start: new Date(2026, 9, 5, 15, 0) },
  ];
  const contacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 123 4567' }] },
    { displayName: 'Luca Verdi', phones: [{ type: 'mobile', value: '333 111 2222' }] },
  ];

  const first = loadGas({ sheets: emptySheets(), events, contacts });
  first.ctx.fullSync(false);

  const moved = { id: 'evt-maria@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 11, 0) };
  const second = loadGas({
    now: new Date(2026, 9, 4, 10, 1),
    sheets: first.state.sheets,
    events: [moved, events[1]],
    contacts,
  });
  second.ctx.fullSync(false);

  assert.deepStrictEqual(second.state.sheets[APPOINTMENTS], [
    APPOINTMENTS_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '2026-10-05', '11:00'],
    ['evt-luca@google.com', 'Luca Verdi', '2026-10-05', '15:00'],
  ]);
  assert.deepStrictEqual(
    second.state.sheets[CACHE].map((r) => [r[0], r[4]]),
    [['ID Appuntamento', 'Ora'], ['evt-maria@google.com', '11:00'], ['evt-luca@google.com', '15:00']]
  );
});

test('golden (c): event deleted inside window removes appointments and cache row', () => {
  const events = [
    { id: 'evt-maria@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 30) },
    { id: 'evt-luca@google.com', title: 'Luca Verdi', start: new Date(2026, 9, 5, 15, 0) },
  ];
  const contacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 123 4567' }] },
    { displayName: 'Luca Verdi', phones: [{ type: 'mobile', value: '333 111 2222' }] },
  ];

  const first = loadGas({ sheets: emptySheets(), events, contacts });
  first.ctx.fullSync(false);

  const second = loadGas({
    now: new Date(2026, 9, 4, 10, 1),
    sheets: first.state.sheets,
    events: [events[0]], // Luca deleted
    contacts,
  });
  second.ctx.fullSync(false);

  assert.deepStrictEqual(second.state.sheets[APPOINTMENTS], [
    APPOINTMENTS_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '2026-10-05', '10:30'],
  ]);
  assert.deepStrictEqual(second.state.sheets[CACHE], [
    CACHE_HEADER,
    ['evt-maria@google.com', 'Maria Bianchi', '393471234567', '2026-10-05', '10:30'],
  ]);
  assert.deepStrictEqual(
    namePhone(second.state.sheets[CLIENTS]).map((r) => r[0]),
    ['Nome', 'Luca Verdi', 'Maria Bianchi']
  );
});

test('golden (d): event titled "Messaggi Appuntamenti" is ignored', () => {
  const events = [
    { id: 'evt-maria@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 30) },
    { id: 'evt-marker@google.com', title: 'Messaggi Appuntamenti', start: new Date(2026, 9, 5, 9, 0) },
  ];
  const contacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 123 4567' }] },
  ];

  const { ctx, state } = loadGas({ sheets: emptySheets(), events, contacts });
  ctx.fullSync(false);

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

test('golden (f): client without contact gets empty phone in Clienti and cache', () => {
  const events = [{ id: 'evt-anna@google.com', title: 'Anna Rossi', start: new Date(2026, 9, 6, 9, 0) }];
  const { ctx, state } = loadGas({ sheets: emptySheets(), events, contacts: [] });
  ctx.fullSync(false);

  assert.deepStrictEqual(namePhone(state.sheets[CLIENTS]), [['Nome', 'Telefono'], ['Anna Rossi', '']]);
  assert.deepStrictEqual(state.sheets[CACHE], [
    CACHE_HEADER,
    ['evt-anna@google.com', 'Anna Rossi', '', '2026-10-06', '09:00'],
  ]);
});

test('golden: forced sync with changed phone updates Clienti and Cache', () => {
  const events = [
    { id: 'evt-maria@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 30) },
  ];
  const initialContacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 123 4567' }] },
  ];

  const first = loadGas({ sheets: emptySheets(), events, contacts: initialContacts });
  first.ctx.fullSync(false);
  assert.deepStrictEqual(namePhone(first.state.sheets[CLIENTS]), [
    ['Nome', 'Telefono'],
    ['Maria Bianchi', '393471234567'],
  ]);

  const updatedContacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 999 8877' }] },
  ];

  // Non-forced sync: should NOT update the phone
  const unforced = loadGas({
    now: new Date(2026, 9, 4, 10, 1),
    sheets: first.state.sheets,
    events,
    contacts: updatedContacts,
  });
  unforced.ctx.fullSync(false);
  assert.deepStrictEqual(namePhone(unforced.state.sheets[CLIENTS]), [
    ['Nome', 'Telefono'],
    ['Maria Bianchi', '393471234567'],
  ]);
  assert.strictEqual(unforced.state.sheets[CACHE][1][2], '393471234567');

  // Forced sync: MUST update the phone in both Clienti and Cache
  const forced = loadGas({
    now: new Date(2026, 9, 4, 10, 2),
    sheets: first.state.sheets,
    events,
    contacts: updatedContacts,
  });
  forced.ctx.fullSync(true);
  assert.deepStrictEqual(namePhone(forced.state.sheets[CLIENTS]), [
    ['Nome', 'Telefono'],
    ['Maria Bianchi', '393479998877'],
  ]);
  assert.strictEqual(forced.state.sheets[CACHE][1][2], '393479998877');
});

test('golden: new client with event already present in sheet (existing row path)', () => {
  // Appointment already exists in appointments sheet, but client is NOT in clients sheet
  const sheets = {
    [CLIENTS]: [CLIENTS_HEADER],
    [APPOINTMENTS]: [
      APPOINTMENTS_HEADER,
      ['evt-giacomo@google.com', 'Giacomo Poretti', '2026-10-05', '11:00'],
    ],
    [CACHE]: [CACHE_HEADER],
  };
  const events = [
    { id: 'evt-giacomo@google.com', title: 'Giacomo Poretti', start: new Date(2026, 9, 5, 11, 0) },
  ];
  const contacts = [
    { displayName: 'Giacomo Poretti', phones: [{ type: 'mobile', value: '+39 333 444 5555' }] },
  ];

  const { ctx, state } = loadGas({ sheets, events, contacts });
  ctx.fullSync(false);

  assert.deepStrictEqual(namePhone(state.sheets[CLIENTS]), [
    ['Nome', 'Telefono'],
    ['Giacomo Poretti', '393334445555'],
  ]);
  assert.deepStrictEqual(state.sheets[CACHE], [
    CACHE_HEADER,
    ['evt-giacomo@google.com', 'Giacomo Poretti', '393334445555', '2026-10-05', '11:00'],
  ]);
});

test('golden: two events for the same client in calendar', () => {
  const events = [
    { id: 'evt-maria-1@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 0) },
    { id: 'evt-maria-2@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 16, 0) },
  ];
  const contacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 123 4567' }] },
  ];

  const { ctx, state } = loadGas({ sheets: emptySheets(), events, contacts });
  ctx.fullSync(false);

  // Clienti must have only one entry for Maria Bianchi
  assert.deepStrictEqual(namePhone(state.sheets[CLIENTS]), [
    ['Nome', 'Telefono'],
    ['Maria Bianchi', '393471234567'],
  ]);

  // Appointments has both
  assert.deepStrictEqual(state.sheets[APPOINTMENTS], [
    APPOINTMENTS_HEADER,
    ['evt-maria-1@google.com', 'Maria Bianchi', '2026-10-05', '10:00'],
    ['evt-maria-2@google.com', 'Maria Bianchi', '2026-10-05', '16:00'],
  ]);

  // Cache has both with Maria's phone
  assert.deepStrictEqual(state.sheets[CACHE], [
    CACHE_HEADER,
    ['evt-maria-1@google.com', 'Maria Bianchi', '393471234567', '2026-10-05', '10:00'],
    ['evt-maria-2@google.com', 'Maria Bianchi', '393471234567', '2026-10-05', '16:00'],
  ]);
});

test('golden: two events for the same client with phone update during forced sync', () => {
  const events = [
    { id: 'evt-maria-1@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 10, 0) },
    { id: 'evt-maria-2@google.com', title: 'Maria Bianchi', start: new Date(2026, 9, 5, 16, 0) },
  ];
  const initialContacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 111 1111' }] },
  ];

  const first = loadGas({ sheets: emptySheets(), events, contacts: initialContacts });
  first.ctx.fullSync(false);

  const updatedContacts = [
    { displayName: 'Maria Bianchi', phones: [{ type: 'mobile', value: '+39 347 222 2222' }] },
  ];

  const second = loadGas({
    now: new Date(2026, 9, 4, 10, 1),
    sheets: first.state.sheets,
    events,
    contacts: updatedContacts,
  });
  second.ctx.fullSync(true);

  assert.deepStrictEqual(namePhone(second.state.sheets[CLIENTS]), [
    ['Nome', 'Telefono'],
    ['Maria Bianchi', '393472222222'],
  ]);

  assert.deepStrictEqual(second.state.sheets[CACHE], [
    CACHE_HEADER,
    ['evt-maria-1@google.com', 'Maria Bianchi', '393472222222', '2026-10-05', '10:00'],
    ['evt-maria-2@google.com', 'Maria Bianchi', '393472222222', '2026-10-05', '16:00'],
  ]);
});

test('resolveClientForEvent_: contract unit tests', () => {
  const contacts = [
    { displayName: 'Mario Rossi', phones: [{ type: 'mobile', value: '+39 347 111 2233' }] },
    { displayName: 'Luigi Bianchi', phones: [{ type: 'mobile', value: '+39 347 444 5566' }] },
    { displayName: 'Giovanni Neri', phones: [{ type: 'mobile', value: '+39 347 777 8899' }] },
  ];
  const { ctx, state } = loadGas({ sheets: emptySheets(), contacts });

  const clientsSheet = ctx.getClientSheet(CLIENTS);
  const clientsMap = new Map();
  const existingClientNamesSet = new Set();
  const clientPhoneUpdates = new Map();

  const sync = {
    clientsMap,
    clientsSheet,
    existingClientNamesSet,
    clientPhoneUpdates,
  };

  // Case 1: New client -> calls saveClient, updates clientsMap, returns formatted phone
  const phone1 = ctx.resolveClientForEvent_(sync, 'Mario Rossi', false);
  assert.strictEqual(phone1, '393471112233');
  assert.ok(clientsMap.has('mario rossi'));
  assert.ok(existingClientNamesSet.has('mario rossi'));
  assert.strictEqual(clientPhoneUpdates.size, 0);

  // Case 2: Existing client, not forced -> returns phone without calling People
  const initialCalls = state.peopleCalls.length;
  const phone2 = ctx.resolveClientForEvent_(sync, 'Mario Rossi', false);
  assert.strictEqual(phone2, '393471112233');
  assert.strictEqual(state.peopleCalls.length, initialCalls, 'should not search People');

  // Case 3: Existing client without phone -> searches People and updates clientPhoneUpdates
  clientsMap.set('luigi bianchi', {
    name: 'Luigi Bianchi',
    phone: '',
    rowIndex: 3,
  });
  const phone3 = ctx.resolveClientForEvent_(sync, 'Luigi Bianchi', false);
  assert.strictEqual(phone3, '393474445566');
  assert.strictEqual(clientPhoneUpdates.get(3), '393474445566');

  // Case 4: Existing client, forced sync with different phone in People -> updates clientPhoneUpdates
  clientsMap.set('giovanni neri', {
    name: 'Giovanni Neri',
    phone: '393470000000',
    rowIndex: 4,
  });
  const giovanniInfo = clientsMap.get('giovanni neri');
  const phone4 = ctx.resolveClientForEvent_(sync, 'Giovanni Neri', true);
  assert.strictEqual(phone4, '393477778899');
  assert.strictEqual(clientPhoneUpdates.get(giovanniInfo.rowIndex), '393477778899');
});

