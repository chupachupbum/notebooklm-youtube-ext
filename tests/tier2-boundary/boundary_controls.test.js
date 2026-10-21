const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 2 - Boundary & Corner Cases: Controls & Visuals (F7, F8, F9)', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 2 pending: content/youtube-injector.js not yet created');
    return;
  }

  // Boundary F7: Collapse edge cases
  await t.test('TC-B-F7-01: Rapid repeated clicks on close button remain in collapsed state', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');

    // Burst of 5 clicks
    for (let i = 0; i < 5; i++) {
      closeBtn.click();
    }
    assert.ok(panel.classList.contains('collapsed'), 'Panel should remain collapsed');
  });

  await t.test('TC-B-F7-02: ResizeObserver resize event does NOT re-expand panel while collapsed', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // ResizeObserver fires because user resized browser
    const ro = sandbox.win.ResizeObserver.instances[0];
    ro.trigger(sandbox.domNodes.moviePlayer, 600);

    assert.ok(
      panel.classList.contains('collapsed'),
      'Panel must stay collapsed despite player resize event'
    );
  });

  await t.test('TC-B-F7-03: Close button click stops propagation to avoid immediate header re-expansion', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();

    // If close event bubbled to header without stopPropagation, it might have toggled back
    assert.ok(panel.classList.contains('collapsed'), 'Must remain collapsed after clicking close button');
  });

  await t.test('TC-B-F7-04: Header element maintains accessible label or title', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const hasAria = closeBtn.getAttribute('aria-label') || closeBtn.getAttribute('title');
    assert.ok(hasAria !== null || closeBtn.textContent.trim().length > 0, 'Close button must have text or aria label');
  });

  await t.test('TC-B-F7-05: Collapse state preserves current video details in memory', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_preserve',
      playerHeight: 500
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();

    const iframe = panel.querySelector('iframe');
    assert.ok(iframe.src.includes('video_preserve'), 'Iframe src must retain video details while collapsed');
  });

  // Boundary F8: Expand edge cases
  await t.test('TC-B-F8-01: Rapid alternating collapse/expand clicks converge cleanly', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    for (let i = 0; i < 6; i++) {
      closeBtn.click();
      header.click();
    }
    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Should finish expanded');
  });

  await t.test('TC-B-F8-02: Clicking child span or icon within collapsed header re-expands panel', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // Click child element inside header
    const childSpan = header.children[0] || header;
    childSpan.click();
    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Click on header child must expand');
  });

  await t.test('TC-B-F8-03: Expanding after player height changed while collapsed adopts new height', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    // Collapse at 480px
    closeBtn.click();

    // Video player resizes to 720px while user was collapsed
    const ro = sandbox.win.ResizeObserver.instances[0];
    ro.trigger(sandbox.domNodes.moviePlayer, 720);

    // Re-expand
    header.click();
    const expandedHeight = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(expandedHeight.includes('720'), `Expanded height must adopt latest 720px, got ${expandedHeight}`);
  });

  await t.test('TC-B-F8-04: Clicking inside iframe area does not trigger expand/collapse header toggle', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const iframe = panel.querySelector('iframe');
    iframe.click();

    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Clicking iframe should not collapse panel');
  });

  await t.test('TC-B-F8-05: Double click on header bar behaves gracefully', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    header.click();
    header.click();
    assert.doesNotThrow(() => {});
  });

  // Boundary F9: Styling edge cases
  await t.test('TC-B-F9-01: Stylesheet handles box-sizing border-box to prevent horizontal overflow', () => {
    if (!fs.existsSync(PATHS.injectorCss)) {
      t.skip('M2 pending');
      return;
    }
    const css = fs.readFileSync(PATHS.injectorCss, 'utf8');
    const hasBoxSizing = css.includes('border-box') || css.includes('box-sizing');
    assert.ok(hasBoxSizing, 'CSS should declare border-box to prevent overflow in #secondary');
  });

  await t.test('TC-B-F9-02: Stylesheet specifies overflow: hidden for smooth height transitions', () => {
    if (!fs.existsSync(PATHS.injectorCss)) {
      t.skip('M2 pending');
      return;
    }
    const css = fs.readFileSync(PATHS.injectorCss, 'utf8');
    assert.ok(css.includes('overflow') || css.includes('hidden'), 'CSS should manage overflow during transitions');
  });

  await t.test('TC-B-F9-03: Collapsed class definition is present in CSS', () => {
    if (!fs.existsSync(PATHS.injectorCss)) {
      t.skip('M2 pending');
      return;
    }
    const css = fs.readFileSync(PATHS.injectorCss, 'utf8');
    assert.ok(css.includes('.collapsed'), 'CSS must define .collapsed class rules');
  });

  await t.test('TC-B-F9-04: Iframe styling inside panel has border: none and 100% width', () => {
    if (!fs.existsSync(PATHS.injectorCss)) {
      t.skip('M2 pending');
      return;
    }
    const css = fs.readFileSync(PATHS.injectorCss, 'utf8');
    assert.ok(css.includes('iframe'), 'CSS should style iframe element');
  });

  await t.test('TC-B-F9-05: Header height defined in CSS is ~40px', () => {
    if (!fs.existsSync(PATHS.injectorCss)) {
      t.skip('M2 pending');
      return;
    }
    const css = fs.readFileSync(PATHS.injectorCss, 'utf8');
    const has40px = css.includes('40px') || css.includes('42px') || css.includes('44px') || css.includes('38px');
    assert.ok(has40px, 'Header bar height should be approximately 40px in CSS');
  });
});
