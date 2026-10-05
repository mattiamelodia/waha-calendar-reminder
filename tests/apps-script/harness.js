'use strict';

/*
 * Node harness for the Google Apps Script project in apps-script/.
 *
 * loadGas(opts) = ONE script execution: it builds a fresh vm context (so module-level
 * caches start empty), installs fakes of the Google services, and loads every apps-script/*.js
 * (except test.js) into that context. To simulate a later execution, call loadGas again and pass
 * the previous state.sheets / state.props (and a new `now`); inputs are always copied.
 *
 * Known fidelity limits of the fakes (they pin current behaviour, they do not emulate Sheets):
 *  - cells hold exactly what the script wrote: NO date/number auto-parsing (a real sheet turns an appended
 *    'yyyy-MM-dd' string into a Date cell; to exercise code that tests `cell instanceof Date`, seed a Date in
 *    `opts.sheets` explicitly: it is re-created as the script's own Date), formulas are not evaluated
 *    (a formula cell reads back as its formula text), sort does not rewrite relative references;
 *  - ranges reject the shapes real Sheets rejects (row/col < 1, zero rows/columns) with Sheets' messages,
 *    and getDataRange() on an empty sheet is the 1x1 A1 range;
 *  - the whole sheets store is ONE spreadsheet: openById(any id) returns it, create() replaces it.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'Europe/Rome';

const GAS_DIR = process.env.GAS_DIR || path.resolve(__dirname, '..', '..', 'apps-script');
const EXCLUDED_FILES = new Set(['test.js']);
const SCRIPT_TIME_ZONE = 'Europe/Rome';

const DEFAULT_PROPS = {
  SHEET_ID: 'test-spreadsheet-id',
  ALL_CLIENTS_SHEET_NAME: 'Clienti',
  ALL_APPOINTMENTS_SHEET_NAME: 'Storico',
  CACHED_APPOINTMENTS_SHEET_NAME: 'CachePromemoria',
};

function defaultNow() {
  return new Date(2026, 9, 4, 10, 0, 0); // 2026-10-04 10:00 Europe/Rome
}

// Plain outer-realm copy of a 2D array (rows written by the script are context-realm arrays).
// Date cells are re-created as the script context's Date (`DateCtor`), so that `cell instanceof Date`
// is true inside the script, as it is for cells Sheets has parsed as dates.
function copyRows(rows, DateCtor = Date) {
  return Array.from(rows, (row) =>
    Array.from(row, (v) => (v instanceof Date ? new DateCtor(v.getTime()) : v))
  );
}

function colLettersToNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function formatDateTz(date, timeZone, format) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)) {
    parts[p.type] = p.value;
  }
  return format
    .replace(/yyyy/g, parts.year)
    .replace(/MM/g, parts.month)
    .replace(/dd/g, parts.day)
    .replace(/HH/g, parts.hour)
    .replace(/mm/g, parts.minute)
    .replace(/ss/g, parts.second);
}

function compareCells(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = a === null || a === undefined ? '' : String(a);
  const sb = b === null || b === undefined ? '' : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function loadGas(opts = {}) {
  const now = new Date(opts.now || defaultNow());

  // ---- Date frozen at `now` for zero-argument construction ----
  const nowMs = now.getTime();
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(nowMs);
      else super(...args);
    }
    static now() {
      return nowMs;
    }
  }

  const props = { ...DEFAULT_PROPS };
  for (const [k, v] of Object.entries(opts.props || {})) {
    if (v === null || v === undefined) delete props[k];
    else props[k] = String(v);
  }

  const sheets = {};
  for (const [name, rows] of Object.entries(opts.sheets || {})) sheets[name] = copyRows(rows, FakeDate);

  const events = (opts.events || []).map((e) => ({
    id: e.id,
    title: e.title,
    start: new Date(e.start),
    color: e.color || '',
    description: e.description || '',
  }));
  const contacts = (opts.contacts || []).map((c) => ({
    displayName: c.displayName,
    phones: (c.phones || []).map((p) => ({ ...p })),
  }));

  const state = {
    now,
    sheets,
    props,
    logs: [],
    gotify: [],
    fetches: [],
    peopleCalls: [],
    writes: 0,
    setValuesCalls: 0,
    openByIdCalls: 0,
    lock: { tryLockCalls: [], released: 0 },
    triggers: (opts.triggers || []).map((t) => ({ handler: t.handler })),
  };

  // ---- SpreadsheetApp ----
  function makeRange(sheetName, row, col, numRows, numCols) {
    if (row < 1) throw new Error('The row start index of the range must be at least 1.');
    if (col < 1) throw new Error('The column start index of the range must be at least 1.');
    if (numRows < 1) throw new Error('The number of rows in the range must be at least 1.');
    if (numCols < 1) throw new Error('The number of columns in the range must be at least 1.');
    const rows = () => state.sheets[sheetName];
    const read = (display) => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) {
          const v = (rows()[row - 1 + r] || [])[col - 1 + c];
          if (display) line.push(v === undefined || v === null ? '' : String(v));
          else line.push(v === undefined ? '' : v);
        }
        out.push(line);
      }
      return out;
    };
    const writeCell = (r, c, v) => {
      const grid = rows();
      while (grid.length < r) grid.push([]);
      const line = grid[r - 1];
      while (line.length < c) line.push('');
      line[c - 1] = v;
    };
    const range = {
      getValues: () => read(false),
      getDisplayValues: () => read(true),
      getNumRows: () => numRows,
      getNumColumns: () => numCols,
      setValues(values) {
        if (values.length !== numRows || (numRows > 0 && values[0].length !== numCols)) {
          throw new Error(
            `The data has ${values.length} rows and ${values[0] ? values[0].length : 0} columns, but the range has ${numRows} rows and ${numCols} columns.`
          );
        }
        state.setValuesCalls++;
        state.writes++;
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) writeCell(row + r, col + c, values[r][c]);
        }
        return range;
      },
      setValue(value) {
        state.writes++;
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) writeCell(row + r, col + c, value);
        }
        return range;
      },
      setFormula(formula) {
        state.writes++;
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) writeCell(row + r, col + c, formula);
        }
        return range;
      },
      sort(spec) {
        state.writes++;
        const specs = Array.isArray(spec) ? spec : [spec];
        const block = read(false).map((line, i) => ({ line, i }));
        block.sort((x, y) => {
          for (const s of specs) {
            const idx = (typeof s === 'number' ? s : s.column) - col;
            const asc = typeof s === 'number' ? true : s.ascending !== false;
            const cmp = compareCells(x.line[idx], y.line[idx]);
            if (cmp !== 0) return asc ? cmp : -cmp;
          }
          return x.i - y.i;
        });
        block.forEach(({ line }, r) => {
          line.forEach((v, c) => writeCell(row + r, col + c, v));
        });
        return range;
      },
    };
    return range;
  }

  function makeSheet(name) {
    const rows = () => state.sheets[name];
    const sheet = {
      getName: () => name,
      setName(newName) {
        const entries = Object.entries(state.sheets).map(([k, v]) => [k === name ? newName : k, v]);
        for (const k of Object.keys(state.sheets)) delete state.sheets[k];
        for (const [k, v] of entries) state.sheets[k] = v;
        name = newName;
        return sheet;
      },
      getLastRow: () => rows().length,
      getLastColumn: () => rows().reduce((m, r) => Math.max(m, r.length), 0),
      getRange(a, b, c, d) {
        if (typeof a === 'string') {
          const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a);
          if (!m) throw new Error(`Unsupported A1 notation in fake: ${a}`);
          const c1 = colLettersToNumber(m[1]);
          const r1 = Number(m[2]);
          const c2 = m[3] ? colLettersToNumber(m[3]) : c1;
          const r2 = m[4] ? Number(m[4]) : r1;
          return makeRange(name, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
        }
        return makeRange(name, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
      },
      getDataRange() {
        return makeRange(name, 1, 1, Math.max(1, sheet.getLastRow()), Math.max(1, sheet.getLastColumn()));
      },
      appendRow(values) {
        state.writes++;
        rows().push(Array.from(values));
        return sheet;
      },
      deleteRow(n) {
        state.writes++;
        rows().splice(n - 1, 1);
        return sheet;
      },
      clearContents() {
        state.writes++;
        rows().length = 0;
        return sheet;
      },
    };
    return sheet;
  }

  function makeSpreadsheet(id) {
    const ss = {
      getId: () => id,
      getSheetByName: (name) => (name in state.sheets ? makeSheet(name) : null),
      getActiveSheet: () => makeSheet(Object.keys(state.sheets)[0]),
      insertSheet(name) {
        state.writes++;
        if (name in state.sheets) throw new Error(`A sheet with the name "${name}" already exists.`);
        state.sheets[name] = [];
        return makeSheet(name);
      },
    };
    return ss;
  }

  const SpreadsheetApp = {
    openById(id) {
      state.openByIdCalls++;
      return makeSpreadsheet(id);
    },
    create() {
      for (const k of Object.keys(state.sheets)) delete state.sheets[k];
      state.sheets.Sheet1 = [];
      return makeSpreadsheet('created-spreadsheet-id');
    },
    flush() {},
  };

  // ---- PropertiesService ----
  const scriptProperties = {
    getProperty: (k) => (Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : null),
    setProperty(k, v) {
      state.props[k] = String(v);
      return scriptProperties;
    },
    deleteProperty(k) {
      delete state.props[k];
      return scriptProperties;
    },
    getProperties: () => ({ ...state.props }),
    getKeys: () => Object.keys(state.props),
  };
  const PropertiesService = { getScriptProperties: () => scriptProperties };

  // ---- CalendarApp ----
  const makeEvent = (e) => ({
    getId: () => e.id,
    getTitle: () => e.title,
    setTitle: (t) => { e.title = t; },
    getStartTime: () => new FakeDate(e.start.getTime()),
    getEndTime: () => new FakeDate(e.start.getTime() + 3600000),
    getColor: () => e.color || '',
    setColor: (c) => { e.color = c; },
    getDescription: () => e.description || '',
    setDescription: (d) => { e.description = d; },
  });
  const calendar = {
    getEvents(start, end) {
      return events
        .filter((e) => e.start.getTime() < end.getTime() && e.start.getTime() + 3600000 > start.getTime())
        .map(makeEvent);
    },
    getEventById(id) {
      const e = events.find((ev) => ev.id === id);
      return e ? makeEvent(e) : null;
    },
  };
  const CalendarApp = {
    getDefaultCalendar: () => calendar,
    getCalendarById: () => calendar,
    EventColor: {
      PALE_BLUE: '1',
      PALE_GREEN: '2',
      MAUVE: '3',
      PALE_RED: '4',
      YELLOW: '5',
      ORANGE: '6',
      CYAN: '7',
      GRAY: '8',
      BLUE: '9',
      GREEN: '10',
      RED: '11',
    },
  };

  // ---- ContentService ----
  const ContentService = {
    MimeType: {
      JSON: 'application/json',
      TEXT: 'text/plain',
    },
    createTextOutput(text) {
      return {
        _content: String(text || ''),
        _mimeType: 'text/plain',
        getContent() { return this._content; },
        setMimeType(m) { this._mimeType = m; return this; },
        getMimeType() { return this._mimeType; },
      };
    },
  };

  // ---- People API ----
  const People = {
    People: {
      searchContacts({ query, pageSize } = {}) {
        state.peopleCalls.push(query);
        const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return { results: [] };
        const results = contacts
          .filter((c) => {
            const words = c.displayName.toLowerCase().split(/\s+/);
            return tokens.every((t) => words.some((w) => w.includes(t)));
          })
          .slice(0, pageSize || 10)
          .map((c) => ({
            person: {
              names: [{ displayName: c.displayName }],
              phoneNumbers: c.phones.map((p) => (p.type === undefined ? { value: p.value } : { type: p.type, value: p.value })),
            },
          }));
        return { results };
      },
    },
  };

  // ---- CacheService ----
  const cacheStore = {};
  const scriptCache = {
    get(k) { return cacheStore[k] !== undefined ? cacheStore[k] : null; },
    put(k, v, ttl) { cacheStore[k] = String(v); },
    remove(k) { delete cacheStore[k]; },
    removeAll(keys) { keys.forEach((k) => delete cacheStore[k]); },
  };
  const CacheService = {
    getScriptCache: () => scriptCache,
    getUserCache: () => scriptCache,
    getDocumentCache: () => scriptCache,
  };

  // ---- LockService ----
  const lock = {
    tryLock(ms) {
      state.lock.tryLockCalls.push(ms);
      return !opts.lockBusy;
    },
    waitLock(ms) {
      state.lock.tryLockCalls.push(ms);
      if (opts.lockBusy) throw new Error('Lock timeout');
    },
    hasLock: () => !opts.lockBusy,
    releaseLock() {
      state.lock.released++;
    },
  };
  const LockService = { getScriptLock: () => lock, getUserLock: () => lock, getDocumentLock: () => lock };

  // ---- ScriptApp ----
  const ScriptApp = {
    getProjectTriggers: () =>
      state.triggers.map((entry) => ({ getHandlerFunction: () => entry.handler, entry })),
    deleteTrigger(trigger) {
      const i = state.triggers.indexOf(trigger.entry);
      if (i >= 0) state.triggers.splice(i, 1);
    },
    newTrigger(handler) {
      const spec = [];
      const builder = {
        timeBased: () => builder,
        atHour: (n) => (spec.push(['atHour', n]), builder),
        nearMinute: (n) => (spec.push(['nearMinute', n]), builder),
        everyDays: (n) => (spec.push(['everyDays', n]), builder),
        everyMinutes: (n) => (spec.push(['everyMinutes', n]), builder),
        create() {
          const entry = { handler };
          Object.defineProperty(entry, 'spec', { value: spec, enumerable: false });
          state.triggers.push(entry);
          return { getHandlerFunction: () => handler, entry };
        },
      };
      return builder;
    },
    getService: () => ({
      getUrl: () => 'https://script.google.com/macros/s/test-app-id/exec',
    }),
  };

  // ---- UrlFetchApp ----
  const UrlFetchApp = {
    fetch(url, options = {}) {
      state.fetches.push({ url, options });
      if (/\/message$/.test(url)) {
        const { title, message, priority } = JSON.parse(options.payload);
        state.gotify.push({ title, message, priority });
      }
      if (typeof opts.fetchResponse === 'function') {
        return opts.fetchResponse(url, options);
      }
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    },
  };

  // ---- HtmlService ----
  const HtmlService = {
    createTemplateFromFile(name) {
      const template = {
        _name: name,
        evaluate() {
          return {
            _title: '',
            _content: `<html>${name}</html>`,
            setTitle(t) { this._title = t; return this; },
            addMetaTag() { return this; },
            getContent() { return this._content; },
          };
        },
      };
      return template;
    },
    createHtmlOutputFromFile(name) {
      return {
        _content: `<!-- ${name} -->`,
        getContent() { return this._content; },
      };
    },
    createHtmlOutput(content) {
      return {
        _content: String(content || ''),
        _title: '',
        setTitle(t) { this._title = t; return this; },
        addMetaTag() { return this; },
        getContent() { return this._content; },
      };
    },
  };

  // ---- Utilities / Session / Logger ----
  let uuidCounter = 1000;
  const Utilities = {
    formatDate: (date, tz, format) => formatDateTz(date, tz || SCRIPT_TIME_ZONE, format),
    sleep() {},
    getUuid: () => `token-uuid-${++uuidCounter}`,
  };
  const Session = {
    getScriptTimeZone: () => SCRIPT_TIME_ZONE,
    getActiveUser: () => ({
      getEmail: () => (opts.userEmail !== undefined ? opts.userEmail : 'owner@example.com'),
    }),
    getEffectiveUser: () => ({
      getEmail: () => (opts.effectiveEmail !== undefined ? opts.effectiveEmail : 'owner@example.com'),
    }),
  };
  const Logger = { log: (msg) => state.logs.push(String(msg)) };

  const ctx = vm.createContext({
    Date: FakeDate,
    SpreadsheetApp,
    PropertiesService,
    CacheService,
    CalendarApp,
    People,
    LockService,
    ScriptApp,
    UrlFetchApp,
    ContentService,
    HtmlService,
    Utilities,
    Session,
    Logger,
  });

  const files = fs
    .readdirSync(GAS_DIR)
    .filter((f) => f.endsWith('.js') && !EXCLUDED_FILES.has(f))
    .sort();
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, file), 'utf8'), ctx, { filename: path.join(GAS_DIR, file) });
  }

  return { ctx, state };
}

module.exports = { loadGas };
