'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./harness');

function seedCalendarEvent(opts = {}) {
  return {
    id: opts.id || 'evt-conf-1',
    title: opts.title || 'Silvia Rossi',
    start: opts.start || new Date(2026, 9, 5, 14, 0, 0),
    color: opts.color || '',
    description: opts.description || '',
  };
}

test('generateConfirmationToken_: generates secure token and stores metadata', () => {
  const { ctx, state } = loadGas();
  const app = {
    id: 'evt-test-1',
    name: 'Silvia Rossi',
    firstName: 'Silvia',
    date: '05/10/2026',
    time: '14:00',
    number: '+39 347 111 2222',
  };

  const token = ctx.generateConfirmationToken_(app);
  assert.ok(token);
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 8);

  const stored = JSON.parse(state.props['CONFIRM_' + token]);
  assert.equal(stored.eventId, 'evt-test-1');
  assert.equal(stored.clientName, 'Silvia Rossi');
  assert.equal(stored.status, 'pending');

  // Reusing token for the same event
  const token2 = ctx.generateConfirmationToken_(app);
  assert.equal(token, token2);
});

test('getConfirmationUrl_: builds full URL with token parameter', () => {
  const { ctx } = loadGas({
    props: { WEBAPP_URL: 'https://script.google.com/macros/s/my-app/exec' },
  });
  const app = { id: 'evt-url-1', name: 'Laura Verdi', date: '05/10/2026', time: '10:00' };
  const url = ctx.getConfirmationUrl_(app);
  assert.ok(url.startsWith('https://script.google.com/macros/s/my-app/exec?token='));
});

test('submitClientConfirmation: confirms appointment and updates Calendar to [OK] PALE_GREEN', () => {
  const event = seedCalendarEvent({ id: 'evt-conf-10', title: 'Carla Neri' });
  const { ctx } = loadGas({
    events: [event],
    props: {
      CONFIRM_tok123: JSON.stringify({
        eventId: 'evt-conf-10',
        clientName: 'Carla Neri',
        firstName: 'Carla',
        date: '05/10/2026',
        time: '15:30',
        status: 'pending',
      }),
    },
  });

  const res = ctx.submitClientConfirmation('tok123', 'confirm');
  assert.equal(res.success, true);
  assert.equal(res.status, 'confirmed');
  assert.equal(res.clientName, 'Carla');

  // Calendar event updated
  const cal = ctx.CalendarApp.getDefaultCalendar();
  const updatedEvent = cal.getEventById('evt-conf-10');
  assert.equal(updatedEvent.getColor(), ctx.CalendarApp.EventColor.PALE_GREEN);
  assert.equal(updatedEvent.getTitle(), '[OK] Carla Neri');
});

test('submitClientConfirmation: reschedules appointment and updates Calendar to [SPOSTARE] PALE_RED', () => {
  const event = seedCalendarEvent({ id: 'evt-conf-20', title: 'Giulia Gialli' });
  const { ctx } = loadGas({
    events: [event],
    props: {
      CONFIRM_tok456: JSON.stringify({
        eventId: 'evt-conf-20',
        clientName: 'Giulia Gialli',
        firstName: 'Giulia',
        date: '05/10/2026',
        time: '16:00',
        status: 'pending',
      }),
    },
  });

  const res = ctx.submitClientConfirmation('tok456', 'reschedule');
  assert.equal(res.success, true);
  assert.equal(res.status, 'rescheduled');

  const cal = ctx.CalendarApp.getDefaultCalendar();
  const updatedEvent = cal.getEventById('evt-conf-20');
  assert.equal(updatedEvent.getColor(), ctx.CalendarApp.EventColor.PALE_RED);
  assert.equal(updatedEvent.getTitle(), '[SPOSTARE] Giulia Gialli');
});

test('submitClientConfirmation: blocks any subsequent vote (first vote is final)', () => {
  const event = seedCalendarEvent({ id: 'evt-conf-30', title: 'Anna Bruno' });
  const { ctx, state } = loadGas({
    events: [event],
    props: {
      CONFIRM_tok789: JSON.stringify({
        eventId: 'evt-conf-30',
        clientName: 'Anna Bruno',
        status: 'pending',
      }),
    },
  });

  // First vote: confirmed
  const res1 = ctx.submitClientConfirmation('tok789', 'confirm');
  assert.equal(res1.success, true);

  // Second vote: client tries to change answer to reschedule -> BLOCKED
  const res2 = ctx.submitClientConfirmation('tok789', 'reschedule');
  assert.equal(res2.success, false);
  assert.equal(res2.alreadyAnswered, true);
  assert.equal(res2.status, 'confirmed');

  // Calendar remains green [OK]
  const cal = ctx.CalendarApp.getDefaultCalendar();
  assert.equal(cal.getEventById('evt-conf-30').getColor(), ctx.CalendarApp.EventColor.PALE_GREEN);
  assert.equal(cal.getEventById('evt-conf-30').getTitle(), '[OK] Anna Bruno');
});

test('doGet: security gate blocks anonymous user from accessing Dashboard', () => {
  const { ctx } = loadGas({
    userEmail: '', // Anonymous user not logged into owner's account
  });

  const output = ctx.doGet({ parameter: {} });
  assert.ok(output.getContent().includes('Accesso Riservato'));
  assert.equal(output.getContent().includes('WhatsApp Reminder Dashboard'), false);
});

test('doGet: renders Dashboard when owner is logged in', () => {
  const { ctx } = loadGas({
    userEmail: 'owner@example.com',
  });

  const output = ctx.doGet({ parameter: {} });
  assert.ok(output.getContent().includes('Page'));
});

test('doGet: renders Dashboard with ?admin=secret key', () => {
  const { ctx } = loadGas({
    userEmail: '',
    props: { ADMIN_SECRET: 'super-admin-key' },
  });

  const output = ctx.doGet({ parameter: { admin: 'super-admin-key' } });
  assert.ok(output.getContent().includes('Page'));
});

test('doGet: blocks non-owner stranger when admin key is not provided', () => {
  const { ctx } = loadGas({
    userEmail: 'stranger@example.com',
    effectiveEmail: 'owner@example.com',
    props: { ADMIN_SECRET: 'super-admin-key' },
  });

  const output = ctx.doGet({ parameter: {} });
  assert.ok(output.getContent().includes('Accesso Riservato'));
});

test('doGet: renders confirmation interface when ?token=<token> is provided', () => {
  const { ctx } = loadGas({
    userEmail: '', // Even anonymous client can access their own confirmation token
    props: {
      CONFIRM_abc123: JSON.stringify({
        eventId: 'evt-conf-50',
        clientName: 'Chiara',
        date: '05/10/2026',
        time: '11:00',
        status: 'pending',
      }),
    },
  });

  const output = ctx.doGet({ parameter: { token: 'abc123' } });
  assert.ok(output.getContent().includes('Conferma Appuntamento'));
  assert.ok(output.getContent().includes('abc123'));
});

test('doGet: catches unexpected errors and renders error page without throwing', () => {
  const { ctx } = loadGas();
  ctx.renderConfirmationHtml_ = () => {
    throw new Error('Simulated failure');
  };
  const output = ctx.doGet({ parameter: { token: 'any-token' } });
  assert.ok(output.getContent().includes('Errore'));
  assert.ok(output.getContent().includes('Simulated failure'));
});

test('personalizeMessage: embeds 1-click confirmation link', () => {
  const { ctx } = loadGas();
  const template = 'Ciao %NOME%, appuntamento il %DATA% alle %ORE%.';
  const link = 'https://script.google.com/macros/s/app/exec?token=tok123';

  // 1. Automatic link append when not explicitly in template
  const msg1 = ctx.personalizeMessage(template, 'Maria', '05/10/2026', '15:00', link);
  assert.ok(msg1.includes('Maria'));
  assert.ok(msg1.includes('15:00'));
  assert.ok(msg1.includes(link));
  assert.ok(msg1.includes('1 clic'));

  // 2. Explicit %LINK% placeholder
  const templateWithPlaceholder = 'Ciao %NOME%! Clicca qui: %LINK%';
  const msg2 = ctx.personalizeMessage(templateWithPlaceholder, 'Giulia', '05/10/2026', '16:00', link);
  assert.equal(msg2, 'Ciao Giulia! Clicca qui: ' + link);
});

test('salon settings: getSalonSettings and saveSalonSettings', () => {
  const { ctx } = loadGas();
  const defaults = ctx.getSalonSettings();
  assert.equal(defaults.salonName, 'Appuntamenti');
  assert.equal(defaults.wahaSession, 'default');
  assert.equal(defaults.confirmationDays, 1);
  assert.equal(defaults.finalReminderEnabled, true);

  const res = ctx.saveSalonSettings({
    salonName: 'Centro Estetico Venere',
    salonLogoUrl: 'https://example.com/logo.png',
    wahaSession: 'studio_mario',
    confirmationDays: 3,
    confirmationLinksEnabled: true,
    finalReminderEnabled: true,
    finalReminderOnlyConfirmed: true,
    messageTemplateConfirmation: 'Nuovo template %LINK%',
    messageTemplateFinal: 'Promemoria finale'
  });

  assert.equal(res.success, true);
  const updated = ctx.getSalonSettings();
  assert.equal(updated.salonName, 'Centro Estetico Venere');
  assert.equal(updated.salonLogoUrl, 'https://example.com/logo.png');
  assert.equal(updated.wahaSession, 'studio_mario');
  assert.equal(updated.confirmationDays, 3);
  assert.equal(updated.finalReminderOnlyConfirmed, true);
  assert.equal(updated.messageTemplateConfirmation, 'Nuovo template %LINK%');
  assert.equal(updated.messageTemplateFinal, 'Promemoria finale');
});

test('calculateDateRange: handles in3days and numeric offsets', () => {
  const { ctx } = loadGas({ now: new Date(2026, 9, 4, 10, 0, 0) });
  const range3 = ctx.calculateDateRange('in3days');
  assert.equal(range3.startDate.getDate(), 7); // 4 + 3 = 7
  assert.equal(range3.endDate.getDate(), 8);

  const rangeNum = ctx.calculateDateRange(2);
  assert.equal(rangeNum.startDate.getDate(), 6); // 4 + 2 = 6
  assert.equal(rangeNum.endDate.getDate(), 7);
});

test('AutomaticSender: two-stage reminders (2 days before confirmation + tomorrow final)', () => {
  const now = new Date(2026, 9, 4, 9, 0, 0); // Sunday Oct 4
  // Event 1: Tomorrow (Oct 5) - should get final reminder (no link)
  const tomorrowEvent = {
    id: 'evt-tom-1',
    title: 'Marta Neri',
    start: new Date(2026, 9, 5, 10, 0, 0),
  };
  // Event 2: In 2 days (Oct 6) - should get confirmation link
  const twoDaysEvent = {
    id: 'evt-2days-2',
    title: 'Elisa Gialli',
    start: new Date(2026, 9, 6, 15, 0, 0),
  };

  const sheetsData = {
    CACHED_APPOINTMENTS_SHEET_NAME: [
      ['ID Evento', 'Nome', 'Telefono', 'Data', 'Ora'],
      ['evt-tom-1', 'Marta Neri', '+39 347 111 2222', '2026-10-05', '10:00'],
      ['evt-2days-2', 'Elisa Gialli', '+39 347 333 4444', '2026-10-06', '15:00'],
    ],
  };

  const { ctx, state } = loadGas({
    now,
    events: [tomorrowEvent, twoDaysEvent],
    sheets: sheetsData,
    props: {
      WEBHOOK_URL: 'https://waha.example.com',
      WEBHOOK_SECRET: 'test-secret',
      CONFIRMATION_DAYS_IN_ADVANCE: '2',
      FINAL_REMINDER_ENABLED: 'true',
      FINAL_REMINDER_ONLY_CONFIRMED: 'false',
    },
    fetchResponse: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }),
  });

  ctx.sendAutomaticReminders();

  const textFetches = state.fetches.filter((f) => f.url.endsWith('/api/sendText'));
  assert.equal(textFetches.length, 2, 'expected 2 text reminder messages');

  const payload2Days = JSON.parse(textFetches[0].options.payload);
  assert.equal(payload2Days.chatId, '393473334444@c.us');
  assert.ok(payload2Days.text.includes('?token='), 'expected confirmation link for 2-day advance event');
  assert.equal(payload2Days.linkPreview, false);

  const payloadTomorrow = JSON.parse(textFetches[1].options.payload);
  assert.equal(payloadTomorrow.chatId, '393471112222@c.us');
  assert.equal(payloadTomorrow.text.includes('?token='), false, 'expected no confirmation link in final reminder');
  assert.equal(payloadTomorrow.linkPreview, false);
});

test('shortenUrl_: returns short url when TinyURL succeeds', () => {
  const { ctx } = loadGas({
    fetchResponse: () => ({
      getResponseCode: () => 200,
      getContentText: () => 'https://tinyurl.com/abc1234',
    }),
  });
  const short = ctx.shortenUrl_('https://script.google.com/macros/s/xyz/exec?token=tok999');
  assert.equal(short, 'https://tinyurl.com/abc1234');
});

test('sendSingleReminderViaWaha: dual mode (confirm with link vs reminder without link)', () => {
  const now = new Date(2026, 9, 4, 10, 0, 0);
  const event = seedCalendarEvent({
    id: 'evt-manual-dual',
    title: 'Laura Blu',
    start: new Date(2026, 9, 5, 14, 0, 0),
  });

  const { ctx, state } = loadGas({
    now,
    events: [event],
    sheets: {
      CACHED_APPOINTMENTS_SHEET_NAME: [
        ['ID Evento', 'Nome', 'Telefono', 'Data', 'Ora'],
        ['evt-manual-dual', 'Laura Blu', '+39 347 555 6677', '2026-10-05', '14:00'],
      ],
    },
    props: {
      WEBHOOK_URL: 'https://waha.example.com',
      WEBHOOK_SECRET: 'test-secret',
      ENABLE_CONFIRMATION_LINKS: 'true',
    },
    fetchResponse: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }),
  });

  // 1. Invia 'confirm' (1-Click)
  const resConfirm = ctx.sendSingleReminderViaWaha('evt-manual-dual', 'confirm');
  assert.equal(resConfirm.success, true);
  assert.equal(resConfirm.type, 'confirm');

  // 2. Invia 'reminder' (Ricordo di cortesia)
  const resReminder = ctx.sendSingleReminderViaWaha('evt-manual-dual', 'reminder');
  assert.equal(resReminder.success, true);
  assert.equal(resReminder.type, 'reminder');

  const fetches = state.fetches.filter((f) => f.url.endsWith('/api/sendText'));
  assert.equal(fetches.length, 2);

  const payloadConfirm = JSON.parse(fetches[0].options.payload);
  assert.ok(payloadConfirm.text.includes('?token='));
  assert.equal(payloadConfirm.linkPreview, false);
  assert.equal(payloadConfirm.session, 'default');

  const payloadReminder = JSON.parse(fetches[1].options.payload);
  assert.equal(payloadReminder.text.includes('?token='), false);
  assert.equal(payloadReminder.linkPreview, false);
  assert.equal(payloadReminder.session, 'default');
});

test('getReminderDataForDay: flags confirmationLinksEnabled and finalReminderEnabled correctly', () => {
  const now = new Date(2026, 9, 4, 10, 0, 0);
  const event = seedCalendarEvent({
    id: 'evt-flags-test',
    title: 'Giulia Neri',
    start: new Date(2026, 9, 5, 15, 0, 0),
  });

  const { ctx } = loadGas({
    now,
    events: [event],
    sheets: {
      CACHED_APPOINTMENTS_SHEET_NAME: [
        ['ID Evento', 'Nome', 'Telefono', 'Data', 'Ora'],
        ['evt-flags-test', 'Giulia Neri', '+39 347 111 2233', '2026-10-05', '15:00'],
      ],
    },
    props: {
      ENABLE_CONFIRMATION_LINKS: 'false',
      FINAL_REMINDER_ENABLED: 'true',
    },
  });

  const data = ctx.getReminderDataForDay('tomorrow');
  assert.equal(data.length, 1);
  assert.equal(data[0].confirmationLinksEnabled, false);
  assert.equal(data[0].finalReminderEnabled, true);
});

