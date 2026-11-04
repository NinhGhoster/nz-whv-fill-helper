#!/usr/bin/env python3
"""
Build a test fixture page that uses the real ASP.NET field names from the
synthetic example rules.

The point is not to look like the INZ form — it is to exercise the exact-name
engine against the same names, the same select values and the same page split
that the real application uses. All values come from
extension/rules.example.json, never from a personal export.

Usage:
    python3 tools/build-fixture.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / "extension" / "rules.example.json"
OUT = ROOT / "test" / "fixtures" / "exact-names.html"

ORDER = [
    "Personal1",
    "Personal2",
    "Medical1",
    "Character",
    "WorkingHolidaySpecific",
    "Submit",
    "Payment",
]


def decoys(value: str):
    """Options that must NOT be picked, returned before the correct value."""
    v = value.strip()
    if v in ("Yes", "No"):
        return ["", "No" if v == "Yes" else "Yes", "Unknown"]
    if v.isdigit():
        alt = str(int(v) + 1)
        return ["", "0", alt]
    if len(v) <= 2:
        return ["", "M", "X", "Z"]
    return ["", v.upper(), v + "x"]


def short(name: str) -> str:
    bits = name.split(":")
    return " / ".join(bits[-2:]) if len(bits) > 1 else name


def field_html(f):
    name = f["name"]
    label = short(name)
    kind = f["type"]

    if kind == "select":
        opts = decoys(f["value"]) + [f["value"]]
        seen = set()
        out = []
        for o in opts:
            if o in seen:
                continue
            seen.add(o)
            text = o if o else "Select"
            out.append(f'<option value="{o}">{text}</option>')
        return (
            f'<div class="f"><label>{label}</label>'
            f'<select name="{name}">{"".join(out)}</select></div>'
        )

    if kind == "checkbox":
        return (
            f'<div class="f chk"><label>'
            f'<input type="checkbox" name="{name}" value="1"> {label}</label></div>'
        )

    return (
        f'<div class="f"><label>{label}</label>'
        f'<input type="text" name="{name}" autocomplete="off"></div>'
    )


def main():
    doc = json.loads(RULES.read_text(encoding="utf-8"))
    pages = doc["pages"]

    names = [p for p in ORDER if p in pages]
    sections = []
    chips = []

    for i, pid in enumerate(names, 1):
        page = pages[pid]
        body = "\n".join(field_html(f) for f in page["fields"])
        hidden = "" if i == 1 else " hide"
        sections.append(
            f'<section data-step="{i}" class="card{hidden}">'
            f"<h2>{pid}</h2>"
            f'<p class="sub">{page["file"]} · {len(page["fields"])} rules · '
            f'real field names</p>'
            f'<div class="grid">{body}</div>'
            f"</section>"
        )
        chips.append(
            f'<span class="chip{" on" if i == 1 else ""}">{i}. {pid}</span>'
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="icon" href="data:," />
<title>Test fixture — real field names</title>
<style>
  :root {{ color-scheme: light; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: #eef1f6; color: #16181d; font-size: 14px;
  }}
  .top {{ background: #12325c; color: #fff; padding: 14px 22px; display: flex; align-items: center; gap: 14px; }}
  .top strong {{ font-size: 15px; }}
  .tag {{ margin-left: auto; font-size: 11px; background: rgba(255,255,255,.15); padding: 4px 9px; border-radius: 20px; }}
  .warn {{ background: #fff7ed; border-bottom: 1px solid #fed7aa; color: #7c2d12; padding: 9px 22px; font-size: 12.5px; }}
  .wrap {{ max-width: 900px; margin: 22px auto 70px; padding: 0 18px; }}
  .steps {{ display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }}
  .chip {{ font-size: 11.5px; padding: 5px 10px; border-radius: 20px; background: #fff; border: 1px solid #d3d9e2; color: #5b6472; }}
  .chip.on {{ background: #12325c; border-color: #12325c; color: #fff; font-weight: 600; }}
  .card {{ background: #fff; border: 1px solid #d3d9e2; border-radius: 10px; padding: 20px 22px 24px; }}
  h2 {{ font-size: 17px; margin: 0 0 4px; }}
  .sub {{ color: #5b6472; font-size: 12.5px; margin: 0 0 18px; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; }}
  .f {{ margin-bottom: 13px; }}
  .f label {{ display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; }}
  .f input[type=text], .f select {{
    width: 100%; padding: 8px 10px; font-size: 13.5px;
    border: 1px solid #c9ced6; border-radius: 6px; background: #fff;
  }}
  .chk label {{ font-weight: 400; font-size: 12.5px; display: flex; gap: 8px; align-items: flex-start; }}
  .foot {{ display: flex; gap: 10px; margin-top: 18px; }}
  button {{
    padding: 9px 16px; border-radius: 7px; border: 1px solid #c9ced6;
    background: #fff; font-size: 13px; font-weight: 500; cursor: pointer;
  }}
  button.primary {{ background: #12325c; color: #fff; border-color: #12325c; }}
  button:disabled {{ opacity: .45; cursor: default; }}
  .hide {{ display: none; }}
</style>
</head>
<body>
<div class="top">
  <strong>Working Holiday Scheme — real field names</strong>
  <span class="tag">TEST FIXTURE</span>
</div>
<div class="warn">
  Local copy of the field names from <code>rules.example.json</code>. All values
  are synthetic. Nothing here is connected to Immigration New Zealand. Used to
  prove that Fill page matches every name and every dropdown value before you
  try it on the live site.
</div>

<div class="wrap">
  <div class="steps">{"".join(chips)}</div>
  {"".join(sections)}
  <div class="foot">
    <button id="back">Back</button>
    <button id="next" class="primary">Next</button>
  </div>
</div>

<script>
  const TOTAL = {len(names)};
  let step = 1;
  const chips = Array.from(document.querySelectorAll('.chip'));
  const sections = Array.from(document.querySelectorAll('section[data-step]'));

  function render() {{
    chips.forEach((c, i) => c.classList.toggle('on', i + 1 === step));
    sections.forEach((s) => s.classList.toggle('hide', Number(s.dataset.step) !== step));
    document.getElementById('back').disabled = step === 1;
    document.getElementById('next').disabled = step === TOTAL;
    window.scrollTo(0, 0);
  }}

  document.getElementById('next').addEventListener('click', () => {{
    if (step < TOTAL) {{ step += 1; render(); }}
  }});
  document.getElementById('back').addEventListener('click', () => {{
    if (step > 1) {{ step -= 1; render(); }}
  }});

  render();
</script>

<script src="harness.js"></script>
</body>
</html>
"""

    OUT.write_text(html, encoding="utf-8")
    total = sum(len(pages[p]["fields"]) for p in names)
    print(f"wrote {OUT} — {total} fields across {len(names)} pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
