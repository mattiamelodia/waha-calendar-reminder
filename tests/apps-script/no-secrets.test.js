'use strict';

// R1: no secrets or personal data in the Apps Script sources. Failures report only file, line and
// the first 4 characters of the match, never the full value.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'apps-script');
const PATTERNS = [
  { name: 'long hex string (key/secret)', re: /[0-9a-f]{32,}/i },
  { name: 'phone number 39XXXXXXXXXX', re: /\b39\d{10}\b/ },
];

function findings() {
  const out = [];
  for (const file of fs.readdirSync(DIR).sort()) {
    const full = path.join(DIR, file);
    if (!fs.statSync(full).isFile()) continue;
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      for (const { name, re } of PATTERNS) {
        const m = line.match(re);
        if (m) out.push(`${file}:${i + 1} ${name} starts with "${m[0].slice(0, 4)}…"`);
      }
    });
  }
  return out;
}

test('no secrets or phone numbers in apps-script/', () => {
  assert.deepStrictEqual(findings(), []);
});
