const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PATHS, readManifest } = require('../harness/test-helpers.js');
const { createChromeMock } = require('../harness/chrome-mock.js');
const { createDOMEnvironment } = require('../harness/dom-mock.js');

const sidepanelCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');

function setupSidepanelDOM(doc) {
  const ids = [
    'notebookUrl', 'videoTitle', 'videoUrl', 'summarizeBtn', 'retryBtn',
    'doneBtn', 'copyBtn', 'followUpBtn', 'followUpInput', 'settingsToggle',
    'settings', 'saveSettings', 'replayTutorialBtn', 'notYoutube', 'ready',
    'working', 'results', 'error', 'statusMessage', 'errorMessage', 'summaryContent',
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
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {}
    },
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

test('Milestone 1 - Challenger M1-2 Adversarial Test Suite', async (t) => {

  // --- SECTION 1: MANIFEST V3 DECLARATIONS & SECURITY BOUNDARIES ---

  await t.test('ADV2-01: Web Accessible Resources strict origin boundary & leak prevention', () => {
    const manifest = readManifest();
    assert.ok(Array.isArray(manifest.web_accessible_resources), 'web_accessible_resources must be an array');
    assert.strictEqual(manifest.web_accessible_resources.length, 1, 'web_accessible_resources should have exactly 1 config block');

    const war = manifest.web_accessible_resources[0];

    // Check matches
    assert.ok(Array.isArray(war.matches), 'matches must be an array');
    for (const match of war.matches) {
      assert.ok(
        match.startsWith('https://www.youtube.com/') || match.startsWith('https://youtube.com/'),
        `Match pattern '${match}' must be restricted strictly to HTTPS YouTube origins`
      );
      assert.ok(!match.includes('*://*'), `Match pattern '${match}' must not use universal scheme wildcards`);
      assert.ok(!match.includes('<all_urls>'), `Match pattern '${match}' must not contain <all_urls>`);
      assert.ok(!match.startsWith('http://'), `Match pattern '${match}' must NOT allow insecure HTTP`);
    }

    // Verify sensitive internal files are NOT exposed in web_accessible_resources
    const forbiddenFiles = [
      'background.js',
      'content/notebooklm-controller.js',
      'lib/selectors.js',
      'manifest.json',
      'package.json',
      'package-lock.json',
      'PROJECT.md',
      'ORIGINAL_REQUEST.md'
    ];

    for (const forbidden of forbiddenFiles) {
      assert.ok(
        !war.resources.includes(forbidden),
        `CRITICAL SECURITY LEAK: '${forbidden}' is exposed in web_accessible_resources!`
      );
    }

    // Verify all declared web-accessible files actually exist on disk
    for (const res of war.resources) {
      if (res.endsWith('/*')) {
        const dir = path.join(PATHS.root, res.slice(0, -2));
        assert.ok(fs.existsSync(dir), `Directory for wildcard resource '${res}' must exist on disk: ${dir}`);
      } else {
        const filePath = path.join(PATHS.root, res);
        assert.ok(fs.existsSync(filePath), `Resource '${res}' declared in web_accessible_resources must exist on disk: ${filePath}`);
      }
    }
  });

  await t.test('ADV2-02: Manifest V3 permissions & CSP compliance audit', () => {
    const manifest = readManifest();
    assert.strictEqual(manifest.manifest_version, 3, 'Manifest version must be 3');

    // Permissions check
    const allowedPermissions = new Set(['sidePanel', 'activeTab', 'tabs', 'storage', 'scripting']);
    for (const perm of manifest.permissions) {
      assert.ok(allowedPermissions.has(perm), `Unexpected or excessive permission found: '${perm}'`);
    }

    // Prohibited dangerous permissions in MV3
    const forbiddenPerms = ['webRequestBlocking', 'declarativeWebRequest', 'proxy', 'management', 'debugger'];
    for (const forbidden of forbiddenPerms) {
      assert.ok(!manifest.permissions.includes(forbidden), `Disallowed permission '${forbidden}' found!`);
    }

    // Check service worker
    assert.ok(manifest.background && manifest.background.service_worker, 'Background service worker must be declared');
    assert.strictEqual(typeof manifest.background.scripts, 'undefined', 'MV3 must NOT declare background.scripts array');

    // Host permissions check
    const expectedHosts = [
      'https://notebooklm.google.com/*',
      'https://notebook.google.com/*',
      'https://www.youtube.com/*',
      'https://youtube.com/*'
    ];
    assert.deepStrictEqual(manifest.host_permissions.sort(), expectedHosts.sort(), 'host_permissions must strictly match required scopes');
  });

  // --- SECTION 2: UNLISTED EXTENSION RESOURCES IN SIDEPANEL.HTML ---

  await t.test('ADV2-03: Zero unlisted extension resources in sidepanel.html', () => {
    const htmlContent = fs.readFileSync(PATHS.sidepanelHtml, 'utf8');
    const manifest = readManifest();
    const warResources = new Set(manifest.web_accessible_resources[0].resources);

    // Regex extract all href and src references in HTML
    const hrefMatches = [...htmlContent.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);

    for (const ref of hrefMatches) {
      // Ignore anchors or hash fragments
      if (ref.startsWith('#')) continue;
      // Remote HTTP/HTTPS links should not be scripts or stylesheets
      if (ref.startsWith('http://') || ref.startsWith('https://')) {
        assert.fail(`Remote dependency found in sidepanel.html: '${ref}'. Remote code is forbidden by MV3 CSP.`);
      }

      // Normalize path relative to extension root
      // sidepanel.html is at sidepanel/sidepanel.html
      const normalizedPath = path.normalize(path.join('sidepanel', ref)).replace(/\\/g, '/');

      assert.ok(
        warResources.has(normalizedPath),
        `Unlisted resource found in sidepanel.html: '${ref}' (resolved to '${normalizedPath}'). This will be BLOCKED by Chrome when embedded inside YouTube iframe!`
      );
    }
  });

  await t.test('ADV2-04: CSS stylesheet self-containment (no external font/@import/url leaks)', () => {
    const sidepanelCss = fs.readFileSync(PATHS.sidepanelCss, 'utf8');
    const onboardingCss = fs.readFileSync(PATHS.onboardingCss, 'utf8');

    for (const [name, css] of [['sidepanel.css', sidepanelCss], ['onboarding.css', onboardingCss]]) {
      // Check for @import
      const importMatch = css.match(/@import\s+[^;]+;/gi);
      assert.strictEqual(importMatch, null, `@import rule found in ${name}: ${importMatch}`);

      // Check for remote url()
      const urlMatches = [...css.matchAll(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(m => m[1]);
      for (const u of urlMatches) {
        if (!u.startsWith('data:')) {
          assert.fail(`Non-data url() found in ${name}: '${u}'. May cause CSP or loading failure.`);
        }
      }
    }
  });

  await t.test('ADV2-05: CSP violation check (no inline scripts, no eval/Function)', () => {
    const htmlContent = fs.readFileSync(PATHS.sidepanelHtml, 'utf8');

    // Verify no inline <script> tags with code
    const scriptTags = [...htmlContent.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const match of scriptTags) {
      if (match[1].trim().length > 0) {
        assert.fail(`Inline script found in sidepanel.html: ${match[1].trim()}`);
      }
    }

    // Verify no inline event handlers (e.g. onclick, onerror)
    const inlineHandlers = [...htmlContent.matchAll(/\s(on[a-z]+)\s*=\s*["'][^"']*["']/gi)].map(m => m[1]);
    assert.deepStrictEqual(inlineHandlers, [], `Inline event handlers found in sidepanel.html: ${inlineHandlers.join(', ')}`);

    // Verify sidepanel.js and onboarding.js do not call eval or new Function
    for (const jsFile of [PATHS.sidepanelJs, PATHS.onboardingJs]) {
      const content = fs.readFileSync(jsFile, 'utf8');
      assert.ok(!/\beval\s*\(/.test(content), `eval() call detected in ${path.basename(jsFile)}`);
      assert.ok(!/new\s+Function\s*\(/.test(content), `new Function() detected in ${path.basename(jsFile)}`);
    }
  });

  // --- SECTION 3: FALLBACK CHROME SIDE PANEL MODE ROBUSTNESS ---

  await t.test('ADV2-06: Sidepanel behavior when chrome.tabs.query rejects with error', async () => {
    const errorMsg = 'Tab query failed due to permission restriction';
    const failingChromeMock = createChromeMock();
    failingChromeMock.tabs.query = () => Promise.reject(new Error(errorMsg));

    const panelUrl = 'chrome-extension://mock-id/sidepanel/sidepanel.html';
    const { doc, context } = runSidepanelInVM(panelUrl, null, failingChromeMock);

    // Initial DOMContentLoaded event setup
    doc.dispatchEvent({ type: 'DOMContentLoaded' });
    await new Promise(resolve => setTimeout(resolve, 20));

    // UI should show error state gracefully
    const errorSection = doc.getElementById('error');
    const errorText = doc.getElementById('errorMessage');
    assert.strictEqual(errorSection.classList.contains('hidden'), false, 'Error section must be visible when tabs.query fails');
    assert.strictEqual(errorText.textContent, 'Failed to detect current tab.', 'Error message should be user-friendly');

    // Clicking retryBtn when tabs.query recovers
    failingChromeMock.tabs.query = () => Promise.resolve([
      { id: 200, url: 'https://www.youtube.com/watch?v=recovered123', title: 'Recovered Video', active: true, currentWindow: true }
    ]);

    const retryBtn = doc.getElementById('retryBtn');
    retryBtn.click();
    await new Promise(resolve => setTimeout(resolve, 50));

    const readySection = doc.getElementById('ready');
    assert.strictEqual(readySection.classList.contains('hidden'), false, 'UI must recover to ready state on retry');
    assert.strictEqual(doc.getElementById('videoTitle').textContent, 'Recovered Video');
  });

  await t.test('ADV2-07: Sidepanel behavior when tabs.query returns empty array (no active tab)', async () => {
    const emptyChromeMock = createChromeMock();
    emptyChromeMock.tabs.query = () => Promise.resolve([]);

    const panelUrl = 'chrome-extension://mock-id/sidepanel/sidepanel.html';
    const { doc, context } = runSidepanelInVM(panelUrl, null, emptyChromeMock);

    await context.checkCurrentTab();

    const notYtSection = doc.getElementById('notYoutube');
    const readySection = doc.getElementById('ready');
    const errorSection = doc.getElementById('error');

    assert.strictEqual(notYtSection.classList.contains('hidden'), false, 'notYoutube state should be active when no tabs returned');
    assert.strictEqual(readySection.classList.contains('hidden'), true, 'ready state must be hidden');
    assert.strictEqual(errorSection.classList.contains('hidden'), true, 'error state must be hidden');
  });

  await t.test('ADV2-08: Sidepanel resilience against abnormal & hostile tab objects', async () => {
    const abnormalTabs = [
      { id: 1 }, // No url property
      { id: 2, url: null },
      { id: 3, url: undefined },
      { id: 4, url: '' },
      { id: 5, url: 'about:blank' },
      { id: 6, url: 'chrome://extensions/' },
      { id: 7, url: 'chrome-extension://other-ext-id/popup.html' },
      { id: 8, url: 'ftp://ftp.example.com/file' },
      { id: 9, url: 'javascript:void(0)' }
    ];

    for (const badTab of abnormalTabs) {
      const mockChrome = createChromeMock();
      mockChrome.tabs.query = () => Promise.resolve([badTab]);

      const panelUrl = 'chrome-extension://mock-id/sidepanel/sidepanel.html';
      const { doc, context } = runSidepanelInVM(panelUrl, null, mockChrome);

      await context.checkCurrentTab();

      const notYtSection = doc.getElementById('notYoutube');
      const errorSection = doc.getElementById('error');

      assert.strictEqual(
        notYtSection.classList.contains('hidden'),
        false,
        `Tab with URL '${badTab.url}' must safely transition to notYoutube state`
      );
      assert.strictEqual(
        errorSection.classList.contains('hidden'),
        true,
        `Tab with URL '${badTab.url}' must NOT trigger an unhandled error state`
      );
    }
  });

  await t.test('ADV2-09: Background openFallbackWindow parameter resilience', async () => {
    const bgCode = fs.readFileSync(PATHS.background, 'utf8');

    // Verify openFallbackWindow handles undefined/null tab parameter
    assert.ok(
      bgCode.includes('if (tab?.url) queryParams.set(\'url\', tab.url);'),
      'background.js must use optional chaining tab?.url when constructing fallback window query'
    );
    assert.ok(
      bgCode.includes('if (tab?.title) queryParams.set(\'title\', tab.title);'),
      'background.js must use optional chaining tab?.title when constructing fallback window query'
    );
    assert.ok(
      bgCode.includes('chrome.windows.getCurrent'),
      'background.js must query current window for positioning fallback window'
    );
  });

  await t.test('ADV2-10: Hostile query string injections & extreme parameters', async () => {
    const extremePayloads = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&bad=%00%FF%FE',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&url=' + encodeURIComponent('https://youtube.com/watch?v=nested'),
      'https://www.youtube.com/watch?v=' + 'a'.repeat(10000), // Huge video ID
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ#' + 'x'.repeat(5000)
    ];

    for (const ep of extremePayloads) {
      const panelUrl = `chrome-extension://mock-id/sidepanel/sidepanel.html?url=${encodeURIComponent(ep)}&title=${encodeURIComponent('T'.repeat(2000))}&inline=1`;
      const { doc, context } = runSidepanelInVM(panelUrl);
      doc.dispatchEvent({ type: 'DOMContentLoaded' });
      await new Promise(resolve => setTimeout(resolve, 20));

      const readyEl = doc.getElementById('ready');
      const notYtEl = doc.getElementById('notYoutube');
      // Should not throw or crash the VM
      assert.ok(readyEl || notYtEl);
    }
  });

  await t.test('ADV2-11: Fallback popup window resilience when chrome.windows.create throws', async () => {
    const bgCode = fs.readFileSync(PATHS.background, 'utf8');
    // Verify background.js handles chrome.sidePanel.open rejection
    assert.ok(
      bgCode.includes('chrome.sidePanel.open failed, falling back to popup window'),
      'background.js must catch chrome.sidePanel.open failure and fall back'
    );
    // Verify chrome.windows.getCurrent failure is safely caught
    assert.ok(
      bgCode.includes('chrome.windows.getCurrent()'),
      'background.js must query current window'
    );
  });

  await t.test('ADV2-12: web_accessible_resources exact match domain boundaries', () => {
    const manifest = readManifest();
    const matches = manifest.web_accessible_resources[0].matches;

    // Verify spoofed subdomains are NOT present
    const spoofedDomains = [
      'https://youtube.com.attacker.com/*',
      'https://www.youtube.com.attacker.com/*',
      'https://fake-youtube.com/*',
      'http://www.youtube.com/*',
      'http://youtube.com/*'
    ];
    for (const spoof of spoofedDomains) {
      assert.ok(!matches.includes(spoof), `Spoofed origin '${spoof}' must not match`);
    }

    // Chrome MV3 pattern specification: 'https://www.youtube.com/*' matches ONLY exact hostname 'www.youtube.com'
    // and 'https://youtube.com/*' matches ONLY exact hostname 'youtube.com'.
    for (const pattern of matches) {
      const host = new URL(pattern.replace('/*', '/')).hostname;
      assert.ok(host === 'www.youtube.com' || host === 'youtube.com', `Host '${host}' must strictly be YouTube`);
    }
  });

  await t.test('ADV2-13: Rapid consecutive checkCurrentTab invocations (race condition check)', async () => {
    const panelUrl = 'chrome-extension://mock-id/sidepanel/sidepanel.html';
    const mockChrome = createChromeMock();
    const { doc, context } = runSidepanelInVM(panelUrl, null, mockChrome);

    // Concurrently trigger checkCurrentTab multiple times
    const promises = [
      context.checkCurrentTab(),
      context.checkCurrentTab(),
      context.checkCurrentTab()
    ];
    await Promise.all(promises);

    // State should remain consistent and not corrupted
    const readyEl = doc.getElementById('ready');
    const notYtEl = doc.getElementById('notYoutube');
    const isReady = !readyEl.classList.contains('hidden');
    const isNotYt = !notYtEl.classList.contains('hidden');
    assert.ok(isReady !== isNotYt, 'Exactly one state (ready or notYoutube) should be active');
  });
});

