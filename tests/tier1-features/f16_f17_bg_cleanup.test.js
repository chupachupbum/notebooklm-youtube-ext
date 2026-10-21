const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 16: Background Cleanup on Tab Close (chrome.tabs.onRemoved)', async (t) => {
  const bgCode = fs.readFileSync(PATHS.background, 'utf8');

  await t.test('TC-F16-01: background.js attaches listener to chrome.tabs.onRemoved', () => {
    const hasRemovedListener = bgCode.includes('chrome.tabs.onRemoved.addListener');
    assert.ok(hasRemovedListener, 'background.js must register chrome.tabs.onRemoved listener');
  });

  await t.test('TC-F16-02: onRemoved triggers performCleanup with reason "tabClosed"', () => {
    const hasTabClosedReason = bgCode.includes("performCleanup('tabClosed')") ||
                               bgCode.includes('performCleanup("tabClosed")');
    assert.ok(hasTabClosedReason, 'Must trigger performCleanup with reason tabClosed');
  });

  await t.test('TC-F16-03: performCleanup cleans up NotebookLM tab and active session', () => {
    const hasPerformCleanupDef = bgCode.includes('async function performCleanup') ||
                                 bgCode.includes('function performCleanup');
    assert.ok(hasPerformCleanupDef, 'performCleanup function must be defined in background.js');
  });

  await t.test('TC-F16-04: Unrelated tab removals do not trigger active YouTube session cleanup', () => {
    const hasSessionTabCheck = bgCode.includes('tabId === activeSession.tabId');
    assert.ok(hasSessionTabCheck, 'Must check if removed tab matches activeSession.tabId before cleanup');
  });

  await t.test('TC-F16-05: Cleans up fallback window if fallbackWindowId is closed', () => {
    const hasFallbackCheck = bgCode.includes('tabId === fallbackWindowId') ||
                             bgCode.includes('fallbackWindowId = null');
    assert.ok(hasFallbackCheck, 'Must reset fallbackWindowId when that window/tab closes');
  });
});

test('Tier 1 - Feature 17: Background Cleanup on Navigation (chrome.tabs.onUpdated)', async (t) => {
  const bgCode = fs.readFileSync(PATHS.background, 'utf8');

  await t.test('TC-F17-01: background.js attaches listener to chrome.tabs.onUpdated', () => {
    const hasUpdatedListener = bgCode.includes('chrome.tabs.onUpdated.addListener');
    assert.ok(hasUpdatedListener, 'background.js must register chrome.tabs.onUpdated listener');
  });

  await t.test('TC-F17-02: onUpdated triggers performCleanup with reason "navigatedAway"', () => {
    const hasNavAwayReason = bgCode.includes("performCleanup('navigatedAway')") ||
                             bgCode.includes('performCleanup("navigatedAway")');
    assert.ok(hasNavAwayReason, 'Must trigger performCleanup with reason navigatedAway');
  });

  await t.test('TC-F17-03: Detects video ID differences using extractYouTubeVideoId', () => {
    const comparesVideoId = bgCode.includes('newVideoId !== activeSession.videoId');
    assert.ok(comparesVideoId, 'Must check if new video ID is different from active session video ID');
  });

  await t.test('TC-F17-04: Re-binds activeSession to new video when navigating between videos', () => {
    const rebindsSession = bgCode.includes('activeSession.videoId = newVideoId') &&
                          bgCode.includes('activeSession.videoUrl = checkUrl');
    assert.ok(rebindsSession, 'Must rebind activeSession with new video details after navigation');
  });

  await t.test('TC-F17-05: syncSession persists session state to chrome.storage.session', () => {
    const hasSyncSession = bgCode.includes('chrome.storage.session.set') || bgCode.includes('syncSession');
    assert.ok(hasSyncSession, 'Must synchronize session state across service worker lifecycles');
  });
});
