// scroll-reveal.js - High-Performance Scroll Reveal Engine (100% GPU Compositor)

function initScrollReveal() {
  // If user prefers reduced motion, reveal everything immediately
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal-init').forEach((el) => {
      el.classList.add('is-revealed');
    });
    return;
  }

  const revealElements = document.querySelectorAll('.reveal-init');
  if (!revealElements.length) return;

  // Use a negative bottom margin so the reveal triggers when the element is 10% into the viewport
  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -8% 0px',
    threshold: 0.05
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        // Stop observing once revealed to free memory
        obs.unobserve(entry.target);
      }
    });
  }, observerOptions);

  revealElements.forEach((el) => {
    observer.observe(el);
  });
}

// Run on DOMContentLoaded or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScrollReveal);
} else {
  initScrollReveal();
}

// Support Astro view transitions or dynamic DOM updates
document.addEventListener('astro:page-load', initScrollReveal);
