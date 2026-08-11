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
    setTimeout(() => cookieBanner.classList.add('show'), 900);
    cookieBanner.querySelectorAll('[data-cookie-dismiss]').forEach(btn => {
      btn.addEventListener('click', () => cookieBanner.classList.remove('show'));
    });
  }

});
