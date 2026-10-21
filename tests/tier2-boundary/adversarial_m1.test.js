const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PATHS, readManifest } = require('../harness/test-helpers.js');
const { createChromeMock } = require('../harness/chrome-mock.js');
const { createDOMEnvironment, MockElement } = require('../harness/dom-mock.js');

const sidepanelCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');

function setupSidepanelDOM(doc) {
  const ids = [
    'notebookUrl', 'videoTitle', 'videoUrl', 'summarizeBtn', 'retryBtn',
    'doneBtn', 'copyBtn', 'followUpBtn', 'followUpInput', 'settingsToggle',
    'settings', 'saveSettings', 'replayTutorialBtn', 'notYoutube', 'ready',
    'working', 'results', 'error', 'statusMessage', 'summaryContent',
    'limitationsBlock', 'limitationsContent', 'followUpResults', 'settingsStatus'
  ];
  for (const id of ids) {
    const el = doc.createElement('div');
    el.id = id;
    doc.body.appendChild(el);
  }
}

function runSidepanelInVM(url, docOverride = null, chromeOverride = null) {
  const { doc, win } = createDOMEnvironment(url);
  const activeDoc = docOverride || doc;
  setupSidepanelDOM(activeDoc);
  const activeChrome = chromeOverride || createChromeMock();

  const sandbox = {
    window: win,
    document: activeDoc,
    chrome: activeChrome,
    console: console,
    URL: URL,
    URLSearchParams: URLSearchParams,
    parseInt: parseInt,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval
  };

  win.document = activeDoc;
  win.chrome = activeChrome;

  const context = vm.createContext(sandbox);
  vm.runInContext(sidepanelCode, context);

  return { doc: activeDoc, win, chrome: activeChrome, context };
}

test('Milestone 1 - Adversarial & Stress Testing', async (t) => {

  await t.test('ADV-01: Stress-test inline parameter variations', async (st) => {
    const falseCases = [
      '',
      '?inline=',
      '?inline=0',
      '?inline=false',
      '?inline=2',
      '?inline=-1',
      '?inline=yes',
      '?inline=null',
      '?inline=undefined',
      '?inline=%201%20',
      '?INLINE=1',
      '?other=1'
    ];

    for (const qs of falseCases) {
      const url = `chrome-extension://mock-id/sidepanel/sidepanel.html${qs}`;
      const { doc } = runSidepanelInVM(url);
      assert.strictEqual(
        doc.body.classList.contains('is-inline-mode'),
        false,
        `Expected inline mode to be FALSE for '${qs}', but got TRUE`
      );
    }

    const trueCases = [
      '?inline=1',
      '?inline=true',
      '?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&inline=1',
      '?inline=1&inline=0', // URLSearchParams.get returns first value '1'
      '?foo=bar&inline=true&baz=qux'
    ];

    for (const qs of trueCases) {
      const url = `chrome-extension://mock-id/sidepanel/sidepanel.html${qs}`;
      const { doc } = runSidepanelInVM(url);
      assert.strictEqual(
        doc.body.classList.contains('is-inline-mode'),
        true,
        `Expected inline mode to be TRUE for '${qs}', but got FALSE`
      );
    }
  });

  await t.test('ADV-02: Stress-test URL parameter with hostile & invalid inputs', async (st) => {
    const invalidUrls = [
      'invalid',
      'javascript:alert(1)',
      'https://attacker.com/watch?v=dQw4w9WgXcQ',
      'https://www.google.com/search?q=youtube',
      'https://www.youtube.com',
      'https://www.youtube.com/feed/subscriptions',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/watch?v=',
      'https://www.youtube.com/shorts/',
      'https://www.youtube.com/live/',
      'https://youtu.be/'
    ];

    for (const invUrl of invalidUrls) {
      const chromeMock = createChromeMock({
        tabs: [{ id: 999, url: 'https://attacker.com', title: 'Evil', active: true, currentWindow: true }]
      });
      const panelUrl = `chrome-extension://mock-id/sidepanel/sidepanel.html?url=${encodeURIComponent(invUrl)}&inline=1`;
      const { doc, context } = runSidepanelInVM(panelUrl, null, chromeMock);
      
      // Trigger DOMContentLoaded
      doc.dispatchEvent({ type: 'DOMContentLoaded' });
      
      // Wait for async checkCurrentTab
      await new Promise(resolve => setTimeout(resolve, 20));

      const readyEl = doc.getElementById('ready');
      const notYtEl = doc.getElementById('notYoutube');
      
      assert.strictEqual(
        readyEl.classList.contains('hidden'),
        true,
        `Invalid URL '${invUrl}' should NOT activate ready state`
      );
      assert.strictEqual(
        notYtEl.classList.contains('hidden'),
        false,
        `Invalid URL '${invUrl}' should activate notYoutube state`
      );
    }

    const validUrls = [
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
      { url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
      { url: 'https://www.youtube.com/shorts/sH0rT1d1234', id: 'sH0rT1d1234' },
      { url: 'https://www.youtube.com/live/liveStreamId1', id: 'liveStreamId1' },
      { url: 'https://youtu.be/dQw4w9WgXcQ?t=10', id: 'dQw4w9WgXcQ' }
    ];

    for (const v of validUrls) {
      const panelUrl = `chrome-extension://mock-id/sidepanel/sidepanel.html?url=${encodeURIComponent(v.url)}&inline=1`;
      const { doc } = runSidepanelInVM(panelUrl);
      doc.dispatchEvent({ type: 'DOMContentLoaded' });
      await new Promise(resolve => setTimeout(resolve, 20));

      const readyEl = doc.getElementById('ready');
      assert.strictEqual(
        readyEl.classList.contains('hidden'),
        false,
        `Valid URL '${v.url}' must activate ready state`
      );
      assert.strictEqual(doc.getElementById('videoUrl').textContent, v.url);
    }
  });

  await t.test('ADV-03: Stress-test title parameter for XSS, HTML injection, and Unicode', async (st) => {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '"><img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '"><iframe src="javascript:alert(1)"></iframe>',
      '${7*7}{{7*7}}'
    ];

    for (const payload of xssPayloads) {
      const panelUrl = `chrome-extension://mock-id/sidepanel/sidepanel.html?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&title=${encodeURIComponent(payload)}&inline=1`;
      const { doc } = runSidepanelInVM(panelUrl);
      doc.dispatchEvent({ type: 'DOMContentLoaded' });
      await new Promise(resolve => setTimeout(resolve, 20));

      const titleEl = doc.getElementById('videoTitle');
      // textContent must store the raw text without interpreting as HTML
      assert.strictEqual(titleEl.textContent, payload, 'Title textContent must match raw payload');
      // children must be empty (no parsed DOM elements)
      assert.strictEqual(titleEl.children.length, 0, 'XSS payload must NOT create child DOM elements');
    }

    const unicodeTitles = [
      '【作業用BGM】超集中できるカフェミュージック ☕',
      'مراجعة شاملة للذكاء الاصطناعي في عام 2026',
      'Обзор обновления искусственного интеллекта',
      '👨‍💻 Dev Vlog #42 🔥 100% Rust & AI 🚀',
      'A'.repeat(5000) // Stress 5000 chars
    ];

    for (const uniTitle of unicodeTitles) {
      const panelUrl = `chrome-extension://mock-id/sidepanel/sidepanel.html?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&title=${encodeURIComponent(uniTitle)}&inline=1`;
      const { doc } = runSidepanelInVM(panelUrl);
      doc.dispatchEvent({ type: 'DOMContentLoaded' });
      await new Promise(resolve => setTimeout(resolve, 20));

      const titleEl = doc.getElementById('videoTitle');
      assert.strictEqual(titleEl.textContent, uniTitle, 'Unicode title must be preserved exactly');
    }
  });

  await t.test('ADV-04: Lifecycle hook & DOM readiness race conditions', async (st) => {
    // 1. Test when document.body is initially null
    const { doc, win } = createDOMEnvironment('chrome-extension://mock-id/sidepanel/sidepanel.html?inline=1');
    const realBody = doc.body;
    doc.body = null; // simulate execution in <head> before <body> exists

    const sandbox = {
      window: win,
      document: doc,
      chrome: createChromeMock(),
      console: console,
      URL: URL,
      URLSearchParams: URLSearchParams,
      parseInt: parseInt,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval
    };
    win.document = doc;
    const context = vm.createContext(sandbox);

    // Initial evaluation with document.body = null should NOT throw
    assert.doesNotThrow(() => {
      vm.runInContext(sidepanelCode, context);
    }, 'Script evaluation with document.body=null must not throw');

    // Restore body and trigger DOMContentLoaded
    doc.body = realBody;
    setupSidepanelDOM(doc);
    assert.strictEqual(doc.body.classList.contains('is-inline-mode'), false);

    // Dispatch DOMContentLoaded
    doc.dispatchEvent({ type: 'DOMContentLoaded' });
    await new Promise(resolve => setTimeout(resolve, 20));

    // Must now have is-inline-mode applied
    assert.strictEqual(
      doc.body.classList.contains('is-inline-mode'),
      true,
      'DOMContentLoaded must apply is-inline-mode after delayed body attachment'
    );

    // 2. Test idempotency of initInlineMode
    context.initInlineMode();
    context.initInlineMode();
    assert.strictEqual(
      doc.body.classList.contains('is-inline-mode'),
      true,
      'Multiple initInlineMode calls must remain idempotent'
    );
  });

  await t.test('ADV-05: Tab ID and parameter tampering edge cases', async (st) => {
    // 1. Valid numeric tabId: ?tabId=42
    const panelUrlValid = 'chrome-extension://mock-id/sidepanel/sidepanel.html?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&tabId=42&inline=1';
    const { doc: docValid, chrome: chromeValid } = runSidepanelInVM(panelUrlValid);
    docValid.dispatchEvent({ type: 'DOMContentLoaded' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(docValid.getElementById('ready').classList.contains('hidden'), false);

    // Closing tab 42 triggers auto-cleanup to 'notYoutube' state
    await chromeValid.tabs.onRemoved.dispatch(42);
    assert.strictEqual(docValid.getElementById('notYoutube').classList.contains('hidden'), false);

    // 2. Malformed tabId: ?tabId=abc (parseInt -> NaN)
    const panelUrlBad = 'chrome-extension://mock-id/sidepanel/sidepanel.html?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&tabId=abc&inline=1';
    const { doc: docBad, chrome: chromeBad } = runSidepanelInVM(panelUrlBad);
    docBad.dispatchEvent({ type: 'DOMContentLoaded' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(docBad.getElementById('ready').classList.contains('hidden'), false);

    // Closing a random tab 42 does NOT trigger cleanup because currentTabId is NaN
    await chromeBad.tabs.onRemoved.dispatch(42);
    assert.strictEqual(docBad.getElementById('ready').classList.contains('hidden'), false);

    // 3. Missing tabId: fallback to active tab query (tab id 101 in default mock)
    const panelUrlNoTab = 'chrome-extension://mock-id/sidepanel/sidepanel.html?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&inline=1';
    const { doc: docNoTab, chrome: chromeNoTab } = runSidepanelInVM(panelUrlNoTab);
    docNoTab.dispatchEvent({ type: 'DOMContentLoaded' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(docNoTab.getElementById('ready').classList.contains('hidden'), false);

    // Closing active tab 101 triggers cleanup
    await chromeNoTab.tabs.onRemoved.dispatch(101);
    assert.strictEqual(docNoTab.getElementById('notYoutube').classList.contains('hidden'), false);
  });

  await t.test('ADV-06: Video switching and state preservation via URL params', async (st) => {
    const videoA = 'https://www.youtube.com/watch?v=videoAAAAAA';
    const videoB = 'https://www.youtube.com/watch?v=videoBBBBBB';

    const panelUrl = `chrome-extension://mock-id/sidepanel/sidepanel.html?url=${encodeURIComponent(videoA)}&title=Video%20A&inline=1`;
    const { doc, win } = runSidepanelInVM(panelUrl);
    doc.dispatchEvent({ type: 'DOMContentLoaded' });
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.strictEqual(doc.getElementById('videoUrl').textContent, videoA);
    assert.strictEqual(doc.getElementById('videoTitle').textContent, 'Video A');
    assert.strictEqual(doc.getElementById('ready').classList.contains('hidden'), false);

    // Simulate video change in URL params and re-run checkCurrentTab
    win.location = new URL(`chrome-extension://mock-id/sidepanel/sidepanel.html?url=${encodeURIComponent(videoB)}&title=Video%20B&inline=1`);
    await win.checkCurrentTab();

    assert.strictEqual(doc.getElementById('videoUrl').textContent, videoB);
    assert.strictEqual(doc.getElementById('videoTitle').textContent, 'Video B');
    assert.strictEqual(doc.getElementById('ready').classList.contains('hidden'), false);
  });

  await t.test('ADV-07: CSS scoping and inline mode stylesheet integrity', () => {
    const sidepanelCss = fs.readFileSync(PATHS.sidepanelCss, 'utf8');

    // Header h1 hidden in inline mode
    assert.match(sidepanelCss, /body\.is-inline-mode\s+header\s+h1\s*\{[^}]*display:\s*none;?[^}]*\}/);

    // Settings toggle accessible and positioned absolutely
    assert.match(sidepanelCss, /body\.is-inline-mode\s+#settingsToggle/);
    assert.match(sidepanelCss, /position:\s*absolute/);

    // Sleek scrollbars defined
    assert.match(sidepanelCss, /body\.is-inline-mode::-webkit-scrollbar/);
    assert.match(sidepanelCss, /scrollbar-width:\s*thin/);

    // Compact layout padding
    assert.match(sidepanelCss, /body\.is-inline-mode\s+main\s*\{[^}]*padding:\s*12px\s+14px;?[^}]*\}/);
  });

  await t.test('ADV-08: Web Accessible Resources and origin isolation', () => {
    const manifest = readManifest();
    const warList = manifest.web_accessible_resources;
    assert.ok(Array.isArray(warList), 'web_accessible_resources must be an array');
    assert.strictEqual(warList.length, 1, 'web_accessible_resources must contain 1 entry');

    const war = warList[0];
    // Must NOT contain universal wildcard
    assert.ok(!war.matches.includes('*'), 'Matches must not be *');
    assert.ok(!war.matches.includes('<all_urls>'), 'Matches must not be <all_urls>');

    // Must strictly match YouTube
    const allowedMatches = ['https://www.youtube.com/*', 'https://youtube.com/*'];
    assert.deepStrictEqual(war.matches.sort(), allowedMatches.sort());

    // All resources must exist
    const expected = [
      'sidepanel/sidepanel.html',
      'sidepanel/sidepanel.css',
      'sidepanel/sidepanel.js',
      'sidepanel/onboarding.css',
      'sidepanel/onboarding.js',
      'lib/markdown.js',
      'icons/*'
    ];
    assert.deepStrictEqual(war.resources.sort(), expected.sort());
  });
});
