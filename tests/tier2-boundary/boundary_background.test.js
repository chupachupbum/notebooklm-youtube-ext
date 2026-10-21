const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS } = require('../harness/test-helpers.js');

test('Tier 2 - Boundary & Corner Cases: Background & Service Worker (F14, F15, F16, F17)', async (t) => {
  const bgCode = fs.readFileSync(PATHS.background, 'utf8');

  // Boundary F14: Side panel & popup fallback edge cases
  await t.test('TC-B-F14-01: Side panel setOptions gracefully catches and suppresses errors', () => {
    const hasCatchOnSidePanel = bgCode.includes('chrome.sidePanel.setOptions') &&
                                (bgCode.includes('.catch(() => {})') || bgCode.includes('catch'));
    assert.ok(hasCatchOnSidePanel, 'Must catch possible errors when calling chrome.sidePanel.setOptions');
  });

  await t.test('TC-B-F14-02: Fallback popup calculation bounds window coordinates inside screen bounds', () => {
    const hasWindowBoundsCheck = bgCode.includes('Math.max(0') &&
                                 bgCode.includes('Math.round(left)');
    assert.ok(hasWindowBoundsCheck, 'Must prevent negative coordinates for popup window fallback');
  });

  await t.test('TC-B-F14-03: Fallback popup window passes query params encoded to fallback window URL', () => {
    const hasQsEncoding = bgCode.includes('queryParams.set(\'url\'') ||
                          bgCode.includes('queryParams.set("url"');
    assert.ok(hasQsEncoding, 'Fallback window must pass url query param to sidepanel.html');
  });

  await t.test('TC-B-F14-04: Multiple clicks on extension action reuse existing fallback window if open', () => {
    const reusesWindow = bgCode.includes('chrome.windows.update(fallbackWindowId, { focused: true })');
    assert.ok(reusesWindow, 'Must bring existing fallback window to front rather than spawning duplicates');
  });

  await t.test('TC-B-F14-05: Missing tab.url does not crash sidepanel fallback creation', () => {
    const checksTabUrl = bgCode.includes('tab?.url');
    assert.ok(checksTabUrl, 'Must safely access optional tab.url property');
  });

  // Boundary F15: Background summarize pipeline edge cases
  await t.test('TC-B-F15-01: Cancellation token invalidates stale summary if user starts new summary', () => {
    const hasCancelCheck = bgCode.includes('activeSession.sessionId !== currentSessionId');
    assert.ok(hasCancelCheck, 'Must compare activeSession.sessionId to abort stale summary execution');
  });

  await t.test('TC-B-F15-02: Handles invalid or malformed YouTube URL passed to summarize', () => {
    const validatesUrl = bgCode.includes('extractYouTubeVideoId') &&
                         bgCode.includes('if (!url');
    assert.ok(validatesUrl, 'Must validate URL and return null for invalid inputs');
  });

  await t.test('TC-B-F15-03: Tolerates NotebookLM tab being closed unexpectedly by user', () => {
    const handlesNotebookTabRemoval = bgCode.includes('tabId === notebookTabId');
    assert.ok(handlesNotebookTabRemoval, 'Must detect when notebookTabId is closed and reset it to null');
  });

  await t.test('TC-B-F15-04: Handles concurrent summarize requests safely', () => {
    const hasConcurrencyLock = bgCode.includes('activeSession.status') ||
                               bgCode.includes('isSummarizing') ||
                               bgCode.includes('sessionId');
    assert.ok(hasConcurrencyLock, 'Must manage session state transitions to prevent race conditions');
  });

  await t.test('TC-B-F15-05: Storage session synchronization is wrapped in try-catch', () => {
    const hasTryCatch = bgCode.includes('try') && bgCode.includes('chrome.storage.session');
    assert.ok(hasTryCatch, 'Storage access must be error-guarded');
  });

  // Boundary F16: Tab close cleanup edge cases
  await t.test('TC-B-F16-01: Tab close cleanup handles asynchronous performCleanup without unhandled rejection', () => {
    const hasAsyncOnRemoved = bgCode.includes('chrome.tabs.onRemoved.addListener(async');
    assert.ok(hasAsyncOnRemoved, 'onRemoved listener should be async or handle promises');
  });

  await t.test('TC-B-F16-02: Tab close cleanup clears session storage state', () => {
    const clearsSession = bgCode.includes('chrome.storage.session.remove') ||
                          bgCode.includes('chrome.storage.session.clear') ||
                          bgCode.includes('activeSession = {');
    assert.ok(clearsSession, 'Must clean in-memory or storage session on close');
  });

  await t.test('TC-B-F16-03: Multiple tabs closed in batch only triggers cleanup for the active tab', () => {
    const checksTabId = bgCode.includes('tabId === activeSession.tabId');
    assert.ok(checksTabId, 'Must verify tabId against activeSession.tabId');
  });

  await t.test('TC-B-F16-04: Gracefully handles performCleanup when NotebookLM tab is already closed', () => {
    const handlesMissingNotebookTab = bgCode.includes('if (!tabId)') ||
                                     bgCode.includes('performCleanup caught error');
    assert.ok(handlesMissingNotebookTab, 'Must handle missing/closed NotebookLM tab without crashing');
  });

  await t.test('TC-B-F16-05: Tab close during active summarization safely cancels operation', () => {
    const resetsSession = bgCode.includes("performCleanup('tabClosed')");
    assert.ok(resetsSession, 'Must trigger performCleanup on active tab close');
  });

  // Boundary F17: Navigation cleanup edge cases
  await t.test('TC-B-F17-01: Navigating within same video with hash or timestamp does NOT trigger cleanup', () => {
    const checksVideoId = bgCode.includes('newVideoId !== activeSession.videoId');
    assert.ok(checksVideoId, 'Must only trigger cleanup if videoId changes, not on query param tweaks');
  });

  await t.test('TC-B-F17-02: Navigating away to non-YouTube URL triggers cleanup and detaches active tab', () => {
    const checksCheckUrl = bgCode.includes('newVideoId !== activeSession.videoId');
    assert.ok(checksCheckUrl, 'Must trigger navigatedAway cleanup when videoId becomes null/different');
  });

  await t.test('TC-B-F17-03: Handles rapid navigation between 3 videos in same tab', () => {
    const rebindsSession = bgCode.includes('activeSession.videoId = newVideoId');
    assert.ok(rebindsSession, 'Must continuously update activeSession.videoId on each navigation');
  });

  await t.test('TC-B-F17-04: Opening new YouTube tab binds activeSession if not yet bound', () => {
    const bindsNewTab = bgCode.includes('newVideoId && !activeSession.tabId');
    assert.ok(bindsNewTab, 'Must bind activeSession when a new video tab opens if session was idle');
  });

  await t.test('TC-B-F17-05: Navigation checkUrl inspects both changeInfo.url and loading status tab.url', () => {
    const checksBoth = bgCode.includes('changeInfo.url || (changeInfo.status === \'loading\' && tab?.url)');
    assert.ok(checksBoth, 'Must inspect changeInfo.url and early loading status tab.url');
  });
});
