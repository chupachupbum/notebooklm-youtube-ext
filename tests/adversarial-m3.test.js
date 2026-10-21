const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('./harness/test-helpers.js');

test('Tier 5 - Adversarial Stress Suite: SPA Navigation & Page Lifecycle (M3)', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('content/youtube-injector.js does not exist');
    return;
  }

  // =========================================================================
  // Challenge 1: Rapid Succession SPA Navigations (15+ Rapid Video Switches)
  // =========================================================================

  await t.test('ADV-SPA-01: Rapid succession SPA navigations (15 switches) leaves exactly 1 panel and final iframe src', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_initial'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const initialPanel = sandbox.doc.getElementById('nlm-youtube-panel');
    assert.ok(initialPanel, 'Panel container must exist initially');

    // Fire 15 rapid video navigations synchronously
    for (let i = 1; i <= 15; i++) {
      const url = `https://www.youtube.com/watch?v=rapid_burst_${i}`;
      sandbox.win.location = new URL(url);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url, response: { title: `Rapid Video ${i}` } }
      }));
    }

    // Verify DOM state
    const allPanels = sandbox.doc.querySelectorAll('#nlm-youtube-panel');
    assert.strictEqual(allPanels.length, 1, 'Exactly one panel container must exist in DOM');

    const iframe = initialPanel.querySelector('iframe');
    assert.ok(iframe, 'Iframe must exist inside panel');
    const parsed = new URL(iframe.src);
    assert.strictEqual(
      parsed.searchParams.get('url'),
      'https://www.youtube.com/watch?v=rapid_burst_15',
      'Iframe must reflect final video URL after 15 rapid navigations'
    );
    assert.strictEqual(
      parsed.searchParams.get('title'),
      'Rapid Video 15',
      'Iframe must reflect final video title'
    );
  });

  // =========================================================================
  // Challenge 2: Timestamp Seeks on Same Video (Iframe Reload Guard)
  // =========================================================================

  await t.test('ADV-SPA-02: Timestamp seeks (#t=30s, &t=45s, and youtu.be ?t=45s) do NOT reload iframe src', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=test_seek_vid'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const originalSrc = iframe.src;
    assert.ok(originalSrc, 'Original iframe src must exist');

    // Instrument iframe.src setter to detect any assignment attempts
    let srcSetterCalls = 0;
    let lastAssignedSrc = null;
    let currentSrcValue = iframe.src;
    Object.defineProperty(iframe, 'src', {
      get() {
        return currentSrcValue;
      },
      set(val) {
        srcSetterCalls++;
        lastAssignedSrc = val;
        currentSrcValue = val;
      },
      configurable: true
    });

    // 1. Seek with hash #t=30s on /watch
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=test_seek_vid#t=30s');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=test_seek_vid#t=30s' }
    }));
    assert.strictEqual(srcSetterCalls, 0, 'Iframe src must not be re-assigned on #t=30s hash seek');

    // 2. Seek with query param &t=45s on /watch
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=test_seek_vid&t=45s');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=test_seek_vid&t=45s' }
    }));
    assert.strictEqual(srcSetterCalls, 0, 'Iframe src must not be re-assigned on &t=45s query seek');

    // 3. Seek with query param ?t=45s on youtu.be domain
    sandbox.win.location = new URL('https://youtu.be/test_seek_vid?t=45s');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://youtu.be/test_seek_vid?t=45s' }
    }));
    assert.strictEqual(srcSetterCalls, 0, 'Iframe src must not be re-assigned on youtu.be ?t=45s seek');

    // 4. Now navigate to a genuinely DIFFERENT video
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=different_vid');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=different_vid' }
    }));
    assert.strictEqual(srcSetterCalls, 1, 'Iframe src must be re-assigned when navigating to a new video');
    assert.ok(lastAssignedSrc.includes('different_vid'), 'Assigned src must target the new video');
  });

  await t.test('ADV-SPA-03: Timestamp seeks while collapsed do NOT force expand or flicker UI', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_seek_collapsed'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    closeBtn.click();
    assert.strictEqual(panel.classList.contains('collapsed'), true, 'Panel must be collapsed');
    assert.strictEqual(panel.style.height, '40px', 'Height must be 40px');

    // Seek timestamp in same video
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=vid_seek_collapsed#t=120s');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=vid_seek_collapsed#t=120s' }
    }));

    // Verify it stays collapsed
    assert.strictEqual(panel.classList.contains('collapsed'), true, 'Panel must remain collapsed on seek');
    assert.strictEqual(panel.style.height, '40px', 'Height must remain 40px');

    // Now navigate to new video -> must auto-restore
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=vid_next_uncollapse');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=vid_next_uncollapse' }
    }));

    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Panel must auto-restore on new video');
    assert.notStrictEqual(panel.style.height, '40px', 'Height must not be 40px after auto-restore');
  });

  // =========================================================================
  // Challenge 3: History Back/Forward Rapid Bursts (popstate)
  // =========================================================================

  await t.test('ADV-SPA-04: History back/forward bursts via popstate correctly switch video without duplication', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=hist_vid_1'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const iframe = panel.querySelector('iframe');

    // Navigate to vid 2
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=hist_vid_2');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=hist_vid_2' }
    }));

    // Navigate to vid 3
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=hist_vid_3');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=hist_vid_3' }
    }));
    assert.ok(iframe.src.includes('hist_vid_3'));

    // Rapid popstate back to vid 2
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=hist_vid_2');
    sandbox.win.dispatchEvent(new sandbox.win.Event('popstate'));
    assert.ok(iframe.src.includes('hist_vid_2'), 'popstate back must update iframe to vid 2');

    // Rapid popstate back to vid 1
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=hist_vid_1');
    sandbox.win.dispatchEvent(new sandbox.win.Event('popstate'));
    assert.ok(iframe.src.includes('hist_vid_1'), 'popstate back must update iframe to vid 1');

    // Rapid popstate forward to vid 3
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=hist_vid_3');
    sandbox.win.dispatchEvent(new sandbox.win.Event('popstate'));
    assert.ok(iframe.src.includes('hist_vid_3'), 'popstate forward must update iframe to vid 3');

    // Verify exactly 1 panel in DOM
    const allPanels = sandbox.doc.querySelectorAll('#nlm-youtube-panel');
    assert.strictEqual(allPanels.length, 1, 'Only one panel must exist despite popstate churn');
  });

  // =========================================================================
  // Challenge 4: Route Transitions (watch -> / -> watch -> /@channel -> /feed -> watch)
  // =========================================================================

  await t.test('ADV-LC-01: Rapid transitions across non-video and video routes maintains strict visibility and observer state', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=route_v1',
      playerHeight: 520
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    assert.ok(panel && panel.style.display !== 'none', 'Initial: watch v1 must show panel');

    const routeSequence = [
      { url: 'https://www.youtube.com/', isVideo: false, desc: 'Home page (/)' },
      { url: 'https://www.youtube.com/watch?v=route_v2', isVideo: true, desc: 'Video page (/watch?v=route_v2)' },
      { url: 'https://www.youtube.com/@channelName', isVideo: false, desc: 'Channel page (/@channelName)' },
      { url: 'https://www.youtube.com/feed/explore', isVideo: false, desc: 'Explore feed (/feed/explore)' },
      { url: 'https://www.youtube.com/watch?v=route_v3', isVideo: true, desc: 'Video page (/watch?v=route_v3)' },
      { url: 'https://www.youtube.com/feed/subscriptions', isVideo: false, desc: 'Subscriptions (/feed/subscriptions)' },
      { url: 'https://www.youtube.com/watch?v=route_v1', isVideo: true, desc: 'Return to original video (/watch?v=route_v1)' }
    ];

    for (const step of routeSequence) {
      sandbox.win.location = new URL(step.url);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: step.url }
      }));

      if (step.isVideo) {
        assert.notStrictEqual(panel.style.display, 'none', `Step ${step.desc} must show panel`);
        assert.strictEqual(panel.classList.contains('nlm-hidden'), false, `Step ${step.desc} must not have .nlm-hidden`);
        const iframe = panel.querySelector('iframe');
        assert.ok(iframe.src.includes(new URL(step.url).searchParams.get('v')), `Step ${step.desc} iframe must reflect video ID`);
      } else {
        assert.strictEqual(panel.style.display, 'none', `Step ${step.desc} must hide panel`);
        assert.strictEqual(panel.classList.contains('nlm-hidden'), true, `Step ${step.desc} must have .nlm-hidden`);
      }
    }
  });

  // =========================================================================
  // Challenge 5: Disconnection and Reconnection of ResizeObserver
  // =========================================================================

  await t.test('ADV-LC-02: ResizeObserver disconnects on non-video route and reconnects with accurate height on return', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=ro_test_vid',
      playerHeight: 480
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const initialRO = sandbox.win.ResizeObserver.instances[0];
    assert.ok(initialRO, 'Initial ResizeObserver must exist');
    assert.ok(initialRO.observed.has(sandbox.domNodes.moviePlayer), 'Initial player must be observed');

    // 1. Navigate to non-video page (Home)
    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/' }
    }));

    // Verify initial ResizeObserver was disconnected
    assert.strictEqual(initialRO.observed.size, 0, 'ResizeObserver must be disconnected on non-video page');

    // Trigger resize while on non-video page -> must not throw or update panel
    assert.doesNotThrow(() => {
      initialRO.trigger(sandbox.domNodes.moviePlayer, 720);
    });
    assert.strictEqual(panel.style.display, 'none', 'Panel must stay hidden on non-video page');

    // 2. Return to video page with new player height (600px)
    sandbox.domNodes.moviePlayer.clientHeight = 600;
    sandbox.domNodes.moviePlayer.offsetHeight = 600;

    sandbox.win.location = new URL('https://www.youtube.com/watch?v=ro_test_vid_2');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=ro_test_vid_2' }
    }));

    // New or re-attached ResizeObserver must be active
    const activeRO = sandbox.win.ResizeObserver.instances[sandbox.win.ResizeObserver.instances.length - 1];
    assert.ok(activeRO.observed.has(sandbox.domNodes.moviePlayer), 'Movie player must be observed upon return');

    // Panel height must be updated to 600px
    const hStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(hStr.includes('600'), `Panel height must sync to 600px upon return, got ${hStr}`);

    // Trigger dynamic resize to 800px
    activeRO.trigger(sandbox.domNodes.moviePlayer, 800);
    assert.ok(panel.style.height.includes('800'), 'Dynamic resize to 800px must work after return');
  });

  // =========================================================================
  // Challenge 6: Auto-Restore Across Repeated Collapse/Navigate Cycles (10 cycles)
  // =========================================================================

  await t.test('ADV-LC-03: Repeated collapse and navigate cycles (10 cycles) reliably auto-restore every time', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=cycle_vid_0',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    const iframe = panel.querySelector('iframe');

    for (let cycle = 1; cycle <= 10; cycle++) {
      // 1. Manually collapse
      closeBtn.click();
      assert.strictEqual(panel.classList.contains('collapsed'), true, `Cycle ${cycle}: Must be collapsed`);
      assert.strictEqual(panel.style.height, '40px', `Cycle ${cycle}: Collapsed height must be 40px`);
      assert.strictEqual(iframe.style.display, 'none', `Cycle ${cycle}: Iframe must be display: none`);

      // 2. Navigate to next video
      const nextUrl = `https://www.youtube.com/watch?v=cycle_vid_${cycle}`;
      sandbox.win.location = new URL(nextUrl);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: nextUrl, response: { title: `Cycle Video ${cycle}` } }
      }));

      // 3. Must be auto-restored
      assert.strictEqual(panel.classList.contains('collapsed'), false, `Cycle ${cycle}: Must auto-restore`);
      assert.notStrictEqual(panel.style.height, '40px', `Cycle ${cycle}: Height must restore from 40px`);
      assert.notStrictEqual(iframe.style.display, 'none', `Cycle ${cycle}: Iframe must be visible`);
      assert.ok(iframe.src.includes(`cycle_vid_${cycle}`), `Cycle ${cycle}: Iframe src must update`);
    }
  });

  // =========================================================================
  // Challenge 7: Relative URLs & Title Updating via yt-page-data-updated
  // =========================================================================

  await t.test('ADV-B-01: Relative URLs in yt-navigate-finish do not crash and resolve properly', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=initial_v'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const iframe = panel.querySelector('iframe');

    // Relative /watch?v=...
    assert.doesNotThrow(() => {
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: '/watch?v=rel_watch_123' }
      }));
    });
    assert.ok(iframe.src.includes('rel_watch_123'), 'Relative watch URL must be handled');

    // Relative /shorts/...
    assert.doesNotThrow(() => {
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: '/shorts/rel_shorts_456' }
      }));
    });
    assert.ok(iframe.src.includes('rel_shorts_456'), 'Relative shorts URL must be handled');

    // Relative non-video /feed/history
    assert.doesNotThrow(() => {
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: '/feed/history' }
      }));
    });
    assert.strictEqual(panel.style.display, 'none', 'Relative non-video URL must hide panel');
  });

  await t.test('ADV-B-02: Title update via yt-page-data-updated updates iframe title query param on document event', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=title_update_vid',
      videoTitle: 'Initial Title'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const iframe = panel.querySelector('iframe');
    const initialParsed = new URL(iframe.src);
    assert.strictEqual(initialParsed.searchParams.get('title'), 'Initial Title');

    // Update title via yt-page-data-updated on document
    sandbox.doc.dispatchEvent(new sandbox.win.CustomEvent('yt-page-data-updated', {
      detail: { response: { title: 'Updated Modern Title' } }
    }));

    const updatedParsed = new URL(iframe.src);
    assert.strictEqual(
      updatedParsed.searchParams.get('title'),
      'Updated Modern Title',
      'yt-page-data-updated must update iframe title parameter'
    );
    assert.strictEqual(
      updatedParsed.searchParams.get('url'),
      initialParsed.searchParams.get('url'),
      'Video URL in iframe must remain intact'
    );
  });

  // =========================================================================
  // Empirical Adversarial Vulnerability Challenge
  // =========================================================================

  await t.test('ADV-CHALLENGE-01: [REMEDIATED] yt-page-data-updated title update handled when URL contains query/hash variation', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=probe_vid',
      videoTitle: 'Initial Title'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const iframe = panel.querySelector('iframe');

    // User seeks timestamp: window.location.href changes to include #t=30s
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=probe_vid#t=30s');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=probe_vid#t=30s' }
    }));

    // Modern YouTube delivers updated title on document
    sandbox.doc.dispatchEvent(new sandbox.win.CustomEvent('yt-page-data-updated', {
      detail: { response: { title: 'Updated Title After Seek' } }
    }));

    const currentTitleInIframe = new URL(iframe.src).searchParams.get('title');

    assert.strictEqual(
      currentTitleInIframe,
      'Updated Title After Seek',
      'Remediated: video ID comparison ensures title update is applied even when hash or query param differs'
    );
  });
});
