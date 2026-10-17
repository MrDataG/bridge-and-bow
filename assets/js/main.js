// Bridge & Bow Travel — shared site behavior
// Loaded on every page via <script src="/assets/js/main.js">

document.addEventListener('DOMContentLoaded', () => {

  // ---- GA4: track outbound Viator clicks (which page + which tour earns clicks) ----
  document.addEventListener('click', (evt) => {
    const link = evt.target.closest && evt.target.closest('a[href*="viator.com"]');
    if (!link || typeof gtag !== 'function') return;
    const item = link.closest('.excursion-item');
    const nameEl = item && item.querySelector('.name');
    let campaign = '';
    try { campaign = new URL(link.href).searchParams.get('campaign') || ''; } catch (e) { /* malformed URL, leave blank */ }
    gtag('event', 'viator_click', {
      tour_name: nameEl ? nameEl.textContent.trim() : (link.textContent || '').trim().slice(0, 80),
      campaign: campaign,
      page_path: window.location.pathname,
      link_url: link.href,
      transport_type: 'beacon'
    });
  });

  // ---- Mobile menu toggle ----
  const menuToggle = document.getElementById('menuToggle');
  const nav = document.getElementById('nav');
  if (menuToggle && nav) {
    menuToggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      menuToggle.classList.toggle('open', isOpen);
      menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // ---- Nav dropdowns (touch / keyboard) ----
  // One delegated listener on the whole document so it works on every page and every browser,
  // including iOS Safari, regardless of when or how the nav markup was parsed.
  const closeAllSubs = (except) => {
    document.querySelectorAll('nav.primary .nav-item.open').forEach(o => {
      if (o === except) return;
      o.classList.remove('open');
      const t = o.querySelector('.sub-toggle');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('nav.primary .sub-toggle');
    if (btn) {
      e.preventDefault();
      const item = btn.closest('.nav-item');
      const open = !item.classList.contains('open');
      closeAllSubs(item);
      item.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    if (!(e.target.closest && e.target.closest('nav.primary .nav-item'))) closeAllSubs(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const item = document.querySelector('nav.primary .nav-item.open');
    if (!item) return;
    const btn = item.querySelector('.sub-toggle');
    closeAllSubs(null);
    if (btn) btn.focus();
  });

  // ---- Scroll-reveal for cards, pillars, stats ----
  document.querySelectorAll('.pillar, .article-card, .stat').forEach(el => el.classList.add('reveal'));
  const revealIo = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('in'), i * 40);
        revealIo.unobserve(entry.target);
      }
    });
  }, { threshold: .15 });
  document.querySelectorAll('.reveal').forEach(el => revealIo.observe(el));

  // ---- Count-up stats ----
  const countIo = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseInt(el.dataset.count, 10);
        const prefix = el.dataset.prefix || '';
        const start = performance.now();
        const dur = 1200;
        function tick(now) {
          const p = Math.min((now - start) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = prefix + Math.round(eased * target).toLocaleString();
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        countIo.unobserve(el);
      }
    });
  }, { threshold: .5 });
  document.querySelectorAll('.stat-num').forEach(el => countIo.observe(el));

  // ---- Header shrink + wake-rail scroll progress ----
  const header = document.getElementById('siteHeader');
  const wakeFill = document.getElementById('wakeFill');
  const wakeMarker = document.getElementById('wakeMarker');
  function onScroll() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 20);
    if (wakeFill && wakeMarker) {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const pct = scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0;
      wakeFill.style.height = (pct * 84) + '%';
      wakeMarker.style.top = (8 + pct * 84) + '%';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---- Cookie consent banner ----
  // Analytics (Google Analytics) only runs after "Accept all". See assets/js/analytics.js.
  const cookieBanner = document.getElementById('cookieBanner');
  if (cookieBanner) {
    const consent = window.bnbConsent;
    const chosen = consent ? consent.choice() : null;
    const hasChoice = chosen === 'all' || chosen === 'essential';
    if (!hasChoice) {
      setTimeout(() => cookieBanner.classList.add('show'), 900);
    }
    cookieBanner.querySelectorAll('[data-cookie-choice]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (consent) {
          if (btn.getAttribute('data-cookie-choice') === 'all') consent.accept();
          else consent.essentialOnly();
        }
        cookieBanner.classList.remove('show');
      });
    });
    // "Cookie settings" link in the footer lets visitors change their choice.
    document.addEventListener('click', (e) => {
      const link = e.target.closest && e.target.closest('[data-cookie-settings]');
      if (!link) return;
      e.preventDefault();
      cookieBanner.classList.add('show');
    });
  }

  // ---- Newsletter signup (Google Sheet via Apps Script) ----
  // Replace APPS_SCRIPT_URL with the /exec URL from your Web App deployment.
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyp2EfFa3gAg17gBabNii9PMIU3I9fwhUGX5IEfo2I1qcpnCggwkZIbPjXkflOq_JQk/exec';
  const newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function (evt) {
      evt.preventDefault();
      const emailInput = document.getElementById('newsletterEmail');
      const msg = document.getElementById('newsletterMsg');
      const submitBtn = newsletterForm.querySelector('button');
      const email = emailInput.value.trim();

      if (!email || email.indexOf('@') === -1) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';

      const body = new URLSearchParams();
      body.append('formType', 'newsletter');
      body.append('email', email);
      body.append('source', window.location.pathname);

      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors', // Apps Script doesn't return CORS headers; response is opaque, so we optimistically assume success
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      })
        .then(() => {
          newsletterForm.style.display = 'none';
          msg.textContent = "You're on the list — thanks!";
          msg.style.display = 'block';
        })
        .catch(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Subscribe';
          msg.textContent = 'Something went wrong — try again in a moment.';
          msg.style.display = 'block';
        });
    });
  }

  // ---- Contact form (same Google Sheet / Apps Script as newsletter) ----
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', function (evt) {
      evt.preventDefault();
      const nameInput = document.getElementById('name');
      const emailInput = document.getElementById('email');
      const messageInput = document.getElementById('message');
      const msg = document.getElementById('contactMsg');
      const submitBtn = contactForm.querySelector('button');

      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const message = messageInput.value.trim();
      if (!name || !email || email.indexOf('@') === -1 || !message) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';

      const body = new URLSearchParams();
      body.append('formType', 'contact');
      body.append('name', name);
      body.append('email', email);
      body.append('message', message);

      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      })
        .then(() => {
          contactForm.style.display = 'none';
          msg.textContent = "Thanks — we'll get back to you soon.";
          msg.style.display = 'block';
        })
        .catch(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send message';
          msg.textContent = 'Something went wrong — try again in a moment.';
          msg.style.display = 'block';
        });
    });
  }

});
