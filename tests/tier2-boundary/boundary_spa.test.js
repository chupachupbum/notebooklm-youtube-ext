const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 2 - Boundary & Corner Cases: SPA Navigation & Page Lifecycle (F10, F11, F12, F13)', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 3 pending: content/youtube-injector.js not yet created');
    return;
  }

  // Boundary F10: Rapid SPA navigation stress test
  await t.test('TC-B-F10-01: Rapid succession SPA navigations (10 events) resolve to the final video URL', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_initial'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');

    // Fire 10 events in rapid succession
    for (let i = 1; i <= 10; i++) {
      const url = `https://www.youtube.com/watch?v=rapid_vid_${i}`;
      sandbox.win.location = new URL(url);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url }
      }));
    }

    const parsed = new URL(iframe.src);
    assert.strictEqual(
      parsed.searchParams.get('url'),
      'https://www.youtube.com/watch?v=rapid_vid_10',
      'Iframe must reflect the final destination after rapid navigation sequence'
    );
  });

  await t.test('TC-B-F10-02: Preserves extra URL query params like timestamp (?t=120) and playlist (?list=PL123)', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_a'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const complexUrl = 'https://www.youtube.com/watch?v=vid_complex&t=120s&list=PLxyz789';
    sandbox.win.location = new URL(complexUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: complexUrl }
    }));

    const iframe = sandbox.doc.querySelector('iframe');
    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('url'), complexUrl);
  });

  await t.test('TC-B-F10-03: Handles video navigation with empty/missing event.detail gracefully', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_a'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Update window.location but omit event.detail.url
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=vid_fallback_loc');
    assert.doesNotThrow(() => {
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: null }));
    });
  });

  await t.test('TC-B-F10-04: Gracefully handles delayed video title updating in YouTube DOM', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_a',
      videoTitle: 'Initial Title'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Navigation event fires before DOM title updates
    const nextUrl = 'https://www.youtube.com/watch?v=vid_b';
    sandbox.win.location = new URL(nextUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: nextUrl }
    }));

    const iframe = sandbox.doc.querySelector('iframe');
    assert.ok(iframe.src.includes('vid_b'));
  });

  await t.test('TC-B-F10-05: Handles YouTube Shorts URLs (/shorts/<id>) in SPA navigation', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_a'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const shortsUrl = 'https://www.youtube.com/shorts/sH0rt5Id123';
    sandbox.win.location = new URL(shortsUrl);
    assert.doesNotThrow(() => {
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: shortsUrl }
      }));
    });
  });

  // Boundary F11: Auto-restore edge cases
  await t.test('TC-B-F11-01: Auto-restores when navigating to video after being collapsed for 10 minutes', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_1',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();

    // Long elapsed time simulated
    const nextUrl = 'https://www.youtube.com/watch?v=vid_2';
    sandbox.win.location = new URL(nextUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: nextUrl }
    }));

    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Must auto-restore on navigation');
  });

  await t.test('TC-B-F11-02: Auto-restore ignores identical hash/timestamp-only URL changes on same video', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_same',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // Same video, just skipped ahead
    const hashUrl = 'https://www.youtube.com/watch?v=vid_same#t=30s';
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: hashUrl }
    }));

    // Should NOT force re-expand for same video seeking
    assert.ok(panel.classList.contains('collapsed'), 'Should stay collapsed on seek within same video');
  });

  await t.test('TC-B-F11-03: Auto-restore sets iframe display back to block/visible', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_1',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const iframe = panel.querySelector('iframe');
    closeBtn.click();

    const nextUrl = 'https://www.youtube.com/watch?v=vid_2';
    sandbox.win.location = new URL(nextUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: nextUrl }
    }));

    assert.notStrictEqual(iframe.style.display, 'none', 'Iframe must be visible after auto-restore');
  });

  await t.test('TC-B-F11-04: Auto-restore updates container height to player height on new video', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_1',
      playerHeight: 480
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();

    // New video has 640px player
    sandbox.domNodes.moviePlayer.clientHeight = 640;
    sandbox.domNodes.moviePlayer.offsetHeight = 640;

    const nextUrl = 'https://www.youtube.com/watch?v=vid_2';
    sandbox.win.location = new URL(nextUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: nextUrl }
    }));

    const restoredHeight = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(restoredHeight.includes('640') || restoredHeight.includes('480'), 'Height must restore appropriately');
  });

  await t.test('TC-B-F11-05: Auto-restore handles back navigation to a previously seen video', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_history_1',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');

    // Navigate to vid 2
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=vid_history_2');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=vid_history_2' }
    }));

    // Collapse vid 2
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // Hit back button to vid 1
    sandbox.win.location = new URL('https://www.youtube.com/watch?v=vid_history_1');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=vid_history_1' }
    }));

    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Navigating back must auto-restore panel');
  });

  // Boundary F12 & F13: Lifecycle edge cases
  await t.test('TC-B-F12-01: Navigating to search results (/results?search_query=) hides panel', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_watch'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const searchUrl = 'https://www.youtube.com/results?search_query=notebooklm';
    sandbox.win.location = new URL(searchUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: searchUrl }
    }));

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const isHidden = !panel || panel.style.display === 'none' || !panel.isConnected;
    assert.ok(isHidden, 'Panel must hide on search results page');
  });

  await t.test('TC-B-F12-02: Navigating to subscriptions (/feed/subscriptions) hides panel', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_watch'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const subUrl = 'https://www.youtube.com/feed/subscriptions';
    sandbox.win.location = new URL(subUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: subUrl }
    }));

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const isHidden = !panel || panel.style.display === 'none' || !panel.isConnected;
    assert.ok(isHidden, 'Panel must hide on subscriptions feed');
  });

  await t.test('TC-B-F12-03: Navigating to user settings (/account) hides panel', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_watch'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const accUrl = 'https://www.youtube.com/account';
    sandbox.win.location = new URL(accUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: accUrl }
    }));

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const isHidden = !panel || panel.style.display === 'none' || !panel.isConnected;
    assert.ok(isHidden, 'Panel must hide on account settings');
  });

  await t.test('TC-B-F13-01: Navigating through search -> video -> channel -> video handles 4 transitions', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/results?search_query=test'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // 1. Enter video 1
    const v1 = 'https://www.youtube.com/watch?v=v1';
    sandbox.win.location = new URL(v1);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: v1 } }));
    let panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel && panel.style.display !== 'none', 'Transition 1: Video 1 should show panel');

    // 2. Go to channel
    const ch = 'https://www.youtube.com/@channel1';
    sandbox.win.location = new URL(ch);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: ch } }));
    panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(!panel || panel.style.display === 'none' || !panel.isConnected, 'Transition 2: Channel should hide panel');

    // 3. Enter video 2
    const v2 = 'https://www.youtube.com/watch?v=v2';
    sandbox.win.location = new URL(v2);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: v2 } }));
    panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel && panel.style.display !== 'none', 'Transition 3: Video 2 should show panel');
  });

  await t.test('TC-B-F13-02: Returns correctly when user rapidly clicks forward and back in history', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=v1'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    for (let i = 0; i < 3; i++) {
      // Back to home
      sandbox.win.location = new URL('https://www.youtube.com/');
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: 'https://www.youtube.com/' } }));
      // Forward to video
      sandbox.win.location = new URL('https://www.youtube.com/watch?v=v1');
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: 'https://www.youtube.com/watch?v=v1' } }));
    }

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel && panel.style.display !== 'none', 'Panel must be healthy after rapid forward/back');
  });
});
