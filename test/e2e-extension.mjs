/**
 * End-to-end test of the unpacked extension: options page -> storage ->
 * content script -> fields.
 *
 * Usage: node test/e2e-extension.mjs <port> <host> <extensionId> <url>
 */

const PORT = process.argv[2] || '9222';
const HOST = process.argv[3] || '[::1]';
const EXT_ID = process.argv[4] || 'cmnkiadfipbfekmibfghlfkelphjffhk';
const URL_UNDER_TEST =
  process.argv[5] || 'http://127.0.0.1:8765/test/fixtures/form.html';
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
    awaitPromise: true,
    userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error(
      `${r.exceptionDetails.text} ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : ''}`
    );
  }
  return r.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

async function main() {
  const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

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

  // 1. options page loads
  await send('Page.navigate', { url: `chrome-extension://${EXT_ID}/options.html` });
  await sleep(1200);

  const title = await evalJS('document.title');
  if (title === `chrome-extension://${EXT_ID}/options.html`) {
    console.log(
      'SKIP  this Chrome build ignores --load-extension (branded Chrome does).\n' +
      '      Load the extension manually via chrome://extensions, then use\n' +
      '      test/fixtures/form.html to check it. The script logic itself is covered\n' +
      '      by test/cdp-test.mjs.'
    );
    process.exit(0);
  }
  check('options page loaded', title, 'NZ WHV Fill Helper — Options');

  // 2. save a profile through the real options UI
  const profile = [
    'Family name = TESTFAMILY',
    'Given name 1 = TESTGIVEN',
    'Date of birth = 1990-01-02',
    'Gender = Male',
    'Country = Belgium',
    'Email = e2e@example.com'
  ].join('\\n');

  await evalJS(`(() => {
    const ta = document.getElementById('profile');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(profile)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('save').click();
  })()`);

  await sleep(500);
  check('save reported success', await evalJS(`document.getElementById('status').textContent`), 'Saved 6 values');

  // 3. content script picks it up on the form page
  await send('Page.navigate', { url: URL_UNDER_TEST });
  await sleep(1600);

  check('real extension injected', await evalJS(`!!document.getElementById('nzwhv-helper-host')`), true);
  check(
    'extension, not harness, owns the page',
    await evalJS(`(() => {
      const h = document.getElementById('nzwhv-helper-host');
      return h.shadowRoot.getElementById('count').textContent;
    })()`),
    '1 / 6'
  );

  await evalJS(
    `document.getElementById('nzwhv-helper-host').shadowRoot.getElementById('auto').click()`
  );
  await sleep(400);

  check('profile flows to field', await evalJS(`document.getElementById('family').value`), 'TESTFAMILY');
  check('select flows to field', await evalJS(`document.getElementById('gender').value`), 'Male');

  // 4. no submit path
  const hasSubmitHook = await evalJS(
    `document.getElementById('nzwhv-helper-host').shadowRoot.innerHTML.toLowerCase().includes('submit your application')`
  );
  check('no submit UI in the panel', hasSubmitHook, false);

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
