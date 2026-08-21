// Bridge & Bow Travel — homepage-only 3D/cinematic behavior
// Loaded ONLY on index.html, after main.js. Does not duplicate anything
// main.js already handles (mobile menu, cookie banner, newsletter submit,
// header scroll-shrink) — this file only adds the new cinematic layer.

document.addEventListener('DOMContentLoaded', () => {

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---- Loader ----
  const loader = document.getElementById('loader');
  window.addEventListener('load', () => {
    if (loader) setTimeout(() => loader.classList.add('hide'), reduceMotion ? 0 : 500);
  });

  // ---- Scroll progress bar + scroll-linked hero badge ----
  const progress = document.getElementById('progress');
  const heroBadge = document.getElementById('heroBadge');
  const heroSection = document.querySelector('.hero3d');

  function onScroll3d() {
    const h = document.documentElement;
    if (progress) {
      const pct = (h.scrollTop) / (h.scrollHeight - h.clientHeight) * 100;
      progress.style.width = pct + '%';
    }
    // Badge reacts to scroll on every device (not just mouse) — as the
    // hero scrolls out of view, it scales down and rotates away.
    if (!reduceMotion && heroBadge && heroSection) {
      const rect = heroSection.getBoundingClientRect();
      const scrolledPast = Math.min(Math.max(-rect.top, 0), rect.height);
      const p = scrolledPast / rect.height;
      const scale = 1 - p * 0.25;
      const rot = p * 20;
      heroBadge.style.transform = `scale(${scale}) rotateY(${rot}deg) rotateX(9deg)`;
    }
  }
  window.addEventListener('scroll', onScroll3d, { passive: true });
  onScroll3d();

  // ---- Custom cursor (fine-pointer devices only) ----
  if (hasHover && !reduceMotion) {
    const cursor = document.getElementById('cursor');
    if (cursor) {
      window.addEventListener('mousemove', (e) => {
        cursor.classList.add('ready');
        cursor.style.left = e.clientX + 'px';
        cursor.style.top = e.clientY + 'px';
      }, { passive: true });
      document.querySelectorAll('a, button, .tilt-card, .guide-card').forEach(el => {
        el.addEventListener('mouseenter', () => cursor.classList.add('active'));
        el.addEventListener('mouseleave', () => cursor.classList.remove('active'));
      });
    }
  }

  // ---- Entrance reveals: voyage stops, stat cells, pillar cards ----
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('in'), i * 60);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: .25 });
  document.querySelectorAll('.stop, .stat-cell, .tilt-card').forEach(el => io.observe(el));

  // ---- Count-up stats ----
  const countIo = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseInt(el.dataset.count, 10);
        const prefix = el.dataset.prefix || '';
        const start = performance.now();
        function tick(now) {
          const p = Math.min((now - start) / 1100, 1);
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

  // ---- Curved-path scroll-driven ship — stays UPRIGHT throughout,
  // confined to a safe x:8-22 (of 0-100) corridor so it can never
  // overlap the stop text, which has a matching left gutter in CSS.
  if (!reduceMotion) {
    const track = document.getElementById('voyageTrack');
    const path = document.getElementById('voyagePath');
    const ship = document.getElementById('voyageShip');
    if (track && path && ship) {
      const pathLen = path.getTotalLength();
      const viewBoxHeight = 1300;

      function updateShip() {
        const rect = track.getBoundingClientRect();
        const total = rect.height - window.innerHeight * 0.5;
        const scrolled = Math.min(Math.max(-rect.top + window.innerHeight * 0.5, 0), total);
        const pct = total > 0 ? scrolled / total : 0;

        const pt = path.getPointAtLength(pct * pathLen);

        ship.style.left = pt.x + '%';
        ship.style.top = (pt.y / viewBoxHeight * 100) + '%';
        // No rotation applied — only depth (translateZ), so the ship
        // stays upright as it travels the curve.
        ship.style.transform = `translateZ(${Math.sin(pct * Math.PI) * 36}px)`;

        requestAnimationFrame(updateShip);
      }
      requestAnimationFrame(updateShip);
    }
  }

  // ---- Mouse-tilt for pillar cards and stat cells (desktop only) ----
  if (hasHover && !reduceMotion) {
    document.querySelectorAll('.tilt-card, .stat-cell').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `rotateY(${px * 12}deg) rotateX(${-py * 12}deg) scale(1.02)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'rotateY(0) rotateX(0) scale(1)';
      });
    });
  }

});
