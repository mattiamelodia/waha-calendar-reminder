'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./harness');

function seedCalendarEvent(opts = {}) {
  return {
    id: opts.id || 'evt-123',
    title: opts.title || 'Maria Rossi',
    start: opts.start || new Date(2026, 9, 5, 15, 30, 0),
    color: opts.color || '',
    description: opts.description || '',
  };
}

test('stripStatusPrefixes_: strips [OK], [SPOSTARE], [CONFERMATO], [ANNULLATO]', () => {
  const { ctx } = loadGas();
  assert.equal(ctx.stripStatusPrefixes_('[OK] Maria Rossi'), 'Maria Rossi');
  assert.equal(ctx.stripStatusPrefixes_('  [SPOSTARE]   Mario Verdi  '), 'Mario Verdi  ');
  assert.equal(ctx.stripStatusPrefixes_('[ok] Anna Bianchi'), 'Anna Bianchi');
  assert.equal(ctx.stripStatusPrefixes_('[confermato] Laura Neri'), 'Laura Neri');
  assert.equal(ctx.stripStatusPrefixes_('[ANNULLATO] Giulia Gialli'), 'Giulia Gialli');
  assert.equal(ctx.stripStatusPrefixes_('Maria Rossi'), 'Maria Rossi');
  assert.equal(ctx.stripStatusPrefixes_(''), '');
  assert.equal(ctx.stripStatusPrefixes_(null), '');
});

test('formatContactName cleans prefixes and trailing words cleanly', () => {
  const { ctx } = loadGas({
    props: { WORDS_TO_REMOVE: JSON.stringify(['refill', 'gel']) },
  });
  assert.equal(ctx.formatContactName('[OK] Maria Rossi'), 'Maria Rossi');
  assert.equal(ctx.formatContactName('[SPOSTARE] Maria Rossi refill'), 'Maria Rossi');
  assert.equal(ctx.formatContactName('[ok]   Chiara Verdi gel  '), 'Chiara Verdi');
});

test('confirmation link toggle: getConfirmationLinksEnabled / setConfirmationLinksEnabled', () => {
  const { ctx, state } = loadGas();
  // Default is true
  assert.equal(ctx.getConfirmationLinksEnabled(), true);
  assert.equal(ctx.getPollRemindersEnabled(), true);

  // Turn off
  assert.equal(ctx.setConfirmationLinksEnabled(false), false);
  assert.equal(state.props.ENABLE_CONFIRMATION_LINKS, 'false');
  assert.equal(ctx.getConfirmationLinksEnabled(), false);
  assert.equal(ctx.getPollRemindersEnabled(), false);

  // Turn on
  assert.equal(ctx.setConfirmationLinksEnabled(true), true);
  assert.equal(state.props.ENABLE_CONFIRMATION_LINKS, 'true');
  assert.equal(ctx.getConfirmationLinksEnabled(), true);
});

test('doPost: gracefully processes webhook events and returns JSON', () => {
  const { ctx } = loadGas();

  // Empty postData
  const emptyRes = JSON.parse(ctx.doPost(null).getContent());
  assert.equal(emptyRes.status, 'ignored');

  // Invalid JSON
  const invalidRes = JSON.parse(
    ctx.doPost({ postData: { contents: 'not-json' } }).getContent()
  );
  assert.equal(invalidRes.status, 'error');

  // Any webhook event
  const res = JSON.parse(
    ctx.doPost({
      postData: {
        contents: JSON.stringify({
          event: 'message.ack',
          payload: { id: 'msg-1' },
        }),
      },
    }).getContent()
  );
  assert.equal(res.status, 'received');
  assert.equal(res.event, 'message.ack');
});

test('AutomaticSender: includes confirmation link when ENABLE_CONFIRMATION_LINKS is true and omits when false', () => {
  const now = new Date(2026, 9, 4, 9, 0, 0);
  const tomorrowEvent = seedCalendarEvent({
    id: 'evt-auto-1',
    title: 'Elena Viola',
    start: new Date(2026, 9, 5, 10, 0, 0),
  });

  const sheetsData = {
    CACHED_APPOINTMENTS_SHEET_NAME: [
      ['ID Evento', 'Nome', 'Telefono', 'Data', 'Ora'],
      ['evt-auto-1', 'Elena Viola', '+39 347 111 2233', '2026-10-05', '10:00'],
    ],
  };

  // 1. With ENABLE_CONFIRMATION_LINKS = true
  const { ctx: ctxOn, state: stateOn } = loadGas({
    now,
    events: [tomorrowEvent],
    sheets: sheetsData,
    props: {
      WEBHOOK_URL: 'https://waha.example.com',
      WEBHOOK_SECRET: 'test-secret',
      ENABLE_CONFIRMATION_LINKS: 'true',
    },
    fetchResponse: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }),
  });

  ctxOn.sendAutomaticReminders();
  const textFetchOn = stateOn.fetches.find((f) => f.url.endsWith('/api/sendText'));
  assert.ok(textFetchOn, 'expected /api/sendText call');
  const payloadOn = JSON.parse(textFetchOn.options.payload);
  assert.ok(payloadOn.text.includes('?token='), 'expected confirmation link in message');

  // 2. With ENABLE_CONFIRMATION_LINKS = false
  const { ctx: ctxOff, state: stateOff } = loadGas({
    now,
    events: [tomorrowEvent],
    sheets: sheetsData,
    props: {
      WEBHOOK_URL: 'https://waha.example.com',
      WEBHOOK_SECRET: 'test-secret',
      ENABLE_CONFIRMATION_LINKS: 'false',
    },
    fetchResponse: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }),
  });

  ctxOff.sendAutomaticReminders();
  const textFetchOff = stateOff.fetches.find((f) => f.url.endsWith('/api/sendText'));
  assert.ok(textFetchOff, 'expected /api/sendText call');
  const payloadOff = JSON.parse(textFetchOff.options.payload);
  assert.equal(payloadOff.text.includes('?token='), false, 'expected no confirmation link when disabled');
});

test('sendSingleReminderViaWaha: manually sends text reminder without poll', () => {
  const now = new Date(2026, 9, 4, 9, 0, 0);
  const tomorrowEvent = seedCalendarEvent({
    id: 'evt-single-1',
    title: 'Silvia Marrone',
    start: new Date(2026, 9, 5, 11, 0, 0),
  });

  const { ctx, state } = loadGas({
    now,
    events: [tomorrowEvent],
    sheets: {
      CACHED_APPOINTMENTS_SHEET_NAME: [
        ['ID Evento', 'Nome', 'Telefono', 'Data', 'Ora'],
        ['evt-single-1', 'Silvia Marrone', '+39 347 999 8877', '2026-10-05', '11:00'],
      ],
    },
    props: {
      WEBHOOK_URL: 'https://waha.example.com',
      WEBHOOK_SECRET: 'test-secret',
      ENABLE_CONFIRMATION_LINKS: 'true',
    },
    fetchResponse: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }),
  });

  const res = ctx.sendSingleReminderViaWaha('evt-single-1');
  assert.equal(res.success, true);
  assert.equal(res.clientName, 'Silvia Marrone');
  assert.equal(res.number, '393479998877');

  const textFetch = state.fetches.find((f) => f.url.endsWith('/api/sendText'));
  assert.ok(textFetch, 'expected /api/sendText call');
  const pollFetch = state.fetches.find((f) => f.url.endsWith('/api/sendPoll'));
  assert.equal(pollFetch, undefined, 'no poll should be sent');
});
