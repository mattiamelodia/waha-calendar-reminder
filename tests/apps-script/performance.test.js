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

test('(a) getClientSheet reuses spreadsheet handle: 5 calls -> state.openByIdCalls === 1', () => {
  const { ctx, state } = loadGas({ props: { SHEET_ID: 'fake-id' } });
  for (let i = 0; i < 5; i++) {
    ctx.getClientSheet(CLIENTS);
  }
  assert.strictEqual(state.openByIdCalls, 1);
});

test('(b) quickCheckSync() with cache equal to calendar -> state.writes === 0', () => {
  const now = new Date('2026-10-04T10:00:00+02:00');
  const evt = { id: 'evt-1@google.com', title: 'Maria Bianchi', start: new Date('2026-10-05T10:30:00+02:00') };
  const { ctx, state } = loadGas({
    now,
    events: [evt],
    sheets: {
      [CLIENTS]: [CLIENTS_HEADER, ['Maria Bianchi', '393471234567', '', '']],
      [APPOINTMENTS]: [APPOINTMENTS_HEADER, ['evt-1@google.com', 'Maria Bianchi', '2026-10-05', '10:30']],
      [CACHE]: [CACHE_HEADER, ['evt-1@google.com', 'Maria Bianchi', '393471234567', '2026-10-05', '10:30']],
    },
  });

  const res = ctx.quickCheckSync();
  assert.strictEqual(res, false);
  assert.strictEqual(state.writes, 0);
});

test('(c) 20 phone updates -> batch update on clients sheet with setColumnValues_', () => {
  const clientRows = [CLIENTS_HEADER];
  const updates = new Map();
  for (let i = 1; i <= 20; i++) {
    clientRows.push([`Cliente ${i}`, '', '', '']);
    updates.set(i + 1, `3934700000${String(i).padStart(2, '0')}`);
  }

  const { ctx, state } = loadGas({
    sheets: {
      [CLIENTS]: clientRows,
    },
  });

  const sheet = ctx.getClientSheet(CLIENTS);
  state.setValuesCalls = 0; // reset counter

  ctx.setColumnValues_(sheet, 2, updates);

  assert.strictEqual(state.setValuesCalls, 1);
  for (let i = 1; i <= 20; i++) {
    assert.strictEqual(state.sheets[CLIENTS][i][1], `3934700000${String(i).padStart(2, '0')}`);
  }
});

test('(d) 10 new appointments -> single setValues via appendRows_', () => {
  const { ctx, state } = loadGas({
    sheets: emptySheets(),
  });

  const sheet = ctx.getClientSheet(APPOINTMENTS);
  state.setValuesCalls = 0;

  const newRows = [];
  for (let i = 1; i <= 10; i++) {
    newRows.push([`evt-${i}`, `Cliente ${i}`, '2026-10-05', '10:00']);
  }

  ctx.appendRows_(sheet, newRows);
  assert.strictEqual(state.setValuesCalls, 1);
  assert.strictEqual(state.sheets[APPOINTMENTS].length, 11);
});

test('(e) getSentIds_() matches getSentStatus for present and absent keys', () => {
  const { ctx } = loadGas({
    props: {
      'evt-1@google.com': 'SENT',
      'evt-2@google.com': 'SENT',
      'OTHER_KEY': 'val',
    },
  });

  const sentIds = ctx.getSentIds_();
  assert.strictEqual(sentIds.constructor.name, 'Set');
  assert.strictEqual(sentIds.has('evt-1@google.com'), ctx.getSentStatus('evt-1@google.com'));
  assert.strictEqual(sentIds.has('evt-2@google.com'), ctx.getSentStatus('evt-2@google.com'));
  assert.strictEqual(sentIds.has('evt-3@google.com'), ctx.getSentStatus('evt-3@google.com'));
});

test('(f) recordRun_ aggregates runs, ms and errors in RUNSTATS_<yyyy-MM-dd>', () => {
  const { ctx, state } = loadGas({
    now: new Date('2026-10-04T12:00:00+02:00'),
  });

  ctx.recordRun_('sync', 150, true);
  ctx.recordRun_('sync', 250, false);
  ctx.recordRun_('sync', 100, true);

  const statsJson = state.props['RUNSTATS_2026-10-04'];
  assert.ok(statsJson, 'RUNSTATS_2026-10-04 must exist');
  const stats = JSON.parse(statsJson);

  assert.strictEqual(stats.runs, 3);
  assert.strictEqual(stats.ms, 500);
  assert.strictEqual(stats.errors, 1);
});

test('logDebug_: only writes to Logger when DEBUG_LOG is true', () => {
  const gasOff = loadGas({ props: { DEBUG_LOG: 'false' } });
  gasOff.ctx.logDebug_('invisible debug');
  assert.strictEqual(gasOff.state.logs.length, 0);

  const gasOn = loadGas({ props: { DEBUG_LOG: 'true' } });
  gasOn.ctx.logDebug_('visible debug');
  assert.strictEqual(gasOn.state.logs.length, 1);
  assert.strictEqual(gasOn.state.logs[0], 'visible debug');
});
