const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 10: SPA Navigation Video Updating (yt-navigate-finish)', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 3 pending: content/youtube-injector.js not yet created');
    return;
  }

  await t.test('TC-F10-01: Listens for YouTube SPA event yt-navigate-finish', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const hasNavListener = sandbox.windowListeners.has('yt-navigate-finish') ||
                           sandbox.doc.eventListeners.has('yt-navigate-finish');
    assert.ok(hasNavListener, 'Must register event listener for yt-navigate-finish');
  });

  await t.test('TC-F10-02: Updates iframe src with new video URL on yt-navigate-finish', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const newVideoUrl = 'https://www.youtube.com/watch?v=video_two';

    // Simulate SPA navigation
    sandbox.win.location = new URL(newVideoUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: newVideoUrl }
    }));

    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('url'), newVideoUrl, 'Iframe src must reflect new video URL');
  });

  await t.test('TC-F10-03: Updates iframe src with new video title on yt-navigate-finish', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one',
      videoTitle: 'Title One'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const newVideoUrl = 'https://www.youtube.com/watch?v=video_two';
    const newTitle = 'Brand New Video Title';

    sandbox.win.location = new URL(newVideoUrl);
    // Update DOM title
    const titleNode = sandbox.doc.querySelector('h1 span');
    if (titleNode) titleNode.textContent = newTitle;

    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: newVideoUrl, response: { title: newTitle } }
    }));

    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('title'), newTitle, 'Iframe src must reflect new video title');
  });

  await t.test('TC-F10-04: Does not reload/re-assign iframe if navigating to same video URL', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=same_video'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const initialSrc = iframe.src;

    // Dispatch event with same URL
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=same_video' }
    }));

    assert.strictEqual(iframe.src, initialSrc, 'Iframe src should not be reloaded for identical URL');
  });

  await t.test('TC-F10-05: Retains DOM panel container during in-page navigation without reloading page', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panelBefore = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panelBefore, 'Panel must exist before navigation');

    // Simulate SPA navigation
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/watch?v=video_two' }
    }));

    const panelAfter = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panelAfter, 'Panel must persist in DOM across SPA navigation');
    assert.strictEqual(panelBefore, panelAfter, 'Panel DOM node reference should be preserved');
  });
});

test('Tier 1 - Feature 11: Auto-Restore on Video Navigation', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 3 pending: content/youtube-injector.js not yet created');
    return;
  }

  await t.test('TC-F11-01: Auto-restores collapsed panel when navigating to new video', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_old',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');

    // User collapses panel on current video
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'), 'Panel should be collapsed');

    // User navigates to new video
    const newVideoUrl = 'https://www.youtube.com/watch?v=video_new';
    sandbox.win.location = new URL(newVideoUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: newVideoUrl }
    }));

    assert.strictEqual(
      panel.classList.contains('collapsed'),
      false,
      'Panel must auto-expand and remove .collapsed on new video navigation'
    );
  });

  await t.test('TC-F11-02: Auto-restore removes .collapsed class upon new video navigation', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_old',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');

    closeBtn.click();
    const newVideoUrl = 'https://www.youtube.com/watch?v=video_new';
    sandbox.win.location = new URL(newVideoUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: newVideoUrl }
    }));

    assert.ok(!panel.classList.contains('collapsed'), 'Panel must not contain .collapsed');
  });

  await t.test('TC-F11-03: Restores container height to player height on auto-restore', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_old',
      playerHeight: 540
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');

    closeBtn.click();
    const newVideoUrl = 'https://www.youtube.com/watch?v=video_new';
    sandbox.win.location = new URL(newVideoUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: newVideoUrl }
    }));

    const restoredHeight = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(restoredHeight.includes('540'), `Restored height must match player height 540px, got ${restoredHeight}`);
  });

  await t.test('TC-F11-04: Auto-restore fires even after multiple collapse events', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_1',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');

    for (let i = 2; i <= 4; i++) {
      closeBtn.click();
      assert.ok(panel.classList.contains('collapsed'), `Iteration ${i}: Must be collapsed`);
      const nextUrl = `https://www.youtube.com/watch?v=video_${i}`;
      sandbox.win.location = new URL(nextUrl);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: nextUrl }
      }));
      assert.ok(!panel.classList.contains('collapsed'), `Iteration ${i}: Must auto-restore on navigation`);
    }
  });

  await t.test('TC-F11-05: Already-expanded panel remains expanded on new video without UI flicker', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_old',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(!panel.classList.contains('collapsed'), 'Panel starts expanded');

    const newVideoUrl = 'https://www.youtube.com/watch?v=video_new';
    sandbox.win.location = new URL(newVideoUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: newVideoUrl }
    }));

    assert.ok(!panel.classList.contains('collapsed'), 'Panel should remain smoothly expanded');
  });
});
