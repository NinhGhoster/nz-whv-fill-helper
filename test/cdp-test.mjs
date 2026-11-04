/**
 * Headless functional test for the fill helper.
 *
 * Usage: node test/cdp-test.mjs <port> <host> <url>
 *   node test/cdp-test.mjs 9334 [::1] http://127.0.0.1:8765/test/fixtures/form.html
 *
 * Drives Chrome over the DevTools protocol: focuses fields, sends Alt+V and
 * Alt+B, and asserts the resulting field values.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.argv[2] || '9334';
const HOST = process.argv[3] || '[::1]';
const URL_UNDER_TEST =
  process.argv[4] || 'http://127.0.0.1:8765/test/fixtures/form.html';

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

async function pressAlt(code, key, vk) {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    modifiers: 1,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: 1,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  });
  await sleep(120);
}

const results = [];
function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  results.push({ name, ok, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`));
}

function truthy(name, actual) {
  const ok = !!actual;
  results.push({ name, ok, actual, expected: true });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `  (got ${JSON.stringify(actual)})`));
}

async function main() {
  const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === 'page');
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
  await sleep(2200);

  // 1. panel injected
  const hasHost = await evalJS(`!!document.getElementById('nzwhv-helper-host')`);
  truthy('panel injected', hasHost);

  // reset the queue so the run starts from a known state
  await evalJS(
    `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('reset').click()`
  );
  await sleep(120);

  const hasShadow = await evalJS(
    `!!(document.getElementById('nzwhv-helper-host') && document.getElementById('nzwhv-helper-host').shadowRoot)`
  );
  truthy('shadow root present', hasShadow);

  const profileCount = await evalJS(
    `(() => { const h=document.getElementById('nzwhv-helper-host'); if(!h||!h.shadowRoot) return 'no host'; return h.shadowRoot.getElementById('count').textContent; })()`
  );
  console.log(`      queue shows: ${profileCount}`);
  truthy('queue loaded', /^1 \/ \d+/.test(profileCount));

  // 2. auto-fill by label on page 1
  await evalJS(
    `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('auto').click()`
  );
  await sleep(300);

  check('autofill family name', await evalJS(`document.getElementById('family').value`), 'EXAMPLE');
  check('autofill given name', await evalJS(`document.getElementById('given1').value`), 'TEST');
  check('autofill date of birth', await evalJS(`document.getElementById('dob').value`), '1990-01-01');
  check('autofill gender select', await evalJS(`document.getElementById('gender').value`), 'Female');
  check('autofill country select', await evalJS(`document.getElementById('country').value`), 'Belgium');
  check('autofill email', await evalJS(`document.getElementById('email').value`), 'you@example.com');

  // 3. keyboard shortcut: reset queue, focus a field, Alt+V
  await evalJS(
    `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('reset').click()`
  );
  await sleep(100);
  await evalJS(`document.getElementById('mobile').focus()`);
  await pressAlt('KeyV', 'v', 86);
  check('Alt+V typed queued value', await evalJS(`document.getElementById('mobile').value`), 'Ms');

  const cursorAfter = await evalJS(
    `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('count').textContent`
  );
  truthy('queue advanced after paste', /^2 \//.test(cursorAfter));

  // 4. bulk "No" on the health page
  await evalJS(`document.getElementById('next').click()`); // -> 2
  await evalJS(`document.getElementById('next').click()`); // -> 3
  await evalJS(`document.getElementById('next').click()`); // -> 4
  await sleep(150);

  await pressAlt('KeyB', 'b', 66);
  await sleep(200);

  const health = await evalJS(`(() => {
    const get = (n) => {
      const r = document.querySelector('input[name="' + n + '"]:checked');
      return r ? r.value : 'none';
    };
    return { h1:get('h1'), h2:get('h2'), h3:get('h3'), h4:get('h4'), h5:get('h5'), h6:get('h6'), h7:get('h7') };
  })()`);

  check('bulk set renal dialysis = No', health.h1, 'No');
  check('bulk set active TB = No', health.h2, 'No');
  check('bulk set cancer = No', health.h3, 'No');
  check('bulk set heart = No', health.h4, 'No');
  check('bulk left pregnancy alone', health.h6, 'none');
  check('bulk left TB-risk-country alone', health.h7, 'none');

  // 5. page 6: pre-answer the Yes questions, then bulk fills the rest
  await evalJS(`document.getElementById('next').click()`); // -> 5
  await evalJS(`document.getElementById('next').click()`); // -> 6
  await sleep(150);

  await evalJS(`
    const yes = (n) => document.querySelector('input[name="' + n + '"][value="Yes"]').click();
    yes('w2'); yes('w4'); yes('w5');
  `);
  await sleep(80);
  await pressAlt('KeyB', 'b', 66);
  await sleep(200);

  const whv = await evalJS(`(() => {
    const get = (n) => {
      const r = document.querySelector('input[name="' + n + '"]:checked');
      return r ? r.value : 'none';
    };
    return { w1:get('w1'), w2:get('w2'), w3:get('w3'), w4:get('w4'), w5:get('w5') };
  })()`);

  check('page6 previous visa = No', whv.w1, 'No');
  check('page6 funds stays Yes', whv.w2, 'Yes');
  check('page6 been to NZ = No', whv.w3, 'No');
  check('page6 outward ticket stays Yes', whv.w4, 'Yes');
  check('page6 requirements stays Yes', whv.w5, 'Yes');

  // 6. the extension must never click a submit button
  const submitClicked = await evalJS(`(() => {
    let clicked = false;
    const finish = document.getElementById('finish');
    if (finish) finish.addEventListener('click', () => { clicked = true; });
    document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('auto').click();
    document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('ordered').click();
    return clicked;
  })()`);
  check('no submit button clicked by helper', submitClicked, false);

  // 7. console errors
  const errors = logEntries.filter((e) => e.level === 'error');
  if (errors.length) {
    console.log('      console errors:');
    errors.forEach((e) => console.log('      - ' + (e.text || '').slice(0, 200)));
  }
  check('no console errors', errors.length, 0);

  // screenshot
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const shotPath = join(tmpdir(), 'nz-helper-test.png');
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
