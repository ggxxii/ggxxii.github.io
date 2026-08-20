document.documentElement.classList.add('js');

// 15 of the 16 looping clips have no controls, so honouring this preference is
// the only pause affordance those users get: leave them on their first frame.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const prefersReducedMotion = () => reduceMotion.matches;

if (prefersReducedMotion()) {
  document.querySelectorAll('video[autoplay]').forEach((video) => {
    video.autoplay = false;
    video.removeAttribute('autoplay');
    video.pause();
  });
}

const scrollProgressFill = document.querySelector('.scroll-progress span');
const siteHeader = document.querySelector('.site-header');

function updateScrollProgress() {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
  if (scrollProgressFill) {
    scrollProgressFill.style.transform = `scaleX(${progress})`;
  }
  siteHeader?.classList.toggle('is-scrolled', window.scrollY > 24);
}

window.addEventListener('scroll', updateScrollProgress, { passive: true });
window.addEventListener('resize', updateScrollProgress);

const revealItems = document.querySelectorAll('.reveal');
revealItems.forEach((item, index) => item.style.setProperty('--delay', `${Math.min(index * 55, 440)}ms`));
const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.08 });
revealItems.forEach((item) => revealObserver.observe(item));

const sections = [...document.querySelectorAll('main section[id]')];
const navLinks = [...document.querySelectorAll('.site-nav a')];
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
    }
  });
}, { rootMargin: '-28% 0px -58% 0px', threshold: 0 });
sections.forEach((section) => sectionObserver.observe(section));

const retargetComparisons = [...document.querySelectorAll('[data-retarget-compare]')];
retargetComparisons.forEach((retargetCompare) => {
  const originalVideo = retargetCompare.querySelector('[data-retarget-original]');
  const robotVideo = retargetCompare.querySelector('[data-retarget-robot]');
  const stage = retargetCompare.querySelector('[data-retarget-stage]');
  let split = 50;
  let lastOriginalTime = 0;

  // Every clip in assets/retargeting carries exactly one keyframe, so seeking
  // to anything but t=0 makes the decoder replay the file from its first frame.
  // The old code re-seeked the robot layer on every timeupdate it found more
  // than 0.12s out, which turned into a seek storm: each correction stalled the
  // decoder, the stall widened the drift, and the stage crawled while the rail
  // thumbnail — which is never seeked — ran at true speed. Correct only drifts
  // small enough to be real, and let the wrap handler realign at t=0.
  const DRIFT_TOLERANCE = 0.35; // ~10 frames at 30 fps
  const LOOP_APART = 1;

  function setRetargetSplit(value) {
    split = Math.min(100, Math.max(0, Number(value) || 0));
    retargetCompare.style.setProperty('--retarget-split', `${split}%`);
    if (stage) {
      const rounded = Math.round(split);
      stage.setAttribute('aria-valuenow', String(rounded));
      stage.setAttribute('aria-valuetext', `${rounded}% original, ${100 - rounded}% retargeted`);
    }
  }

  function splitFromPointer(event) {
    const rect = stage.getBoundingClientRect();
    if (!rect.width) return split;
    return ((event.clientX - rect.left) / rect.width) * 100;
  }

  function syncRobotVideo(force = false) {
    if (!originalVideo || !robotVideo || robotVideo.seeking) {
      return;
    }

    const drift = Math.abs(robotVideo.currentTime - originalVideo.currentTime);
    // A drift of seconds means one of the two has wrapped; realigning that at
    // an arbitrary offset is the expensive case, so leave it to the wrap branch.
    if (!force && (drift <= DRIFT_TOLERANCE || drift > LOOP_APART)) {
      return;
    }

    try {
      robotVideo.currentTime = originalVideo.currentTime;
    } catch {}
  }

  function setRetargetPlayback(playing) {
    if (!originalVideo || !robotVideo) {
      return;
    }

    if (playing) {
      syncRobotVideo(true);
      Promise.allSettled([originalVideo.play(), robotVideo.play()]);
      retargetCompare.classList.remove('is-paused');
    } else {
      originalVideo.pause();
      robotVideo.pause();
      retargetCompare.classList.add('is-paused');
    }
  }

  // The stage is the control: a mouse scrubs on hover, touch and pen drag.
  stage?.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' && event.buttons === 0) return;
    setRetargetSplit(splitFromPointer(event));
  });

  stage?.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') {
      stage.setPointerCapture?.(event.pointerId);
    }
    setRetargetSplit(splitFromPointer(event));
  });

  stage?.addEventListener('pointerup', (event) => {
    if (stage.hasPointerCapture?.(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
  });

  stage?.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 4;
    let next = null;
    if (event.key === 'ArrowLeft') next = split - step;
    else if (event.key === 'ArrowRight') next = split + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 100;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    setRetargetSplit(next);
  });

  originalVideo?.addEventListener('timeupdate', () => {
    const now = originalVideo.currentTime;
    if (now + 0.05 < lastOriginalTime) {
      // The original just looped. t=0 is the one seek these clips answer for
      // free, so snap the robot there instead of chasing an arbitrary offset.
      try {
        robotVideo.currentTime = 0;
      } catch {}
      if (!originalVideo.paused) {
        robotVideo?.play?.().catch(() => {});
      }
    } else {
      syncRobotVideo();
    }
    lastOriginalTime = now;
  });
  originalVideo?.addEventListener('seeking', () => syncRobotVideo(true));
  originalVideo?.addEventListener('play', () => setRetargetPlayback(true));
  originalVideo?.addEventListener('pause', () => {
    if (!originalVideo.ended) {
      setRetargetPlayback(false);
    }
  });

  setRetargetSplit(50);
});

const retargetCarousel = document.querySelector('[data-retarget-carousel]');
if (retargetCarousel) {
  const panels = [...retargetCarousel.querySelectorAll('[data-retarget-panel]')];
  const retargetLayout = retargetCarousel.closest('.retarget-layout');
  const thumbs = [...(retargetLayout?.querySelectorAll('[data-retarget-thumb]') ?? [])];
  let retargetIndex = Math.max(0, panels.findIndex((panel) => panel.classList.contains('active')));

  function setRetargetIndex(nextIndex) {
    if (!panels.length) {
      return;
    }

    retargetIndex = (nextIndex + panels.length) % panels.length;
    panels.forEach((panel, index) => {
      const active = index === retargetIndex;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
      panel.setAttribute('aria-hidden', String(!active));

      const originalVideo = panel.querySelector('[data-retarget-original]');
      const robotVideo = panel.querySelector('[data-retarget-robot]');
      if (!active) {
        originalVideo?.pause();
        robotVideo?.pause();
        return;
      }

      try {
        if (originalVideo) originalVideo.currentTime = 0;
        if (robotVideo) robotVideo.currentTime = 0;
      } catch {}
      if (!prefersReducedMotion()) {
        originalVideo?.play().catch(() => {});
      }
    });

    thumbs.forEach((thumb, index) => {
      const active = index === retargetIndex;
      thumb.classList.toggle('active', active);
      thumb.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }

  thumbs.forEach((thumb, index) => {
    const thumbVideo = thumb.querySelector('video');
    thumb.addEventListener('click', () => setRetargetIndex(index));
    thumb.addEventListener('mouseenter', () => {
      if (!prefersReducedMotion()) thumbVideo?.play?.().catch(() => {});
    });
  });

  retargetCarousel.addEventListener('keydown', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-retarget-stage]')) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setRetargetIndex(retargetIndex - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setRetargetIndex(retargetIndex + 1);
    }
  });

  // The rail and the compare stage are ~8 MB of video. The markup ships panel 0
  // visible and thumb 0 active, so nothing has to run until they are near view.
  function startRetarget() {
    if (prefersReducedMotion()) {
      // still load a frame so the rail and stage are not blank
      thumbs.forEach((thumb) => thumb.querySelector('video')?.load?.());
      panels.forEach((panel) => {
        panel.querySelector('[data-retarget-original]')?.load?.();
        panel.querySelector('[data-retarget-robot]')?.load?.();
      });
      return;
    }
    thumbs.forEach((thumb) => thumb.querySelector('video')?.play?.().catch(() => {}));
    setRetargetIndex(retargetIndex);
  }

  if ('IntersectionObserver' in window) {
    const gate = new IntersectionObserver((entries, observer) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        startRetarget();
      }
    }, { rootMargin: '1400px 0px' });
    gate.observe(retargetLayout ?? retargetCarousel);
  } else {
    startRetarget();
  }
}

const qualitativeCarousel = document.querySelector('[data-qualitative-carousel]');
if (qualitativeCarousel) {
  const qualitativeShell = qualitativeCarousel.closest('.qualitative-grid-shell') ?? qualitativeCarousel;
  const datasetChips = [...qualitativeShell.querySelectorAll('[data-qualitative-dataset]')];
  const sceneButtons = [...qualitativeShell.querySelectorAll('[data-qualitative-case]')];
  const methodButtons = [...qualitativeCarousel.querySelectorAll('[data-qualitative-method]')];
  const qualitativeVideos = [...qualitativeCarousel.querySelectorAll('.qualitative-thumb-video')];
  // `ref` names the first tile: the benchmarks have ground truth, the wild
  // clips do not, so there the tile carries the raw input video instead.
  const caseList = [
    { label: 'ARCTIC', ref: 'GT' },
    { label: 'ARCTIC', ref: 'GT' },
    { label: 'ARCTIC', ref: 'GT' },
    { label: 'HOT3D', ref: 'GT' },
    { label: 'OAKINK2', ref: 'GT' },
    { label: 'OAKINK2', ref: 'GT' },
    { label: 'OAKINK2', ref: 'GT' },
    { label: 'IN THE WILD', ref: 'Input' },
    { label: 'IN THE WILD', ref: 'Input' },
    { label: 'IN THE WILD', ref: 'Input' },
    { label: 'IN THE WILD', ref: 'Input' },
    { label: 'IN THE WILD', ref: 'Input' },
  ];
  const refLabel = qualitativeShell.querySelector('.qualitative-thumb-gt .qualitative-thumb-label');
  let qualitativeIndex = 0;
  let qualitativeReady = false;
  let qualitativeAutoTimer = null;
  const qualitativeAutoIntervalMs = 8000;
  const loadedScenes = new Set();

  function freezeVideo(video) {
    video?.pause?.();
    try {
      if (video && video.readyState > 0) {
        video.currentTime = 0;
      }
    } catch {}
  }

  function sceneVideos(index) {
    const key = (index + caseList.length) % caseList.length;
    return methodButtons
      .map((button) => button.querySelectorAll('.qualitative-thumb-frame video')[key])
      .filter(Boolean);
  }

  // 12 scenes x 8 tiles is ~29 MB; fetching that in one go when the section
  // nears the viewport is what the per-scene gate below avoids. Only the scene
  // being shown (plus the next one, prefetched) ever leaves preload="none".
  function ensureSceneLoaded(index, onReady) {
    const key = (index + caseList.length) % caseList.length;
    if (loadedScenes.has(key)) {
      onReady?.();
      return;
    }
    loadedScenes.add(key);

    const videos = sceneVideos(key);
    let pending = videos.length;
    if (!pending) {
      onReady?.();
      return;
    }

    const settle = (video) => {
      freezeVideo(video);
      pending -= 1;
      if (pending <= 0) onReady?.();
    };

    videos.forEach((video) => {
      video.preload = 'auto';
      if (video.readyState >= 2) {
        settle(video);
        return;
      }
      video.addEventListener('loadeddata', () => settle(video), { once: true });
      video.addEventListener('error', () => settle(video), { once: true });
      video.load?.();
    });
  }

  function primeQualitativeVideos() {
    qualitativeShell.classList.add('is-loading');

    // Attribute normalisation only — none of this touches the network.
    qualitativeVideos.forEach((video) => {
      video.autoplay = false;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.removeAttribute('autoplay');
      video.hidden = false;
      freezeVideo(video);
    });

    ensureSceneLoaded(qualitativeIndex, () => {
      qualitativeReady = true;
      qualitativeShell.classList.remove('is-loading');
      qualitativeShell.classList.add('is-ready');
      syncQualitativePlayback();
    });
    ensureSceneLoaded(qualitativeIndex + 1);
  }

  function applyQualitativeSelection(nextIndex) {
    if (!methodButtons.length) return [];

    qualitativeIndex = (nextIndex + caseList.length) % caseList.length;
    const current = caseList[qualitativeIndex];
    datasetChips.forEach((chip) => {
      chip.classList.toggle('is-active', chip.dataset.qualitativeDataset === current.label);
    });
    if (refLabel) refLabel.textContent = current.ref;

    sceneButtons.forEach((button, buttonIndex) => {
      const active = buttonIndex === qualitativeIndex;
      button.classList.toggle('active', active);
      if (active) {
        button.setAttribute('aria-current', 'true');
      } else {
        button.removeAttribute('aria-current');
      }
    });

    const activeVideos = [];

    methodButtons.forEach((button) => {
      const frame = button.querySelector('.qualitative-thumb-frame');
      if (!frame) return;

      const videos = [...frame.querySelectorAll('video')];
      videos.forEach((video, videoIndex) => {
        const active = videoIndex === qualitativeIndex;
        video.classList.toggle('is-active', active);
        video.hidden = false;
        if (active) {
          activeVideos.push(video);
        } else {
          freezeVideo(video);
        }
      });

      button.classList.toggle('active', button.dataset.qualitativeFolder === 'ours');
    });

    return activeVideos;
  }

  function playQualitativeSelection(activeVideos) {
    if (!activeVideos.length || prefersReducedMotion()) return;

    window.requestAnimationFrame(() => {
      activeVideos.forEach((video) => {
        try {
          video.currentTime = 0;
        } catch {}
      });
      window.requestAnimationFrame(() => {
        activeVideos.forEach((video) => {
          video.play?.().catch(() => {});
        });
      });
    });
  }

  function setQualitativeIndex(nextIndex) {
    const activeVideos = applyQualitativeSelection(nextIndex);
    ensureSceneLoaded(qualitativeIndex, () => {
      if (qualitativeReady) {
        playQualitativeSelection(activeVideos);
      }
    });
    ensureSceneLoaded(qualitativeIndex + 1);
  }

  function stopQualitativeAuto() {
    if (qualitativeAutoTimer) {
      window.clearInterval(qualitativeAutoTimer);
      qualitativeAutoTimer = null;
    }
  }

  function startQualitativeAuto() {
    stopQualitativeAuto();
    if (caseList.length <= 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    qualitativeAutoTimer = window.setInterval(() => {
      setQualitativeIndex(qualitativeIndex + 1);
    }, qualitativeAutoIntervalMs);
  }

  function restartQualitativeAuto() {
    if (qualitativeReady) {
      startQualitativeAuto();
    }
  }

  function syncQualitativePlayback() {
    const activeVideos = applyQualitativeSelection(qualitativeIndex);
    if (qualitativeReady) {
      playQualitativeSelection(activeVideos);
      startQualitativeAuto();
    }
  }

  sceneButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setQualitativeIndex(Number(button.dataset.qualitativeCase) || 0);
      restartQualitativeAuto();
    });
  });

  qualitativeCarousel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setQualitativeIndex(qualitativeIndex - 1);
      restartQualitativeAuto();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setQualitativeIndex(qualitativeIndex + 1);
      restartQualitativeAuto();
    }
  });

  // 56 clips is ~14 MB. Hold the eager preload until the grid is nearly in
  // view; until then the markup's own first-per-cell video is all that loads.
  function startQualitative() {
    primeQualitativeVideos();
    setQualitativeIndex(0);
  }

  if ('IntersectionObserver' in window) {
    const gate = new IntersectionObserver((entries, observer) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        startQualitative();
      }
    }, { rootMargin: '1000px 0px' });
    gate.observe(qualitativeShell);
  } else {
    startQualitative();
  }
}

const resultsCarousel = document.querySelector('[data-results-carousel]');
if (resultsCarousel) {
  const panels = [...resultsCarousel.querySelectorAll('[data-results-panel]')];
  const tabs = [...document.querySelectorAll('[data-results-tab]')];
  const resultsStage = resultsCarousel.querySelector('.results-carousel-stage');
  let resultsIndex = Math.max(0, panels.findIndex((panel) => panel.classList.contains('active')));
  let resultsTimer = null;
  const resultsIntervalMs = 8000;

  function setResultsIndex(nextIndex, options = {}) {
    if (!panels.length) {
      return;
    }

    const previousIndex = resultsIndex;
    resultsIndex = (nextIndex + panels.length) % panels.length;

    // Slide the incoming table in from the side we are travelling towards,
    // taking the shorter way round so wrapping 4 -> 0 still reads as forward.
    let step = resultsIndex - previousIndex;
    if (step > panels.length / 2) step -= panels.length;
    if (step < -panels.length / 2) step += panels.length;
    resultsStage?.style.setProperty('--from', step < 0 ? '-22px' : '22px');

    panels.forEach((panel, index) => {
      const active = index === resultsIndex;
      panel.hidden = false;
      // re-trigger the entry animation even when the class is already there
      if (active && index !== previousIndex) {
        panel.classList.remove('active');
        void panel.offsetWidth;
      }
      panel.classList.toggle('active', active);
      panel.setAttribute('aria-hidden', String(!active));

      if (active) {
        panel.querySelector('.results-table-wrap')?.scrollTo({ left: 0, top: 0 });
      }
    });

    tabs.forEach((tab, index) => {
      const active = index === resultsIndex;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-current', active ? 'true' : 'false');
    });

    if (options.resetTimer) {
      restartResultsAutoplay();
    }
  }

  function stopResultsAutoplay() {
    if (resultsTimer) {
      window.clearInterval(resultsTimer);
      resultsTimer = null;
    }
  }

  function startResultsAutoplay() {
    if (panels.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    stopResultsAutoplay();
    resultsTimer = window.setInterval(() => {
      setResultsIndex(resultsIndex + 1);
    }, resultsIntervalMs);
  }

  function restartResultsAutoplay() {
    stopResultsAutoplay();
    startResultsAutoplay();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setResultsIndex(index, { resetTimer: true }));
  });

  resultsCarousel.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setResultsIndex(resultsIndex - 1, { resetTimer: true });
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setResultsIndex(resultsIndex + 1, { resetTimer: true });
    }
  });

  setResultsIndex(resultsIndex);

  // Rotating from page load meant arriving mid-cycle on a random dataset.
  // Start from the first tab when the section actually comes into view, and
  // stop again once it leaves so the tab is not somewhere unexpected on return.
  if ('IntersectionObserver' in window) {
    const gate = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setResultsIndex(0);
          startResultsAutoplay();
        } else {
          stopResultsAutoplay();
        }
      });
    }, { threshold: 0.25 });
    gate.observe(resultsCarousel);
  } else {
    startResultsAutoplay();
  }
}

updateScrollProgress();
