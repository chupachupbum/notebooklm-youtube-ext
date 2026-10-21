const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('./harness/test-helpers.js');

test('Tier 5 - Adversarial Stress Suite: Milestone 3 SPA Navigation & Lifecycle Integration', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('content/youtube-injector.js does not exist');
    return;
  }

  // ADV-M3-01: Relative URL in SPA navigation event detail
  await t.test('ADV-M3-01: Relative URL (/watch?v=vid_rel_123) correctly resolves and sets iframe src', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=initial_vid'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    assert.ok(iframe, 'Iframe must exist initially');

    // Dispatch yt-navigate-finish with relative URL
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: '/watch?v=vid_rel_123' }
    }));

    const parsed = new URL(iframe.src);
    assert.strictEqual(
      parsed.searchParams.get('url'),
      'https://www.youtube.com/watch?v=vid_rel_123',
      'Relative URL must be normalized against window.location.origin'
    );
  });

  // ADV-M3-02: Various relative & alternate URL formats
  await t.test('ADV-M3-02: Non-standard relative formats (/shorts/s123, /live/l456, youtu.be) do not throw', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=initial'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const testUrls = [
      '/shorts/short_123',
      '/live/stream_456',
      'watch?v=no_leading_slash_789',
      'https://m.youtube.com/watch?v=mobile_111',
      'https://youtu.be/shortlink_222'
    ];

    for (const u of testUrls) {
      assert.doesNotThrow(() => {
        sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
          detail: { url: u }
        }));
      }, `Must not throw for URL: ${u}`);
    }
  });

  // ADV-M3-03: Repeated timestamp seeks do NOT reload iframe src
  await t.test('ADV-M3-03: Repeated timestamp seeks (?t=..., #t=...) never reload or re-assign iframe src', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=same_video_id'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const initialSrc = iframe.src;

    const seeks = [
      'https://www.youtube.com/watch?v=same_video_id&t=15s',
      'https://www.youtube.com/watch?v=same_video_id&t=30s&list=PL123',
      'https://www.youtube.com/watch?v=same_video_id#t=45s',
      'https://www.youtube.com/watch?v=same_video_id#t=1m20s'
    ];

    for (const seekUrl of seeks) {
      sandbox.win.location = new URL(seekUrl);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: seekUrl }
      }));
      assert.strictEqual(
        iframe.src,
        initialSrc,
        `Iframe src must not change on timestamp seek: ${seekUrl}`
      );
    }
  });

  // ADV-M3-04: Collapsed panel remains collapsed during timestamp seeks
  await t.test('ADV-M3-04: Collapsed panel stays collapsed across multiple timestamp seeks on same video', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=same_video_id'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'), 'Panel should be collapsed');

    const seeks = [
      'https://www.youtube.com/watch?v=same_video_id&t=10s',
      'https://www.youtube.com/watch?v=same_video_id#t=20s',
      'https://www.youtube.com/watch?v=same_video_id&t=30s'
    ];

    for (const seekUrl of seeks) {
      sandbox.win.location = new URL(seekUrl);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: seekUrl }
      }));
      assert.ok(
        panel.classList.contains('collapsed'),
        `Panel must remain collapsed during seek: ${seekUrl}`
      );
    }
  });

  // ADV-M3-05: Auto-expand behavior across video navigation and home roundtrips
  await t.test('ADV-M3-05: Auto-expands on new video, and re-expands when returning from non-video page', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_alpha'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');

    // 1. Collapse on Video Alpha
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // 2. Navigate to Video Beta -> Should auto-expand
    const betaUrl = 'https://www.youtube.com/watch?v=video_beta';
    sandbox.win.location = new URL(betaUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: betaUrl }
    }));
    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Should auto-expand on Video Beta');

    // 3. Collapse on Video Beta
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // 4. Navigate to Homepage -> Panel hidden
    const homeUrl = 'https://www.youtube.com/';
    sandbox.win.location = new URL(homeUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: homeUrl }
    }));
    assert.strictEqual(panel.style.display, 'none');

    // 5. Navigate back to Video Beta -> Must re-show and auto-expand
    sandbox.win.location = new URL(betaUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: betaUrl }
    }));
    assert.notStrictEqual(panel.style.display, 'none', 'Panel must be visible again');
    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Panel must auto-expand on return to video');
  });

  // ADV-M3-06: Non-video page matrix disconnects ResizeObserver and hides panel
  await t.test('ADV-M3-06: Non-video pages matrix hides panel and disconnects ResizeObserver', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_watch'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const nonVideoPages = [
      'https://www.youtube.com/',
      'https://www.youtube.com/@Veritasium',
      'https://www.youtube.com/feed/subscriptions',
      'https://www.youtube.com/feed/explore',
      'https://www.youtube.com/results?search_query=veritasium',
      'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
      'https://www.youtube.com/account'
    ];

    for (const p of nonVideoPages) {
      sandbox.win.location = new URL(p);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: p }
      }));

      assert.strictEqual(panel.style.display, 'none', `Panel must be hidden on ${p}`);
      assert.ok(panel.classList.contains('nlm-hidden'), `nlm-hidden class must be present on ${p}`);

      const ro = sandbox.win.ResizeObserver.instances[0];
      const isDisconnected = !ro || ro.observed.size === 0;
      assert.ok(isDisconnected, `ResizeObserver must be disconnected on ${p}`);
    }
  });

  // ADV-M3-07: Rapid interleaved navigation cycle
  await t.test('ADV-M3-07: Rapid interleaved transitions (Video -> Home -> Video -> Search -> Video) maintain integrity', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=interleave_init'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const flow = [
      { url: 'https://www.youtube.com/', isVideo: false },
      { url: 'https://www.youtube.com/watch?v=interleave_1', isVideo: true },
      { url: 'https://www.youtube.com/results?search_query=test', isVideo: false },
      { url: 'https://www.youtube.com/watch?v=interleave_2', isVideo: true },
      { url: 'https://www.youtube.com/@testchannel', isVideo: false },
      { url: 'https://www.youtube.com/watch?v=interleave_3', isVideo: true }
    ];

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const iframe = panel.querySelector('iframe');

    for (let i = 0; i < flow.length; i++) {
      const step = flow[i];
      sandbox.win.location = new URL(step.url);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: step.url }
      }));

      if (step.isVideo) {
        assert.notStrictEqual(panel.style.display, 'none', `Step ${i}: Video page must show panel`);
        const parsed = new URL(iframe.src);
        assert.strictEqual(parsed.searchParams.get('url'), step.url, `Step ${i}: Iframe URL must match`);
      } else {
        assert.strictEqual(panel.style.display, 'none', `Step ${i}: Non-video page must hide panel`);
      }
    }
  });

  // ADV-M3-08: Navigation away during anchor wait aborts cleanly
  await t.test('ADV-M3-08: Navigation away to non-video page while waiting for anchor aborts cleanly', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=pending_anchor',
      hasSidebar: false // Anchor does not exist yet!
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Now user navigates away before anchor ever appears
    const homeUrl = 'https://www.youtube.com/';
    sandbox.win.location = new URL(homeUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: homeUrl }
    }));

    // Now simulate anchor being added to DOM late (while on homepage!)
    const lateAnchor = sandbox.doc.createElement('div');
    lateAnchor.id = 'secondary-inner';
    sandbox.doc.body.appendChild(lateAnchor);

    // Ensure panel was NOT mounted into the anchor on homepage
    const panelInsideAnchor = lateAnchor.querySelector('#nlm-youtube-panel');
    assert.strictEqual(panelInsideAnchor, null, 'Panel must NOT mount onto anchor when on non-video page');
  });

  // ADV-M3-09: Hostile event detail objects
  await t.test('ADV-M3-09: Hostile event detail objects (null, primitives, non-string URL) do not crash', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=hostile_test'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const hostileDetails = [
      null,
      undefined,
      {},
      { url: null },
      { url: 12345 },
      { url: {} },
      { url: 'javascript:alert(1)' },
      { url: '' },
      { response: null },
      { response: { title: {} } }
    ];

    for (const detail of hostileDetails) {
      assert.doesNotThrow(() => {
        sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail }));
      }, `Must not throw on hostile detail: ${JSON.stringify(detail)}`);
    }
  });

  // ADV-M3-10: Sidepanel extractYouTubeVideoId robustness on relative & hostile URLs
  await t.test('ADV-M3-10: sidepanel.js extractYouTubeVideoId safely processes relative and non-URL inputs', () => {
    const sidepanelCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');
    
    // Evaluate extractYouTubeVideoId in an isolated context
    const fnMatch = sidepanelCode.match(/function extractYouTubeVideoId\([\s\S]*?\n\}/);
    assert.ok(fnMatch, 'Must locate extractYouTubeVideoId in sidepanel.js');
    
    const fnStr = fnMatch[0];
    const extractFn = new Function(`${fnStr}; return extractYouTubeVideoId;`)();

    // Valid formats
    assert.strictEqual(extractFn('https://www.youtube.com/watch?v=abc123XYZ'), 'abc123XYZ');
    assert.strictEqual(extractFn('/watch?v=rel_id_456'), 'rel_id_456');
    assert.strictEqual(extractFn('/shorts/short_789'), 'short_789');
    assert.strictEqual(extractFn('/live/live_012'), 'live_012');
    assert.strictEqual(extractFn('https://youtu.be/short_link_345'), 'short_link_345');

    // Hostile / non-video inputs
    assert.strictEqual(extractFn('/'), null);
    assert.strictEqual(extractFn('/feed/subscriptions'), null);
    assert.strictEqual(extractFn('https://google.com/watch?v=fake'), null);
    assert.strictEqual(extractFn(null), null);
    assert.strictEqual(extractFn(undefined), null);
    assert.strictEqual(extractFn(12345), null);
    assert.strictEqual(extractFn(''), null);
    assert.strictEqual(extractFn('invalid:url//?v=123'), null);
  });
});
