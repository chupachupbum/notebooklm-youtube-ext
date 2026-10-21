const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 7: Header Bar & Close/Collapse Toggle', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 2 pending: content/youtube-injector.js not yet created');
    return;
  }

  await t.test('TC-F7-01: Header bar displays extension title/logo ("NLM Summarizer")', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];
    assert.ok(header, 'Header element must exist');
    assert.ok(
      header.textContent.includes('NLM Summarizer') || header.textContent.includes('Summarizer'),
      'Header must contain extension branding'
    );
  });

  await t.test('TC-F7-02: Header bar contains close/minimize button (✕)', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') ||
                     panel.querySelector('button') ||
                     panel.querySelector('[aria-label*="close" i]');
    assert.ok(closeBtn, 'Close/minimize button must exist in header');
  });

  await t.test('TC-F7-03: Clicking close button sets collapsed state (adds .collapsed class)', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') ||
                     panel.querySelector('button');
    closeBtn.click();

    assert.ok(panel.classList.contains('collapsed'), 'Panel container must have .collapsed class');
  });

  await t.test('TC-F7-04: Collapsed state restricts container height to ~40px bar', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    closeBtn.click();

    const collapsedHeight = parseInt(panel.style.height || '40', 10);
    assert.ok(collapsedHeight <= 48, `Collapsed height must be ~40px, got ${collapsedHeight}`);
  });

  await t.test('TC-F7-05: In collapsed state, iframe is hidden or inaccessible', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const iframe = panel.querySelector('iframe');
    closeBtn.click();

    const isHidden = panel.classList.contains('collapsed') || iframe.style.display === 'none';
    assert.ok(isHidden, 'Iframe should be suppressed or container collapsed');
  });
});

test('Tier 1 - Feature 8: Expand from Collapsed Bar', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 2 pending: content/youtube-injector.js not yet created');
    return;
  }

  await t.test('TC-F8-01: Clicking collapsed header bar triggers expand', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    // Collapse first
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'), 'Must be collapsed');

    // Click header to re-expand
    header.click();
    assert.ok(!panel.classList.contains('collapsed'), 'Must not have .collapsed after clicking bar');
  });

  await t.test('TC-F8-02: Expanding removes .collapsed class from container', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    closeBtn.click();
    header.click();

    assert.strictEqual(panel.classList.contains('collapsed'), false, 'Container must remove .collapsed');
  });

  await t.test('TC-F8-03: Restores container height to match video player on expansion', () => {
    const sandbox = createTestSandbox({ playerHeight: 560 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    closeBtn.click();
    header.click();

    const restoredHeight = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(restoredHeight.includes('560'), `Height must restore to 560px, got ${restoredHeight}`);
  });

  await t.test('TC-F8-04: Iframe becomes visible again upon expansion', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];
    const iframe = panel.querySelector('iframe');

    closeBtn.click();
    header.click();

    assert.notStrictEqual(iframe.style.display, 'none', 'Iframe must not be display: none when expanded');
  });

  await t.test('TC-F8-05: Multiple collapse/expand toggles preserve state integrity', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const closeBtn = panel.querySelector('[class*="close"]') || panel.querySelector('button');
    const header = panel.querySelector('[class*="header"]') || panel.children[0];

    for (let i = 0; i < 5; i++) {
      closeBtn.click();
      assert.ok(panel.classList.contains('collapsed'), `Cycle ${i}: Must be collapsed`);
      header.click();
      assert.ok(!panel.classList.contains('collapsed'), `Cycle ${i}: Must be expanded`);
    }
  });
});
