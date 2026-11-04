/**
 * Checks that the unpacked extension actually injects on a page.
 * Usage: node test/inject-check.mjs <port> <host> <url>
 */

const PORT = process.argv[2] || '9222';
const HOST = process.argv[3] || '127.0.0.1';
const URL_UNDER_TEST = process.argv[4] || 'about:blank';
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

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
console.log('targets:');
for (const t of list) console.log(`  ${t.type.padEnd(15)} ${String(t.url).slice(0, 90)}`);

const page = list.find((t) => t.type === 'page');
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

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_UNDER_TEST });
await sleep(1500);

const injected = await evalJS(`!!document.getElementById('nzwhv-helper-host')`);
const href = await evalJS('location.href');
const hasShadow = await evalJS(
  `!!(document.getElementById('nzwhv-helper-host') && document.getElementById('nzwhv-helper-host').shadowRoot)`
);
const count = await evalJS(
  `(() => { const h=document.getElementById('nzwhv-helper-host'); return h && h.shadowRoot ? h.shadowRoot.getElementById('count').textContent : 'none'; })()`
);

console.log(`\nurl:      ${href}`);
console.log(`injected: ${injected}`);
console.log(`shadow:   ${hasShadow}`);
console.log(`queue:    ${count}`);

const sw = list.find((t) => t.type === 'service_worker');
if (sw) {
  const id = sw.url.split('/')[2];
  console.log(`extension id: ${id}`);
  console.log(`options url: chrome-extension://${id}/options.html`);
}

process.exit(injected && hasShadow ? 0 : 1);
