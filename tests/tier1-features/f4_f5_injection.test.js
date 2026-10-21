const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 4: DOM Anchor Selection & Panel Injection', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 2 pending: content/youtube-injector.js not yet created');
    return;
  }

  await t.test('TC-F4-01: Injects panel container above #secondary-inner when present', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel') ||
                  sandbox.doc.querySelector('#nlm-youtube-panel-container');
    assert.ok(panel, 'Injected panel container must exist in DOM');
    assert.ok(
      sandbox.domNodes.secondaryInner.children.includes(panel) ||
      sandbox.domNodes.secondary.children.includes(panel),
      'Panel must be injected inside #secondary-inner or #secondary'
    );
  });

  await t.test('TC-F4-02: Falls back to #secondary if #secondary-inner is absent', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    // Remove #secondary-inner to test fallback
    sandbox.domNodes.secondary.removeChild(sandbox.domNodes.secondaryInner);

    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel') ||
                  sandbox.doc.querySelector('#nlm-youtube-panel-container');
    assert.ok(panel, 'Injected panel container must exist in DOM even without #secondary-inner');
    assert.ok(sandbox.domNodes.secondary.children.includes(panel), 'Panel must be child of #secondary');
  });

  await t.test('TC-F4-03: Inserts panel as first child (prepended) above recommendations', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const container = sandbox.domNodes.secondaryInner.children.length > 1
      ? sandbox.domNodes.secondaryInner
      : sandbox.domNodes.secondary;
    const firstChild = container.children[0];
    const isPanel = firstChild.id.includes('nlm-youtube-panel');
    assert.ok(isPanel, 'Injected panel must be the first child (prepended before #related)');
  });

  await t.test('TC-F4-04: Deduplication: does not inject duplicate panels on repeated calls', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panels = sandbox.doc.querySelectorAll('[id*="nlm-youtube-panel"]');
    assert.strictEqual(panels.length, 1, 'Must never create duplicate panel containers');
  });

  await t.test('TC-F4-05: Container element has valid identifier and classes', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel') ||
                  sandbox.doc.querySelector('#nlm-youtube-panel-container');
    assert.ok(panel, 'Panel container must exist');
    assert.ok(panel.id.length > 0, 'Panel must have an explicit ID');
  });
});

test('Tier 1 - Feature 5: Iframe Embedding with Query Parameters', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 2 pending: content/youtube-injector.js not yet created');
    return;
  }

  const testVideoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const testVideoTitle = 'Rick Astley - Never Gonna Give You Up';

  await t.test('TC-F5-01: Creates an <iframe> element inside the panel container', () => {
    const sandbox = createTestSandbox({
      url: testVideoUrl,
      videoTitle: testVideoTitle
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    assert.ok(iframe, 'An <iframe> must be embedded inside the injected container');
  });

  await t.test('TC-F5-02: Iframe src targets sidepanel/sidepanel.html via chrome.runtime.getURL', () => {
    const sandbox = createTestSandbox({
      url: testVideoUrl,
      videoTitle: testVideoTitle
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    assert.ok(iframe && iframe.src, 'Iframe src must be set');
    assert.ok(
      iframe.src.startsWith('chrome-extension://mock-nlm-extension-id/sidepanel/sidepanel.html'),
      'Iframe src must point to sidepanel/sidepanel.html via chrome.runtime.getURL'
    );
  });

  await t.test('TC-F5-03: Passes video URL encoded in query params', () => {
    const sandbox = createTestSandbox({
      url: testVideoUrl,
      videoTitle: testVideoTitle
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const parsedUrl = new URL(iframe.src);
    assert.strictEqual(
      parsedUrl.searchParams.get('url'),
      testVideoUrl,
      'Query param url must match current video URL'
    );
  });

  await t.test('TC-F5-04: Passes video title encoded in query params', () => {
    const sandbox = createTestSandbox({
      url: testVideoUrl,
      videoTitle: testVideoTitle
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const parsedUrl = new URL(iframe.src);
    assert.strictEqual(
      parsedUrl.searchParams.get('title'),
      testVideoTitle,
      'Query param title must match current video title'
    );
  });

  await t.test('TC-F5-05: Passes inline=1 to trigger sidepanel inline mode', () => {
    const sandbox = createTestSandbox({
      url: testVideoUrl,
      videoTitle: testVideoTitle
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const iframe = sandbox.doc.querySelector('iframe');
    const parsedUrl = new URL(iframe.src);
    assert.strictEqual(
      parsedUrl.searchParams.get('inline'),
      '1',
      'Query param inline must be set to 1'
    );
  });
});
