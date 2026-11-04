/**
 * Functional test for the scheme-list target country.
 *
 * Navigates test/fixtures/scheme-list.html through several stored countries and
 * asserts the panel line, the row outline and the TARGET badge. It also asserts
 * that Check and Fill do not navigate anywhere.
 *
 *   node test/cdp-scheme-list.mjs <port> <host> <url>
 */

const PORT = process.argv[2] || '9334';
const HOST = process.argv[3] || '127.0.0.1';
const URL_UNDER_TEST =
  process.argv[4] || 'http://127.0.0.1:8765/test/fixtures/scheme-list.html';

const BASE = `http://${HOST}:${PORT}`;
const PANEL = `document.getElementById('nzwhv-helper-host').shadowRoot`;

let nextId = 1;
let ws;
const pending = new Map();
const consoleErrors = [];
let passed = 0;
let failed = 0;

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
    awaitPromise: true
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

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected ${JSON.stringify(expected)}`);
    console.log(`      actual   ${JSON.stringify(actual)}`);
    failed += 1;
  } else {
    passed += 1;
  }
}

function truthy(name, value, detail) {
  const ok = !!value;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    if (detail) console.log(`      ${detail}`);
    failed += 1;
  } else {
    passed += 1;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function load(country) {
  const url = new URL(URL_UNDER_TEST);
  if (country !== null) url.searchParams.set('country', country);
  await send('Page.navigate', { url: url.href });
  await sleep(2600);
  const ready = await evalJS(`!!document.getElementById('nzwhv-helper-host')`);
  if (!ready) throw new Error(`panel did not load for ${url.href}`);
}

async function snapshot() {
  return evalJS(`(() => {
    const host = document.getElementById('nzwhv-helper-host');
    const root = host.shadowRoot;
    const rows = Array.from(document.querySelectorAll('.category-item')).map((row) => {
      const link = row.querySelector('a[href*="Create.aspx"]');
      const name = row.querySelector('[id*="countryName"]');
      return {
        country: name ? name.textContent.trim() : '',
        target: row.getAttribute('data-nzwhv-target') === '1',
        outline: row.style.outline || '',
        badges: Array.from(row.querySelectorAll('[data-nzwhv-badge]')).map((b) => b.textContent.trim())
      };
    });
    return {
      href: location.href,
      pageLine: root.getElementById('pageline').textContent.trim(),
      countryLine: root.getElementById('countryline').textContent.trim(),
      countryClass: root.getElementById('countryline').className,
      countryVisible: root.getElementById('countryline').style.display !== 'none',
      fillDisabled: root.getElementById('fillpage').disabled,
      checkDisabled: root.getElementById('checkpage').disabled,
      rows,
      report: root.getElementById('report').innerText.trim()
    };
  })()`);
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
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    consoleErrors.push(d.text + ' ' + (d.exception ? d.exception.description : ''));
  }
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

// 1. Default target: Belgium, open.
await load(null);
const be = await snapshot();

check('page line counts the schemes', be.pageLine, 'Scheme list — 4 countries');
check('country line names the target and status', be.countryLine, 'BELGIUM — OPEN · click Apply Now');
truthy('country line uses the open style', /\bopen\b/.test(be.countryClass), be.countryClass);
truthy('country line is visible', be.countryVisible);
truthy('fill stays available to explain the list', !be.fillDisabled);
truthy('check stays available to explain the list', !be.checkDisabled);

const beRow = be.rows.find((r) => r.country === 'BELGIUM');
const usRow = be.rows.find((r) => r.country === 'UNITED STATES OF AMERICA');
truthy('Belgium row is marked as the target', beRow && beRow.target);
truthy('Belgium row has a visible outline', beRow && beRow.outline !== '');
check('Belgium row has exactly one badge', beRow && beRow.badges, ['TARGET']);
truthy('other rows are not marked', usRow && !usRow.target && usRow.badges.length === 0);

// 2. Check and Fill must not navigate or click a scheme link.
const hrefBefore = be.href;
await evalJS(`${PANEL}.getElementById('checkpage').click()`);
await sleep(400);
const afterCheck = await snapshot();
check('Check leaves the URL alone', afterCheck.href, hrefBefore);
truthy(
  'Check explains the scheme list',
  /BELGIUM — OPEN/.test(afterCheck.report) && /not a form/i.test(afterCheck.report),
  afterCheck.report
);

await evalJS(`${PANEL}.getElementById('fillpage').click()`);
await sleep(400);
const afterFill = await snapshot();
check('Fill leaves the URL alone', afterFill.href, hrefBefore);

// 3. A different target moves the badge.
await load('THAILAND');
const th = await snapshot();
check('Thailand is detected', th.countryLine, 'THAILAND — CLOSED');
const thRow = th.rows.find((r) => r.country === 'THAILAND');
const beRow2 = th.rows.find((r) => r.country === 'BELGIUM');
truthy('Thailand row is marked', thRow && thRow.target);
check('Thailand row has the badge', thRow && thRow.badges, ['TARGET']);
truthy('Belgium is no longer marked', beRow2 && !beRow2.target && beRow2.badges.length === 0);

// 4. An open scheme uses the open style.
await load('UNITED KINGDOM');
const uk = await snapshot();
check('An open scheme is detected', uk.countryLine, 'UNITED KINGDOM — OPEN · click Apply Now');
truthy('open style is used', /\bopen\b/.test(uk.countryClass), uk.countryClass);

// 5. Common short forms work.
await load('UK');
const ukShort = await snapshot();
check('UK is treated as UNITED KINGDOM', ukShort.countryLine, 'UNITED KINGDOM — OPEN · click Apply Now');

await load('USA');
const usShort = await snapshot();
check(
  'USA is treated as UNITED STATES OF AMERICA',
  usShort.countryLine,
  'UNITED STATES OF AMERICA — CLOSED'
);

// 6. An unknown country is reported, not silently ignored.
await load('ATLANTIS');
const missing = await snapshot();
check('unknown country is reported', missing.countryLine, 'ATLANTIS — not on this list');
truthy('unknown country uses the warning style', /\bnone\b/.test(missing.countryClass), missing.countryClass);
truthy('unknown country has no badge', missing.rows.every((r) => r.badges.length === 0));

// 7. An empty target disables the highlight instead of guessing.
await load('');
const none = await snapshot();
check(
  'empty target is reported',
  none.countryLine,
  'No target country set — open the extension options'
);
truthy('empty target uses the warning style', /\bnone\b/.test(none.countryClass), none.countryClass);
truthy('empty target has no badge', none.rows.every((r) => r.badges.length === 0));

// 8. No page errors anywhere.
check('no console errors', consoleErrors, []);

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
