// Bridge & Bow Travel — shared site behavior
// Loaded on every page via <script src="/assets/js/main.js">

document.addEventListener('DOMContentLoaded', () => {

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
  const cookieBanner = document.getElementById('cookieBanner');
  if (cookieBanner) {
    const consentKey = 'bnb_cookie_consent';
    let alreadyChosen = null;
    try { alreadyChosen = localStorage.getItem(consentKey); } catch (e) { /* storage blocked, fall through and show banner */ }
    if (!alreadyChosen) {
      setTimeout(() => cookieBanner.classList.add('show'), 900);
    }
    cookieBanner.querySelectorAll('[data-cookie-dismiss]').forEach(btn => {
      btn.addEventListener('click', () => {
        try { localStorage.setItem(consentKey, 'dismissed'); } catch (e) { /* storage blocked, banner will just reappear next visit */ }
        cookieBanner.classList.remove('show');
      });
    });
  }

  // ---- Newsletter signup (Google Sheet via Apps Script) ----
  // Replace APPS_SCRIPT_URL with the /exec URL from your Web App deployment.
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw409pg6HwnyYwndg1XxLt_FfpOC3ZC14TEttI5XZKTqT217IzgPa1Uv3GuW31NxUDY/exec';
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

});
