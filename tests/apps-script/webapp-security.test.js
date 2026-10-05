'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '../../apps-script/JavaScript.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Extract JS from inside <script> tags
const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(htmlContent);
if (!scriptMatch) {
  throw new Error('No <script> tag found in JavaScript.html');
}
const jsCode = scriptMatch[1];

function createWebAppContext() {
  const sandbox = {
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    google: { script: { run: {} } },
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout: () => {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(jsCode, ctx);
  return ctx;
}

test('escapeHtml: escapes HTML characters, quotes, and handles edge cases', () => {
  const ctx = createWebAppContext();
  assert.strictEqual(typeof ctx.escapeHtml, 'function', 'escapeHtml must be defined in web app script');

  assert.strictEqual(ctx.escapeHtml('Test <b>grassetto</b> & "x"'), 'Test &lt;b&gt;grassetto&lt;/b&gt; &amp; &quot;x&quot;');
  assert.strictEqual(ctx.escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.strictEqual(ctx.escapeHtml("it's a test"), 'it&#39;s a test');
  assert.strictEqual(ctx.escapeHtml(null), '');
  assert.strictEqual(ctx.escapeHtml(undefined), '');
  assert.strictEqual(ctx.escapeHtml(123), '123');
  assert.strictEqual(ctx.escapeHtml('Mario Rossi'), 'Mario Rossi');
});

test('JavaScript.html: uses escapeHtml on client data', () => {
  assert.match(htmlContent, /escapeHtml\(app\.name\)/);
  assert.match(htmlContent, /escapeHtml\(client\.name/);
  assert.match(htmlContent, /escapeHtml\(clientName\)/);
});
