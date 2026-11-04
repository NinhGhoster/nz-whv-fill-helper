/*
 * Dump every named field on the current page.
 *
 * Use this if you want to check the live form without installing anything:
 *
 *   1. Open the INZ page you want to inspect.
 *   2. Press F12 (or Cmd+Option+I), click the Console tab.
 *   3. Paste this whole file, press Enter.
 *   4. It copies a JSON summary to the clipboard and prints it.
 *
 * It only reads the page. It types nothing and clicks nothing.
 */
(() => {
  const short = (s) => String(s || '').slice(0, 120);

  const rows = Array.from(document.querySelectorAll('input, select, textarea'))
    .filter((el) => el.name)
    .map((el) => {
      const row = {
        tag: el.tagName.toLowerCase(),
        type: (el.type || '').toLowerCase(),
        name: el.name,
        id: el.id || ''
      };

      if (el.tagName === 'SELECT') {
        row.value = el.value;
        row.options = Array.from(el.options)
          .slice(0, 8)
          .map((o) => ({ value: o.value, text: short(o.text) }));
        row.optionCount = el.options.length;
      } else if (row.type === 'checkbox' || row.type === 'radio') {
        row.value = el.value;
        row.checked = el.checked;
      } else {
        row.value = short(el.value);
        row.maxLength = el.maxLength > 0 ? el.maxLength : undefined;
      }

      const label =
        (el.labels && el.labels[0] && el.labels[0].innerText) ||
        (el.closest('tr') && el.closest('tr').cells[0] && el.closest('tr').cells[0].innerText) ||
        '';
      row.label = short(label).replace(/\s+/g, ' ').trim();

      return row;
    });

  const out = {
    url: location.href,
    title: document.title,
    forms: document.forms.length,
    frames: Array.from(document.querySelectorAll('iframe,frame')).length,
    fieldCount: rows.length,
    fields: rows
  };

  const text = JSON.stringify(out, null, 2);
  try {
    copy(text); // DevTools console helper
  } catch (e) {
    /* not in the console */
  }
  console.log(text);
  return `${rows.length} named fields — copied to clipboard`;
})();
