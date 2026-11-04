const PROFILE_KEY = 'nzwhv_profile';
const SKIP_KEY = 'nzwhv_skip';
const COUNTRY_KEY = 'nzwhv_country';

const DEFAULT_SKIP =
  'tb risk|low risk for tb|pregnan|three month|3 month|five years prior|5 years prior|spent 3|spent three';

const DEFAULT_COUNTRY = '';

const TEMPLATE = `# One value per line: Label = value
# Order matters. Lines starting with # are ignored.

# --- Page 1: Personal details ---
Preferred title = Mr
Family name = Doe
Given name 1 = John
Given name 2 =
Gender = Male
Date of birth = 1990-01-01
Country of birth = Belgium
Town or city of birth = Brussels
Street number = 1
Street name = Example Street
Suburb = Centre
City = Brussels
Postcode = 1000
Country = Belgium
Phone = +32 2 123 45 67
Mobile = +32 470 12 34 56
Email = john.doe@example.com
Are you represented by an immigration adviser = No
Do you have a payment card available = Yes

# --- Page 2: Identification ---
Passport number = X1234567
Re-enter passport number = X1234567
Passport expiry date = 2035-01-01
Passport issue date = 2025-01-01
Passport issuing country = Belgium
Second form of identification = National ID
National ID number = 001199001234
Date document was issued = 2015-06-01

# --- Page 6: Working Holiday Specific ---
Intended date of travel to New Zealand = 2027-04-01
`;

const $ = (id) => document.getElementById(id);

function setStatus(text, ok = true) {
  const el = $('status');
  el.textContent = text;
  el.style.color = ok ? '#14532d' : '#b91c1c';
  if (text) setTimeout(() => (el.textContent = ''), 2200);
}

function load() {
  chrome.storage.local.get([PROFILE_KEY, SKIP_KEY, COUNTRY_KEY], (res) => {
    $('profile').value = res[PROFILE_KEY] || '';
    $('skip').value = res[SKIP_KEY] || DEFAULT_SKIP;
    $('country').value = res[COUNTRY_KEY] || DEFAULT_COUNTRY;
  });
}

function save() {
  const profile = $('profile').value;
  const skip = $('skip').value.trim() || DEFAULT_SKIP;
  const country = $('country').value.trim().toUpperCase() || DEFAULT_COUNTRY;

  const lines = profile
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

  const bad = lines.filter((l) => l.indexOf('=') === -1);
  if (bad.length) {
    setStatus(`${bad.length} line(s) missing "="`, false);
    return;
  }

  chrome.storage.local.set(
    { [PROFILE_KEY]: profile, [SKIP_KEY]: skip, [COUNTRY_KEY]: country },
    () => {
      setStatus(`Saved ${lines.length} values`);
    }
  );
}

document.addEventListener('DOMContentLoaded', () => {
  load();

  $('save').addEventListener('click', save);

  $('loadExample').addEventListener('click', () => {
    if ($('profile').value.trim() && !confirm('Replace the current profile with the template?')) return;
    $('profile').value = TEMPLATE;
    setStatus('Template loaded — replace the placeholder values');
  });

  $('clear').addEventListener('click', () => {
    if (!confirm('Clear the saved profile?')) return;
    $('profile').value = '';
    chrome.storage.local.remove([PROFILE_KEY], () => setStatus('Cleared'));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
});
