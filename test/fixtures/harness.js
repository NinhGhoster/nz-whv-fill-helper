/*
 * Test-fixture harness.
 *
 * Load this after the form markup. Two modes:
 *
 *  - Extension installed: the content script has already marked
 *    <html data-nzwhv="on"> and this file does nothing.
 *  - Extension not installed: it stubs chrome.storage, then loads
 *    rules.example.js and content.js as page scripts so the panel and
 *    shortcuts still work.
 */
(function () {
  'use strict';

  var PROFILE = [
    'Preferred title = Mr',
    'Family name = Doe',
    'Given name 1 = John',
    'Gender = Male',
    'Date of birth = 1990-01-01',
    'Country of birth = Belgium',
    'Town or city of birth = Brussels',
    'Street number = 1',
    'Street name = Example Street',
    'Suburb = Centre',
    'City = Brussels',
    'Postcode = 1000',
    'Country = Belgium',
    'Phone = +32 2 123 45 67',
    'Mobile = +32 470 12 34 56',
    'Email = john.doe@example.com',
    'Passport number = X1234567',
    'Re-enter passport number = X1234567',
    'Passport expiry date = 2035-01-01',
    'Passport issue date = 2025-01-01',
    'Passport issuing country = Belgium',
    'Second form of identification = National ID',
    'National ID number = 001199001234',
    'Date document was issued = 2015-06-01',
    'Intended date of travel to New Zealand = 2027-04-01'
  ].join('\n');

  function loadContent() {
    var s = document.createElement('script');
    s.src = '../../extension/content.js';
    document.body.appendChild(s);
  }

  function start() {
    if (document.documentElement.hasAttribute('data-nzwhv')) return;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return;

    var params = new URLSearchParams(location.search);
    var country = params.has('country')
      ? params.get('country')
      : document.documentElement.getAttribute('data-target-country') || 'BELGIUM';

    window.__NZWHV_TEST_PROFILE__ = PROFILE;
    window.chrome = {
      storage: {
        local: {
          get: function (keys, cb) {
            cb({ nzwhv_profile: PROFILE, nzwhv_country: country });
          },
          set: function (obj, cb) {
            if (cb) cb();
          }
        }
      },
      runtime: {
        openOptionsPage: function () {
          alert('Options are only available once the extension is installed.');
        }
      }
    };

    var r = document.createElement('script');
    r.src = '../../extension/rules.example.js';
    r.onload = loadContent;
    r.onerror = loadContent;
    document.body.appendChild(r);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(start, 600);
    });
  } else {
    setTimeout(start, 600);
  }
})();
