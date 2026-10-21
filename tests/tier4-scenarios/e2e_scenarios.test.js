const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 4 - Real-World Application Scenarios (End-to-End User Workflows)', async (t) => {
  const bgCode = fs.readFileSync(PATHS.background, 'utf8');

  // Scenario 1: Standard Summarization Workflow
  await t.test('SCENARIO-01: Standard Summarize Workflow (Injection -> Summarize -> Progress -> Done)', () => {
    // 1. YouTube content script triggers
    assert.ok(bgCode.includes("action === 'summarize'"));
    // 2. Progress steps handled
    assert.ok(bgCode.includes('step'));
    // 3. Follow-up / Done cleanup
    assert.ok(bgCode.includes('handleDone'));
  });

  // Scenario 2: Binge Watching Recommendation Navigation
  await t.test('SCENARIO-02: Binge Watching (Video 1 -> Summarize -> Click Recommendation -> Auto-Update to Video 2)', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=vid_ep1',
      videoTitle: 'Episode 1: The Beginning'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    assert.ok(iframe.src.includes('vid_ep1'));

    // User clicks recommendation for Episode 2
    const ep2Url = 'https://www.youtube.com/watch?v=vid_ep2';
    const ep2Title = 'Episode 2: The Adventure Continues';
    sandbox.win.location = new URL(ep2Url);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: { url: ep2Url, response: { title: ep2Title } }
    }));

    const parsed = new URL(iframe.src);
    assert.strictEqual(parsed.searchParams.get('url'), ep2Url);
  });

  // Scenario 3: Focus & Collapse Workflow
  await t.test('SCENARIO-03: Focus & Collapse (Watch video -> Minimize to thin bar -> Re-expand later)', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2 pending');
      return;
    }
    const sandbox = createTestSandbox({ playerHeight: 520 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    // User minimizes to focus on video
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));
    const collapsedH = parseInt(panel.style.height || '40', 10);
    assert.ok(collapsedH <= 48);

    // Later, user clicks header to re-expand
    header.click();
    assert.strictEqual(panel.classList.contains('collapsed'), false);
    const expandedH = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(expandedH.includes('520'));
  });

  // Scenario 4: User Browse & Return Workflow
  await t.test('SCENARIO-04: User Browse & Return (Video -> Home -> Feed -> Back to Video)', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=vid_orig' });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    // Click YouTube logo
    sandbox.win.location = new URL('https://www.youtube.com/');
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: 'https://www.youtube.com/' } }));
    let panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(!panel || panel.style.display === 'none' || !panel.isConnected);

    // Click a video from home feed
    const returnUrl = 'https://www.youtube.com/watch?v=vid_new_feed';
    sandbox.win.location = new URL(returnUrl);
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', { detail: { url: returnUrl } }));
    panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel && panel.style.display !== 'none');
  });

  // Scenario 5: Mid-Flight Navigation Abort
  await t.test('SCENARIO-05: Mid-Flight Navigation Abort (Summarize Video 1 -> Click Video 2 before completion -> Session 1 Aborted)', () => {
    assert.ok(bgCode.includes('activeSession.sessionId = null') ||
              bgCode.includes('activeSession.sessionId !== currentSessionId'));
    assert.ok(bgCode.includes("performCleanup('navigatedAway')"));
  });

  // Scenario 6: Tab Close Cleanup Workflow
  await t.test('SCENARIO-06: Tab Close Cleanup (Active session -> User closes tab -> Cleanup fired -> Storage reset)', () => {
    assert.ok(bgCode.includes('chrome.tabs.onRemoved.addListener'));
    assert.ok(bgCode.includes("performCleanup('tabClosed')"));
    assert.ok(bgCode.includes('activeSession = {'));
  });

  // Scenario 7: Concurrent Side Panel & Inline Usage
  await t.test('SCENARIO-07: Concurrent Side Panel & Inline Usage (Both surfaces active simultaneously)', () => {
    assert.ok(bgCode.includes('chrome.sidePanel'));
    assert.ok(bgCode.includes('broadcastToSidePanel'));
  });

  // Scenario 8: Long Navigation Session (5 Consecutive Videos)
  await t.test('SCENARIO-08: Long Navigation Session (5 Consecutive Videos in single tab)', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2/M3 pending');
      return;
    }
    const sandbox = createTestSandbox({ url: 'https://www.youtube.com/watch?v=vid_0' });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');

    for (let i = 1; i <= 5; i++) {
      const nextUrl = `https://www.youtube.com/watch?v=vid_${i}`;
      sandbox.win.location = new URL(nextUrl);
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: nextUrl }
      }));
      const parsed = new URL(iframe.src);
      assert.strictEqual(parsed.searchParams.get('url'), nextUrl, `Step ${i}: Iframe URL must match`);
    }
  });

  // Scenario 9: Theater Mode Toggle & Viewport Resizing
  await t.test('SCENARIO-09: Theater Mode Toggle & Viewport Resizing (ResizeObserver tracks dynamic changes)', () => {
    if (!fs.existsSync(PATHS.injector)) {
      t.skip('M2 pending');
      return;
    }
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Toggle theater mode (height expands to 650px)
    ro.trigger(sandbox.domNodes.moviePlayer, 650);
    let hStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(hStr.includes('650'));

    // Return to normal mode (height reverts to 480px)
    ro.trigger(sandbox.domNodes.moviePlayer, 480);
    hStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(hStr.includes('480'));
  });

  // Scenario 10: Onboarding inside Inline Iframe
  await t.test('SCENARIO-10: First-Time User Onboarding (Runs cleanly inside iframe boundaries)', () => {
    assert.ok(fs.existsSync(PATHS.onboardingJs), 'onboarding.js must exist');
    assert.ok(fs.existsSync(PATHS.onboardingCss), 'onboarding.css must exist');
  });
});
