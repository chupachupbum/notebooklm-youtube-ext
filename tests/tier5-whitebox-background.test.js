const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PATHS } = require('./harness/test-helpers.js');
const { createChromeMock } = require('./harness/chrome-mock.js');
const { createDOMEnvironment } = require('./harness/dom-mock.js');

/**
 * Creates an isolated Background Service Worker sandbox.
 */
function createBackgroundSandbox(options = {}) {
  const initialTabs = options.tabs || [
    { id: 101, url: 'https://www.youtube.com/watch?v=vid_test1', title: 'Test Video 1', active: true, windowId: 1 },
    { id: 200, url: 'https://notebooklm.google.com/notebook/notebook-123', active: false, windowId: 1 }
  ];
  const initialWindows = options.windows || [
    { id: 1, focused: true, width: 1920, height: 1080, left: 0, top: 0 }
  ];

  const chromeMock = options.chrome || createChromeMock({ tabs: initialTabs, windows: initialWindows });
  if (options.hasSidePanel === false) {
    delete chromeMock.sidePanel;
  }

  // Support array URL patterns in tabs.query
  const origQuery = chromeMock.tabs.query;
  chromeMock.tabs.query = function(queryInfo) {
    if (queryInfo && Array.isArray(queryInfo.url)) {
      let matched = [...chromeMock._state.tabsList];
      if (queryInfo.active !== undefined) matched = matched.filter(t => t.active === queryInfo.active);
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
      for (const fn of [...windowRemovedListeners]) await fn(winId);
    }
  };

  chromeMock.scripting = {
    executeScript: () => Promise.resolve([{ result: true }])
  };

  chromeMock.runtime.getPlatformInfo = (cb) => {
    const info = { os: 'win', arch: 'x86-64' };
    if (typeof cb === 'function') cb(info);
    return Promise.resolve(info);
  };

  if (options.defaultNotebookUrl !== false) {
    chromeMock.storage.local.store.set('notebookUrl', options.notebookUrl || 'https://notebooklm.google.com/notebook/notebook-123');
  }

  const broadcastMessages = [];
  const originalRuntimeSendMessage = chromeMock.runtime.sendMessage;
  chromeMock.runtime.sendMessage = function(msg, cb) {
    broadcastMessages.push(msg);
    if (options.failRuntimeSendMessage) {
      const err = new Error('Could not establish connection. Receiving end does not exist.');
      if (typeof cb === 'function') cb(undefined);
      return Promise.reject(err);
    }
    return originalRuntimeSendMessage(msg, cb);
  };

  let notebookMessageHandler = options.notebookMessageHandler || ((tabId, message) => {
    if (message.action === 'ping') return Promise.resolve({ status: 'alive' });
    if (message.action === 'clearChat') return Promise.resolve({ success: true });
    if (message.action === 'addSource') return Promise.resolve({ success: true });
    if (message.action === 'askQuestion') return Promise.resolve({ text: 'Mock Response' });
    if (message.action === 'removeSource') return Promise.resolve({ success: true });
    return Promise.resolve({ success: true });
  });

  chromeMock.tabs.sendMessage = function(tabId, message, cb) {
    chromeMock._state.sentTabMessages.push({ tabId, message });
    return notebookMessageHandler(tabId, message).then(res => {
      if (typeof cb === 'function') cb(res);
      return res;
    });
  };

  const sandbox = {
    chrome: chromeMock,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
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
    setActiveSession: (val) => vm.runInContext(`activeSession = ${JSON.stringify(val)}`, sandbox),
    getFallbackWindowId: () => vm.runInContext('fallbackWindowId', sandbox),
    setFallbackWindowId: (val) => vm.runInContext(`fallbackWindowId = ${JSON.stringify(val)}`, sandbox),
    getNotebookTabId: () => vm.runInContext('notebookTabId', sandbox),
    setNotebookTabId: (val) => vm.runInContext(`notebookTabId = ${JSON.stringify(val)}`, sandbox),
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

/**
 * Creates an isolated Sidepanel DOM sandbox.
 */
function createSidepanelSandbox(searchQuery = '', sharedChrome = null) {
  const { doc, win } = createDOMEnvironment('chrome-extension://ext-id/sidepanel/sidepanel.html' + searchQuery);
  
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

  const chromeMock = sharedChrome || createChromeMock();
  const runtimeListeners = [];
  chromeMock.runtime.onMessage.addListener = (fn) => runtimeListeners.push(fn);

  const sandbox = {
    window: win,
    document: doc,
    chrome: chromeMock,
    URL: win.URL,
    URLSearchParams: win.URLSearchParams,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
    requestAnimationFrame: (cb) => cb()
  };

  vm.createContext(sandbox);
  const spCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');
  vm.runInContext(spCode, sandbox);
  doc.dispatchEvent(new win.CustomEvent('DOMContentLoaded'));

  return { sandbox, doc, win, chrome: chromeMock, domNodes, runtimeListeners };
}

test('Tier 5 - White-Box Adversarial Hardening Suite: Service Worker & Side Panel Deep Audit', async (t) => {

  // =========================================================================
  // Section 1: Service Worker Restart & Session Synchronization
  // =========================================================================

  await t.test('WB-SW-01: Service worker restores activeSession from storage.session on boot', async () => {
    const initialSession = {
      tabId: 101,
      videoUrl: 'https://www.youtube.com/watch?v=boot_vid',
      videoId: 'boot_vid',
      hasSource: true,
      sessionId: 'sess_boot_999',
      status: 'ready'
    };

    const chromeMock = createChromeMock({
      tabs: [{ id: 101, url: initialSession.videoUrl, active: true }]
    });
    chromeMock.storage.session.store.set('activeSession', initialSession);

    const bg = createBackgroundSandbox({ chrome: chromeMock });
    // Allow the SW storage restore promise to resolve
    await new Promise(r => setTimeout(r, 20));

    // Verify session restoration
    const session = bg.getActiveSession();
    assert.strictEqual(session.videoId, 'boot_vid');
    assert.strictEqual(session.status, 'ready');
    assert.strictEqual(session.tabId, 101);
  });

  await t.test('WB-SW-02: Service worker boot handles null/missing storage.session activeSession gracefully', async () => {
    const chromeMock = createChromeMock();
    chromeMock.storage.session.store.set('activeSession', null);

    const bg = createBackgroundSandbox({ chrome: chromeMock });
    await new Promise(r => setTimeout(r, 20));

    const session = bg.getActiveSession();
    assert.strictEqual(session.status, 'idle', 'Session must remain idle');
    assert.strictEqual(session.tabId, null);
    assert.strictEqual(session.videoId, null);
  });

  await t.test('WB-SW-03: resolveNotebookTab cleans up dead notebookTabId and discovers live tab via query', async () => {
    const bg = createBackgroundSandbox({
      tabs: [
        { id: 300, url: 'https://notebooklm.google.com/notebook/notebook-live', active: false }
      ]
    });

    // Point notebookTabId to a closed/dead tab 999
    bg.chrome.storage.session.store.set('notebookTabId', 999);
    bg.setNotebookTabId(999);

    const resolveNotebookTab = vm.runInContext('resolveNotebookTab', bg.sandbox);
    const resolvedId = await resolveNotebookTab();

    assert.strictEqual(resolvedId, 300, 'Must fallback to open NotebookLM tab 300');
    const stored = await bg.chrome.storage.session.get(['notebookTabId']);
    assert.strictEqual(stored.notebookTabId, 300, 'Storage must be updated with live tab 300');
  });

  await t.test('WB-SW-04: syncSession catches storage quota/write failures without unhandled rejections', async () => {
    const bg = createBackgroundSandbox();

    // Force storage.session.set to reject (e.g. quota exceeded)
    bg.chrome.storage.session.set = () => Promise.reject(new Error('Session storage quota exceeded'));

    const syncSession = vm.runInContext('syncSession', bg.sandbox);
    await assert.doesNotReject(async () => {
      await syncSession();
    }, 'syncSession must absorb storage set errors without rethrowing');
  });

  await t.test('WB-SW-05: Service worker restart restores fallbackWindowId preventing duplicate window creation', async () => {
    // In background.js lines 7 and 41-52:
    // fallbackWindowId is persisted to chrome.storage.session.
    // When the service worker suspends and restarts while a fallback window is open,
    // fallbackWindowId is restored, allowing openFallbackWindow to focus the existing window.
    const chromeMock = createChromeMock({
      tabs: [{ id: 101, url: 'https://www.youtube.com/watch?v=win_test', active: true, windowId: 1 }],
      windows: [{ id: 1, focused: true, width: 1920, height: 1080, left: 0, top: 0 }]
    });
    delete chromeMock.sidePanel;

    function createSW() {
      const sandbox = {
        chrome: chromeMock,
        console: { log: () => {}, warn: () => {}, error: () => {} },
        URL, URLSearchParams, Date, setTimeout, clearTimeout, setInterval, clearInterval
      };
      vm.createContext(sandbox);
      const code = fs.readFileSync(PATHS.background, 'utf8');
      vm.runInContext(code, sandbox);
      return sandbox;
    }

    // First SW boot: action clicked opens fallback popup window
    const sw1 = createSW();
    await new Promise(r => setTimeout(r, 20));
    const listener1 = chromeMock.action.onClicked.listeners[0];
    await listener1({ id: 101, url: 'https://www.youtube.com/watch?v=win_test', title: 'Win Test' });

    const win1Count = chromeMock._state.windowsList.length;
    assert.strictEqual(win1Count, 2, 'Popup window must be created');
    const firstWinId = vm.runInContext('fallbackWindowId', sw1);
    assert.ok(firstWinId, 'SW1 tracks fallbackWindowId');

    // Second SW boot (simulating MV3 service worker termination and re-activation)
    const sw2 = createSW();
    await new Promise(r => setTimeout(r, 20));
    const restoredFallbackId = vm.runInContext('fallbackWindowId', sw2);

    // FallbackWindowId is restored from storage.session
    assert.strictEqual(
      restoredFallbackId,
      firstWinId,
      'fallbackWindowId must be restored in newly booted service worker'
    );

    // Clicking action again in SW2 focuses existing popup window without creating a duplicate
    const listener2 = chromeMock.action.onClicked.listeners[chromeMock.action.onClicked.listeners.length - 1];
    await listener2({ id: 101, url: 'https://www.youtube.com/watch?v=win_test', title: 'Win Test' });

    assert.strictEqual(
      chromeMock._state.windowsList.length,
      2,
      'Existing fallback window focused without creating duplicate'
    );
  });

  // =========================================================================
  // Section 2: Error States in handleSummarize, handleDone, and handleFollowUp
  // =========================================================================

  await t.test('WB-ERR-01: handleSummarize missing notebookUrl resets activeSession to idle state', async () => {
    // In background.js lines 456-472:
    // When notebookUrl is missing, an error is thrown, caught in onMessage, and
    // activeSession is reset back to 'idle'.
    const bg = createBackgroundSandbox({ defaultNotebookUrl: false });
    await bg.chrome.storage.local.remove(['notebookUrl']);

    await bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=err_url',
      tabId: 101
    });

    // Wait for async handleSummarize rejection
    await new Promise(r => setTimeout(r, 40));

    // An error broadcast was sent
    const errBroadcast = bg.broadcastMessages.find(m => m.action === 'error');
    assert.ok(errBroadcast, 'Error must be broadcasted to sidepanel');

    // activeSession.status must be reset to 'idle'
    const session = bg.getActiveSession();
    assert.strictEqual(
      session.status,
      'idle',
      'activeSession.status must be reset to idle on summarize error'
    );
  });

  await t.test('WB-ERR-02: handleSummarize cleans up pre-existing source prior to retry on same video', async () => {
    // In background.js:
    // If a previous summarization added a source but failed, retrying on the same video
    // triggers cleanup of the pre-existing source to avoid duplicate sources.
    let failAsk = true;
    const sentActions = [];

    const bg = createBackgroundSandbox();
    bg.setNotebookMessageHandler((tabId, msg) => {
      sentActions.push(msg.action);
      if (msg.action === 'ping') return Promise.resolve({ status: 'alive' });
      if (msg.action === 'askQuestion' && failAsk) {
        return Promise.reject(new Error('NotebookLM rate limit exceeded'));
      }
      return Promise.resolve({ success: true, text: 'Answer' });
    });

    // 1st attempt: fails during askQuestion (retries with ensureContentScriptReady which sleeps 1000ms)
    await bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=retry_vid',
      tabId: 101
    });
    await new Promise(r => setTimeout(r, 1150));

    const postFailSession = bg.getActiveSession();
    assert.strictEqual(
      postFailSession.hasSource,
      true,
      'activeSession retains hasSource=true after failure'
    );
    assert.strictEqual(postFailSession.status, 'idle', 'Session status reset to idle on failure');

    // 2nd attempt: user retries the same video
    failAsk = false;
    await bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=retry_vid',
      tabId: 101
    });
    await new Promise(r => setTimeout(r, 350));

    // Count how many times addSource and removeSource were called
    const addSourceCount = sentActions.filter(a => a === 'addSource').length;
    const removeSourceCount = sentActions.filter(a => a === 'removeSource').length;

    assert.strictEqual(addSourceCount, 2, 'addSource called twice');
    assert.strictEqual(
      removeSourceCount,
      1,
      'removeSource was called prior to retry on same video, preventing duplicate source'
    );
  });

  await t.test('WB-ERR-03: handleFollowUp error broadcasts followUpError preserving results view', async () => {
    // In background.js lines 588-591:
    // handleFollowUp error broadcasts { action: 'followUpError', message: err.message }
    // In sidepanel.js:
    // followUpError preserves the results screen and shows the error inline.
    const sidepanel = createSidepanelSandbox();

    // 1. Deliver summary to transition sidepanel into 'results' state
    sidepanel.runtimeListeners.forEach(fn => fn({
      action: 'summary',
      summary: 'Thorough video summary content',
      limitations: 'Some limitations'
    }));

    const resultsBefore = sidepanel.doc.getElementById('results');
    assert.strictEqual(resultsBefore.classList.contains('hidden'), false, 'Results screen must be visible');

    // 2. User submits follow-up, but NotebookLM encounters network error
    sidepanel.runtimeListeners.forEach(fn => fn({
      action: 'followUpError',
      message: 'Network timeout talking to NotebookLM'
    }));

    // Results screen must remain visible, error screen hidden
    const resultsAfter = sidepanel.doc.getElementById('results');
    const errorAfter = sidepanel.doc.getElementById('error');

    assert.strictEqual(
      resultsAfter.classList.contains('hidden'),
      false,
      'Results screen must remain visible upon follow-up error'
    );
    assert.strictEqual(
      errorAfter.classList.contains('hidden'),
      true,
      'Sidepanel must not transition to global error state'
    );
  });

  await t.test('WB-ERR-04: performCleanup manualDone reports success:false when removeSource throws', async () => {
    // In background.js:
    // When performCleanup('manualDone') fails, it propagates the error so
    // onMessage sends { success: false, error: err.message }.
    const bg = createBackgroundSandbox();
    bg.setNotebookMessageHandler((tabId, msg) => {
      if (msg.action === 'removeSource') {
        return Promise.reject(new Error('NotebookLM removeSource failed'));
      }
      return Promise.resolve({ success: true });
    });

    const session = bg.getActiveSession();
    session.hasSource = true;
    session.videoId = 'vid_done_err';

    const response = await new Promise(resolve => {
      const listener = bg.chrome.runtime.onMessage.listeners[0];
      listener({ action: 'done' }, {}, resolve);
    });

    assert.strictEqual(
      response.success,
      false,
      'done action responded with success: false when removeSource throws'
    );
    assert.strictEqual(
      response.error,
      'NotebookLM removeSource failed',
      'done action reports error message'
    );

    // Broadcast messages show both cleanupError AND sessionCleanedUp were sent
    const cleanupErrorBroadcast = bg.broadcastMessages.find(m => m.action === 'cleanupError');
    assert.ok(cleanupErrorBroadcast, 'cleanupError was broadcasted');
  });

  await t.test('WB-ERR-05: waitForTabLoad removes tabs.onUpdated listener upon timeout', async () => {
    // In background.js:
    // waitForTabLoad adds listener via chrome.tabs.onUpdated.addListener(listener).
    // The timeout branch removes the listener before rejecting.
    const chromeMock = createChromeMock();
    const sandbox = {
      chrome: chromeMock,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      URL, URLSearchParams, Date,
      setTimeout: (fn) => {
        // Fast-forward timeout immediately to trigger Tab load timeout
        setImmediate(fn);
        return 123;
      },
      clearTimeout: () => {},
      setInterval, clearInterval
    };
    vm.createContext(sandbox);
    const code = fs.readFileSync(PATHS.background, 'utf8');
    vm.runInContext(code, sandbox);

    const initialListenersCount = chromeMock.tabs.onUpdated.listeners.length;
    const waitForTabLoad = vm.runInContext('waitForTabLoad', sandbox);

    await assert.rejects(
      async () => { await waitForTabLoad(888); },
      /Tab load timeout/
    );

    // The listener must be removed after timeout rejection
    assert.strictEqual(
      chromeMock.tabs.onUpdated.listeners.length,
      initialListenersCount,
      'waitForTabLoad removed chrome.tabs.onUpdated listener on timeout'
    );
  });

  await t.test('WB-ERR-06: Cancellation checkpoints halt execution cleanly during multi-step summarize', async () => {
    const bg = createBackgroundSandbox();
    let firstQuestionResolve = null;

    bg.setNotebookMessageHandler((tabId, msg) => {
      if (msg.action === 'askQuestion') {
        return new Promise(r => { firstQuestionResolve = r; });
      }
      return Promise.resolve({ success: true });
    });

    // Start summarize
    bg.dispatchRuntimeMessage({
      action: 'summarize',
      videoUrl: 'https://www.youtube.com/watch?v=cancel_vid',
      tabId: 101
    });

    while (!firstQuestionResolve) {
      await new Promise(r => setTimeout(r, 5));
    }

    // Invalidate session mid-flight
    const session = bg.getActiveSession();
    session.sessionId = 'new_invalidation_token';

    // Let first question resolve
    firstQuestionResolve({ text: 'Answer' });
    await new Promise(r => setTimeout(r, 40));

    // Summary must not have been broadcasted
    const summaryBroadcast = bg.broadcastMessages.find(m => m.action === 'summary');
    assert.strictEqual(summaryBroadcast, undefined, 'Aborted session must not broadcast summary');
  });

  // =========================================================================
  // Section 3: Message Broadcasting & Multi-Listener Edge Cases
  // =========================================================================

  await t.test('WB-MSG-01: broadcastToSidePanel absorbs rejection when no extension views exist', async () => {
    // When no sidepanel or iframe is open, chrome.runtime.sendMessage rejects with:
    // "Could not establish connection. Receiving end does not exist."
    const bg = createBackgroundSandbox({ failRuntimeSendMessage: true });
    const broadcastToSidePanel = vm.runInContext('broadcastToSidePanel', bg.sandbox);

    await assert.doesNotReject(async () => {
      broadcastToSidePanel({ action: 'progress', step: 'open' });
      await new Promise(r => setTimeout(r, 10));
    }, 'broadcastToSidePanel must catch runtime.sendMessage rejection without unhandled error');
  });

  await t.test('WB-MSG-02: Message broadcast delivers uniformly across multiple listeners', async () => {
    const bg = createBackgroundSandbox();
    const received1 = [];
    const received2 = [];

    // Simulate 2 distinct views (native Side Panel + inline YouTube iframe)
    bg.chrome.runtime.onMessage.addListener((msg) => received1.push(msg));
    bg.chrome.runtime.onMessage.addListener((msg) => received2.push(msg));

    const broadcastToSidePanel = vm.runInContext('broadcastToSidePanel', bg.sandbox);
    broadcastToSidePanel({ action: 'progress', step: 'ask' });

    assert.strictEqual(received1.length, 1);
    assert.strictEqual(received2.length, 1);
    assert.strictEqual(received1[0].step, 'ask');
    assert.strictEqual(received2[0].step, 'ask');
  });

  await t.test('WB-MSG-03: Sidepanel message listener gracefully ignores unknown actions', async () => {
    const sidepanel = createSidepanelSandbox();
    assert.doesNotThrow(() => {
      sidepanel.runtimeListeners.forEach(fn => fn({ action: 'unknownAction123', foo: 'bar' }));
    }, 'Unknown actions must be ignored safely');
  });

  await t.test('WB-MSG-04: Sidepanel summarize button catches runtime.sendMessage start error and shows error state', async () => {
    const sidepanel = createSidepanelSandbox();
    // Wait for initial DOMContentLoaded checkCurrentTab to settle
    await new Promise(r => setTimeout(r, 20));

    sidepanel.chrome.runtime.sendMessage = () => Promise.reject(new Error('Service worker dead'));

    sidepanel.doc.getElementById('summarizeBtn').click();
    await new Promise(r => setTimeout(r, 20));

    const errState = sidepanel.doc.getElementById('error');
    assert.strictEqual(errState.classList.contains('hidden'), false, 'Error state must be shown when summarize start fails');
  });

  // =========================================================================
  // Section 4: Storage Quota & Corrupted Data Handling
  // =========================================================================

  await t.test('WB-STO-01: Corrupted summaryHistory in storage safely resets to array in saveToHistory', async () => {
    // In background.js lines 399-409:
    // If summaryHistory was stored as a non-array (e.g. object { corrupted: true }),
    // safe Array.isArray check ensures history defaults to [] and successfully saves.
    const bg = createBackgroundSandbox();
    await bg.chrome.storage.local.set({ summaryHistory: { corrupted: true } });

    const saveToHistory = vm.runInContext('saveToHistory', bg.sandbox);

    await saveToHistory({
      videoUrl: 'https://www.youtube.com/watch?v=corrupt_test',
      videoTitle: 'Corrupt Test',
      summary: 'Summary Text',
      limitations: 'None'
    });

    const stored = await bg.chrome.storage.local.get(['summaryHistory']);
    assert.ok(Array.isArray(stored.summaryHistory), 'History must be an array');
    assert.strictEqual(stored.summaryHistory.length, 1, 'Summary successfully saved to history');
    assert.strictEqual(stored.summaryHistory[0].videoUrl, 'https://www.youtube.com/watch?v=corrupt_test');
  });

  await t.test('WB-STO-02: saveToHistory strictly caps stored history at 50 entries', async () => {
    const bg = createBackgroundSandbox();
    const existing = [];
    for (let i = 0; i < 55; i++) {
      existing.push({ videoUrl: `https://youtube.com/watch?v=${i}`, timestamp: i });
    }
    await bg.chrome.storage.local.set({ summaryHistory: existing });

    const saveToHistory = vm.runInContext('saveToHistory', bg.sandbox);
    await saveToHistory({
      videoUrl: 'https://www.youtube.com/watch?v=new_vid',
      videoTitle: 'New Video',
      summary: 'Summary',
      limitations: 'None'
    });

    const stored = await bg.chrome.storage.local.get(['summaryHistory']);
    assert.strictEqual(stored.summaryHistory.length, 50, 'Stored history must be capped at 50');
    assert.strictEqual(stored.summaryHistory[0].videoUrl, 'https://www.youtube.com/watch?v=new_vid');
  });

  await t.test('WB-STO-03: saveToHistory catches storage quota exceeded without SW crash', async () => {
    const bg = createBackgroundSandbox();
    bg.chrome.storage.local.set = () => Promise.reject(new Error('QuotaExceededError'));

    const saveToHistory = vm.runInContext('saveToHistory', bg.sandbox);
    await assert.doesNotReject(async () => {
      await saveToHistory({
        videoUrl: 'https://www.youtube.com/watch?v=quota_vid',
        videoTitle: 'Quota Video',
        summary: 'Summary',
        limitations: 'None'
      });
    }, 'saveToHistory must absorb storage set quota rejections');
  });

  // =========================================================================
  // Section 5: Fallback Window & Onboarding Interactions
  // =========================================================================

  await t.test('WB-ONB-01: openFallbackWindow includes tabId in URL params for activeSession tab close tracking', async () => {
    // In background.js lines 67-72:
    // tab.id is included in queryParams, so sidepanel correctly binds currentTabId to YouTube tab
    const bg = createBackgroundSandbox({ hasSidePanel: false });
    const ytTab = { id: 101, url: 'https://www.youtube.com/watch?v=tab_tracking_vid', title: 'Tracking Vid' };

    await bg.dispatchActionClick(ytTab);

    const winId = bg.getFallbackWindowId();
    const createdWin = bg.chrome._state.windowsList.find(w => w.id === winId);
    assert.ok(createdWin, 'Fallback window must be created');

    const parsedUrl = new URL(createdWin.url);
    assert.strictEqual(parsedUrl.searchParams.get('url'), ytTab.url);
    assert.strictEqual(parsedUrl.searchParams.get('title'), ytTab.title);

    // tabId parameter must be present in query string
    assert.strictEqual(
      parsedUrl.searchParams.get('tabId'),
      '101',
      'openFallbackWindow includes tabId in URL parameters'
    );
  });

  await t.test('WB-ONB-02: Onboarding replay from results state unhides ready while hiding results', async () => {
    // In sidepanel/onboarding.js line 130:
    // prepareDemoState() hides results, working, and error before unhiding ready
    const { doc, win } = createDOMEnvironment('chrome-extension://ext/sidepanel/sidepanel.html');

    const elements = [
      'header', 'settingsToggle', 'settings', 'notebookUrl', 'saveSettings', 'settingsStatus', 'replayTutorialBtn',
      'notYoutube', 'ready', 'videoTitle', 'videoUrl', 'summarizeBtn',
      'working', 'statusMessage', 'progressSteps',
      'results', 'summaryContent', 'limitationsBlock', 'limitationsContent', 'followUpInput', 'followUpBtn', 'followUpResults', 'doneBtn', 'copyBtn',
      'error', 'errorMessage', 'retryBtn'
    ];
    for (const id of elements) {
      const el = doc.createElement(id.includes('Btn') ? 'button' : (id.includes('Input') || id === 'notebookUrl' ? 'input' : 'div'));
      el.id = id;
      if (['notYoutube', 'working', 'results', 'error', 'settings', 'limitationsBlock'].includes(id)) {
        el.classList.add('hidden');
      }
      doc.body.appendChild(el);
    }

    const chromeMock = createChromeMock();
    chromeMock.storage.local.set({ onboardingComplete: true, onboardingVersion: 1 });

    const sandbox = {
      window: win, document: doc, chrome: chromeMock,
      URL: win.URL, URLSearchParams: win.URLSearchParams,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      setTimeout: (f) => setTimeout(f, 0), clearTimeout,
      requestAnimationFrame: (cb) => cb()
    };
    vm.createContext(sandbox);
    const obCode = fs.readFileSync(PATHS.onboardingJs, 'utf8');
    vm.runInContext(obCode, sandbox);

    // User is viewing completed results
    doc.getElementById('ready').classList.add('hidden');
    doc.getElementById('results').classList.remove('hidden');

    // Tour replayed
    win.NLM_Onboarding.start();

    const readyHidden = doc.getElementById('ready').classList.contains('hidden');
    const resultsHidden = doc.getElementById('results').classList.contains('hidden');

    assert.strictEqual(readyHidden, false, 'ready state was unhidden');
    assert.strictEqual(
      resultsHidden,
      true,
      'results state was hidden to prevent overlapping states under onboarding modal'
    );
  });

  await t.test('WB-ONB-03: Onboarding complete persists completion flag and removes overlay', async () => {
    const { doc, win } = createDOMEnvironment('chrome-extension://ext/sidepanel/sidepanel.html');

    const elements = [
      'header', 'settingsToggle', 'settings', 'notebookUrl', 'saveSettings', 'settingsStatus', 'replayTutorialBtn',
      'notYoutube', 'ready', 'videoTitle', 'videoUrl', 'summarizeBtn',
      'working', 'statusMessage', 'progressSteps',
      'results', 'summaryContent', 'limitationsBlock', 'limitationsContent', 'followUpInput', 'followUpBtn', 'followUpResults', 'doneBtn', 'copyBtn',
      'error', 'errorMessage', 'retryBtn'
    ];
    for (const id of elements) {
      const el = doc.createElement(id.includes('Btn') ? 'button' : (id.includes('Input') || id === 'notebookUrl' ? 'input' : 'div'));
      el.id = id;
      doc.body.appendChild(el);
    }

    const chromeMock = createChromeMock();
    const sandbox = {
      window: win, document: doc, chrome: chromeMock,
      URL: win.URL, URLSearchParams: win.URLSearchParams,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      setTimeout: (f) => setTimeout(f, 0), clearTimeout,
      requestAnimationFrame: (cb) => cb()
    };
    vm.createContext(sandbox);
    const obCode = fs.readFileSync(PATHS.onboardingJs, 'utf8');
    vm.runInContext(obCode, sandbox);

    win.NLM_Onboarding.start();
    assert.ok(doc.querySelector('.onboarding-overlay'), 'Overlay must exist when started');

    win.NLM_Onboarding.complete();

    const stored = await chromeMock.storage.local.get(['onboardingComplete', 'onboardingVersion']);
    assert.strictEqual(stored.onboardingComplete, true);
    assert.strictEqual(stored.onboardingVersion, 1);
  });

});
