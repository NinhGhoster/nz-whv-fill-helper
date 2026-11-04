/**
 * Inject the real content script into the live INZ page and run one action.
 *
 *   node test/live-inject.mjs fill
 *   node test/live-inject.mjs check
 *
 * It stubs chrome.storage, loads rules.js then content.js into the page, and
 * clicks the panel button. It never clicks Next, Save or Submit.
 */

import { readFileSync } from 'node:fs';

const PORT = process.argv[2] || '9333';
const ACTION = process.argv[3] || 'check';
const BASE = `http://127.0.0.1:${PORT}`;

let nextId = 1;
let ws;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }
    }, 20000);
  });
}

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error(
      `${r.exceptionDetails.text} ${
        r.exceptionDetails.exception ? r.exceptionDetails.exception.description : ''
      }`
    );
  }
  return r.result.value;
}

const rules = readFileSync(new URL('../extension/rules.js', import.meta.url), 'utf8');
const content = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const page = list.find(
  (t) => t.type === 'page' && /immigration\.govt\.nz/.test(t.url)
);
if (!page) {
  console.error('no INZ page target');
  process.exit(2);
}

ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  }
});

await send('Runtime.enable');

if (await evalJS(`!!document.getElementById('nzwhv-helper-host')`)) {
  console.log('panel already present, reusing it');
} else {
  await evalJS(`
    (() => {
      window.chrome = window.chrome || {};
      window.chrome.storage = {
        local: {
          get: (keys, cb) => cb({ nzwhv_profile: '' }),
          set: (obj, cb) => cb && cb()
        }
      };
      window.chrome.runtime = {
        openOptionsPage: () => alert('stub')
      };
      return true;
    })()
  `);
  await evalJS(rules);
  await evalJS(content);
  await new Promise((r) => setTimeout(r, 600));
}

const injected = await evalJS(`!!document.getElementById('nzwhv-helper-host')`);
console.log('panel:', injected, '| url:', page.url);

const before = await evalJS(`(() => {
  const out = {};
  for (const el of document.querySelectorAll('input,select,textarea')) {
    if (!el.name) continue;
    const t = (el.type || '').toLowerCase();
    if (t === 'hidden' || t === 'submit') continue;
    out[el.name.split(':').pop()] = el.tagName === 'SELECT' || t === 'checkbox' ? el.value : el.value;
  }
  return out;
})()`);

await evalJS(
  `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('${
    ACTION === 'fill' ? 'fillpage' : 'checkpage'
  }').click()`
);
await new Promise((r) => setTimeout(r, 900));

const report = await evalJS(
  `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('report').innerText`
);
const pageLine = await evalJS(
  `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('pageline').innerText`
);

const after = await evalJS(`(() => {
  const out = {};
  for (const el of document.querySelectorAll('input,select,textarea')) {
    if (!el.name) continue;
    const t = (el.type || '').toLowerCase();
    if (t === 'hidden' || t === 'submit') continue;
    const short = el.name.split(':').pop();
    out[short] = { value: el.value, checked: el.checked };
  }
  return out;
})()`);

const display = await evalJS(`(() => {
  const out = {};
  for (const sel of document.querySelectorAll('select')) {
    const wrap = document.getElementById('s2id_' + sel.id);
    const chosen = wrap ? wrap.querySelector('.select2-chosen') : null;
    out[sel.name.split(':').pop()] = chosen ? chosen.innerText.trim() : '(no select2)';
  }
  return out;
})()`);

console.log('\npage line:', pageLine);
console.log('\nreport:\n' + report);

if (ACTION === 'fill') {
  console.log('\nfield values after fill:');
  for (const [k, v] of Object.entries(after)) {
    const changed = before[k] !== v.value;
    console.log(
      `  ${changed ? '*' : ' '} ${k.padEnd(34)} ${JSON.stringify(v.value).slice(0, 45)}` +
        (display[k] !== undefined ? `   shown: ${JSON.stringify(display[k]).slice(0, 30)}` : '')
    );
  }
}

process.exit(0);
