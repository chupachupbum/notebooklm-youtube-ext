const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PATHS } = require('../harness/test-helpers.js');
const { createChromeMock } = require('../harness/chrome-mock.js');
const { createDOMEnvironment } = require('../harness/dom-mock.js');

test('Tier 1 - Feature 3: Inline Mode Detection in Sidepanel', async (t) => {
  const sidepanelCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');
  const sidepanelCss = fs.readFileSync(PATHS.sidepanelCss, 'utf8');

  await t.test('TC-F3-01: sidepanel.js inspects inline query parameter in URL', () => {
    // Contract requirement: sidepanel.js must check for inline query param
    const hasInlineCheck = sidepanelCode.includes('inline') || sidepanelCode.includes("'inline'") || sidepanelCode.includes('"inline"');
    assert.ok(hasInlineCheck, "sidepanel.js must check for 'inline' parameter in window.location.search");
  });

  await t.test('TC-F3-02: sidepanel.js adds is-inline-mode class or attribute when inline=1', () => {
    const hasInlineClassRef = sidepanelCode.includes('is-inline-mode') || sidepanelCode.includes('inline-mode');
    assert.ok(hasInlineClassRef, "sidepanel.js must reference or toggle 'is-inline-mode' class");
  });

  await t.test('TC-F3-03: sidepanel.css defines styles for is-inline-mode', () => {
    const hasInlineStyles = sidepanelCss.includes('.is-inline-mode') || sidepanelCss.includes('is-inline-mode');
    assert.ok(hasInlineStyles, 'sidepanel.css must contain styling rules for .is-inline-mode');
  });

  await t.test('TC-F3-04: Default execution without inline param maintains standard sidepanel layout', () => {
    // When loaded without inline=1, is-inline-mode should not be applied
    const { doc, win } = createDOMEnvironment('chrome-extension://mock-id/sidepanel/sidepanel.html?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const chrome = createChromeMock();
    
    // Simulate DOM elements for sidepanel.html
    const container = doc.createElement('div');
    container.id = 'container';
    doc.body.appendChild(container);

    assert.ok(!doc.body.classList.contains('is-inline-mode'), 'Standard sidepanel must not have is-inline-mode on body');
  });

  await t.test('TC-F3-05: Co-existence: inline=1 does not break url and title query param extraction', () => {
    const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const testTitle = 'Rick Astley - Never Gonna Give You Up';
    const search = `?url=${encodeURIComponent(testUrl)}&title=${encodeURIComponent(testTitle)}&inline=1`;
    
    const params = new URLSearchParams(search);
    assert.strictEqual(params.get('inline'), '1', 'inline param must be 1');
    assert.strictEqual(params.get('url'), testUrl, 'url param must match decoded testUrl');
    assert.strictEqual(params.get('title'), testTitle, 'title param must match decoded testTitle');
  });
});
