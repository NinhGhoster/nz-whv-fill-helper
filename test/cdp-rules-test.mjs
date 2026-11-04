/**
 * Functional test for the exact-name engine.
 *
 * Drives test/fixtures/exact-names.html, which is generated from
 * rules.example.json and therefore carries the same field names, select values
 * and page split as the real INZ application, with synthetic values.
 *
 *   node test/cdp-rules-test.mjs <port> <host> <url>
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.argv[2] || '9334';
const HOST = process.argv[3] || '127.0.0.1';
const URL_UNDER_TEST =
  process.argv[4] || 'http://127.0.0.1:8765/test/fixtures/exact-names.html';

const BASE = `http://${HOST}:${PORT}`;

let nextId = 1;
let ws;
const pending = new Map();
const logEntries = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 15000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error(
      `JS error: ${r.exceptionDetails.text} ${
        r.exceptionDetails.exception ? r.exceptionDetails.exception.description : ''
      }`
    );
  }
  return r.result.value;
}

const results = [];
function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  results.push({ name, ok, actual, expected });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
  );
}

function truthy(name, actual) {
  const ok = !!actual;
  results.push({ name, ok, actual, expected: true });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `  (got ${JSON.stringify(actual)})`));
}

const PANEL = `document.getElementById('nzwhv-helper-host').shadowRoot`;

async function clickPanel(id) {
  await evalJS(`${PANEL}.getElementById('${id}').click()`);
  await sleep(250);
}

async function reportText() {
  return evalJS(`${PANEL}.getElementById('report').innerText`);
}

/**
 * Reads the visible page's rules from the generated rules.js and returns the
 * expected value for each field.
 */
async function visibleRules() {
  return evalJS(`(() => {
    const rules = window.__NZWHV_RULES__.pages;
    const section = Array.from(document.querySelectorAll('section[data-step]'))
      .find((s) => !s.classList.contains('hide'));
    if (!section) return null;

    const names = new Set(
      Array.from(section.querySelectorAll('[name]')).map((el) => el.getAttribute('name'))
    );

    for (const [id, page] of Object.entries(rules)) {
      const mine = page.fields.filter((f) => names.has(f.name));
      if (mine.length && mine.length === names.size) {
        return { id, fields: mine };
      }
    }
    return null;
  })()`);
}

/**
 * Reads back what is actually in the visible page's fields.
 */
async function actualValues() {
  return evalJS(`(() => {
    const section = Array.from(document.querySelectorAll('section[data-step]'))
      .find((s) => !s.classList.contains('hide'));
    const out = {};
    for (const el of section.querySelectorAll('[name]')) {
      const n = el.getAttribute('name');
      if (el.tagName === 'SELECT') out[n] = el.value;
      else if (el.type === 'checkbox') out[n] = el.checked ? '1' : '0';
      else out[n] = el.value;
    }
    return out;
  })()`);
}

async function main() {
  const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome://'));
  if (!page) throw new Error('No page target found');

  ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true, promptText: '' }).catch(() => {});
    } else if (msg.method === 'Log.entryAdded') {
      logEntries.push(msg.params.entry);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  await send('Page.navigate', { url: URL_UNDER_TEST });
  await sleep(1800);

  truthy('panel injected', await evalJS(`!!document.getElementById('nzwhv-helper-host')`));
  truthy(
    'rules loaded',
    await evalJS(`!!(window.__NZWHV_RULES__ && window.__NZWHV_RULES__.pages)`)
  );

  const totalRules = await evalJS(
    `Object.values(window.__NZWHV_RULES__.pages).reduce((n,p)=>n+p.fields.length,0)`
  );
  check('52 rules loaded', totalRules, 52);

  const pages = await evalJS(`Object.keys(window.__NZWHV_RULES__.pages)`);
  console.log(`      pages: ${pages.join(', ')}`);

  for (let i = 0; i < pages.length; i++) {
    const visible = await visibleRules();
    if (!visible) {
      truthy(`page ${i + 1} rules located`, false);
      break;
    }

    const pageLine = await evalJS(`${PANEL}.getElementById('pageline').textContent`);
    check(
      `page ${i + 1} detected`,
      pageLine.trim(),
      `${visible.id} — ${visible.fields.length} field${visible.fields.length === 1 ? '' : 's'}`
    );

    // Check first: it must not type anything.
    const before = await actualValues();
    await clickPanel('checkpage');
    const checkReport = await reportText();
    truthy(
      `page ${i + 1} check reports full coverage`,
      checkReport.includes(`${visible.fields.length}/${visible.fields.length} ready`)
    );
    const after = await actualValues();
    check(
      `page ${i + 1} check typed nothing`,
      JSON.stringify(after),
      JSON.stringify(before)
    );

    // Then fill. The declaration page needs a second, deliberate click.
    await clickPanel('fillpage');
    if (visible.id === 'Submit') {
      await clickPanel('fillpage');
    }
    const fillReport = await reportText();
    truthy(
      `page ${i + 1} fill reports full coverage`,
      fillReport.includes(`filled ${visible.fields.length}/${visible.fields.length}`)
    );

    const actual = await actualValues();
    let bad = [];
    for (const f of visible.fields) {
      if (String(actual[f.name]) !== String(f.value)) {
        bad.push(`${f.name.split(':').pop()}=${actual[f.name]} want ${f.value}`);
      }
    }
    check(`page ${i + 1} all values correct`, bad.join(' | ') || 'ok', 'ok');

    if (i < pages.length - 1) {
      await evalJS(`document.getElementById('next').click()`);
      await sleep(1300);
    }
  }

  // Nothing outside the rules may be touched: the only buttons the helper
  // clicks are radio and checkbox inputs, and this page has no radios.
  const textInputs = await evalJS(
    `Array.from(document.querySelectorAll('input[type=text]')).filter(e => !e.value).length`
  );
  check('no empty text field left behind', textInputs, 0);

  const errors = logEntries.filter((e) => e.level === 'error');
  if (errors.length) errors.forEach((e) => console.log('      - ' + (e.text || '').slice(0, 160)));
  check('no console errors', errors.length, 0);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const shotPath = join(tmpdir(), 'nz-rules-test.png');
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(`      screenshot written to ${shotPath}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
