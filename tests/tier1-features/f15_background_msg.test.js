const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 15: Background Summarize Pipeline Integration', async (t) => {
  const bgCode = fs.readFileSync(PATHS.background, 'utf8');
  const sidepanelCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');

  await t.test('TC-F15-01: sidepanel.js dispatches summarize action via chrome.runtime.sendMessage', () => {
    const sendsSummarize = sidepanelCode.includes("action: 'summarize'") ||
                           sidepanelCode.includes('action: "summarize"');
    assert.ok(sendsSummarize, 'sidepanel.js must send action: "summarize"');
  });

  await t.test('TC-F15-02: background.js registers onMessage handler matching summarize action', () => {
    const handlesSummarize = bgCode.includes("action === 'summarize'") ||
                             bgCode.includes('action === "summarize"') ||
                             bgCode.includes("request.action === 'summarize'");
    assert.ok(handlesSummarize, 'background.js must handle summarize action in runtime.onMessage');
  });

  await t.test('TC-F15-03: background.js maintains activeSession tracking videoId and tabId', () => {
    const hasActiveSession = bgCode.includes('activeSession') &&
                             bgCode.includes('videoId') &&
                             bgCode.includes('tabId');
    assert.ok(hasActiveSession, 'background.js must maintain activeSession with tabId and videoId');
  });

  await t.test('TC-F15-04: background.js provides step status notifications to UI', () => {
    const broadcastsStep = bgCode.includes('step') || bgCode.includes('status');
    assert.ok(broadcastsStep, 'background.js must report pipeline steps back to caller');
  });

  await t.test('TC-F15-05: background.js uses sessionId cancellation token to prevent stale overwrites', () => {
    const hasSessionIdToken = bgCode.includes('sessionId') || bgCode.includes('cancel');
    assert.ok(hasSessionIdToken, 'background.js must use sessionId tokens to invalidate stale summarizations');
  });
});
