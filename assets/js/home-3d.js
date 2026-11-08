// Bridge & Bow Travel — homepage-only behavior.
// Loaded ONLY on index.html, after main.js (which handles the menu, cookie banner,
// newsletter submit and header shrink). This file only draws the scroll progress bar.

document.addEventListener('DOMContentLoaded', () => {
  const progress = document.getElementById('progress');
  if (!progress) return;

  function onScroll() {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    progress.style.transform = 'scaleX(' + (max > 0 ? Math.min(h.scrollTop / max, 1) : 0) + ')';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
