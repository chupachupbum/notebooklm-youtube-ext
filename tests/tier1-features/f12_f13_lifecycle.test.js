const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 12: Non-Video Page Lifecycle (Hiding/Detaching)', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 3 pending: content/youtube-injector.js not yet created');
    return;
  }

  await t.test('TC-F12-01: Navigating to YouTube homepage (/) hides or detaches panel container', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const homeUrl = 'https://www.youtube.com/';
    sandbox.win.location = new URL(homeUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: homeUrl }
    }));

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const isHiddenOrDetached = !panel || panel.style.display === 'none' || !panel.isConnected;
    assert.ok(isHiddenOrDetached, 'Panel must be hidden or detached on homepage');
  });

  await t.test('TC-F12-02: Navigating to channel page (/@channel) hides panel container', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const channelUrl = 'https://www.youtube.com/@RickAstleyYT';
    sandbox.win.location = new URL(channelUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: channelUrl }
    }));

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const isHidden = !panel || panel.style.display === 'none' || !panel.isConnected;
    assert.ok(isHidden, 'Panel must be hidden on channel page');
  });

  await t.test('TC-F12-03: Disconnects or pauses ResizeObserver when navigating away from video pages', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const homeUrl = 'https://www.youtube.com/';
    sandbox.win.location = new URL(homeUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: homeUrl }
    }));

    const ro = sandbox.win.ResizeObserver.instances[0];
    const isDisconnectedOrEmpty = !ro || ro.observed.size === 0;
    assert.ok(isDisconnectedOrEmpty, 'ResizeObserver should be disconnected or inactive on non-video pages');
  });

  await t.test('TC-F12-04: Does not throw errors attempting to measure non-existent player on non-video pages', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Remove player
    sandbox.domNodes.moviePlayer.remove();

    assert.doesNotThrow(() => {
      const homeUrl = 'https://www.youtube.com/feed/trending';
      sandbox.win.location = new URL(homeUrl);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: homeUrl }
      }));
    }, 'Must not throw unhandled exception when player is absent');
  });

  await t.test('TC-F12-05: Keeps event listeners active on window to catch return navigations', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const homeUrl = 'https://www.youtube.com/';
    sandbox.win.location = new URL(homeUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: homeUrl }
    }));

    const hasNavListener = sandbox.windowListeners.has('yt-navigate-finish') ||
                           sandbox.doc.eventListeners.has('yt-navigate-finish');
    assert.ok(hasNavListener, 'yt-navigate-finish listener must remain attached after navigating away');
  });
});

test('Tier 1 - Feature 13: Return to Video Page Lifecycle (Re-showing/Re-attaching)', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 3 pending: content/youtube-injector.js not yet created');
    return;
  }

  await t.test('TC-F13-01: Navigating back from homepage to /watch re-shows panel container', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Navigate to homepage
    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/' }
    }));

    // Navigate back to video
    const returnUrl = 'https://www.youtube.com/watch?v=video_return';
    sandbox.win.location = new URL(returnUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: returnUrl }
    }));

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel, 'Panel container must exist after returning to video page');
    assert.notStrictEqual(panel.style.display, 'none', 'Panel must not be display: none after returning');
  });

  await t.test('TC-F13-02: Re-attaches ResizeObserver to video player upon return', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Navigate away and return
    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/' }
    }));

    const returnUrl = 'https://www.youtube.com/watch?v=video_return';
    sandbox.win.location = new URL(returnUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: returnUrl }
    }));

    const activeRo = sandbox.win.ResizeObserver.instances.find(ro => ro.observed.size > 0);
    assert.ok(activeRo, 'ResizeObserver must be active and observing player upon return');
  });

  await t.test('TC-F13-03: Re-hydrates iframe src with returned video URL and title', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/' }
    }));

    const returnUrl = 'https://www.youtube.com/watch?v=video_return';
    const returnTitle = 'Returned Video Title';
    sandbox.win.location = new URL(returnUrl);
    const titleNode = sandbox.doc.querySelector('h1 span');
    if (titleNode) titleNode.textContent = returnTitle;

    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: returnUrl, response: { title: returnTitle } }
    }));

    const iframe = sandbox.doc.querySelector('iframe');
    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('url'), returnUrl, 'Iframe src must reflect returned video URL');
  });

  await t.test('TC-F13-04: Restores panel to expanded state upon return to video page', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click(); // Collapse before leaving

    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: 'https://www.youtube.com/' }
    }));

    const returnUrl = 'https://www.youtube.com/watch?v=video_return';
    sandbox.win.location = new URL(returnUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: returnUrl }
    }));

    assert.strictEqual(
      panel.classList.contains('collapsed'),
      false,
      'Panel must default to expanded on return to video'
    );
  });

  await t.test('TC-F13-05: Handles repeated round-trip navigations cleanly', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_1'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    for (let i = 2; i <= 4; i++) {
      // Go to home
      sandbox.win.location = new URL('https://www.youtube.com/');
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: 'https://www.youtube.com/' }
      }));

      // Return to video
      const returnUrl = `https://www.youtube.com/watch?v=video_${i}`;
      sandbox.win.location = new URL(returnUrl);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: returnUrl }
      }));

      const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
      assert.ok(panel, `Round trip ${i}: Panel must exist`);
      assert.notStrictEqual(panel.style.display, 'none', `Round trip ${i}: Panel must be visible`);
    }
  });
});
