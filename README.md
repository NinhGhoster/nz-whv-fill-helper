# NZ WHV fill helper

A local-only Chrome extension that types your own New Zealand working holiday
application faster. It never advances a page, never submits, and never touches
the CAPTCHA.

It is a typing aid, not an automation tool: you still choose the scheme, solve
the robot check, press Next, submit and pay.

---

## Two ways it fills

| Layer | How it works | Reliability |
|---|---|---|
| **Exact names** (`Alt+F`) | Looks up the real ASP.NET `name` attributes from your own export and sets those fields, including dropdown codes. | Primary. 52 fields across 7 pages in the example export. |
| Clipboard queue (`Alt+V`) | Shows your next value. You click a field, press Alt+V, it types it. | Fallback for any field the rules miss. |
| Bulk answers (`Alt+B`) | Answers every *unanswered* Yes/No radio group with "No". | Fallback for older pages. |
| Label matching | Matches fields by their label text. | Best effort. |

`Alt+C` checks the current page **without typing anything**: it reports how many
of the rule names and dropdown values exist in the live DOM. Use it to confirm
the form still matches your export.

## Target country

Set it once on the options page. On the Working Holiday scheme list the matching
row gets a dark outline and a `TARGET` badge, and the panel shows
`COUNTRY — CLOSED` or `COUNTRY — OPEN · click Apply Now`. If the row is off
screen it scrolls into view once.

That is all the extension does on the scheme list. It does not click the row and
does not refresh the page. Leave the field blank to disable the highlight; the
panel says `No target country set`.

## What it never does

- No clicking Next, Submit, Pay, Apply Now, or any link or button.
- No auto-refresh, polling or reload loop.
- No CAPTCHA interaction.
- No network requests. Nothing leaves your machine.
- No credentials. It uses the session you already logged in with.

The only `.click()` calls in `content.js` are on radio and checkbox inputs,
which is how the page's own JavaScript registers a choice. Search the file for
`document.querySelector('.submit')`-style code: there is none.

---

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `extension` folder in this repository
4. Click the toolbar icon → set your target country → **Save**
5. Open <https://onlineservices.immigration.govt.nz/WorkingHoliday/> and check
   that the panel appears and your country's row carries the `TARGET` badge

The fallback queue is optional; `Alt+F` uses the generated rules. Reload the
extension after changing `rules.js`.

To remove: **Remove** on `chrome://extensions`.

## Where the field names come from

`extension/rules.js` is generated from a Lightning Autofill export of your own
application:

```
python3 tools/build-rules.py path/to/your-export.csv
```

That writes `extension/rules.json`, `extension/rules.js` and `rules-report.md`.
All three contain personal answers. `rules.json` and `rules-report.md` are
gitignored. `rules.js` is tracked only as the empty placeholder; the pre-commit
hook rejects a generated version.

The repository ships a synthetic example instead:

```
python3 tools/build-rules.py lightning-autofill.example.csv --example
```

That writes `extension/rules.example.json`, `extension/rules.example.js` and
`rules-report.example.md`. The example values are a fictional John Doe profile.
The committed `extension/rules.js` is an empty placeholder, so the extension
loads but does not fill anything until you generate your own rules.

The example export has 52 fields across 7 pages.

| Page | Fields | Kind |
|---|---|---|
| Personal1.aspx | 12 | 7 text, 5 dropdown |
| Personal2.aspx | 5 | 4 text, 1 dropdown |
| Personal3.aspx | 0 | optional occupation page — just click Next |
| Medical1.aspx | 9 | 9 dropdown |
| Character.aspx | 8 | 8 dropdown |
| WorkingHolidaySpecific.aspx | 6 | 1 text, 5 dropdown |
| Submit.aspx | 11 | 11 checkboxes |
| OnLinePayment.aspx | 1 | payer name |

The exact-name engine was verified against a live draft: every field matched,
the values survived a save and a reload, and the declaration page ticked all 11
boxes. Note that the footer on WorkingHolidaySpecific is **SAVE**, not Next — it
is the end of the section.

Three things a real export settles that label matching would get wrong:

- dropdowns are set by **option value**, not by visible text;
- dates use the jQuery UI format that appears in the field;
- several section names are non-obvious (`hasAgent`, `hasCreditCard`,
  `offshoreDetails`, `requirementsQuestions`).

## Profile format (fallback queue only)

One line per value, `Label = value`. Order matters. Lines starting with `#` are
ignored.

```
Family name = Doe
Given name 1 = John
Email = john.doe@example.com
Passport number = X1234567
Passport expiry = 2035-01-01
Date of birth = 1990-01-01
```

Dates work as `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY`. Radio and dropdown
answers work by text. See `profile.example.txt`.

---

## On the day

Use `RUNBOOK.md`. Short version:

1. Logged in well before opening.
2. On the Working Holiday page, with the `TARGET` badge on your country's row.
3. Start refreshing gently two minutes before — by hand.
4. Click Apply Now, solve the robot check yourself.
5. On each page: **Alt+F**, glance at the reported `filled N/N`, then you click
   Next.
6. You click Submit, you tick the declarations, you pay.

Budget ~10 seconds per page with the exact-name fill.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No panel appears | Reload the page. Check the extension is enabled and the URL is under `onlineservices.immigration.govt.nz`. |
| Scheme list has no `TARGET` badge | Set the target country on the options page, save, then reload the list. |
| Panel says `No target country set` | Enter the country name in the extension options and save. |
| Panel says `— not on this list` | The target country does not match any row. Use the exact name, for example `BELGIUM` or `UNITED KINGDOM`. |
| Page line says `No rules loaded` | Generate `extension/rules.js` from your own export, then reload the extension. |
| Page line says "No rule set for this page" | The page is not one of the seven, or the live form changed. Use `Alt+C` on the previous page, then `Alt+V` by hand. |
| `filled 8/12` | The four misses are listed by their last name segment. Type those by hand. |
| Dropdown reports `no option "16"` | The live list changed. Pick it by hand. |
| Alt+F does nothing | Click inside the page first, then press it again. The panel button works too. |
| Value went into the wrong field | Fix it by hand, then press ▶ in the panel to advance the queue. |
| Panel covers a field | Drag it by the dark blue title bar. |

The queue position is remembered per tab, so it survives a page refresh.

---

## Privacy

- The extension makes no network requests and sends nothing anywhere.
- It stores values in `chrome.storage.local` only.
- `lightning-autofill-*.csv`, generated `extension/rules.json`, generated
  `extension/rules.js` and `rules-report.md` contain personal answers. The CSV,
  JSON and report are gitignored; the hook rejects a generated `rules.js`.
- Enable the hook in a fresh clone with
  `git config core.hooksPath .githooks`.
- The repository ships only synthetic examples: `lightning-autofill.example.csv`,
  `extension/rules.example.*`, `rules-report.example.md` and
  `test/fixtures/exact-names.html`.

---

## Testing

```
python3 -m http.server 8765          # in this folder
node test/cdp-rules-test.mjs  9334 127.0.0.1 http://127.0.0.1:8765/test/fixtures/exact-names.html
node test/cdp-test.mjs        9334 127.0.0.1 http://127.0.0.1:8765/test/fixtures/form.html
node test/cdp-scheme-list.mjs 9334 127.0.0.1 http://127.0.0.1:8765/test/fixtures/scheme-list.html
```

`test/fixtures/exact-names.html` is generated from `rules.example.json`, so it
carries the same field names, dropdown values and page split as the real
application, with synthetic values. Regenerate it after changing the example
export:

```
python3 tools/build-fixture.py
```

The first suite runs 40 checks: page detection, `Alt+C` typing nothing, `Alt+F`
filling every value on all seven pages, the declaration page's deliberate double
click, and no console errors.

The second suite covers the fallback tools on the older fixture: 24 checks for
the queue, label matching, bulk "No" and the three deliberate exceptions.

The third suite covers the scheme list: 28 checks for the panel line, the
`TARGET` badge, the open/closed styling, the `UK` alias, an unknown country, an
empty target, and that neither button navigates or clicks a scheme link.

`test/live-inject.mjs` runs the real content script against a live INZ page
over CDP — read-only in `check` mode, `fill` mode on a throwaway draft. It needs
a local `extension/rules.js` generated from your own export. It never clicks
Next, Save or Submit.

`test/e2e-extension.mjs` exercises the options page and storage round-trip. It
skips on branded Chrome builds, which ignore `--load-extension`; load the
extension by hand through `chrome://extensions` instead.
