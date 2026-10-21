const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PATHS } = require('./harness/test-helpers.js');
const { createChromeMock } = require('./harness/chrome-mock.js');
const { createDOMEnvironment } = require('./harness/dom-mock.js');

/**
 * Creates an enhanced background test sandbox with fully mocked Chrome APIs
 * capable of executing background.js service worker logic.
 */
function createBackgroundSandbox(options = {}) {
  const initialTabs = options.tabs || [
    { id: 101, url: 'https://www.youtube.com/watch?v=vid_test1', title: 'Test Video 1', active: true, windowId: 1 },
    { id: 200, url: 'https://notebooklm.google.com/notebook/notebook-123', active: false, windowId: 1 }
  ];
  const initialWindows = options.windows || [
    { id: 1, focused: true, width: 1920, height: 1080, left: 0, top: 0 }
  ];

  const chromeMock = createChromeMock({ tabs: initialTabs, windows: initialWindows });
  if (options.hasSidePanel === false) {
    delete chromeMock.sidePanel;
  }

  // Patch tabs.query to support array URL patterns (MV3 tabs.query spec)
  const origQuery = chromeMock.tabs.query;
  chromeMock.tabs.query = function(queryInfo) {
    if (queryInfo && Array.isArray(queryInfo.url)) {
      let matched = [...chromeMock._state.tabsList];
      if (queryInfo.active !== undefined) matched = matched.filter(t => t.active === queryInfo.active);
      if (queryInfo.currentWindow !== undefined) matched = matched.filter(t => t.currentWindow === queryInfo.currentWindow);
      matched = matched.filter(t => {
        if (!t.url) return false;
        return queryInfo.url.some(p => {
          const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$');
          return regex.test(t.url);
        });
      });
      return Promise.resolve(matched);
    }
    return origQuery(queryInfo);
  };

  // Add windows.get and windows.onRemoved (for fallback popup window testing)
  chromeMock.windows.get = function(winId) {
    const win = chromeMock._state.windowsList.find(w => w.id === winId);
    if (win) return Promise.resolve(win);
    return Promise.reject(new Error('Window ' + winId + ' not found'));
  };

  const windowRemovedListeners = [];
  chromeMock.windows.onRemoved = {
    addListener: (fn) => windowRemovedListeners.push(fn),
    removeListener: (fn) => {
      const idx = windowRemovedListeners.indexOf(fn);
      if (idx !== -1) windowRemovedListeners.splice(idx, 1);
    },
    dispatch: async (winId) => {
      for (const fn of [...windowRemovedListeners]) {
        await fn(winId);
      }
    }
  };

  // Add scripting.executeScript mock
  chromeMock.scripting = {
    executeScript: () => Promise.resolve([{ result: true }])
  };

  // Add runtime.getPlatformInfo mock
  chromeMock.runtime.getPlatformInfo = (cb) => {
    const info = { os: 'win', arch: 'x86-64' };
    if (typeof cb === 'function') cb(info);
    return Promise.resolve(info);
  };

  // Configure default notebookUrl
  chromeMock.storage.local.set({ notebookUrl: 'https://notebooklm.google.com/notebook/notebook-123' });

  // Track broadcast messages sent via chrome.runtime.sendMessage
  const broadcastMessages = [];
  const originalRuntimeSendMessage = chromeMock.runtime.sendMessage;
  chromeMock.runtime.sendMessage = function(msg, cb) {
    broadcastMessages.push(msg);
    return originalRuntimeSendMessage(msg, cb);
  };

  // Content script message handler for NotebookLM tab
  let notebookMessageHandler = (tabId, message) => {
    if (message.action === 'ping') return Promise.resolve({ status: 'alive' });
    if (message.action === 'clearChat') return Promise.resolve({ success: true });
    if (message.action === 'addSource') return Promise.resolve({ success: true });
    if (message.action === 'askQuestion') return Promise.resolve({ text: 'Mock Generated Response' });
    if (message.action === 'removeSource') return Promise.resolve({ success: true });
    return Promise.resolve({ success: true });
  };

  chromeMock.tabs.sendMessage = function(tabId, message, cb) {
    chromeMock._state.sentTabMessages.push({ tabId, message });
    return notebookMessageHandler(tabId, message).then(res => {
      if (typeof cb === 'function') cb(res);
      return res;
    });
  };

  const sandbox = {
    chrome: chromeMock,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {}
    },
    URL,
    URLSearchParams,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };

  vm.createContext(sandbox);
  const bgCode = fs.readFileSync(PATHS.background, 'utf8');
  vm.runInContext(bgCode, sandbox);

  return {
    sandbox,
    chrome: chromeMock,
    broadcastMessages,
    setNotebookMessageHandler: (fn) => { notebookMessageHandler = fn; },
    getActiveSession: () => vm.runInContext('activeSession', sandbox),
    getFallbackWindowId: () => vm.runInContext('fallbackWindowId', sandbox),
    dispatchTabUpdated: (tabId, changeInfo, tab) => {
      const listener = chromeMock.tabs.onUpdated.listeners[0];
      return listener(tabId, changeInfo, tab);
    },
    dispatchTabRemoved: (tabId) => {
      const listener = chromeMock.tabs.onRemoved.listeners[0];
      return listener(tabId, { isWindowClosing: false });
    },
    dispatchActionClick: (tab) => {
      const listener = chromeMock.action.onClicked.listeners[0];
      return listener(tab);
    },
    dispatchRuntimeMessage: (msg) => {
      const listener = chromeMock.runtime.onMessage.listeners[0];
      return new Promise((resolve) => {
        const isAsync = listener(msg, { id: 'test' }, resolve);
        if (isAsync !== true) resolve({ received: true });
      });
    }
  };
}

function setupSidepanelDOM(doc) {
  const elements = [
    'header', 'settingsToggle', 'settings', 'notebookUrl', 'saveSettings', 'settingsStatus', 'replayTutorialBtn',
    'notYoutube', 'ready', 'videoTitle', 'videoUrl', 'summarizeBtn',
    'working', 'statusMessage', 'progressSteps',
    'results', 'summaryContent', 'limitationsBlock', 'limitationsContent', 'followUpInput', 'followUpBtn', 'followUpResults', 'doneBtn', 'copyBtn',
    'error', 'errorMessage', 'retryBtn'
  ];
  const domNodes = {};
  for (const id of elements) {
    const el = doc.createElement(id.includes('Btn') ? 'button' : (id.includes('Input') || id === 'notebookUrl' ? 'input' : 'div'));
    el.id = id;
    if (['notYoutube', 'working', 'results', 'error', 'settings', 'limitationsBlock'].includes(id)) {
      el.classList.add('hidden');
    }
    doc.body.appendChild(el);
    domNodes[id] = el;
  }
  const steps = ['open', 'add', 'ask', 'wait', 'limits', 'done'];
  for (const step of steps) {
    const stepEl = doc.createElement('div');
    stepEl.className = 'step';
    stepEl.setAttribute('data-step', step);
    domNodes.progressSteps.appendChild(stepEl);
  }
  doc.body.contains = (child) => {
    let cur = child;
    while (cur) {
      if (cur === doc.body) return true;
      cur = cur.parentNode;
    }
    return false;
  };
  return domNodes;
}

/**
 * Creates a Sidepanel / Inline panel DOM sandbox
 */
function createSidepanelSandbox(searchQuery = '', sharedChrome = null) {
  const { doc, win } = createDOMEnvironment('chrome-extension://ext-id/sidepanel/sidepanel.html' + searchQuery);
  const domNodes = setupSidepanelDOM(doc);

  const chromeMock = sharedChrome || createChromeMock();
  const sandbox = {
    window: win,
    document: doc,
    chrome: chromeMock,
    URL: win.URL,
    URLSearchParams: win.URLSearchParams,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id)
  };

  vm.createContext(sandbox);
  const spCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');
  vm.runInContext(spCode, sandbox);
  doc.dispatchEvent(new win.CustomEvent('DOMContentLoaded'));

  return { sandbox, doc, win, chrome: chromeMock, domNodes };
}

test('Tier 5 - Adversarial Stress Suite: Background Cleanup, Session Invalidation & Coexistence (M3-2)', async (t) => {

  // =========================================================================
  // Dimension 1: Background Cleanups & Session Invalidation
  // =========================================================================

  await t.test('ADV-M3-2-01: Mid-flight navigation abort invalidates session and discards Video 1 summary', async () => {
    const bg = createBackgroundSandbox();
    let askQuestionDeferred = null;

    bg.setNotebookMessageHandler((tabId, message) => {
      if (message.action === 'ping') return Promise.resolve({ status: 'alive' });
      if (message.action === 'clearChat') return Promise.resolve({ success: true });
      if (message.action === 'addSource') return Promise.resolve({ success: true });
      if (message.action === 'askQuestion') {
        return new Promise((resolve) => {
          askQuestionDeferred = resolve;
        });
      }
      return Promise.resolve({ success: true });
    });

    // Step 1: Start summarization for Video 1 on tab 101
    bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=vid_flight1',
      videoTitle: 'Flight Video 1',
      tabId: 101
    });

    // Wait until pipeline reaches askQuestion
    while (!askQuestionDeferred) {
      await new Promise(r => setTimeout(r, 10));
    }

    const midFlightSession = bg.getActiveSession();
    assert.strictEqual(midFlightSession.videoId, 'vid_flight1');
    assert.strictEqual(midFlightSession.status, 'working');
    assert.ok(midFlightSession.sessionId, 'SessionId must be active');

    // Step 2: Tab 101 navigates to Video 2 while summarize is still in flight
    await bg.dispatchTabUpdated(
      101,
      { url: 'https://www.youtube.com/watch?v=vid_flight2' },
      { id: 101, url: 'https://www.youtube.com/watch?v=vid_flight2' }
    );

    // Verify session 1 was aborted and rebound to Video 2
    const postNavSession = bg.getActiveSession();
    assert.strictEqual(postNavSession.videoId, 'vid_flight2');
    assert.strictEqual(postNavSession.status, 'ready');

    // Step 3: Video 1 deferred response resolves
    askQuestionDeferred({ text: 'Video 1 Summary Text that must be discarded' });
    await new Promise(r => setTimeout(r, 50));

    // Step 4: Verify Video 1 was NOT broadcast to sidepanel
    const summaryBroadcasts = bg.broadcastMessages.filter(m => m.action === 'summary');
    assert.strictEqual(summaryBroadcasts.length, 0, 'No summary broadcast must be sent for aborted Video 1');

    // Step 5: Verify Video 1 was NOT saved to history
    const historyData = await bg.chrome.storage.local.get(['summaryHistory']);
    const history = historyData.summaryHistory || [];
    assert.strictEqual(history.length, 0, 'History must not contain aborted Video 1');
  });

  await t.test('ADV-M3-2-02: Mid-flight navigation with immediate Video 2 summarize executes only Video 2', async () => {
    const bg = createBackgroundSandbox();
    let video1AskResolve = null;

    bg.setNotebookMessageHandler((tabId, message) => {
      if (message.action === 'ping') return Promise.resolve({ status: 'alive' });
      if (message.action === 'clearChat') return Promise.resolve({ success: true });
      if (message.action === 'addSource') return Promise.resolve({ success: true });
      if (message.action === 'askQuestion') {
        if (message.question && message.question.includes('Flight Video 1')) {
          return new Promise(r => { video1AskResolve = r; });
        }
        return Promise.resolve({ text: 'Summary of Video 2' });
      }
      if (message.action === 'removeSource') return Promise.resolve({ success: true });
      return Promise.resolve({ success: true });
    });

    // Start Video 1
    bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=vid_1_fast',
      videoTitle: 'Flight Video 1',
      tabId: 101
    });

    // Wait for Video 1 to enter working state
    while (!bg.getActiveSession().sessionId) {
      await new Promise(r => setTimeout(r, 5));
    }

    // Navigate to Video 2
    await bg.dispatchTabUpdated(
      101,
      { url: 'https://www.youtube.com/watch?v=vid_2_fast' },
      { id: 101, url: 'https://www.youtube.com/watch?v=vid_2_fast' }
    );

    // Immediately start summarize on Video 2
    bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=vid_2_fast',
      videoTitle: 'Flight Video 2',
      tabId: 101
    });

    // Let Video 1 resolve in background
    if (video1AskResolve) video1AskResolve({ text: 'Discarded Video 1' });
    await new Promise(r => setTimeout(r, 50));

    // Active session should be for Video 2
    const currentSession = bg.getActiveSession();
    assert.strictEqual(currentSession.videoId, 'vid_2_fast');
  });

  await t.test('ADV-M3-2-03: Tab close cleanup (tabClosed) completely resets activeSession and storage', async () => {
    const bg = createBackgroundSandbox();
    let sourceRemoved = false;

    bg.setNotebookMessageHandler((tabId, message) => {
      if (message.action === 'removeSource') {
        sourceRemoved = true;
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true, text: 'Done' });
    });

    // Simulate active session on tab 101 with active source
    await bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=vid_to_close',
      videoTitle: 'Close Me Video',
      tabId: 101
    });

    // Mark that source was added
    const session = bg.getActiveSession();
    session.hasSource = true;

    // Tab 101 is closed
    await bg.dispatchTabRemoved(101);

    // Session in memory must be idle and cleared
    const postCloseSession = bg.getActiveSession();
    assert.strictEqual(postCloseSession.status, 'idle', 'Session status must be idle');
    assert.strictEqual(postCloseSession.tabId, null, 'Session tabId must be null');
    assert.strictEqual(postCloseSession.videoId, null, 'Session videoId must be null');
    assert.strictEqual(postCloseSession.hasSource, false, 'hasSource must be false');
    assert.strictEqual(postCloseSession.sessionId, null, 'sessionId must be null');

    // Storage session must also be synced to idle
    const storageData = await bg.chrome.storage.session.get(['activeSession']);
    assert.strictEqual(storageData.activeSession.status, 'idle');
    assert.strictEqual(storageData.activeSession.tabId, null);

    // removeSource must have been called
    assert.ok(sourceRemoved, 'removeSource must be dispatched to NotebookLM on tab close');

    // Broadcast message must notify sessionCleanedUp with reason tabClosed
    const cleanupBroadcast = bg.broadcastMessages.find(
      m => m.action === 'sessionCleanedUp' && m.reason === 'tabClosed'
    );
    assert.ok(cleanupBroadcast, 'Must broadcast sessionCleanedUp with reason tabClosed');
  });

  await t.test('ADV-M3-2-04: Unrelated tab closures do NOT disrupt active YouTube session', async () => {
    const bg = createBackgroundSandbox();

    // Start active session on tab 101
    bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=vid_persistent',
      videoTitle: 'Persistent Video',
      tabId: 101
    });

    while (bg.getActiveSession().status !== 'working') {
      await new Promise(r => setTimeout(r, 5));
    }

    const originalSessionId = bg.getActiveSession().sessionId;

    // Close 10 unrelated tabs (e.g. Wikipedia, GitHub tabs)
    for (let tabId = 201; tabId <= 210; tabId++) {
      await bg.dispatchTabRemoved(tabId);
    }

    // Active session must remain completely intact
    const session = bg.getActiveSession();
    assert.strictEqual(session.tabId, 101, 'Active tabId must still be 101');
    assert.strictEqual(session.videoId, 'vid_persistent', 'Active videoId must remain unchanged');
    assert.strictEqual(session.status, 'working', 'Status must still be working');
    assert.strictEqual(session.sessionId, originalSessionId, 'SessionId must not be invalidated');
  });

  await t.test('ADV-M3-2-05: Direct closure of NotebookLM tab clears notebookTabId without crashing', async () => {
    const bg = createBackgroundSandbox();

    // Set notebookTabId in session and service worker memory
    await bg.chrome.storage.session.set({ notebookTabId: 200 });
    vm.runInContext('notebookTabId = 200', bg.sandbox);

    // Close NotebookLM tab (id 200)
    await bg.dispatchTabRemoved(200);

    // Verify storage session cleared notebookTabId
    const stored = await bg.chrome.storage.session.get(['notebookTabId']);
    assert.strictEqual(stored.notebookTabId, undefined, 'notebookTabId must be removed from storage');

    // Subsequent cleanup should handle missing NotebookLM tab gracefully
    await assert.doesNotReject(async () => {
      await bg.dispatchTabRemoved(101);
    }, 'Cleanup with missing NotebookLM tab must not throw');
  });

  await t.test('ADV-M3-2-06: Same-video timestamp / fragment updates do NOT trigger cleanup', async () => {
    const bg = createBackgroundSandbox();

    // Bind tab 101 to Video 1
    await bg.dispatchTabUpdated(
      101,
      { url: 'https://www.youtube.com/watch?v=vid_same' },
      { id: 101, url: 'https://www.youtube.com/watch?v=vid_same' }
    );

    assert.strictEqual(bg.getActiveSession().videoId, 'vid_same');
    bg.broadcastMessages.length = 0; // Clear

    // Navigate to timestamp ?t=45s on same video
    await bg.dispatchTabUpdated(
      101,
      { url: 'https://www.youtube.com/watch?v=vid_same&t=45s' },
      { id: 101, url: 'https://www.youtube.com/watch?v=vid_same&t=45s' }
    );

    // Navigate to hash #comments on same video
    await bg.dispatchTabUpdated(
      101,
      { url: 'https://www.youtube.com/watch?v=vid_same#comments' },
      { id: 101, url: 'https://www.youtube.com/watch?v=vid_same#comments' }
    );

    // No navigatedAway cleanup must have been fired
    const navCleanups = bg.broadcastMessages.filter(
      m => m.action === 'sessionCleanedUp' && m.reason === 'navigatedAway'
    );
    assert.strictEqual(navCleanups.length, 0, 'Timestamp navigation on same video must not trigger cleanup');
    assert.strictEqual(bg.getActiveSession().videoId, 'vid_same');
  });

  // =========================================================================
  // Dimension 2: Side Panel + Inline Coexistence
  // =========================================================================

  await t.test('ADV-M3-2-07: Concurrent Side Panel and Inline Iframe receive shared progress and summary', async () => {
    const bg = createBackgroundSandbox();

    // Create shared runtime bus connecting background and both UI surfaces
    const uiListeners = [];
    bg.chrome.runtime.onMessage.addListener((msg) => {
      for (const fn of uiListeners) fn(msg);
    });

    const nativePanel = createSidepanelSandbox('', {
      ...bg.chrome,
      runtime: {
        ...bg.chrome.runtime,
        sendMessage: (msg) => bg.dispatchRuntimeMessage(msg),
        onMessage: { addListener: (fn) => uiListeners.push(fn) }
      },
      tabs: {
        query: () => Promise.resolve([{ id: 101, url: 'https://www.youtube.com/watch?v=coex_vid', title: 'Coex Video', active: true }]),
        onActivated: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      }
    });

    const inlinePanel = createSidepanelSandbox('?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dcoex_vid&title=Coex%20Video&inline=1', {
      ...bg.chrome,
      runtime: {
        ...bg.chrome.runtime,
        sendMessage: (msg) => bg.dispatchRuntimeMessage(msg),
        onMessage: { addListener: (fn) => uiListeners.push(fn) }
      },
      tabs: {
        query: () => Promise.resolve([{ id: 101, url: 'https://www.youtube.com/watch?v=coex_vid', title: 'Coex Video', active: true }]),
        onActivated: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      }
    });

    // Verify DOM isolation: inline panel has .is-inline-mode class, native does not
    assert.ok(inlinePanel.doc.body.classList.contains('is-inline-mode'), 'Inline panel must have is-inline-mode');
    assert.ok(!nativePanel.doc.body.classList.contains('is-inline-mode'), 'Native panel must NOT have is-inline-mode');

    // Trigger summarize from inline panel
    inlinePanel.doc.getElementById('summarizeBtn').click();

    // Wait for background broadcast of summary
    while (!bg.broadcastMessages.some(m => m.action === 'summary')) {
      await new Promise(r => setTimeout(r, 10));
    }

    // Both surfaces must transition to results state
    const nativeResultsHidden = nativePanel.doc.getElementById('results').classList.contains('hidden');
    const inlineResultsHidden = inlinePanel.doc.getElementById('results').classList.contains('hidden');
    assert.strictEqual(nativeResultsHidden, false, 'Native Side Panel must be in results state');
    assert.strictEqual(inlineResultsHidden, false, 'Inline Panel must be in results state');

    // Both surfaces must have summary content rendered
    assert.ok(nativePanel.doc.getElementById('summaryContent').innerHTML.length > 0);
    assert.ok(inlinePanel.doc.getElementById('summaryContent').innerHTML.length > 0);
  });

  await t.test('ADV-M3-2-08: Done button clicked in Native Side Panel synchronizes cleanup to Inline Iframe', async () => {
    const bg = createBackgroundSandbox();
    const uiListeners = [];

    bg.chrome.runtime.onMessage.addListener((msg) => {
      for (const fn of uiListeners) fn(msg);
    });

    const nativePanel = createSidepanelSandbox('', {
      ...bg.chrome,
      runtime: {
        ...bg.chrome.runtime,
        sendMessage: (msg) => bg.dispatchRuntimeMessage(msg),
        onMessage: { addListener: (fn) => uiListeners.push(fn) }
      },
      tabs: {
        query: () => Promise.resolve([{ id: 101, url: 'https://www.youtube.com/watch?v=sync_vid', title: 'Sync Vid', active: true }]),
        onActivated: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      }
    });

    const inlinePanel = createSidepanelSandbox('?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dsync_vid&title=Sync%20Vid&inline=1', {
      ...bg.chrome,
      runtime: {
        ...bg.chrome.runtime,
        sendMessage: (msg) => bg.dispatchRuntimeMessage(msg),
        onMessage: { addListener: (fn) => uiListeners.push(fn) }
      },
      tabs: {
        query: () => Promise.resolve([{ id: 101, url: 'https://www.youtube.com/watch?v=sync_vid', title: 'Sync Vid', active: true }]),
        onActivated: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      }
    });

    // Populate results on both surfaces
    nativePanel.doc.getElementById('summaryContent').textContent = 'Some Active Summary';
    inlinePanel.doc.getElementById('summaryContent').textContent = 'Some Active Summary';

    // Click Done button in Native Side Panel
    await nativePanel.doc.getElementById('doneBtn').click();
    await new Promise(r => setTimeout(r, 20));

    // Both surfaces must reset summaryContent and show ready state
    assert.strictEqual(nativePanel.doc.getElementById('summaryContent').innerHTML, '');
    assert.strictEqual(inlinePanel.doc.getElementById('summaryContent').innerHTML, '');
    assert.strictEqual(nativePanel.doc.getElementById('ready').classList.contains('hidden'), false);
    assert.strictEqual(inlinePanel.doc.getElementById('ready').classList.contains('hidden'), false);
  });

  await t.test('ADV-M3-2-09: Fallback window open -> focus -> close -> re-open lifecycle', async () => {
    const bg = createBackgroundSandbox({
      hasSidePanel: false,
      windows: [{ id: 1, focused: true, width: 1920, height: 1080, left: 0, top: 0 }]
    });

    const ytTab = {
      id: 101,
      url: 'https://www.youtube.com/watch?v=fallback_test_vid',
      title: 'Fallback Test Video'
    };

    // First click: opens fallback window
    await bg.dispatchActionClick(ytTab);

    const firstWinId = bg.getFallbackWindowId();
    assert.ok(firstWinId, 'Fallback window ID must be assigned');

    const createdWin = bg.chrome._state.windowsList.find(w => w.id === firstWinId);
    assert.ok(createdWin, 'Fallback window must exist in windowsList');
    assert.strictEqual(createdWin.type, 'popup');
    assert.ok(createdWin.url.includes('sidepanel/sidepanel.html'));
    assert.ok(createdWin.url.includes('fallback_test_vid'));

    // Second click while open: brings existing window to front without creating duplicate
    const initialWinCount = bg.chrome._state.windowsList.length;
    await bg.dispatchActionClick(ytTab);
    assert.strictEqual(bg.chrome._state.windowsList.length, initialWinCount, 'Must not create duplicate popup window');
    assert.strictEqual(bg.getFallbackWindowId(), firstWinId);

    // Fallback window closes
    await bg.chrome.windows.onRemoved.dispatch(firstWinId);
    assert.strictEqual(bg.getFallbackWindowId(), null, 'fallbackWindowId must reset to null on window removal');

    // Third click: opens a brand new fallback popup window
    await bg.dispatchActionClick(ytTab);
    const newWinId = bg.getFallbackWindowId();
    assert.ok(newWinId, 'New fallback window ID must be assigned');
    assert.notStrictEqual(newWinId, firstWinId, 'New fallback window must have distinct window ID');
  });

  await t.test('ADV-M3-2-10: YouTube tab closure updates Fallback Window UI to notYoutube', async () => {
    const tabRemovedListeners = [];
    const sharedChrome = createChromeMock();
    sharedChrome.tabs.onRemoved.addListener = (fn) => tabRemovedListeners.push(fn);

    const fallbackSidepanel = createSidepanelSandbox('', sharedChrome);

    // Initial checkCurrentTab on YouTube tab 101
    await fallbackSidepanel.sandbox.checkCurrentTab();
    assert.strictEqual(fallbackSidepanel.doc.getElementById('ready').classList.contains('hidden'), false);

    // YouTube tab 101 closes
    for (const fn of tabRemovedListeners) {
      fn(101);
    }

    // Fallback UI must transition to notYoutube state
    const notYoutubeHidden = fallbackSidepanel.doc.getElementById('notYoutube').classList.contains('hidden');
    assert.strictEqual(notYoutubeHidden, false, 'Fallback panel must transition to notYoutube state');
  });

  await t.test('ADV-M3-2-11: Rapid navigation ping-pong (10 navigations) maintains consistent session', async () => {
    const bg = createBackgroundSandbox();

    for (let i = 1; i <= 10; i++) {
      const vid = (i % 2 === 0) ? 'vid_ping' : 'vid_pong';
      await bg.dispatchTabUpdated(
        101,
        { url: 'https://www.youtube.com/watch?v=' + vid },
        { id: 101, url: 'https://www.youtube.com/watch?v=' + vid }
      );
      assert.strictEqual(bg.getActiveSession().videoId, vid);
    }

    const finalSession = bg.getActiveSession();
    assert.strictEqual(finalSession.videoId, 'vid_ping', '10th navigation must be vid_ping');
    assert.strictEqual(finalSession.status, 'ready');
  });

  await t.test('ADV-M3-2-12: Concurrent double summarize calls are safely sequenced by session token', async () => {
    const bg = createBackgroundSandbox();

    bg.setNotebookMessageHandler((tabId, message) => {
      if (message.action === 'askQuestion') {
        return new Promise(resolve => setTimeout(() => resolve({ text: 'Answer' }), 20));
      }
      return Promise.resolve({ success: true });
    });

    // Dispatch two rapid summarize requests in the same tick
    const p1 = bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=vid_double1',
      videoTitle: 'Double 1',
      tabId: 101
    });

    const p2 = bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=vid_double2',
      videoTitle: 'Double 2',
      tabId: 101
    });

    await Promise.all([p1, p2]);
    await new Promise(r => setTimeout(r, 80));

    // Only the second summarize request should be active and broadcast
    const session = bg.getActiveSession();
    assert.strictEqual(session.videoId, 'vid_double2', 'Final active session must be double 2');
  });

});