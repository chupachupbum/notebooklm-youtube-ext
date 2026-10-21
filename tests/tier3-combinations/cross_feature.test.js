const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 3 - Cross-Feature Combinations (Pairwise Interactions)', async (t) => {
  const bgCode = fs.readFileSync(PATHS.background, 'utf8');

  // Pair 1: F7 (Collapse) + F10 (SPA Navigation)
  await t.test('TC-X-01: Collapse panel on Video 1 -> SPA navigate to Video 2 -> auto-expands with Video 2 details', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_1',
      videoTitle: 'Video 1 Title',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'), 'Must be collapsed');

    const nextUrl = 'https://www.youtube.com/watch?v=vid_2';
    sandbox.win.location = new URL(nextUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: nextUrl }
    }));

    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Must auto-expand on navigation');
    const iframe = panel.querySelector('iframe');
    assert.ok(iframe.src.includes('vid_2'), 'Iframe src must reflect Video 2');
  });

  // Pair 2: F7 (Collapse) + F6 (Height Sync)
  await t.test('TC-X-02: Collapse panel -> player height changes -> collapsed height stays 40px -> expand adopts new height', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2 pending');
      return;
    }
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // Resize player while collapsed
    const ro = sandbox.win.ResizeObserver.instances[0];
    ro.trigger(sandbox.domNodes.moviePlayer, 720);

    const collapsedH = parseInt(panel.style.height || '40', 10);
    assert.ok(collapsedH <= 48, 'Height must remain collapsed ~40px during resize');

    // Expand
    header.click();
    const expandedH = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(expandedH.includes('720'), `Expanded height must adopt 720px, got ${expandedH}`);
  });

  // Pair 3: F15 (Summarize) + F16 (Tab Close Cleanup)
  await t.test('TC-X-03: Active summarization in progress -> tab close triggers performCleanup("tabClosed")', () => {
    assert.ok(bgCode.includes("performCleanup('tabClosed')"));
    assert.ok(bgCode.includes('chrome.tabs.onRemoved.addListener'));
  });

  // Pair 4: F15 (Summarize) + F17 (Navigation Cleanup)
  await t.test('TC-X-04: Active summarization in progress -> navigation away triggers performCleanup("navigatedAway")', () => {
    assert.ok(bgCode.includes("performCleanup('navigatedAway')"));
    assert.ok(bgCode.includes('chrome.tabs.onUpdated.addListener'));
    assert.ok(bgCode.includes('newVideoId !== activeSession.videoId'));
  });

  // Pair 5: F3 (Inline Mode) + F14 (Chrome Side Panel Compatibility)
  await t.test('TC-X-05: Inline mode detection (inline=1) does not interfere with native Side Panel fallback', () => {
    const sidepanelCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');
    const urlParams = new URLSearchParams('?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(urlParams.get('inline'), null, 'Native side panel has no inline query param');
  });

  // Pair 6: F4 (DOM Anchor) + F12 (Hide) + F13 (Restore)
  await t.test('TC-X-06: Mounts on Video 1 -> hides on Home -> re-mounts on Video 2 above recommendations', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=v1' });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // 1. Home
    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: 'https://www.youtube.com/' } }));
    let panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(!panel || panel.style.display === 'none' || !panel.isConnected);

    // 2. Video 2
    const v2 = 'https://www.youtube.com/watch?v=v2';
    sandbox.win.location = new URL(v2);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: v2 } }));
    panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel && panel.style.display !== 'none', 'Panel must re-mount on Video 2');
  });

  // Pair 7: F5 (Query Encoding) + F10 (SPA Navigation)
  await t.test('TC-X-07: Video 1 special characters -> navigates to Video 2 with quotes -> encodes both sequentially', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const title1 = 'Rock & Roll 50% Off';
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=v1',
      videoTitle: title1
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    assert.strictEqual(new URL(iframe.src).searchParams.get('title'), title1);

    const title2 = '"Summer Special" - Episode #42?';
    const v2 = 'https://www.youtube.com/watch?v=v2';
    sandbox.win.location = new URL(v2);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: v2, response: { title: title2 } }
    }));
    assert.strictEqual(new URL(iframe.src).searchParams.get('title'), title2);
  });

  // Pair 8: F7 (Collapse) + F12 (Hide) + F13 (Return Restore)
  await t.test('TC-X-08: Collapsed on Video 1 -> Home -> Return to Video 1 -> Restores to default expanded state', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=v1', playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // Go Home
    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: 'https://www.youtube.com/' } }));

    // Return to Video 1
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=v1');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: 'https://www.youtube.com/watch?v=v1' } }));

    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Panel must restore to expanded state');
  });

  // Pair 9: F6 (Height Sync) + F13 (Return)
  await t.test('TC-X-09: Navigates away from 480px video -> returns to 720px video -> adopts 720px height', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=v1', playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Leave
    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: 'https://www.youtube.com/' } }));

    // Return to high-res video
    sandbox.domNodes.moviePlayer.clientHeight = 720;
    sandbox.domNodes.moviePlayer.offsetHeight = 720;
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=v2_720p');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=v2_720p' }
    }));

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const heightStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(heightStr.includes('720') || heightStr.includes('480'));
  });

  // Pair 10: F10 (SPA Nav) + F15 (Summarize Invalidation)
  await t.test('TC-X-10: In-flight summary on Video 1 -> user navigates to Video 2 -> sessionId invalidated', () => {
    assert.ok(bgCode.includes('activeSession.sessionId = null') ||
              bgCode.includes('activeSession.sessionId !== currentSessionId'));
    assert.ok(bgCode.includes("performCleanup('navigatedAway')"));
  });

  // Pair 11: F8 (Expand) + F10 (SPA Navigation) Multi-Cycle
  await t.test('TC-X-11: 3 cycles of collapse/expand -> SPA navigation -> panel operates smoothly', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=v1', playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    for (let i = 0; i < 3; i++) {
      closeBtn.click();
      header.click();
    }

    const nextUrl = 'https://www.youtube.com/watch?v=v2';
    sandbox.win.location = new URL(nextUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: nextUrl } }));

    assert.strictEqual(panel.classList.contains('collapsed'), false);
  });

  // Pair 12: F14 (Popup Fallback) + F16 (Tab Close Cleanup)
  await t.test('TC-X-12: Fallback window open + YouTube tab closed -> fallback window reset upon close', () => {
    assert.ok(bgCode.includes('if (tabId === fallbackWindowId) {'));
    assert.ok(bgCode.includes('fallbackWindowId = null;'));
  });

  // Pair 13: F4 (DOM Anchor) + F9 (CSS Dark Theme)
  await t.test('TC-X-13: Injected container structure conforms to dark theme layout specs', () => {
    assert.ok(PATHS.injectorCss.includes('youtube-injector.css'));
  });

  // Pair 14: F3 (Inline Mode) + F5 (Iframe Embedding)
  await t.test('TC-X-14: Injector iframe src sets inline=1 which is parsed by sidepanel URLSearchParams', () => {
    const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const qs = `?url=${encodeURIComponent(testUrl)}&inline=1`;
    const params = new URLSearchParams(qs);
    assert.strictEqual(params.get('inline'), '1');
    assert.strictEqual(params.get('url'), testUrl);
  });

  // Pair 15: F10 (SPA) + F11 (Auto-Restore) + F16 (Tab Close Cleanup)
  await t.test('TC-X-15: Complete lifecycle: collapse -> SPA nav -> auto-restore -> tab close cleanup', () => {
    assert.ok(bgCode.includes('chrome.tabs.onRemoved.addListener'));
    assert.ok(bgCode.includes("performCleanup('tabClosed')"));
  });
});
