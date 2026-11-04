# Runbook — NZ working holiday application

This is the human checklist for the day you lodge. Replace the placeholders with
your scheme's opening time, target country and document details.

The extension only types. Every click, every declaration and every payment
decision stays with you.

---

## Before the day

| Task | Why it matters |
|---|---|
| Generate `extension/rules.js` from your own export | The placeholder shipped in the repository does not contain your answers. |
| Set the target country on the options page | The scheme list then marks the correct row with a `TARGET` badge. |
| Log in at https://onlineservices.immigration.govt.nz/?WHS | A wrong password at the last minute costs the slot. |
| Check the account email matches the one in the form | A mismatch causes processing problems later. |
| Call the bank about the card | International online payments on, a sufficient limit, and the 3-D Secure OTP reaching your phone. |
| Check the passport | It must be valid for the period your scheme requires; copy the number and expiry exactly. |
| Confirm eligibility | Check your scheme's age, qualification, English and nationality rules on the INZ page. |
| Put the passport, card and phone in front of you | You will need all three. |

## T-minus checklist

| When | Task |
|---|---|
| The day before | Install or reload the extension. Generate the rules. Save the target country. Confirm the badge on a draft if you want a dry run. |
| 60 minutes before | Laptop plugged in, sleep disabled, notifications off, other apps closed. One Chrome window, one tab on the INZ site. No VPN. Turn off Chrome autofill for this site. |
| 15 minutes before | Log in again if the session expired. Confirm the panel is visible and the target row has the badge. Screenshot every screen from here on. |
| 2 minutes before | Refresh by hand every 3–5 seconds. Do not use an auto-refresh extension. |
| At opening | Confirm the target row still has the badge and the panel says `OPEN`. Then click **Apply Now** yourself. |

Do not lodge before the scheme opens. Applications lodged early are deleted.

## When the scheme opens

1. Confirm the target row has the `TARGET` badge and the panel says
   `COUNTRY — OPEN`. Then **Apply Now**.
2. Robot check → **you solve it**. There is no panel on that page; it comes back
   by itself as soon as you land on Personal details. Nothing is lost.
3. **Personal details** — `Alt+F`. Check the agent answer, card availability,
   email and country. Then Next.
4. **Identification** — `Alt+F`. Check the passport number twice and the expiry.
   Then Next.
5. **Occupation** — optional. The panel says `Occupation details — optional`.
   Nothing to fill. Then Next.
6. **Health** — `Alt+F`. Read every answer against your own circumstances. The
   health declarations are yours, not the helper's. Then Next.
7. **Character** — `Alt+F`. Check each answer. Then Next.
8. **Working Holiday Specific** — `Alt+F`. Check the travel date, funds, onward
   ticket and requirements answers. This is the end of the section, so the blue
   button says **SAVE**, not Next. Click **SAVE**.
9. Click **Proceed to Submit your Application**.
10. **Declaration page** — `Alt+F` twice: the first click arms it, the second
    ticks all 11. Read them before you do it. Then **you click SUBMIT**.
11. **Secure Payment Site** — payer name only. Card number, expiry, CVC and OTP
    by hand.
12. Screenshot the success page, then wait for the email.

Steps 1, 2, 9 (Proceed to Submit), 10 (the final SUBMIT click), 11 and 12 are
yours. The helper only types.

### If a page does not fill

The panel names the page and the count, for example `Personal1 — 12 fields`.
After `Alt+F` the report says `filled 12/12`. If it says `filled 8/12`, the four
misses are listed by their last name segment. Type those by hand with `Alt+V`,
or just type them — do not debug the extension while the clock is running.

`Alt+C` checks names and dropdown values **without typing anything**. If you
want to confirm the live form matches your export before filling, press `Alt+C`
first.

If the panel says `No rules loaded`, the placeholder `extension/rules.js` is
still in place. Generate your own rules and reload the extension.

---

## If something goes wrong

| Symptom | What to do |
|---|---|
| Page will not load | Keep retrying on the same tab. Do not open extra tabs. |
| "Access denied" page | Log in again from the same tab. If it persists, wait a minute — do not hammer the site. |
| Logged out mid-way | Log back in. The partially completed application is saved. Go to Working Holiday → Edit. |
| "Unfortunately the available places..." | Keep refreshing for a few minutes. Failed payments can release places. |
| Payment declined | Try a second card immediately. You are racing the payment lock. |
| Payment page hangs after paying | **Do not close it.** Wait. Then check the status page for Payment Status: Received. |
| Wrong country row | Check the row label twice before clicking. The `TARGET` badge is there to catch this. |
| A field is missed | Type it by hand. Do not stop to diagnose the extension. |

---

## Hard rules

- **One application.** A second working holiday application linked to your
  passport, name and date of birth can bar you from every NZ working holiday
  scheme. This is the single unrecoverable mistake.
- **No VPN.**
- **No automation of the CAPTCHA, Submit or Pay steps.** Those are the exact
  behaviours INZ treats as unauthorised access.
- **No auto-refresh loop and no auto-click on Apply Now.** Refresh by hand. The
  extension highlights the row; you click it.
- **Do not submit on another country's scheme to practise.** Opening a draft is
  recoverable. Submitting one is not.
- **Check every health and character answer yourself.** The helper types what
  your export says, not what is true on the day.

---

## After you have the slot

Winning the slot is not the visa.

| Deadline | Task |
|---|---|
| Check your scheme's deadline | Chest X-ray or medical, if INZ asks for one |
| Check your scheme's deadline | Qualification, English test result, police certificate, funds evidence, medical insurance, onward ticket or funds for one |
| Until confirmed | Check the application status page until Payment Status reads **Received** |

Most people who lose a won slot lose it after the form, not on the form.
