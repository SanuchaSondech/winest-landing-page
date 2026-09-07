/**
 * WINEST - Members Carousel Engine (Touch & Desktop Drag & Momentum)
 * รองรับ:
 * 1. Touch swipe / drag สำหรับมือถือและแท็บเล็ต (ใช้นิ้วเลื่อนได้ทันที)
 * 2. Mouse click & drag สำหรับคอมพิวเตอร์ (คลิกลากได้)
 * 3. Mouse wheel / Trackpad สำหรับเลื่อนแนวนอน
 * 4. รางเลื่อนรูปคนขี่ยูนิคอน (Scrubber bar) คลิกหรือลากเพื่อเลื่อนดูสมาชิกได้
 * 5. ระบบ Inertia / Momentum เมื่อสะบัดนิ้วหรือเมาส์
 * 6. ไร้รอยต่อแบบ Infinite Loop
 * 
 * Performance Optimized:
 * - 0 DOM mutations inside the 60fps render loop
 * - Complete RAF pause when off-screen or tab hidden
 * - Zero layout thrashing (cached geometry)
 * - Subpixel-stabilized GPU translate3d
 */

// Config flag: เปิด/ปิดการเลื่อนของ Carousel (ปิดไว้เป็น false ตามที่ระบุเนื่องจากมีสมาชิกเปิดตัว 2 คน)
export const ENABLE_CAROUSEL_SCROLL = false;

export function initMembersCarousel(options = {}) {
  const container = document.getElementById('membersCarousel');
  const viewport = document.getElementById('membersViewport');
  const track = document.getElementById('membersTrack');
  const sliderWrap = document.getElementById('sliderTrackWrap');
  const sliderRail = document.getElementById('sliderTrackRail') || (sliderWrap && sliderWrap.querySelector('.slider-track-rail'));
  const sliderThumb = document.getElementById('sliderPillThumb');

  if (!container || !viewport || !track) return;

  // ป้องกันการ bind ซ้ำเมื่อ Astro page-load
  if (container.dataset.carouselInitialized === 'true') return;
  container.dataset.carouselInitialized = 'true';

  // ตรวจสอบการเปิด/ปิดการเลื่อน (ถ้าเป็น false ให้แสดงการ์ดแบบ Static Center ไม่เลื่อน)
  const isScrollEnabled = options.enabled ?? (
    container.dataset.scrollEnabled !== 'false' && 
    viewport.dataset.scrollEnabled !== 'false' && 
    ENABLE_CAROUSEL_SCROLL
  );

  if (!isScrollEnabled) {
    container.classList.add('is-static');
    container.dataset.scrollEnabled = 'false';
    viewport.dataset.scrollEnabled = 'false';
    track.style.transform = 'none';
    if (sliderWrap) sliderWrap.style.display = 'none';
    return;
  }

  const groups = track.querySelectorAll('.members-ticker-group');
  if (groups.length < 2) return;

  // เปิดโหมด interactive (CSS class .is-interactive จะหยุด keyframes animation เองโดยไม่ต้องเซ็ต inline style)
  container.classList.add('is-interactive');

  let groupWidth = groups[0].offsetWidth || (track.scrollWidth / 2);
  let currentX = 0;
  let velocity = 0;
  let isDragging = false;
  let hasMoved = false;
  let startX = 0;
  let startY = 0;
  let dragStartX = 0;
  let lastX = 0;
  let lastTime = 0;
  let isHovered = false;
  let isInView = false;
  let isLoopRunning = false;
  let pauseAutoUntil = 0;
  let rafId = null;

  // Cached layout values — updated in measure() on resize, never read in render()
  let cachedRailWidth = 0;
  let cachedThumbWidth = 46;

  const AUTO_SPEED = 0.55; // Pixels per frame (~33px/sec ที่ 60fps)
  const FRICTION = 0.93; // แรงเสียดทานสำหรับ momentum flick

  function measure() {
    let measured = 0;
    if (groups[0]) {
      const rect = groups[0].getBoundingClientRect();
      measured = rect.width || groups[0].offsetWidth;
    }
    if (!measured || measured < 100) {
      measured = track.scrollWidth > 0 ? (track.scrollWidth / 2) : 0;
    }
    if (measured > 100) {
      groupWidth = measured;
    }
    // Cache slider dimensions so render() never reads layout
    if (sliderRail) cachedRailWidth = sliderRail.clientWidth;
    if (sliderThumb) cachedThumbWidth = sliderThumb.clientWidth || 46;
  }
  measure();
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('load', measure, { passive: true });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measure);
  }

  // จัดการตำแหน่งให้อยู่ในลูปแบบ Infinite ไร้รอยต่อ
  function wrapX() {
    if (groupWidth <= 0) return;
    while (currentX <= -groupWidth) {
      currentX += groupWidth;
    }
    while (currentX > 0) {
      currentX -= groupWidth;
    }
  }

  function updateA11ySlider() {
    if (!sliderWrap || groupWidth <= 0) return;
    let normalized = (-currentX) % groupWidth;
    if (normalized < 0) normalized += groupWidth;
    const progress = normalized / groupWidth;
    sliderWrap.setAttribute('aria-valuenow', String(Math.round((1 - progress) * 100)));
  }

  // อัปเดตตำแหน่งลง GPU Compositor (ไม่อ่าน layout และไม่ mutate DOM attributes ใน render loop)
  function render() {
    // ปัดเศษทศนิยม 1 ตำแหน่งเพื่อป้องกัน subpixel texture jitter
    const rx = Math.round(currentX * 10) / 10;
    track.style.transform = `translate3d(${rx}px, 0, 0)`;

    // อัปเดตตำแหน่งคนขี่ยูนิคอนบนแถบสไลด์
    if (sliderRail && sliderThumb && groupWidth > 0) {
      const maxThumbTravel = Math.max(cachedRailWidth - cachedThumbWidth, 0);
      let normalized = (-currentX) % groupWidth;
      if (normalized < 0) normalized += groupWidth;
      const progress = normalized / groupWidth;

      const thumbX = Math.round(Math.min(Math.max((1 - progress) * maxThumbTravel, 0), maxThumbTravel) * 10) / 10;
      sliderThumb.style.transform = `translate3d(${thumbX}px, 0, 0)`;
    }
  }

  // Main Render Loop: ทำงานเฉพาะเมื่ออยู่ในหน้าจอ (isInView) เท่านั้น
  let lastFrameTime = performance.now();
  function tick(now) {
    if (!isLoopRunning) return;

    const dt = Math.min((now - lastFrameTime) / 16.67, 2.5);
    lastFrameTime = now;

    if (isDragging) {
      // ตำแหน่งถูกควบคุมแบบเรียลไทม์จาก Pointer/Touch
    } else if (Math.abs(velocity) > 0.06) {
      // โมเมนตัมจากการสะบัด (Inertia glide)
      currentX += velocity * dt * 16;
      velocity *= Math.pow(FRICTION, dt);
      wrapX();
      render();
    } else {
      velocity = 0;
      const isPaused = isHovered || (Date.now() < pauseAutoUntil);
      if (!isPaused) {
        currentX -= AUTO_SPEED * dt;
        wrapX();
        render();
      }
    }

    if (isLoopRunning) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function startLoop() {
    if (isLoopRunning) return;
    isLoopRunning = true;
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (!isLoopRunning) return;
    isLoopRunning = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // หยุด Loop ทั้งหมดเมื่ออยู่นอกจอเพื่อประหยัด CPU/GPU 100%
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        isInView = entry.isIntersecting;
        if (isInView) {
          startLoop();
        } else {
          stopLoop();
        }
      });
    }, { rootMargin: '80px 0px', threshold: 0 });
    observer.observe(container);
  } else {
    isInView = true;
    startLoop();
  }

  // หยุด Loop เมื่อสลับแท็บ
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
    } else if (isInView) {
      startLoop();
    }
  });

  // Hover detection เพื่อหยุด auto-scroll ให้ผู้ใช้อ่านรายละเอียดการ์ดได้สะดวก
  container.addEventListener('mouseenter', () => { isHovered = true; }, { passive: true });
  container.addEventListener('mouseleave', () => { isHovered = false; }, { passive: true });

  // ----------------------------------------------------
  // 1. Touch Gestures (ใช้นิ้วเลื่อนบนมือถือ/แท็บเล็ต)
  // ----------------------------------------------------
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    isDragging = true;
    hasMoved = false;
    velocity = 0;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragStartX = currentX;
    lastX = startX;
    lastTime = performance.now();
    viewport.classList.add('is-dragging');
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    const clientX = e.touches[0].clientX;
    const clientY = e.touches[0].clientY;
    const diffX = clientX - startX;
    const diffY = clientY - startY;

    if (!hasMoved) {
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 4) {
        hasMoved = true;
      } else if (Math.abs(diffY) > 8) {
        // เจตนาเลื่อนหน้าจอแนวตั้ง (Vertical Scroll)
        isDragging = false;
        viewport.classList.remove('is-dragging');
        return;
      }
    }

    if (hasMoved) {
      currentX = dragStartX + diffX;
      wrapX();
      render();

      const now = performance.now();
      const dt = now - lastTime;
      if (dt > 10) {
        velocity = (clientX - lastX) / dt;
        lastX = clientX;
        lastTime = now;
      }
    }
  }, { passive: true });

  viewport.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    viewport.classList.remove('is-dragging');
    pauseAutoUntil = Date.now() + 1200;
    updateA11ySlider();
  }, { passive: true });

  // ----------------------------------------------------
  // 2. Mouse Click & Drag (คลิกลากบนเดสก์ท็อป)
  // ----------------------------------------------------
  let isMouseDown = false;

  viewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isMouseDown = true;
    isDragging = false;
    hasMoved = false;
    velocity = 0;
    startX = e.clientX;
    dragStartX = currentX;
    lastX = startX;
    lastTime = performance.now();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    const diffX = e.clientX - startX;

    if (!hasMoved && Math.abs(diffX) > 4) {
      hasMoved = true;
      isDragging = true;
      viewport.classList.add('is-dragging');
    }

    if (isDragging) {
      currentX = dragStartX + diffX;
      wrapX();
      render();

      const now = performance.now();
      const dt = now - lastTime;
      if (dt > 10) {
        velocity = (e.clientX - lastX) / dt;
        lastX = e.clientX;
        lastTime = now;
      }
    }
  });

  window.addEventListener('mouseup', () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    isDragging = false;
    viewport.classList.remove('is-dragging');
    pauseAutoUntil = Date.now() + 1200;
    updateA11ySlider();
  });

  // ป้องกันการกดลิงก์โดยไม่ได้ตั้งใจขณะลากเลื่อนการ์ด
  viewport.addEventListener('click', (e) => {
    if (hasMoved) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => { hasMoved = false; }, 50);
    }
  }, true);

  // ----------------------------------------------------
  // 3. Mouse Wheel / Trackpad Horizontal Scroll
  // ----------------------------------------------------
  viewport.addEventListener('wheel', (e) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (Math.abs(delta) > 1) {
      currentX -= delta * 1.15;
      wrapX();
      render();
      pauseAutoUntil = Date.now() + 1500;
    }
  }, { passive: true });

  // ----------------------------------------------------
  // 4. Interactive Scrubber Bar (คนขี่ยูนิคอนบนราง)
  // ----------------------------------------------------
  if (sliderWrap && sliderRail) {
    let isSliderDragging = false;
    let cachedSliderRect = null; // Cached once on drag start, not every mousemove

    function seekFromSlider(clientX) {
      if (!cachedSliderRect || cachedSliderRect.width <= 0) return;
      const maxThumbTravel = Math.max(cachedSliderRect.width - cachedThumbWidth, 1);

      // ให้จุดกึ่งกลางของตัวยูนิคอนอยู่ตรงกับพิกัดเมาส์/นิ้ว
      const rawX = clientX - cachedSliderRect.left - (cachedThumbWidth / 2);
      const thumbRatio = Math.min(Math.max(rawX / maxThumbTravel, 0), 1);

      // สัมพันธ์กับ thumbX = (1 - progress) * maxThumbTravel
      // ดังนั้น progress = 1 - thumbRatio
      currentX = -(1 - thumbRatio) * groupWidth;
      wrapX();
      render();
      pauseAutoUntil = Date.now() + 1800;
    }

    sliderWrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isSliderDragging = true;
      velocity = 0;
      cachedSliderRect = sliderRail.getBoundingClientRect(); // Read layout once on drag start
      seekFromSlider(e.clientX);
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isSliderDragging) return;
      seekFromSlider(e.clientX);
    });

    window.addEventListener('mouseup', () => {
      if (!isSliderDragging) return;
      isSliderDragging = false;
      document.body.style.userSelect = '';
      updateA11ySlider();
    });

    // Touch บนแถบยูนิคอน
    sliderWrap.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      isSliderDragging = true;
      velocity = 0;
      cachedSliderRect = sliderRail.getBoundingClientRect(); // Read layout once on touch start
      seekFromSlider(e.touches[0].clientX);
    }, { passive: true });

    sliderWrap.addEventListener('touchmove', (e) => {
      if (!isSliderDragging || e.touches.length !== 1) return;
      seekFromSlider(e.touches[0].clientX);
    }, { passive: true });

    sliderWrap.addEventListener('touchend', () => {
      isSliderDragging = false;
      updateA11ySlider();
    }, { passive: true });

    // รองรับปุ่มลูกศรซ้าย/ขวาบนคีย์บอร์ด
    sliderWrap.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        currentX -= (groupWidth / 6);
        wrapX();
        render();
        pauseAutoUntil = Date.now() + 1800;
        updateA11ySlider();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        currentX += (groupWidth / 6);
        wrapX();
        render();
        pauseAutoUntil = Date.now() + 1800;
        updateA11ySlider();
      }
    });
  }

  // เรนเดอร์ตำแหน่งเริ่มต้น
  render();
}

/**
 * Interactive Raycast Cursor Spotlight for Roster Magnetic CTA Button
 */
export function initMagneticButton() {
  const magneticBtn = document.getElementById('rosterMagneticBtn');
  if (!magneticBtn || magneticBtn.dataset.bound === 'true') return;
  magneticBtn.dataset.bound = 'true';

  magneticBtn.addEventListener('mousemove', (e) => {
    const rect = magneticBtn.getBoundingClientRect();
    magneticBtn.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    magneticBtn.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, { passive: true });
}

/**
 * Initialize all interactive elements in Members Section
 */
export function initMembersSection() {
  initMembersCarousel();
  initMagneticButton();
}
