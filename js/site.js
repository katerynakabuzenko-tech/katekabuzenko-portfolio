// Shared nav logic for all pages.
// Mobile (<=900px): full-screen overlay (unchanged behaviour).
// Desktop (>900px): inline nav reveal next to the menu icon, icon rotates.
document.addEventListener('DOMContentLoaded', function () {
  var openBtn = document.getElementById('site-menu-open');
  var closeBtn = document.getElementById('site-menu-close');
  var overlay = document.getElementById('site-nav-overlay');
  var headerRight = document.querySelector('.site-header-right');
  if (!openBtn) return;

  var isMobile = function () {
    return window.matchMedia('(max-width:900px)').matches;
  };

  function openMobileMenu() {
    if (!overlay) return;
    overlay.classList.add('open');
    openBtn.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeMobileMenu() {
    if (!overlay) return;
    overlay.classList.remove('open');
    openBtn.classList.remove('active');
    document.body.style.overflow = '';
  }

  function openDesktopNav() {
    if (headerRight) headerRight.classList.add('nav-open');
    openBtn.classList.add('expanded');
  }
  function closeDesktopNav() {
    if (headerRight) headerRight.classList.remove('nav-open');
    openBtn.classList.remove('expanded');
  }

  function isOpen() {
    return isMobile() ? (overlay && overlay.classList.contains('open')) : (headerRight && headerRight.classList.contains('nav-open'));
  }

  openBtn.addEventListener('click', function () {
    if (isMobile()) {
      if (overlay && overlay.classList.contains('open')) { closeMobileMenu(); } else { openMobileMenu(); }
    } else {
      if (headerRight && headerRight.classList.contains('nav-open')) { closeDesktopNav(); } else { openDesktopNav(); }
    }
  });

  if (closeBtn) closeBtn.addEventListener('click', closeMobileMenu);

  if (overlay) {
    overlay.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeMobileMenu);
    });
  }
  if (headerRight) {
    headerRight.querySelectorAll('.site-nav-inline a').forEach(function (a) {
      a.addEventListener('click', closeDesktopNav);
    });
  }

  // Keep state sane when crossing the breakpoint while open.
  window.addEventListener('resize', function () {
    if (isMobile()) {
      closeDesktopNav();
    } else {
      closeMobileMenu();
    }
  });
});

// Custom cursor (dot + trailing ring) — matches the cursor used on Home.
// Sub-pages set `cursor:none` on body via the shared stylesheet, so without
// this the native cursor disappears and nothing replaces it.
document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('cursor')) return; // page already has its own (e.g. Home)
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return; // touch devices

  var cursor = document.createElement('div');
  cursor.id = 'cursor';
  cursor.innerHTML = '<div id="cursor-dot"></div><div id="cursor-ring"></div>';
  document.body.appendChild(cursor);

  var dot = document.getElementById('cursor-dot');
  var ring = document.getElementById('cursor-ring');
  var mx = 0, my = 0, rx = 0, ry = 0;

  document.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
    dot.style.left = mx + 'px'; dot.style.top = my + 'px';
  });

  (function animateRing() {
    rx += (mx - rx) * 0.12;
    ry += (my - ry) * 0.12;
    ring.style.left = rx + 'px';
    ring.style.top = ry + 'px';
    requestAnimationFrame(animateRing);
  })();

  function bindHoverTargets() {
    document.querySelectorAll('a,button,.work-row,.btn-pill,.btn-primary,.about-cv-btn,.contact-submit').forEach(function (el) {
      el.addEventListener('mouseenter', function () { document.body.classList.add('hovering'); });
      el.addEventListener('mouseleave', function () { document.body.classList.remove('hovering'); });
    });
  }
  bindHoverTargets();
});

// Auto-hide header on scroll-down, reveal on scroll-up.
// Desktop also reveals it whenever the cursor parks in the top 80px reveal zone.
document.addEventListener('DOMContentLoaded', function () {
  var header = document.querySelector('.site-header');
  if (!header) return;

  var overlay = document.getElementById('site-nav-overlay');
  var headerRight = document.querySelector('.site-header-right');
  var REVEAL_ZONE = 80;
  var HIDE_THRESHOLD = 80;
  var lastY = window.scrollY;
  var hoverZone = false;

  function isDesktop() {
    return window.matchMedia('(min-width:901px)').matches;
  }
  function navIsOpen() {
    return (headerRight && headerRight.classList.contains('nav-open')) || (overlay && overlay.classList.contains('open'));
  }
  function show() { header.classList.remove('nav-autohidden'); }
  function hide() {
    if (navIsOpen()) return;
    if (isDesktop() && hoverZone) return;
    header.classList.add('nav-autohidden');
  }

  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    if (y <= HIDE_THRESHOLD || y < lastY) {
      show();
    } else if (y > lastY) {
      hide();
    }
    lastY = y;
  }, { passive: true });

  // Desktop-only hover reveal zone — works even mid scroll-down.
  window.addEventListener('mousemove', function (e) {
    if (!isDesktop()) { hoverZone = false; return; }
    if (e.clientY <= REVEAL_ZONE) {
      hoverZone = true;
      show();
    } else {
      hoverZone = false;
    }
  });
});

// Case-study cover image: full-bleed, uncropped — fades and zooms gently
// into place on reveal (handled entirely in CSS via .cs-hero.visible).

// Scroll Stack — project/case-study cards (work. on Home, and the Work
// page's full list) pin in place and gently shrink/blur as the next card
// scrolls up to take its spot, vanilla-JS port of the React Bits
// ScrollStack pattern (no Lenis dependency — this site has no bundler).
document.addEventListener('DOMContentLoaded', function () {
  var rows = Array.prototype.slice.call(document.querySelectorAll('.work-row'));
  if (rows.length < 2) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var mq = window.matchMedia('(max-width:680px)');
  var active = false;
  var ticking = false;

  function enable() {
    if (active) return;
    active = true;
    rows.forEach(function (row, i) {
      row.style.setProperty('--stack-i', i + 1);
      row.classList.add('work-row-stack');
    });
    update();
  }
  function disable() {
    if (!active) return;
    active = false;
    rows.forEach(function (row) {
      row.classList.remove('work-row-stack');
      row.style.transform = '';
      row.style.filter = '';
    });
  }

  function update() {
    ticking = false;
    if (!active) return;
    for (var i = 0; i < rows.length - 1; i++) {
      var row = rows[i];
      var next = rows[i + 1];
      var rowRect = row.getBoundingClientRect();
      var nextRect = next.getBoundingClientRect();
      var overlap = rowRect.bottom - nextRect.top;
      var progress = Math.max(0, Math.min(1, overlap / rowRect.height));
      var scale = 1 - progress * 0.06;
      var blur = progress * 4;
      row.style.transform = 'scale(' + scale.toFixed(4) + ')';
      row.style.filter = progress > 0.02
        ? 'blur(' + blur.toFixed(2) + 'px) brightness(' + (1 - progress * 0.12).toFixed(3) + ')'
        : '';
    }
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }
  function syncBreakpoint() {
    if (mq.matches) { disable(); } else { enable(); }
  }

  syncBreakpoint();
  if (mq.addEventListener) mq.addEventListener('change', syncBreakpoint);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
});
