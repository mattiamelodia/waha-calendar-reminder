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

const GOTIFY_PROPS = {
  GOTIFY_URL: 'https://gotify.example.com',
  GOTIFY_TOKEN: 'fake-gotify-token',
};

test('nextFailStreak_: increments on failure, resets to 0 on success', () => {
  const { ctx } = loadGas();
  assert.strictEqual(ctx.nextFailStreak_(2, false), 3);
  assert.strictEqual(ctx.nextFailStreak_(0, false), 1);
  assert.strictEqual(ctx.nextFailStreak_(5, true), 0);
  assert.strictEqual(ctx.nextFailStreak_(0, true), 0);
});

test('sync failure alerts: 3 failures trigger 1 alert; 4th in cooldown is silent; success sends recovery', () => {
  const now = new Date('2026-10-04T10:00:00+02:00');
  const brokenCalendar = {
    getEvents() {
      throw new Error('Google Calendar error');
    },
  };

  // Run 1 (fail 1)
  const run1 = loadGas({
    now,
    props: { ...GOTIFY_PROPS },
  });
  run1.ctx.CalendarApp.getCalendarById = () => brokenCalendar;
  run1.ctx.CalendarApp.getDefaultCalendar = () => brokenCalendar;
  run1.ctx.syncAppointmentsFromCalendar();
  assert.strictEqual(run1.state.gotify.length, 0);

  // Run 2 (fail 2)
  const run2 = loadGas({
    now: new Date(now.getTime() + 60000),
    props: run1.state.props,
  });
  run2.ctx.CalendarApp.getCalendarById = () => brokenCalendar;
  run2.ctx.CalendarApp.getDefaultCalendar = () => brokenCalendar;
  run2.ctx.syncAppointmentsFromCalendar();
  assert.strictEqual(run2.state.gotify.length, 0);

  // Run 3 (fail 3) -> Triggers alert!
  const run3 = loadGas({
    now: new Date(now.getTime() + 120000),
    props: run2.state.props,
  });
  run3.ctx.CalendarApp.getCalendarById = () => brokenCalendar;
  run3.ctx.CalendarApp.getDefaultCalendar = () => brokenCalendar;
  run3.ctx.syncAppointmentsFromCalendar();
  assert.strictEqual(run3.state.gotify.length, 1);
  assert.match(run3.state.gotify[0].message, /3 errori di fila/);
  assert.strictEqual(run3.state.gotify[0].priority, 8);

  // Run 4 (fail 4, within 60 min cooldown) -> No new alert
  const run4 = loadGas({
    now: new Date(now.getTime() + 180000),
    props: run3.state.props,
  });
  run4.ctx.CalendarApp.getCalendarById = () => brokenCalendar;
  run4.ctx.CalendarApp.getDefaultCalendar = () => brokenCalendar;
  run4.ctx.syncAppointmentsFromCalendar();
  assert.strictEqual(run4.state.gotify.length, 0);

  // Run 5 (success) -> Recovery alert!
  const run5 = loadGas({
    now: new Date(now.getTime() + 240000),
    props: run4.state.props,
    sheets: {
      [CLIENTS]: [CLIENTS_HEADER],
      [APPOINTMENTS]: [APPOINTMENTS_HEADER],
      [CACHE]: [CACHE_HEADER],
    },
  });
  run5.ctx.syncAppointmentsFromCalendar();
  assert.strictEqual(run5.state.gotify.length, 1);
  assert.match(run5.state.gotify[0].message, /ripristinata/i);
});

test('checkTomorrowNumbers: alerts with count and no client names if numbers are missing', () => {
  // Today: 2026-10-04, Tomorrow: 2026-10-05
  const now = new Date('2026-10-04T10:00:00+02:00');

  // Case A: 2 appointments tomorrow without phone
  const gasWithMissing = loadGas({
    now,
    props: { ...GOTIFY_PROPS },
    sheets: {
      [CACHE]: [
        CACHE_HEADER,
        ['evt-1', 'Mario Rossi', '', '2026-10-05', '10:00'],
        ['evt-2', 'Luca Verdi', '', '2026-10-05', '11:00'],
        ['evt-3', 'Anna Bianchi', '393471112233', '2026-10-05', '12:00'],
        ['evt-4', 'Altro Giorno', '', '2026-10-06', '10:00'],
      ],
    },
  });

  gasWithMissing.ctx.checkTomorrowNumbers();
  assert.strictEqual(gasWithMissing.state.gotify.length, 1);
  const alert = gasWithMissing.state.gotify[0];
  assert.match(alert.message, /2 appuntamenti di domani senza numero/);
  assert.doesNotMatch(alert.message, /Mario/);
  assert.doesNotMatch(alert.message, /Luca/);
  assert.strictEqual(alert.priority, 6);

  // Case B: 0 appointments tomorrow without phone -> no alert
  const gasNoMissing = loadGas({
    now,
    props: { ...GOTIFY_PROPS },
    sheets: {
      [CACHE]: [
        CACHE_HEADER,
        ['evt-3', 'Anna Bianchi', '393471112233', '2026-10-05', '12:00'],
      ],
    },
  });

  gasNoMissing.ctx.checkTomorrowNumbers();
  assert.strictEqual(gasNoMissing.state.gotify.length, 0);
});

test('checkQuotaUsage_: warns when quota is above 80%, silent at 50%', () => {
  // Today: 2026-10-04, Yesterday: 2026-10-03
  const now = new Date('2026-10-04T03:00:00+02:00');

  // Quota is 90 min (5,400,000 ms).
  // 85% of 90 min = 76.5 min = 4,590,000 ms
  const gas85 = loadGas({
    now,
    props: {
      ...GOTIFY_PROPS,
      'RUNSTATS_2026-10-03': JSON.stringify({ runs: 1400, ms: 4590000, errors: 0 }),
      QUOTA_MINUTES: '90',
    },
  });
  gas85.ctx.checkQuotaUsage_();
  assert.strictEqual(gas85.state.gotify.length, 1);
  assert.match(gas85.state.gotify[0].message, /quota/i);

  // 50% of 90 min = 45 min = 2,700,000 ms
  const gas50 = loadGas({
    now,
    props: {
      ...GOTIFY_PROPS,
      'RUNSTATS_2026-10-03': JSON.stringify({ runs: 1400, ms: 2700000, errors: 0 }),
      QUOTA_MINUTES: '90',
    },
  });
  gas50.ctx.checkQuotaUsage_();
  assert.strictEqual(gas50.state.gotify.length, 0);
});

test('setupAlertTriggers: configures checkTomorrowNumbers daily trigger at 8:30', () => {
  const { ctx, state } = loadGas();
  ctx.setupAlertTriggers();

  const trigger = state.triggers.find((t) => t.handler === 'checkTomorrowNumbers');
  assert.ok(trigger, 'checkTomorrowNumbers trigger must exist');

  const specs = trigger.spec || trigger.entry?.spec || [];
  const hasAtHour8 = specs.some(([name, val]) => name === 'atHour' && val === 8);
  const hasNearMinute30 = specs.some(([name, val]) => name === 'nearMinute' && val === 30);
  assert.ok(hasAtHour8, 'trigger must use atHour(8)');
  assert.ok(hasNearMinute30, 'trigger must use nearMinute(30)');
});
