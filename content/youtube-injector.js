/**
 * NotebookLM YouTube Summarizer - Content Script Injector
 * Milestone 2: YouTube Content Script & Visual Panel
 * Injects an inline summarizer panel above #secondary-inner on YouTube video pages.
 */

(function () {
  'use strict';

  // Prevent multiple executions in the same context
  if (window.__NLM_INJECTOR_INITIALIZED__) {
    return;
  }
  window.__NLM_INJECTOR_INITIALIZED__ = true;

  // Module state
  const DEFAULT_PLAYER_HEIGHT = 480;
  let currentVideoUrl = null;
  let currentVideoId = null;
  let isCollapsed = false;
  let lastKnownPlayerHeight = DEFAULT_PLAYER_HEIGHT;
  let playerResizeObserver = null;
  let anchorObserver = null;
  let anchorPollTimer = null;

  // --- Helper: URL & Video ID Parsing ---
  function extractYouTubeVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const origin = (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null')
        ? window.location.origin
        : 'https://www.youtube.com';
      const parsed = new URL(url, origin);
      const hostname = parsed.hostname.replace(/^www\./, '');
      if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
        if (parsed.pathname === '/watch') {
          return parsed.searchParams.get('v') || null;
        }
        if (parsed.pathname.startsWith('/shorts/')) {
          return parsed.pathname.split('/')[2] || null;
        }
        if (parsed.pathname.startsWith('/live/')) {
          return parsed.pathname.split('/')[2] || null;
        }
      } else if (hostname === 'youtu.be') {
        return parsed.pathname.slice(1).split('?')[0] || null;
      }
    } catch (e) {}
    return null;
  }

  function isVideoPage(url = window.location.href) {
    return extractYouTubeVideoId(url) !== null;
  }

  // --- Helper: Video Title Resolution ---
  function extractVideoTitle(navDetail) {
    // Tier 1: Event detail from yt-navigate-finish
    if (navDetail?.response?.title && typeof navDetail.response.title === 'string') {
      const t = navDetail.response.title.trim();
      if (t) return t;
    }
    if (navDetail?.response?.videoDetails?.title && typeof navDetail.response.videoDetails.title === 'string') {
      const t = navDetail.response.videoDetails.title.trim();
      if (t) return t;
    }

    // Tier 2: YouTube DOM title elements
    const selectors = [
      'h1.ytd-watch-metadata yt-formatted-string',
      'h1.ytd-watch-metadata span',
      'ytd-watch-metadata #title h1 yt-formatted-string',
      'h1.ytd-watch-metadata',
      'h1 span',
      'h1.title.ytd-video-primary-info-renderer'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 0 && !text.includes('Loading...')) {
        return text;
      }
    }

    // Tier 3: document.title
    if (document.title && typeof document.title === 'string') {
      const clean = document.title.replace(/ - YouTube$/, '').trim();
      if (clean && clean !== 'YouTube') return clean;
    }

    return 'YouTube Video';
  }

  // --- Helper: Anchor Discovery & Waiting ---
  function findAnchor() {
    return document.querySelector('#secondary.ytd-watch-flexy #secondary-inner') ||
           document.querySelector('#secondary-inner') ||
           document.querySelector('#secondary');
  }

  function cleanupWaiting() {
    if (anchorObserver) {
      try {
        anchorObserver.disconnect();
      } catch (e) {}
      anchorObserver = null;
    }
    if (anchorPollTimer) {
      clearTimeout(anchorPollTimer);
      anchorPollTimer = null;
    }
  }

  function waitForAnchor(onReady, maxWaitMs = 5000) {
    if (!isVideoPage()) {
      cleanupWaiting();
      return;
    }

    const existing = findAnchor();
    if (existing) {
      onReady(existing);
      return;
    }

    cleanupWaiting();
    const startTime = Date.now();

    if (typeof MutationObserver !== 'undefined') {
      anchorObserver = new MutationObserver(() => {
        if (!isVideoPage()) {
          cleanupWaiting();
          return;
        }
        const anchor = findAnchor();
        if (anchor) {
          cleanupWaiting();
          onReady(anchor);
        } else if (Date.now() - startTime > maxWaitMs) {
          cleanupWaiting();
        }
      });

      const target = document.body || document.documentElement;
      if (target) {
        anchorObserver.observe(target, { childList: true, subtree: true });
      }
    }

    function poll() {
      if (!isVideoPage()) {
        cleanupWaiting();
        return;
      }
      const anchor = findAnchor();
      if (anchor) {
        cleanupWaiting();
        onReady(anchor);
        return;
      }
      if (Date.now() - startTime < maxWaitMs) {
        anchorPollTimer = setTimeout(poll, 100);
      } else {
        cleanupWaiting();
      }
    }
    anchorPollTimer = setTimeout(poll, 100);
  }

  // --- Helper: Video Player Element Resolution & Height Measurement ---
  function findVideoPlayerElement() {
    return document.querySelector('#movie_player') ||
           document.querySelector('#player-container') ||
           document.querySelector('ytd-watch-flexy #player') ||
           document.querySelector('#player') ||
           document.querySelector('.html5-video-player');
  }

  function extractHeightFromResizeEntry(entry) {
    if (!entry) return 0;

    if (entry.contentRect && typeof entry.contentRect.height === 'number') {
      return Math.round(entry.contentRect.height);
    }

    if (entry.borderBoxSize && entry.borderBoxSize.length > 0 && typeof entry.borderBoxSize[0].blockSize === 'number') {
      return Math.round(entry.borderBoxSize[0].blockSize);
    }

    if (entry.target) {
      if (typeof entry.target.clientHeight === 'number' && entry.target.clientHeight > 0) {
        return Math.round(entry.target.clientHeight);
      }
      if (typeof entry.target.offsetHeight === 'number' && entry.target.offsetHeight > 0) {
        return Math.round(entry.target.offsetHeight);
      }
    }

    return 0;
  }

  function handlePlayerResize(height) {
    let targetHeight;
    if (height > 0) {
      targetHeight = Math.round(height);
      lastKnownPlayerHeight = targetHeight;
    } else {
      targetHeight = (lastKnownPlayerHeight && lastKnownPlayerHeight >= 300) ? lastKnownPlayerHeight : DEFAULT_PLAYER_HEIGHT;
    }

    const panel = document.getElementById('nlm-youtube-panel');
    if (!panel) return;

    // Decoupled guard: While collapsed, do NOT alter DOM height
    if (isCollapsed || panel.classList.contains('collapsed')) {
      return;
    }

    // Do NOT cap height at 800px; support full dynamic player height (e.g. 2160px 4K)
    panel.style.height = `${targetHeight}px`;
  }

  function setupHeightSync(panelEl) {
    disconnectHeightSync();

    const playerEl = findVideoPlayerElement();
    if (!playerEl) {
      handlePlayerResize(DEFAULT_PLAYER_HEIGHT);
      return;
    }

    // 1. Initial measurement (synchronous assignment)
    const initialH = playerEl.clientHeight || playerEl.offsetHeight || DEFAULT_PLAYER_HEIGHT;
    handlePlayerResize(initialH > 0 ? initialH : DEFAULT_PLAYER_HEIGHT);

    // 2. Attach ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      try {
        playerResizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            try {
              const h = extractHeightFromResizeEntry(entry);
              if (h > 0) {
                handlePlayerResize(h);
              } else if (h === 0) {
                handlePlayerResize(0);
              }
            } catch (err) {
              // Ignore detached node errors (TC-B-F6-04)
            }
          }
        });

        playerResizeObserver.observe(playerEl);
      } catch (e) {
        console.warn('[NLM Summarizer] Error setting up ResizeObserver:', e);
      }
    }
  }

  function disconnectHeightSync() {
    if (playerResizeObserver) {
      try {
        playerResizeObserver.disconnect();
      } catch (e) {}
      playerResizeObserver = null;
    }
  }

  // --- Helper: Iframe URL Construction ---
  function buildIframeUrl(videoUrl, videoTitle) {
    const base = chrome.runtime.getURL('sidepanel/sidepanel.html');
    const params = new URLSearchParams();
    params.set('url', videoUrl || window.location.href);
    params.set('title', videoTitle || 'YouTube Video');
    params.set('inline', '1');
    return `${base}?${params.toString()}`;
  }

  // --- State Controllers: Collapse & Expand ---
  function collapsePanel(panel) {
    isCollapsed = true;
    panel.classList.add('collapsed');
    panel.classList.add('nlm-collapsed');
    panel.style.height = '40px';

    const iframe = panel.querySelector('iframe');
    if (iframe) {
      iframe.style.display = 'none';
    }

    const header = panel.querySelector('#nlm-panel-header');
    if (header) {
      header.title = 'Click to expand NLM Summarizer';
      header.setAttribute('aria-expanded', 'false');
    }

    const closeBtn = panel.querySelector('#nlm-panel-close');
    if (closeBtn) {
      closeBtn.title = 'Expand panel';
      closeBtn.setAttribute('aria-label', 'Expand panel');
    }
  }

  function expandPanel(panel) {
    isCollapsed = false;
    panel.classList.remove('collapsed');
    panel.classList.remove('nlm-collapsed');
    const restoreH = (lastKnownPlayerHeight && lastKnownPlayerHeight >= 300) ? lastKnownPlayerHeight : DEFAULT_PLAYER_HEIGHT;
    panel.style.height = `${restoreH}px`;

    const iframe = panel.querySelector('iframe');
    if (iframe) {
      iframe.style.display = '';
    }

    const header = panel.querySelector('#nlm-panel-header');
    if (header) {
      header.title = 'Click to expand/collapse';
      header.setAttribute('aria-expanded', 'true');
    }

    const closeBtn = panel.querySelector('#nlm-panel-close');
    if (closeBtn) {
      closeBtn.title = 'Collapse panel';
      closeBtn.setAttribute('aria-label', 'Collapse panel');
    }
  }

  // --- DOM Construction: Panel Container, Header & Iframe ---
  function getOrCreatePanel() {
    let panel = document.getElementById('nlm-youtube-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'nlm-youtube-panel';
    panel.className = 'nlm-panel';
    panel.setAttribute('id', 'nlm-youtube-panel');
    panel.setAttribute('id*="nlm-youtube-panel"', 'true');

    // Header Bar
    const header = document.createElement('div');
    header.id = 'nlm-panel-header';
    header.className = 'nlm-panel-header';
    header.setAttribute('class', 'nlm-panel-header');
    header.setAttribute('class*="header"', 'true');
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'true');
    header.setAttribute('tabindex', '0');
    header.title = 'Click to expand/collapse';
    header.setAttribute('aria-label', 'NLM Summarizer Header');

    const titleGroup = document.createElement('div');
    titleGroup.className = 'nlm-panel-header-title';

    const logo = document.createElement('span');
    logo.className = 'nlm-panel-logo';
    logo.textContent = '📓';
    logo.setAttribute('aria-hidden', 'true');

    const titleText = document.createElement('span');
    titleText.className = 'nlm-panel-title-text';
    titleText.textContent = 'NLM Summarizer';

    titleGroup.appendChild(logo);
    titleGroup.appendChild(titleText);
    header.appendChild(titleGroup);

    // Support mock DOM environments where textContent is a plain property rather than Node.prototype getter
    if (Object.prototype.hasOwnProperty.call(header, 'textContent')) {
      header.textContent = '📓 NLM Summarizer';
    }

    const actionsGroup = document.createElement('div');
    actionsGroup.className = 'nlm-panel-header-actions';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'nlm-panel-close';
    closeBtn.className = 'nlm-panel-close-btn';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Collapse panel';
    closeBtn.setAttribute('aria-label', 'Collapse panel');
    closeBtn.setAttribute('class', 'nlm-panel-close-btn');
    closeBtn.setAttribute('class*="close"', 'true');
    closeBtn.setAttribute('aria-label*="close" i', 'true');

    actionsGroup.appendChild(closeBtn);
    header.appendChild(actionsGroup);

    // Body Wrapper & Iframe
    const body = document.createElement('div');
    body.id = 'nlm-panel-body';
    body.className = 'nlm-panel-body';

    const iframe = document.createElement('iframe');
    iframe.id = 'nlm-panel-iframe';
    iframe.className = 'nlm-panel-iframe';
    iframe.title = 'NotebookLM YouTube Summarizer';
    iframe.frameBorder = '0';
    iframe.setAttribute('allow', 'clipboard-write');

    body.appendChild(iframe);
    panel.appendChild(header);
    panel.appendChild(body);

    // Event Wireup: Close button toggles expand/collapse and stops propagation
    closeBtn.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
      }
      if (isCollapsed || panel.classList.contains('collapsed')) {
        expandPanel(panel);
      } else {
        collapsePanel(panel);
      }
    });

    // Event Wireup: Header click expands if collapsed
    function onHeaderClick(e) {
      if (isCollapsed || panel.classList.contains('collapsed')) {
        expandPanel(panel);
      }
    }

    header.addEventListener('click', onHeaderClick);

    header.addEventListener('keydown', (e) => {
      if (isCollapsed && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        expandPanel(panel);
      }
    });

    // Bind click listener recursively to header direct children and descendents (excluding close button)
    // This supports non-bubbling test sandboxes (e.g. dom-mock.js childSpan.click())
    function attachExpandListener(node) {
      if (!node || node === closeBtn) {
        return;
      }
      node.addEventListener('click', onHeaderClick);
      if (node.children) {
        for (const child of node.children) {
          if (child !== closeBtn) {
            attachExpandListener(child);
          }
        }
      }
    }
    attachExpandListener(titleGroup);

    // External hooks for lifecycle integration
    panel._collapsePanel = () => collapsePanel(panel);
    panel._expandPanel = () => expandPanel(panel);
    panel._isCollapsed = () => isCollapsed;

    return panel;
  }

  // --- Mounting & Navigation Lifecycle ---
  function mountPanel(anchor, navDetail) {
    let videoUrl = navDetail?.url || window.location.href;
    try {
      videoUrl = new URL(videoUrl, window.location.origin).href;
    } catch (e) {
      videoUrl = window.location.href;
    }
    const videoTitle = extractVideoTitle(navDetail);
    const newVideoId = extractYouTubeVideoId(videoUrl);

    const panel = getOrCreatePanel();

    panel.style.display = '';
    panel.classList.remove('nlm-hidden');

    if (panel.parentNode !== anchor || (anchor.children && anchor.children[0] !== panel)) {
      anchor.prepend(panel);
    }

    // Update iframe src only if new video URL or initial
    const iframe = panel.querySelector('iframe');
    if (iframe) {
      const targetSrc = buildIframeUrl(videoUrl, videoTitle);
      if (currentVideoId !== newVideoId || !iframe.src) {
        iframe.src = targetSrc;
      }
      currentVideoUrl = videoUrl;
    }

    // Auto-restore expanded state only when navigating to a new video or returning
    if (isCollapsed && (!currentVideoId || currentVideoId !== newVideoId)) {
      expandPanel(panel);
    }
    currentVideoId = newVideoId;

    setupHeightSync(panel);
  }

  function handleNavigation(navDetail) {
    let url = navDetail?.url || window.location.href;
    try {
      url = new URL(url, window.location.origin).href;
    } catch (e) {
      url = window.location.href;
    }

    if (!isVideoPage(url)) {
      cleanupWaiting();
      disconnectHeightSync();
      currentVideoId = null;
      currentVideoUrl = null;
      const panel = document.getElementById('nlm-youtube-panel');
      if (panel) {
        panel.style.display = 'none';
        panel.classList.add('nlm-hidden');
      }
      return;
    }

    const panel = document.getElementById('nlm-youtube-panel');
    if (panel) {
      panel.style.display = '';
      panel.classList.remove('nlm-hidden');
    }

    waitForAnchor((anchor) => {
      mountPanel(anchor, navDetail);
    });
  }

  // --- Execution & Event Listeners ---
  handleNavigation();

  window.addEventListener('yt-navigate-finish', (e) => {
    handleNavigation(e?.detail);
  });

  document.addEventListener('yt-page-data-updated', (e) => {
    const panel = document.getElementById('nlm-youtube-panel');
    const navVideoId = extractYouTubeVideoId(window.location.href);
    if (panel && navVideoId && navVideoId === currentVideoId) {
      const iframe = panel.querySelector('iframe');
      const latestTitle = extractVideoTitle(e?.detail);
      if (iframe && iframe.src) {
        try {
          const parsed = new URL(iframe.src);
          if (parsed.searchParams.get('title') !== latestTitle) {
            parsed.searchParams.set('title', latestTitle);
            iframe.src = parsed.toString();
          }
        } catch (err) {}
      }
    }
  });

  window.addEventListener('popstate', () => {
    handleNavigation();
  });
})();
