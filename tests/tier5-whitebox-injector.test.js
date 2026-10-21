/**
 * Tier 5: White-Box Adversarial Coverage Hardening Suite
 * Milestone 4: Deep White-Box Code Audit of content/youtube-injector.js and content/youtube-injector.css
 * 
 * Verifies untested paths, edge cases, error handling, lifecycle teardown,
 * dimension transitions, and exposes known implementation vulnerabilities:
 * - Line 537: Strict equality (currentVideoUrl === window.location.href) dropping yt-page-data-updated title updates on query/hash variations
 * - Lines 481-485: Failure to refresh currentVideoUrl on same-video navigation / seek
 * - Lines 409-414 vs 300-303: Close/minimize button click while collapsed fails to expand (trapped collapsed state)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('./harness/test-helpers.js');

test('Tier 5 - White-Box Adversarial: Group 1 - yt-page-data-updated Title Resolution & URL Invariants', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('content/youtube-injector.js not found');
    return;
  }

  await t.test('TC-WB-01: yt-page-data-updated must update iframe title when address bar has query params (&list, &t)', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=wb_vid_01',
      videoTitle: 'Initial Title'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    assert.ok(panel, 'Panel must exist');
    const iframe = panel.querySelector('iframe');
    assert.ok(iframe, 'Iframe must exist');

    // Simulate user navigating to video in playlist with timestamp
    // YouTube address bar reflects: https://www.youtube.com/watch?v=wb_vid_01&list=PL123&index=2&t=45s
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=wb_vid_01&list=PL123&index=2&t=45s');

    // YouTube asynchronously delivers hydrated page metadata
    sandbox.doc.dispatchEvent(new sandbox.win.CustomEvent('yt-page-data-updated', {
      detail: { response: { title: 'Hydrated Title With Query Params' } }
    }));

    const currentTitleInIframe = new URL(iframe.src).searchParams.get('title');
    assert.strictEqual(
      currentTitleInIframe,
      'Hydrated Title With Query Params',
      'BUG DETECTED (Line 537): yt-page-data-updated title update dropped because currentVideoUrl === window.location.href fails when address bar contains query parameters'
    );
  });

  await t.test('TC-WB-02: yt-page-data-updated must update iframe title after timeline scrub/seek (#t=30s)', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=wb_vid_02',
      videoTitle: 'Initial Title'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const iframe = panel.querySelector('iframe');

    // User scrubs or clicks a timestamp link on same video
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=wb_vid_02#t=30s');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=wb_vid_02#t=30s' }
    }));

    // Modern YouTube delivers updated page data with full title
    sandbox.doc.dispatchEvent(new sandbox.win.CustomEvent('yt-page-data-updated', {
      detail: { response: { title: 'Hydrated Title After Seek' } }
    }));

    const currentTitleInIframe = new URL(iframe.src).searchParams.get('title');
    assert.strictEqual(
      currentTitleInIframe,
      'Hydrated Title After Seek',
      'BUG DETECTED (Line 537 & 481): yt-page-data-updated title update dropped because mountPanel leaves currentVideoUrl stale on same-video seek'
    );
  });

  await t.test('TC-WB-03: yt-page-data-updated ignores events for mismatched / obsolete video IDs', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=wb_vid_03',
      videoTitle: 'Active Video Title'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const iframe = panel.querySelector('iframe');

    // An out-of-order or stale event arrives with window.location pointing to an obsolete video
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=obsolete_vid');
    sandbox.doc.dispatchEvent(new sandbox.win.CustomEvent('yt-page-data-updated', {
      detail: { response: { title: 'Stale Obsolete Title' } }
    }));

    const currentTitleInIframe = new URL(iframe.src).searchParams.get('title');
    assert.strictEqual(
      currentTitleInIframe,
      'Active Video Title',
      'Stale out-of-order page data events must not overwrite current iframe title'
    );
  });

  await t.test('TC-WB-04: yt-page-data-updated extracts title from Tier 2 DOM elements if detail has no title', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=wb_vid_04',
      videoTitle: 'Initial Title'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const iframe = panel.querySelector('iframe');

    // DOM title element updates
    sandbox.domNodes.titleContainer.children[0].textContent = 'DOM Hydrated Video Title';

    // yt-page-data-updated fires with empty detail
    sandbox.doc.dispatchEvent(new sandbox.win.CustomEvent('yt-page-data-updated', {
      detail: {}
    }));

    const currentTitleInIframe = new URL(iframe.src).searchParams.get('title');
    assert.strictEqual(
      currentTitleInIframe,
      'DOM Hydrated Video Title',
      'yt-page-data-updated should extract title from DOM when event detail omits title'
    );
  });
});

test('Tier 5 - White-Box Adversarial: Group 2 - Close/Minimize Button Dual-State Interaction', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('content/youtube-injector.js not found');
    return;
  }

  await t.test('TC-WB-05: Clicking #nlm-panel-close while collapsed must expand the panel', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    assert.ok(closeBtn, 'Close button must exist');

    // First click: collapses panel
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'), 'Panel must be collapsed after first click');
    assert.strictEqual(closeBtn.title, 'Expand panel', 'Button title must reflect Expand state');
    assert.strictEqual(closeBtn.getAttribute('aria-label'), 'Expand panel', 'Aria-label must reflect Expand state');

    // Second click: user clicks the "+" / "Expand panel" button to expand
    closeBtn.click();

    assert.strictEqual(
      panel.classList.contains('collapsed'),
      false,
      'BUG DETECTED (Lines 409-414): Clicking #nlm-panel-close while collapsed fails to expand panel because listener calls collapsePanel unconditionally and stops propagation'
    );
  });

  await t.test('TC-WB-06: Keyboard Enter/Space on collapsed header expands panel', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const header = panel.querySelector('#nlm-panel-header');
    const closeBtn = panel.querySelector('#nlm-panel-close');

    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'), 'Panel must be collapsed');

    // Press Enter on header
    const enterEvt = new sandbox.win.CustomEvent('keydown');
    enterEvt.key = 'Enter';
    header.dispatchEvent(enterEvt);
    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Enter key must expand panel');

    // Collapse again and press Space
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'), 'Panel must be collapsed');
    const spaceEvt = new sandbox.win.CustomEvent('keydown');
    spaceEvt.key = ' ';
    header.dispatchEvent(spaceEvt);
    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Space key must expand panel');
  });
});

test('Tier 5 - White-Box Adversarial: Group 3 - Theater Mode, Fullscreen & Dimension Transitions', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('content/youtube-injector.js not found');
    return;
  }

  await t.test('TC-WB-07: Theater mode transition (480px -> 680px -> 480px) tracks accurately via ResizeObserver', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const ro = sandbox.win.ResizeObserver.instances[0];
    assert.ok(ro, 'ResizeObserver must be active');

    // Enter theater mode
    ro.trigger(sandbox.domNodes.moviePlayer, 680);
    assert.strictEqual(panel.style.height, '680px', 'Panel height must sync to 680px in theater mode');

    // Exit theater mode
    ro.trigger(sandbox.domNodes.moviePlayer, 480);
    assert.strictEqual(panel.style.height, '480px', 'Panel height must revert to 480px');
  });

  await t.test('TC-WB-08: Fullscreen transition (1080px) and return to normal mode', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Enter fullscreen
    ro.trigger(sandbox.domNodes.moviePlayer, 1080);
    assert.strictEqual(panel.style.height, '1080px', 'Panel height must track fullscreen height 1080px');

    // Exit fullscreen
    ro.trigger(sandbox.domNodes.moviePlayer, 480);
    assert.strictEqual(panel.style.height, '480px', 'Panel height must return to standard 480px');
  });

  await t.test('TC-WB-09: Player height changes while collapsed do NOT alter 40px DOM height, but cache for expand', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const header = panel.querySelector('#nlm-panel-header');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Collapse
    closeBtn.click();
    assert.strictEqual(panel.style.height, '40px');

    // Player resizes to 720px while collapsed (e.g. theater mode toggled via hotkey)
    ro.trigger(sandbox.domNodes.moviePlayer, 720);
    assert.strictEqual(panel.style.height, '40px', 'DOM height must remain 40px while collapsed');

    // Expand panel via header click
    header.click();
    assert.strictEqual(panel.style.height, '720px', 'Panel must expand to cached 720px height');
  });

  await t.test('TC-WB-10: Player height 0 fallback does not collapse panel below 480px', () => {
    const sandbox = createTestSandbox({ playerHeight: 520 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Transient height 0 (e.g., hidden player or DOM detach)
    ro.trigger(sandbox.domNodes.moviePlayer, 0);
    assert.strictEqual(panel.style.height, '520px', 'Transient height 0 must fall back to lastKnownPlayerHeight');
  });

  await t.test('TC-WB-11: Extreme 4K UHD player height (2160px) supported without clamping', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const ro = sandbox.win.ResizeObserver.instances[0];

    ro.trigger(sandbox.domNodes.moviePlayer, 2160);
    assert.strictEqual(panel.style.height, '2160px', '4K resolution height 2160px must not be clamped');
  });
});

test('Tier 5 - White-Box Adversarial: Group 4 - DOM Teardown, MutationObserver Lifecycle & Polling Limits', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('content/youtube-injector.js not found');
    return;
  }

  await t.test('TC-WB-12: waitForAnchor cleans up MutationObserver on timeout when anchor never appears', () => {
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=no_anchor_vid' });
    sandbox.domNodes.secondary.remove(); // Remove secondary sidebar completely

    let currentTime = 100000;
    sandbox.context.Date = { now: () => currentTime };

    runScriptInSandbox(PATHS.injector, sandbox.context);

    const mo = sandbox.win.MutationObserver.instances[0];
    assert.ok(mo, 'MutationObserver must be registered');
    assert.strictEqual(mo.observed.size, 1, 'Body must be observed');

    // Advance time past 5000ms maxWaitMs and trigger mutation
    currentTime += 6000;
    mo.trigger([]);
    assert.strictEqual(mo.observed.size, 0, 'Observer must be disconnected after timeout');
  });

  await t.test('TC-WB-13: Navigation to non-video page during active anchor polling aborts mounting', () => {
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=delay_vid' });
    sandbox.domNodes.secondary.remove(); // Remove secondary sidebar initially

    runScriptInSandbox(PATHS.injector, sandbox.context);

    const mo = sandbox.win.MutationObserver.instances[0];
    assert.ok(mo, 'Observer active');

    // User navigates to /feed/explore before anchor appears
    sandbox.win.location = new URL('https://www.youtube.com/feed/explore');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/feed/explore' }
    }));

    assert.strictEqual(mo.observed.size, 0, 'Observer must be disconnected on non-video navigation');

    // Re-add secondary sidebar to DOM
    sandbox.doc.body.appendChild(sandbox.domNodes.secondary);
    mo.trigger([]);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    const isHidden = !panel || panel.style.display === 'none' || panel.classList.contains('nlm-hidden');
    assert.ok(isHidden, 'Panel must NOT mount or be visible on non-video page');
  });

  await t.test('TC-WB-14: Detached secondary container recreation re-prepends panel into new container', () => {
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=vid_mount_1' });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    assert.ok(panel);
    assert.strictEqual(panel.parentNode, sandbox.domNodes.secondaryInner);

    // YouTube SPA destroys old secondary container and creates a brand new one
    sandbox.domNodes.secondary.remove();
    const newSecondary = sandbox.doc.createElement('div');
    newSecondary.id = 'secondary';
    const newSecondaryInner = sandbox.doc.createElement('div');
    newSecondaryInner.id = 'secondary-inner';
    newSecondary.appendChild(newSecondaryInner);
    sandbox.doc.body.appendChild(newSecondary);

    // Navigate to next video
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=vid_mount_2');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=vid_mount_2' }
    }));

    const currentPanel = sandbox.doc.getElementById('nlm-youtube-panel');
    assert.strictEqual(
      currentPanel.parentNode,
      newSecondaryInner,
      'Panel must re-attach into the newly created secondary container'
    );
  });

  await t.test('TC-WB-15: Completely missing player container falls back to 480px default safely', () => {
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=no_player' });
    sandbox.domNodes.primary.removeChild(sandbox.domNodes.playerContainer);

    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.getElementById('nlm-youtube-panel');
    assert.ok(panel, 'Panel must mount even without player container');
    assert.strictEqual(panel.style.height, '480px', 'Default height must be 480px');
    assert.strictEqual(sandbox.win.ResizeObserver.instances.length, 0, 'No ResizeObserver should attach to null player');
  });
});

test('Tier 5 - White-Box Adversarial: Group 5 - CSS Transitions & Visual Specification Conformance', async (t) => {
  if (!fs.existsSync(PATHS.injectorCss)) {
    t.skip('content/youtube-injector.css not found');
    return;
  }

  const css = fs.readFileSync(PATHS.injectorCss, 'utf8');

  await t.test('TC-WB-16: CSS specifies cubic-bezier(0.4, 0, 0.2, 1) transition curves', () => {
    assert.ok(
      css.includes('cubic-bezier(0.4, 0, 0.2, 1)'),
      'CSS must include material design cubic-bezier curve for smooth transitions'
    );
    assert.ok(
      css.includes('transition: height'),
      'CSS must transition container height'
    );
    assert.ok(
      css.includes('transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)'),
      'CSS must transition close button transform with cubic-bezier'
    );
  });

  await t.test('TC-WB-17: CSS defines strict rules for both .collapsed and .nlm-collapsed classes', () => {
    assert.ok(
      css.includes('#nlm-youtube-panel.collapsed') && css.includes('#nlm-youtube-panel.nlm-collapsed'),
      'CSS must support both .collapsed and .nlm-collapsed selectors'
    );
    assert.ok(
      css.includes('height: 40px !important'),
      'CSS must enforce 40px height with !important in collapsed state'
    );
    assert.ok(
      css.includes('transform: rotate(45deg)'),
      'CSS must rotate close button 45 degrees to transform ✕ into +'
    );
  });

  await t.test('TC-WB-18: URL parsing invariants: trailing slashes, malformed delimiters, and Shorts paths', () => {
    const sandbox = createTestSandbox();
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Test URL parsing via script execution
    const testCases = [
      { input: 'https://www.youtube.com/watch?v=validId1234', expected: 'validId1234' },
      { input: 'https://www.youtube.com/watch?v=validId1234&t=10s&list=PL1', expected: 'validId1234' },
      { input: 'https://www.youtube.com/shorts/shorts12345', expected: 'shorts12345' },
      { input: 'https://www.youtube.com/shorts/shorts12345/', expected: 'shorts12345' },
      { input: 'https://www.youtube.com/live/live1234567', expected: 'live1234567' },
      { input: 'https://youtu.be/shortUrl123', expected: 'shortUrl123' },
      { input: 'https://youtu.be/shortUrl123?t=45s', expected: 'shortUrl123' },
      { input: 'https://www.youtube.com/watch', expected: null },
      { input: 'https://www.youtube.com/watch?v=', expected: null },
      { input: 'https://www.youtube.com/shorts/', expected: null },
      { input: 'https://www.youtube.com/feed/subscriptions', expected: null }
    ];

    // Trigger navigations and verify iframe URL params
    const iframe = sandbox.doc.getElementById('nlm-youtube-panel').querySelector('iframe');
    for (const tc of testCases) {
      sandbox.win.location = new URL(tc.input || 'https://www.youtube.com/');
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: tc.input }
      }));

      if (tc.expected) {
        assert.ok(iframe.src.includes(tc.expected), `Iframe src must contain ${tc.expected} for ${tc.input}`);
      }
    }
  });
});
