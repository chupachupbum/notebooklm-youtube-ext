const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 2 - Boundary & Corner Cases: Injection, Anchors & Height (F4, F5, F6)', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 2 pending: content/youtube-injector.js not yet created');
    return;
  }

  // Boundary F4: Anchor selection & delayed DOM mounting
  await t.test('TC-B-F4-01: Handles delayed mounting of #secondary via MutationObserver', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    // Remove #secondary initially
    sandbox.domNodes.secondary.remove();

    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Later, DOM finishes loading and #secondary is appended
    sandbox.doc.body.appendChild(sandbox.domNodes.secondary);
    if (sandbox.win.MutationObserver.instances.length > 0) {
      sandbox.win.MutationObserver.instances[0].trigger();
    }

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel, 'Panel must inject after secondary sidebar becomes available');
  });

  await t.test('TC-B-F4-02: Handles completely missing sidebar on YouTube Shorts (/shorts/) without crashing', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/shorts/abcdef12345'
    });
    sandbox.domNodes.secondary.remove();

    assert.doesNotThrow(() => {
      runScriptInSandbox(PATHS.injector, sandbox.context);
    }, 'Must not throw unhandled exception on pages lacking #secondary');
  });

  await t.test('TC-B-F4-03: Handles live stream pages (/live/) with live chat container in secondary', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/live/live_stream_id'
    });
    const chatContainer = sandbox.doc.createElement('div');
    chatContainer.id = 'chat-container';
    sandbox.domNodes.secondary.prepend(chatContainer);

    assert.doesNotThrow(() => {
      runScriptInSandbox(PATHS.injector, sandbox.context);
    });
    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel, 'Panel must mount cleanly alongside live chat container');
  });

  await t.test('TC-B-F4-04: Robust against existing child nodes in #secondary-inner', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    // Add multiple child nodes
    const adBanner = sandbox.doc.createElement('div');
    adBanner.id = 'player-ads';
    sandbox.domNodes.secondaryInner.prepend(adBanner);

    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel, 'Panel must be injected');
    assert.strictEqual(
      sandbox.domNodes.secondaryInner.children[0],
      panel,
      'Panel must still be prepended at the very top'
    );
  });

  await t.test('TC-B-F4-05: Idempotent injection: 10 rapid calls produce only 1 panel', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    for (let i = 0; i < 10; i++) {
      runScriptInSandbox(PATHS.injector, sandbox.context);
    }
    const panels = sandbox.doc.querySelectorAll('[id*="nlm-youtube-panel"]');
    assert.strictEqual(panels.length, 1, 'Exactly one panel container must exist');
  });

  // Boundary F5: Special characters, XSS vectors, and titles
  await t.test('TC-B-F5-01: Encodes titles containing ampersands, hashes, and question marks', () => {
    const complexTitle = 'Rock & Roll? #1 Hit: 50% Off / "Sale"';
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoTitle: complexTitle
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('title'), complexTitle, 'Title with URL meta-characters must round-trip correctly');
  });

  await t.test('TC-B-F5-02: Escapes HTML tags and potential XSS in video title', () => {
    const xssTitle = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoTitle: xssTitle
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('title'), xssTitle);
  });

  await t.test('TC-B-F5-03: Handles emojis and non-Latin CJK unicode characters in title', () => {
    const unicodeTitle = '🔥 YouTube まとめ 日本語 한국어 中文 — 2026 🎉';
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoTitle: unicodeTitle
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('title'), unicodeTitle, 'Unicode title must preserve exact characters');
  });

  await t.test('TC-B-F5-04: Handles empty or missing title gracefully with fallback', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoTitle: ''
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const parsed = new URL(iframe.src);
    const titleVal = parsed.searchParams.get('title');
    assert.ok(titleVal !== null, 'Title param should exist');
  });

  await t.test('TC-B-F5-05: Handles extremely long titles (1000+ chars) without failing', () => {
    const longTitle = 'A'.repeat(1200);
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoTitle: longTitle
    });
    assert.doesNotThrow(() => {
      runScriptInSandbox(PATHS.injector, sandbox.context);
    });
    const iframe = sandbox.doc.querySelector('iframe');
    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('title'), longTitle);
  });

  // Boundary F6: Height synchronization corner cases
  await t.test('TC-B-F6-01: Handles zero height initial player (audio only or background loading)', () => {
    const sandbox = createTestSandbox({ playerHeight: 0 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const height = parseInt(panel.style.height || panel.style.minHeight || '0', 10);
    assert.ok(height >= 300, 'Must apply reasonable fallback minimum height when player height is 0');
  });

  await t.test('TC-B-F6-02: Handles extreme player height (e.g. 2160px 4K display)', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const ro = sandbox.win.ResizeObserver.instances[0];
    ro.trigger(sandbox.domNodes.moviePlayer, 2160);

    const heightStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(heightStr.includes('2160'), 'Panel height must expand to 2160px');
  });

  await t.test('TC-B-F6-03: Handles rapid player resize jitter (window resizing)', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Jitter heights rapidly
    const heights = [485, 492, 510, 505, 520, 480];
    for (const h of heights) {
      ro.trigger(sandbox.domNodes.moviePlayer, h);
    }

    const finalHeight = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(finalHeight.includes('480'), 'Final height must reflect last resize event');
  });

  await t.test('TC-B-F6-04: Does not crash if observed player element is removed from DOM', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    sandbox.domNodes.moviePlayer.remove();
    const ro = sandbox.win.ResizeObserver.instances[0];

    assert.doesNotThrow(() => {
      ro.trigger(sandbox.domNodes.moviePlayer, 500);
    });
  });

  await t.test('TC-B-F6-05: Maintains height sync across multiple DOM mutation cycles', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const ro = sandbox.win.ResizeObserver.instances[0];

    ro.trigger(sandbox.domNodes.moviePlayer, 640);
    assert.ok((panel.style.height || `${panel.offsetHeight}px`).includes('640'));

    ro.trigger(sandbox.domNodes.moviePlayer, 400);
    assert.ok((panel.style.height || `${panel.offsetHeight}px`).includes('400'));
  });
});
