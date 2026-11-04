/*
 * NZ WHV Fill Helper — content script
 *
 * This script only writes values into form fields that you focus or that it can
 * match by label. It never clicks a button, never submits a form, and never
 * interacts with a CAPTCHA.
 *
 * The only .click() calls in this file are on radio and checkbox inputs, which
 * is required for the page's own JavaScript to register the selection.
 */
(() => {
  'use strict';

  if (window.__nzwhvHelper) return;
  window.__nzwhvHelper = true;

  // DOM marker visible to the page's own scripts, so the test harness
  // knows the real extension has taken over and does not inject a second copy.
  try {
    document.documentElement.setAttribute('data-nzwhv', 'on');
  } catch (e) {
    /* ignore */
  }

  const PROFILE_KEY = 'nzwhv_profile';
  const SKIP_KEY = 'nzwhv_skip';
  const CURSOR_KEY = 'nzwhv_cursor';
  const COUNTRY_KEY = 'nzwhv_country';

  const DEFAULT_SKIP =
    'tb risk|low risk for tb|pregnan|three month|3 month|five years prior|5 years prior|spent 3|spent three';

  const DEFAULT_COUNTRY = '';

  const state = {
    profile: [],
    cursor: 0,
    skipPattern: DEFAULT_SKIP,
    targetCountry: DEFAULT_COUNTRY,
    readOnly: false,
    collapsed: false,
    submitArmAt: 0
  };

  let host = null;
  let root = null;
  let ui = {};

  /* ------------------------------------------------------------------ */
  /* small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const textOf = (node) => (node ? (node.innerText || node.textContent || '').trim() : '');

  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const esc = (s) =>
    String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);

  const isVisible = (el) => {
    if (!el) return false;
    if (el.offsetParent === null && el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  const isFillable = (el) => {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return !el.disabled && !el.readOnly;
    if (tag !== 'INPUT') return false;
    if (el.disabled || el.readOnly) return false;
    const t = (el.type || 'text').toLowerCase();
    return ['text', 'email', 'tel', 'number', 'date', 'search', 'url', 'password'].includes(t);
  };

  const stripAnswers = (s) =>
    s
      .replace(/\b(yes|no)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  /* ------------------------------------------------------------------ */
  /* storage                                                             */
  /* ------------------------------------------------------------------ */

  function loadProfile(done) {
    try {
      chrome.storage.local.get([PROFILE_KEY, SKIP_KEY, COUNTRY_KEY], (res) => {
        state.profile = parseProfile(res[PROFILE_KEY] || '');
        state.skipPattern = res[SKIP_KEY] || DEFAULT_SKIP;
        state.targetCountry = String(res[COUNTRY_KEY] || DEFAULT_COUNTRY).trim();
        done();
      });
    } catch (e) {
      done();
    }
  }

  function parseProfile(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
      .map((line) => {
        const i = line.indexOf('=');
        if (i === -1) return null;
        return { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
      })
      .filter((x) => x && x.label);
  }

  function readCursor() {
    let raw = '0';
    try {
      raw = sessionStorage.getItem(CURSOR_KEY) || '0';
    } catch (e) {
      raw = '0';
    }
    const n = parseInt(raw, 10);
    state.cursor = Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function saveCursor() {
    try {
      sessionStorage.setItem(CURSOR_KEY, String(state.cursor));
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------------ */
  /* value writing                                                       */
  /* ------------------------------------------------------------------ */

  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function toISODate(v) {
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) {
      const d = m[1].padStart(2, '0');
      const mo = m[2].padStart(2, '0');
      return `${m[3]}-${mo}-${d}`;
    }
    m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return s;
  }

  function writeValue(el, value) {
    if (el.tagName === 'SELECT') {
      const want = norm(value);
      const opts = Array.from(el.options);
      let opt =
        opts.find((o) => norm(o.text) === want) ||
        opts.find((o) => norm(o.value) === want) ||
        opts.find((o) => norm(o.text).startsWith(want)) ||
        opts.find((o) => norm(o.text).includes(want));
      if (!opt) return false;
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      flash(el);
      return true;
    }

    const type = (el.type || '').toLowerCase();

    if (type === 'radio') {
      const want = norm(value);
      const group = el.name
        ? Array.from(document.querySelectorAll('input[type="radio"]')).filter(
            (r) => r.name === el.name
          )
        : [el];
      const target = group.find((r) => norm(radioText(r)) === want);
      if (!target) return false;
      target.click();
      flash(target);
      return true;
    }

    if (type === 'checkbox') {
      const on = /^(yes|true|1|on|checked|y)$/i.test(String(value).trim());
      if (el.checked !== on) el.click();
      flash(el);
      return true;
    }

    if (type === 'date') {
      setNativeValue(el, toISODate(value));
      flash(el);
      return true;
    }

    setNativeValue(el, String(value));
    flash(el);
    return true;
  }

  function flash(el) {
    const prev = el.style.outline;
    el.style.outline = '2px solid #1a7f37';
    el.style.outlineOffset = '1px';
    setTimeout(() => {
      el.style.outline = prev;
    }, 1400);
  }

  /* ------------------------------------------------------------------ */
  /* label extraction                                                    */
  /* ------------------------------------------------------------------ */

  function labelFor(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;

    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return textOf(l);
      } catch (e) {
        /* ignore */
      }
    }

    if (el.labels && el.labels.length) return textOf(el.labels[0]);

    const tr = el.closest('tr');
    if (tr) {
      const cells = Array.from(tr.querySelectorAll('td,th'));
      for (const c of cells) {
        if (!c.contains(el)) {
          const t = textOf(c);
          if (t) return t;
        }
      }
    }

    const fs = el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg) return textOf(lg);
    }

    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i++) {
      const prev = node.previousElementSibling;
      if (prev) {
        const t = textOf(prev);
        if (t && t.length < 140) return t;
      }
      node = node.parentElement;
    }

    return el.placeholder || el.name || '';
  }

  function radioText(el) {
    if (el.labels && el.labels.length) return textOf(el.labels[0]);
    const p = el.parentElement;
    if (p) {
      const t = textOf(p);
      if (t && t.length <= 40) return t;
    }
    if (el.nextSibling && el.nextSibling.nodeType === 3) {
      return (el.nextSibling.textContent || '').trim();
    }
    return el.value || '';
  }

  function questionText(el) {
    const fs = el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg && textOf(lg)) return textOf(lg);
    }

    const tr = el.closest('tr');
    if (tr) {
      const t = textOf(tr);
      if (t.length > 3 && t.length < 500) return stripAnswers(t);
    }

    const li = el.closest('li');
    if (li) {
      const t = textOf(li);
      if (t.length > 3 && t.length < 500) return stripAnswers(t);
    }

    let node = el.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      const t = textOf(node);
      if (t.length > 10 && t.length < 400) return stripAnswers(t);
      node = node.parentElement;
    }

    return '';
  }

  /* ------------------------------------------------------------------ */
  /* actions                                                             */
  /* ------------------------------------------------------------------ */

  function currentItem() {
    return state.profile[state.cursor] || null;
  }

  function pasteNext() {
    if (state.readOnly) return toast('Not active on this page');
    const item = currentItem();
    if (!item) return toast('Queue finished — nothing left');

    const el = document.activeElement;
    if (!isFillable(el)) return toast('Click into a field first, then press Alt+V');

    const ok = writeValue(el, item.value);
    if (!ok) return toast(`Could not match "${item.value}" in that field`);

    state.cursor += 1;
    saveCursor();
    render();
    toast(`Filled: ${item.label}`);
  }

  function step(delta) {
    state.cursor = Math.max(0, Math.min(state.cursor + delta, state.profile.length));
    saveCursor();
    render();
  }

  function resetCursor() {
    state.cursor = 0;
    saveCursor();
    render();
    toast('Queue reset to the beginning');
  }

  function bulkNo() {
    if (state.readOnly) return toast('Not active on this page');

    const groups = new Map();
    document.querySelectorAll('input[type="radio"]').forEach((r) => {
      if (!r.name) return;
      if (!groups.has(r.name)) groups.set(r.name, []);
      groups.get(r.name).push(r);
    });

    let filled = 0;
    const left = [];
    const seen = new Set();
    const skip = new RegExp(state.skipPattern, 'i');

    for (const radios of groups.values()) {
      if (radios.some((r) => r.checked)) continue;

      const q = questionText(radios[0]);
      if (!q) continue;

      const key = norm(q);
      if (seen.has(key)) continue;
      seen.add(key);

      if (skip.test(q)) {
        left.push(q);
        continue;
      }

      const target = radios.find((r) => norm(radioText(r)) === 'no');
      if (!target) {
        left.push(q);
        continue;
      }

      target.click();
      filled += 1;
    }

    const leftHtml = left.length
      ? `<div class="sub">Left for you (${left.length}):</div><ul>${left
          .slice(0, 10)
          .map((t) => `<li>${esc(t.slice(0, 150))}</li>`)
          .join('')}</ul>`
      : '';

    report(`<b>Bulk &quot;No&quot;:</b> ${filled} answered.${leftHtml}`);
  }

  function textFieldsInOrder(includeSelects = false) {
    const selector =
      'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"], input:not([type]), textarea' +
      (includeSelects ? ', select' : '');
    return Array.from(document.querySelectorAll(selector)).filter(
      (el) => isVisible(el) && isFillable(el) && !host.contains(el)
    );
  }

  function fillInOrder() {
    if (state.readOnly) return toast('Not active on this page');
    if (!state.profile.length) return toast('No profile loaded');

    const fields = textFieldsInOrder();
    const done = [];
    let i = state.cursor;

    for (const el of fields) {
      if (el.value && el.value.trim()) continue;
      while (i < state.profile.length && !state.profile[i].value) i += 1;
      if (i >= state.profile.length) break;
      const item = state.profile[i];
      if (writeValue(el, item.value)) {
        done.push([labelFor(el), item.value]);
        i += 1;
      }
    }

    state.cursor = i;
    saveCursor();
    render();

    if (!done.length) return report('Nothing filled. Fields may already have values.');

    report(
      `<b>Filled ${done.length} field(s):</b><ul>${done
        .map(([l, v]) => `<li>${esc(l.slice(0, 60))} &rarr; <code>${esc(v.slice(0, 40))}</code></li>`)
        .join('')}</ul><div class="sub">Check every one before you press Next.</div>`
    );
  }

  function autoFillByLabel() {
    if (state.readOnly) return toast('Not active on this page');
    if (!state.profile.length) return toast('No profile loaded');

    const fields = textFieldsInOrder(true);
    const used = new Set();
    const done = [];
    const missed = [];
    let highest = -1;

    const usedThisPage = new Set();

    for (const el of fields) {
      if (el.value && el.value.trim()) continue;

      const fieldLabel = norm(labelFor(el));
      if (!fieldLabel) {
        missed.push('(unlabelled field)');
        continue;
      }
      if (usedThisPage.has(fieldLabel)) continue;

      let best = null;
      let bestScore = 0;
      const reuse = /re.?enter|confirm|repeat/.test(fieldLabel);

      state.profile.forEach((item, idx) => {
        if (!item.value) return;
        if (used.has(idx) && !reuse) return;
        const pl = norm(item.label);
        if (!pl) return;

        let score = 0;
        if (pl === fieldLabel) score = 100;
        else if (fieldLabel.includes(pl) && pl.length >= 4) score = 70;
        else if (pl.includes(fieldLabel) && fieldLabel.length >= 4) score = 50;

        if (score > bestScore) {
          bestScore = score;
          best = { item, idx };
        }
      });

      if (best && bestScore >= 50) {
        if (writeValue(el, best.item.value)) {
          used.add(best.idx);
          usedThisPage.add(fieldLabel);
          if (best.idx > highest) highest = best.idx;
          done.push([labelFor(el), best.item.label, best.item.value]);
        }
      } else {
        missed.push(labelFor(el) || '(unlabelled field)');
      }
    }

    if (!done.length && !missed.length) return report('No empty text fields on this page.');

    if (highest >= 0 && highest + 1 > state.cursor) {
      state.cursor = highest + 1;
      saveCursor();
      render();
    }

    const doneHtml = done.length
      ? `<b>Filled ${done.length}:</b><ul>${done
          .map(
            ([l, src, v]) =>
              `<li>${esc(l.slice(0, 55))} &larr; <span class="sub">${esc(
                src.slice(0, 45)
              )}</span> = <code>${esc(v.slice(0, 35))}</code></li>`
          )
          .join('')}</ul>`
      : '';

    const missHtml = missed.length
      ? `<div class="sub">Not matched (${missed.length}) — use Alt+V:</div><ul>${missed
          .slice(0, 8)
          .map((m) => `<li>${esc(m.slice(0, 70))}</li>`)
          .join('')}</ul>`
      : '';

    report(doneHtml + missHtml + '<div class="sub">Review before pressing Next.</div>');
  }

  /* ------------------------------------------------------------------ */
  /* exact-name rules — generated from the exported autofill profile      */
  /* ------------------------------------------------------------------ */

  const RULES = (() => {
    try {
      return (window.__NZWHV_RULES__ && window.__NZWHV_RULES__.pages) || {};
    } catch (e) {
      return {};
    }
  })();

  // Wizard pages that exist but carry no rules. Without this the panel looks
  // broken on them; they are simply optional.
  const OPTIONAL_PAGES = {
    personal3: 'Occupation details — optional. Click Next.'
  };

  function pageBase() {
    return (location.pathname.split('/').pop() || '')
      .toLowerCase()
      .replace(/\.aspx$/, '');
  }

  function optionalNote() {
    return OPTIONAL_PAGES[pageBase()] || '';
  }

  // The scheme list is the one page where the danger is not speed but the
  // wrong row: every country keeps a Create.aspx link, closed ones included.
  const COUNTRY_ALIASES = {
    UK: 'UNITED KINGDOM',
    US: 'UNITED STATES OF AMERICA',
    USA: 'UNITED STATES OF AMERICA',
    'UNITED STATES': 'UNITED STATES OF AMERICA',
    KOREA: 'SOUTH KOREA',
    'HONG KONG': 'HONG KONG SAR'
  };

  function schemeListInfo() {
    let links = [];
    try {
      links = Array.from(document.querySelectorAll('a[href*="Create.aspx"]'));
    } catch (e) {
      return null;
    }
    if (!links.length) return null;

    const items = links
      .map((link) => {
        const nameEl = link.querySelector('[id*="countryName"]');
        const statusEl = link.querySelector('[id*="countryStatus"]');
        const country =
          textOf(nameEl) || textOf(link).replace(/\s*(OPEN|CLOSED)\s*$/i, '').trim();
        const rawStatus = textOf(statusEl) || textOf(link);
        const idMatch = (link.getAttribute('href') || '').match(/[?&]CountryId=(\d+)/i);
        return {
          country,
          status: /open/i.test(rawStatus) ? 'OPEN' : 'CLOSED',
          countryId: idMatch ? idMatch[1] : '',
          link,
          row: link.closest('.category-item') || link.parentElement || link
        };
      })
      .filter((i) => i.country && i.row.classList && i.row.classList.contains('category-item'));

    // One "create" link can appear elsewhere in the account. The scheme list is
    // the only page with a whole grid of them.
    if (items.length < 3) return null;

    const typed = String(state.targetCountry || '').trim();
    const want = norm(COUNTRY_ALIASES[typed.toUpperCase()] || typed);
    const wantKey = want.replace(/\s+/g, '');
    let match =
      items.find((i) => norm(i.country).replace(/\s+/g, '') === wantKey) || null;

    if (!match && want) {
      const partial = items.filter((i) => {
        const n = norm(i.country);
        return n.includes(want) || want.includes(n);
      });
      if (partial.length === 1) match = partial[0];
    }

    return {
      items,
      match,
      want,
      open: items.filter((i) => i.status === 'OPEN').length
    };
  }

  function markSchemeTarget(info) {
    const m = info && info.match;
    if (!m) return;

    m.row.setAttribute('data-nzwhv-target', '1');
    m.row.style.outline = '3px solid #12325c';
    m.row.style.outlineOffset = '-1px';
    m.row.style.borderRadius = '6px';

    const nameEl = m.link.querySelector('[id*="countryName"]');
    const holder = nameEl ? nameEl.parentElement : null;
    if (holder && !holder.querySelector('[data-nzwhv-badge]')) {
      const badge = document.createElement('span');
      badge.setAttribute('data-nzwhv-badge', '1');
      badge.textContent = 'TARGET';
      badge.style.cssText = [
        'display:inline-block',
        'margin-left:6px',
        'padding:1px 5px',
        'border-radius:3px',
        'background:#12325c',
        'color:#fff',
        'font:600 9.5px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
        'letter-spacing:.05em',
        'vertical-align:middle'
      ].join(';');
      nameEl.insertAdjacentElement('afterend', badge);
    }

    if (m.row.getAttribute('data-nzwhv-scrolled') === '1') return;
    const r = m.row.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;
    m.row.setAttribute('data-nzwhv-scrolled', '1');
    try {
      m.row.scrollIntoView({ block: 'center' });
    } catch (e) {
      /* ignore */
    }
  }

  function schemeNote(info) {
    info = info || schemeListInfo();
    if (!info) return '';
    if (!info.match) {
      const target = String(state.targetCountry || '').trim();
      return target
        ? `<b>${esc(target)} is not on this list.</b><div class="sub">Check the spelling in the extension options.</div>`
        : '<b>No target country set.</b><div class="sub">Open the extension options and enter the country name exactly as it appears on this list.</div>';
    }
    return `<b>${esc(info.match.country)} — ${esc(
      info.match.status
    )}</b><div class="sub">This is the scheme list, not a form. Click the row yourself.</div>`;
  }

  function ruleCount() {
    return Object.values(RULES).reduce((n, p) => n + p.fields.length, 0);
  }

  function findByRuleName(name) {
    const byName = Array.from(document.getElementsByName(name) || []);
    if (byName.length) return byName.find(isVisible) || byName[0];

    // Some ASP.NET builds render the id with underscores where the name has
    // colons. Try that, then a quoted attribute lookup.
    const byId = document.getElementById(name.replace(/:/g, '_'));
    if (byId) return byId;

    try {
      return document.querySelector(`[id="${name}"]`);
    } catch (e) {
      return null;
    }
  }

  function optionFor(select, value) {
    const want = String(value);
    const opts = Array.from(select.options || []);
    return (
      opts.find((o) => o.value === want) ||
      opts.find((o) => norm(o.value) === norm(want)) ||
      opts.find((o) => norm(o.text) === norm(want)) ||
      null
    );
  }

  function detectPage() {
    const entries = Object.entries(RULES);
    if (!entries.length) return null;

    const base = pageBase();

    // 1. exact file name, e.g. Personal1.aspx
    for (const [id, page] of entries) {
      const file = (page.file || '').toLowerCase().replace(/\.aspx$/, '');
      if (base && file && base === file) return { id, page, how: 'url' };
    }

    // 2. the payment form lives outside /WorkingHoliday/
    if (/onlinepayment|payment/.test(base)) {
      const hit = entries.find(([id]) => id === 'Payment');
      if (hit) return { id: hit[0], page: hit[1], how: 'url' };
    }

    // 3. score each page by how many of its field names are present *and
    //    visible* — the real wizard shows one page at a time, but a fixture
    //    page may keep the others in the DOM behind display:none.
    let best = null;
    for (const [id, page] of entries) {
      const present = page.fields.filter((f) => {
        const el = findByRuleName(f.name);
        return el && isVisible(el);
      }).length;
      if (!present) continue;
      const score = present / page.fields.length;
      if (!best || score > best.score) {
        best = { id, page, how: 'dom', score, present };
      }
    }
    return best && best.score >= 0.5 ? best : null;
  }

  function checkPage() {
    const det = detectPage();
    if (!det) {
      const scheme = schemeListInfo();
      if (scheme) {
        report(schemeNote(scheme));
        return toast('No form on the scheme list');
      }
      const note = optionalNote();
      if (note) {
        report(`<b>${esc(note)}</b>`);
        return toast('Optional page — nothing to fill');
      }
      if (!ruleCount()) {
        report(
          '<b>No rules loaded.</b><div class="sub">Generate <code>extension/rules.js</code> from your own export: <code>python3 tools/build-rules.py your-export.csv</code>, then reload the extension.</div>'
        );
        return toast('No rules loaded');
      }
      report(
        `<b>No rule set for this page.</b><div class="sub">${ruleCount()} fields are loaded for ${Object.keys(
          RULES
        ).length} pages, but none of them exist here. Use Alt+V for single values.</div>`
      );
      return toast('No rules match this page');
    }

    const rows = det.page.fields.map((f) => {
      const el = findByRuleName(f.name);
      if (!el) return { f, ok: false, why: 'field not found' };
      if (el.tagName === 'SELECT') {
        const opt = optionFor(el, f.value);
        return { f, ok: !!opt, why: opt ? 'option "' + f.value + '"' : 'no option "' + f.value + '"' };
      }
      if ((el.type || '').toLowerCase() === 'checkbox') {
        return { f, ok: true, why: el.checked ? 'already ticked' : 'checkbox' };
      }
      return { f, ok: true, why: el.value ? 'has value' : 'empty, will type' };
    });

    const bad = rows.filter((r) => !r.ok);
    const good = rows.length - bad.length;

    report(
      `<b>${det.id}: ${good}/${rows.length} ready</b>` +
        `<div class="sub">matched by ${det.how} · nothing was typed</div>` +
        (bad.length
          ? `<ul>${bad
              .map(
                (r) =>
                  `<li>${esc(r.f.name.split(':').pop())} — ${esc(r.why)}</li>`
              )
              .join('')}</ul>`
          : '<div class="sub">Every rule name and dropdown value exists on this page.</div>')
    );

    toast(`${good}/${rows.length} ready`);
    return det;
  }

  function fillPage() {
    const det = detectPage();
    if (!det) {
      const scheme = schemeListInfo();
      if (scheme) {
        report(schemeNote(scheme));
        return toast('No form on the scheme list');
      }
      const note = optionalNote();
      if (note) {
        report(`<b>${esc(note)}</b>`);
        return toast('Optional page — just click Next');
      }
      if (!ruleCount()) {
        report(
          '<b>No rules loaded.</b><div class="sub">Generate <code>extension/rules.js</code> from your own export: <code>python3 tools/build-rules.py your-export.csv</code>, then reload the extension.</div>'
        );
        return toast('No rules loaded');
      }
      report(
        '<b>No rule set for this page.</b><div class="sub">Nothing was typed. Use Alt+V for single values.</div>'
      );
      return toast('No rules match this page');
    }

    if (det.id === 'Submit') {
      const armed = state.submitArmAt && Date.now() - state.submitArmAt < 8000;
      if (!armed) {
        state.submitArmAt = Date.now();
        report(
          `<b>Legal declaration page.</b><div class="sub">Ticking all ${det.page.fields.length} boxes is your statement that each one is true.</div>` +
            '<div class="sub">Click Fill page again within 8 seconds to tick them.</div>'
        );
        return toast('Click Fill page again to tick the declarations');
      }
      state.submitArmAt = 0;
    }

    const done = [];
    const failed = [];

    for (const f of det.page.fields) {
      const el = findByRuleName(f.name);
      if (!el) {
        failed.push([f, 'field not found']);
        continue;
      }

      try {
        if (f.type === 'select') {
          const opt = optionFor(el, f.value);
          if (!opt) {
            failed.push([f, `no option "${f.value}"`]);
            continue;
          }
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          flash(el);
          done.push(f);
        } else if (f.type === 'checkbox') {
          if (!el.checked) el.click();
          flash(el);
          done.push(f);
        } else {
          setNativeValue(el, f.value);
          flash(el);
          done.push(f);
        }
      } catch (e) {
        failed.push([f, String((e && e.message) || e)]);
      }
    }

    report(
      `<b>${det.id}: filled ${done.length}/${det.page.fields.length}</b>` +
        (failed.length
          ? `<div class="sub">Not filled (${failed.length}):</div><ul>${failed
              .map(
                ([f, why]) =>
                  `<li>${esc(f.name.split(':').pop())} — ${esc(why)}</li>`
              )
              .join('')}</ul>`
          : '<div class="sub">Every rule on this page matched.</div>') +
        '<div class="sub">Check the fields, then you press Next.</div>'
    );

    toast(`Filled ${done.length}/${det.page.fields.length}`);
  }

  /* ------------------------------------------------------------------ */
  /* panel                                                               */
  /* ------------------------------------------------------------------ */

  function toast(msg) {
    if (!ui.toastEl) return;
    ui.toastEl.textContent = msg;
    ui.toastEl.classList.add('on');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => ui.toastEl.classList.remove('on'), 2600);
  }

  function report(html) {
    if (!ui.reportEl) return;
    ui.reportEl.innerHTML = html;
    ui.reportEl.scrollTop = 0;
  }

  function updateCountryLine(info) {
    if (!ui.countryLine) return;

    if (!info) {
      ui.countryLine.style.display = 'none';
      return;
    }

    ui.countryLine.style.display = 'block';

    if (!info.match) {
      const target = String(state.targetCountry || '').trim();
      ui.countryLine.className = 'countryline none';
      ui.countryLine.textContent = target
        ? `${target} — not on this list`
        : 'No target country set — open the extension options';
      return;
    }

    const m = info.match;
    ui.countryLine.className = `countryline ${m.status === 'OPEN' ? 'open' : 'closed'}`;
    ui.countryLine.textContent =
      m.status === 'OPEN'
        ? `${m.country} — OPEN · click Apply Now`
        : `${m.country} — CLOSED`;
  }

  function updatePageLine() {
    if (!ui.pageLine) return;

    const scheme = schemeListInfo();
    updateCountryLine(scheme);

    if (scheme) {
      const text = `Scheme list — ${scheme.items.length} countries`;
      if (ui.pageLine.textContent !== text) ui.pageLine.textContent = text;
      ui.pageLine.classList.remove('off');
      ui.fillBtn.disabled = false;
      ui.checkBtn.disabled = false;
      markSchemeTarget(scheme);
      return;
    }

    const det = detectPage();
    let text;
    if (det) {
      text = `${det.id} — ${det.page.fields.length} field${
        det.page.fields.length === 1 ? '' : 's'
      }`;
      ui.pageLine.classList.remove('off');
      ui.fillBtn.disabled = false;
      ui.checkBtn.disabled = false;
    } else {
      const note = optionalNote();
      text = note
        ? note
        : Object.keys(RULES).length
          ? 'No rule set for this page'
          : 'No rules loaded — run tools/build-rules.py';
      ui.pageLine.classList.add('off');
      ui.fillBtn.disabled = true;
      ui.checkBtn.disabled = true;
    }

    if (ui.pageLine.textContent !== text) ui.pageLine.textContent = text;
  }

  function render() {
    if (!ui.count) return;

    updatePageLine();

    const total = state.profile.length;
    ui.count.textContent = total ? `${Math.min(state.cursor + 1, total)} / ${total}` : 'fallback queue off';

    const item = currentItem();
    ui.labelEl.textContent = item ? item.label : total ? 'Queue finished' : 'Alt+F works without it';
    ui.valueEl.textContent = item ? item.value || '(empty)' : '—';

    ui.prev.disabled = state.cursor <= 0;
    ui.next.disabled = !item;
    ui.skip.disabled = !item;

    ui.next.textContent = 'Paste';
    ui.next.appendChild(kbd('Alt+V'));
    ui.bulkBtn.textContent = 'Bulk "No"';
    ui.bulkBtn.appendChild(kbd('Alt+B'));

    if (state.readOnly) {
      ui.banner.style.display = 'block';
    }
  }

  function kbd(text) {
    const k = document.createElement('kbd');
    k.textContent = text;
    return k;
  }

  function buildPanel() {
    host = document.createElement('div');
    host.id = 'nzwhv-helper-host';
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.top = '70px';
    host.style.right = '16px';
    host.style.zIndex = '2147483647';
    root = host.attachShadow({ mode: 'open' });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        .panel {
          width: 300px; background: #ffffff; color: #16181d;
          border: 1px solid #c9ced6; border-radius: 10px;
          box-shadow: 0 12px 32px rgba(0,0,0,.18);
          font-size: 13px; line-height: 1.35; overflow: hidden;
        }
        .hd {
          display: flex; align-items: center; gap: 8px;
          padding: 9px 11px; background: #12325c; color: #fff;
          font-weight: 600; font-size: 13px;
        }
        .hd .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
        .hd .sp { flex: 1; }
        .mini {
          background: rgba(255,255,255,.14); color: #fff; border: 0;
          width: 22px; height: 22px; border-radius: 5px; cursor: pointer;
          font-size: 14px; line-height: 1;
        }
        .body { padding: 11px; }
        .panel.collapsed .body { display: none; }
        .banner {
          display: none; background: #fef3c7; border: 1px solid #f0c36d;
          color: #6b4a00; padding: 7px 9px; border-radius: 6px;
          margin-bottom: 9px; font-size: 12px;
        }
        .count { font-size: 11px; color: #5b6472; letter-spacing: .02em; }
        .label { font-weight: 600; margin-top: 3px; font-size: 13px; }
        .value {
          margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px; color: #12325c; background: #f2f5fa;
          padding: 5px 7px; border-radius: 5px; word-break: break-all;
          min-height: 27px;
        }
        .row { display: flex; gap: 6px; margin-top: 8px; }
        button {
          flex: 1; padding: 7px 8px; border-radius: 6px; cursor: pointer;
          border: 1px solid #c9ced6; background: #fff; color: #16181d;
          font-size: 12.5px; font-weight: 500; display: inline-flex;
          align-items: center; justify-content: center; gap: 5px;
        }
        button:hover:not(:disabled) { background: #f2f5fa; }
        button:disabled { opacity: .45; cursor: default; }
        button.primary { background: #12325c; color: #fff; border-color: #12325c; }
        button.primary:hover:not(:disabled) { background: #1a4375; }
        kbd {
          font-family: ui-monospace, Menlo, monospace; font-size: 10px;
          background: rgba(0,0,0,.08); border-radius: 3px; padding: 1px 4px;
        }
        button.primary kbd { background: rgba(255,255,255,.18); }
        .report {
          margin-top: 9px; max-height: 190px; overflow: auto;
          font-size: 11.5px; color: #2b3038; border-top: 1px solid #e6e9ef;
          padding-top: 8px;
        }
        .report ul { margin: 4px 0 0 0; padding-left: 16px; }
        .report li { margin-bottom: 2px; }
        .report .sub { color: #6b7280; font-size: 11px; margin-top: 6px; }
        .report code { background: #f2f5fa; padding: 0 3px; border-radius: 3px; }
        .ft {
          margin-top: 9px; padding-top: 8px; border-top: 1px solid #e6e9ef;
          font-size: 10.5px; color: #6b7280;
        }
        .toast {
          margin-top: 8px; padding: 6px 8px; border-radius: 5px;
          background: #e8f5ec; color: #14532d; font-size: 11.5px;
          opacity: 0; transition: opacity .15s; min-height: 0;
        }
        .toast.on { opacity: 1; }
        .links { display: flex; gap: 10px; margin-top: 7px; }
        .links a { color: #12325c; font-size: 11px; cursor: pointer; text-decoration: underline; }
        .pagebox { margin-bottom: 4px; }
        .pageline {
          font-size: 11.5px; font-weight: 600; color: #12325c;
          background: #eef3fa; border: 1px solid #d7e2f0; border-radius: 5px;
          padding: 5px 7px; margin-bottom: 7px;
        }
        .pageline.off { color: #92400e; background: #fffbeb; border-color: #fde68a; font-weight: 500; }
        .countryline {
          display: none; font-size: 11.5px; font-weight: 600; padding: 5px 7px;
          margin-bottom: 7px; border-radius: 5px; border: 1px solid #d7e2f0;
          background: #eef3fa; color: #12325c;
        }
        .countryline.open { background: #e8f5ec; border-color: #bbf7d0; color: #14532d; }
        .countryline.closed { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
        .countryline.none { background: #fffbeb; border-color: #fde68a; color: #92400e; font-weight: 500; }
        .sep { height: 1px; background: #e6e9ef; margin: 10px 0 8px; }
      </style>

      <div class="panel" id="panel">
        <div class="hd">
          <span class="dot"></span>
          <span>NZ WHV fill</span>
          <span class="sp"></span>
          <button class="mini" id="collapse" title="Collapse">–</button>
        </div>
        <div class="body">
          <div class="banner" id="banner">Declaration page. Fill ticks all 11 — read them first.</div>

          <div class="pagebox">
            <div class="pageline" id="pageline">No rule set for this page</div>
            <div class="countryline" id="countryline"></div>
            <div class="row">
              <button id="fillpage" class="primary">Fill page <kbd>Alt+F</kbd></button>
              <button id="checkpage" title="Check field names only — types nothing">Check <kbd>Alt+C</kbd></button>
            </div>
          </div>

          <div class="sep"></div>

          <div class="count" id="count">0 / 0</div>
          <div class="label" id="label">Loading…</div>
          <div class="value" id="value">—</div>

          <div class="row">
            <button id="prev" title="Previous value">&#9664;</button>
            <button id="next" class="primary">Paste</button>
            <button id="skip" title="Skip this value">&#9654;</button>
          </div>

          <div class="row">
            <button id="bulk">Bulk "No"</button>
          </div>

          <div class="row">
            <button id="auto" title="Match fields by label">Auto-fill text</button>
            <button id="ordered" title="Fill empty fields top to bottom">Fill in order</button>
          </div>

          <div class="links">
            <a id="reset">reset queue</a>
            <a id="opts">edit profile</a>
          </div>

          <div class="toast" id="toast"></div>
          <div class="report" id="report"></div>
          <div class="ft">Types only. Never submits. You press Next.</div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(host);

    ui.panel = root.getElementById('panel');
    ui.count = root.getElementById('count');
    ui.labelEl = root.getElementById('label');
    ui.valueEl = root.getElementById('value');
    ui.prev = root.getElementById('prev');
    ui.next = root.getElementById('next');
    ui.skip = root.getElementById('skip');
    ui.bulkBtn = root.getElementById('bulk');
    ui.autoBtn = root.getElementById('auto');
    ui.orderedBtn = root.getElementById('ordered');
    ui.reportEl = root.getElementById('report');
    ui.toastEl = root.getElementById('toast');
    ui.banner = root.getElementById('banner');
    ui.pageLine = root.getElementById('pageline');
    ui.countryLine = root.getElementById('countryline');
    ui.fillBtn = root.getElementById('fillpage');
    ui.checkBtn = root.getElementById('checkpage');

    ui.fillBtn.addEventListener('click', fillPage);
    ui.checkBtn.addEventListener('click', checkPage);
    ui.next.addEventListener('click', pasteNext);
    ui.bulkBtn.addEventListener('click', bulkNo);
    ui.autoBtn.addEventListener('click', autoFillByLabel);
    ui.orderedBtn.addEventListener('click', fillInOrder);
    ui.prev.addEventListener('click', () => step(-1));
    ui.skip.addEventListener('click', () => step(1));
    root.getElementById('reset').addEventListener('click', (e) => {
      e.preventDefault();
      resetCursor();
    });
    root.getElementById('opts').addEventListener('click', (e) => {
      e.preventDefault();
      try {
        chrome.runtime.openOptionsPage();
      } catch (err) {
        toast('Open chrome://extensions → Details → Extension options');
      }
    });
    root.getElementById('collapse').addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      ui.panel.classList.toggle('collapsed', state.collapsed);
      root.getElementById('collapse').textContent = state.collapsed ? '+' : '–';
    });

    makeDraggable();
  }

  function makeDraggable() {
    const hd = root.querySelector('.hd');
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let left0 = 0;
    let top0 = 0;

    hd.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = host.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      left0 = r.left;
      top0 = r.top;
      dragging = true;
      host.style.left = `${r.left}px`;
      host.style.top = `${r.top}px`;
      host.style.right = 'auto';
      try {
        hd.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    });

    hd.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(window.innerWidth - 80, left0 + e.clientX - startX));
      const y = Math.max(0, Math.min(window.innerHeight - 40, top0 + e.clientY - startY));
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
    });

    const stop = () => {
      dragging = false;
    };
    hd.addEventListener('pointerup', stop);
    hd.addEventListener('pointercancel', stop);
  }

  /* ------------------------------------------------------------------ */
  /* keyboard                                                            */
  /* ------------------------------------------------------------------ */

  function onKeyDown(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;

    // Use e.code so the shortcut still works when Alt produces a different
    // character (for example Option+V on macOS inserts "√").
    const code = e.code;

    if (code === 'KeyV' || e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      pasteNext();
    } else if (code === 'KeyB' || e.key === 'F3') {
      e.preventDefault();
      e.stopPropagation();
      bulkNo();
    } else if (code === 'KeyF') {
      e.preventDefault();
      e.stopPropagation();
      fillPage();
    } else if (code === 'KeyC') {
      e.preventDefault();
      e.stopPropagation();
      checkPage();
    }
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  function boot() {
    if (!document.body) return;

    state.readOnly = /Submit\.aspx/i.test(location.pathname + location.search);

    buildPanel();
    readCursor();
    loadProfile(() => {
      if (state.cursor > state.profile.length) state.cursor = 0;
      render();
      if (!state.profile.length && !schemeListInfo()) {
        report(
          Object.keys(RULES).length
            ? '<b>Fallback queue is empty.</b><div class="sub">Alt+F uses the built-in rules and does not need it. Add values in the options only if you want Alt+V.</div>'
            : '<b>No rules loaded.</b><div class="sub">Generate <code>extension/rules.js</code> from your own export, then reload the extension. The fallback queue is optional.</div>'
        );
      }
    });

    window.addEventListener('keydown', onKeyDown, true);

    // The fixture pages switch sections without a navigation, so keep the
    // page label fresh there. The real wizard reloads, so it does not need it.
    if (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      setInterval(updatePageLine, 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
