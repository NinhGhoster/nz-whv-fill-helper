/**
 * Evaluate a JS expression in the live Chrome page and print the result.
 *
 *   node test/cdp-eval.mjs 9333 "document.title"
 *   node test/cdp-eval.mjs 9333 --file some-script.js
 */

import { readFileSync } from 'node:fs';

const PORT = process.argv[2] || '9333';
const arg = process.argv[3] || 'document.title';
const isFile = arg === '--file';
const SOURCE = isFile ? readFileSync(process.argv[4], 'utf8') : arg;

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

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome://'));
if (!page) {
  console.error('no page target');
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

const r = await send('Runtime.evaluate', {
  expression: SOURCE,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true
});

if (r.exceptionDetails) {
  console.error('EXCEPTION:', r.exceptionDetails.text);
  if (r.exceptionDetails.exception) console.error(r.exceptionDetails.exception.description);
  process.exit(1);
}

const v = r.result.value;
console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
process.exit(0);
