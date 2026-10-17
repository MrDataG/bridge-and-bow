// Google Analytics 4 for Bridge & Bow Travel, loaded ONLY after the visitor accepts analytics cookies.
// Choice is stored in localStorage under "bnb_cookie_consent" as "all" or "essential".
// With no choice yet, or "essential", nothing is loaded and no analytics cookies are set.
(function () {
  var GA_ID = 'G-EDJNC213VK';
  var KEY = 'bnb_cookie_consent';
  var loaded = false;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  // Consent Mode: analytics storage is denied unless the visitor accepts.
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  function readChoice() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function enable() {
    window['ga-disable-' + GA_ID] = false;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    if (loaded) return;
    loaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
  }

  function disable() {
    window['ga-disable-' + GA_ID] = true;
    gtag('consent', 'update', { analytics_storage: 'denied' });
    // Remove any Google Analytics cookies set earlier on this domain.
    var names = document.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); });
    var host = location.hostname;
    var domains = [host, '.' + host, '.' + host.replace(/^www\./, '')];
    names.forEach(function (n) {
      if (n === '_ga' || n.indexOf('_ga_') === 0 || n === '_gid' || n.indexOf('_gat') === 0) {
        domains.forEach(function (d) {
          document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + d;
        });
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      }
    });
  }

  window.bnbConsent = {
    accept: function () { try { localStorage.setItem(KEY, 'all'); } catch (e) {} enable(); },
    essentialOnly: function () { try { localStorage.setItem(KEY, 'essential'); } catch (e) {} disable(); },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} disable(); },
    choice: readChoice
  };

  if (readChoice() === 'all') { enable(); } else { window['ga-disable-' + GA_ID] = true; }
})();
