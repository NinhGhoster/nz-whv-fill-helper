/**
 * Renders the fallback fixture at a realistic viewport and screenshots it.
 * Usage: node test/screenshot.mjs <port> <host> <out.png>
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.argv[2] || '9334';
const HOST = process.argv[3] || '127.0.0.1';
const OUT = process.argv[4] || join(tmpdir(), 'nz-helper.png');
const BASE = `http://${HOST}:${PORT}`;

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
    }, 15000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1400,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false
});

await send('Page.navigate', { url: 'http://127.0.0.1:8765/test/fixtures/form.html' });
await sleep(2500);

await send('Runtime.evaluate', {
  expression: `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('auto').click()`
});
await sleep(400);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('wrote', OUT);
process.exit(0);
