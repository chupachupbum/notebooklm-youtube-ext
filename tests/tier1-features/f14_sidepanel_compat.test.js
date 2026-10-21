const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, readManifest } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 14: Chrome Side Panel Compatibility & Fallback Mode', async (t) => {
  const manifest = readManifest();
  const bgCode = fs.readFileSync(PATHS.background, 'utf8');
  const sidepanelHtml = fs.readFileSync(PATHS.sidepanelHtml, 'utf8');

  await t.test('TC-F14-01: manifest.json defines side_panel default_path pointing to sidepanel.html', () => {
    assert.ok(manifest.side_panel, 'manifest.json must have side_panel property');
    assert.strictEqual(
      manifest.side_panel.default_path,
      'sidepanel/sidepanel.html',
      'default_path must be sidepanel/sidepanel.html'
    );
  });

  await t.test('TC-F14-02: background.js sets sidePanel options for YouTube tabs', () => {
    const hasSidePanelCall = bgCode.includes('chrome.sidePanel.setOptions') || bgCode.includes('sidePanel');
    assert.ok(hasSidePanelCall, 'background.js must invoke chrome.sidePanel API for YouTube tabs');
  });

  await t.test('TC-F14-03: background.js implements fallback popup window when sidePanel API is unsupported', () => {
    const hasFallbackWindow = bgCode.includes('fallbackWindowId') ||
                              bgCode.includes('chrome.windows.create') ||
                              bgCode.includes('type: \'popup\'');
    assert.ok(hasFallbackWindow, 'background.js must implement fallback popup window creation');
  });

  await t.test('TC-F14-04: sidepanel.html references required dependencies (CSS and JS)', () => {
    assert.ok(sidepanelHtml.includes('sidepanel.css'), 'sidepanel.html must include sidepanel.css');
    assert.ok(sidepanelHtml.includes('sidepanel.js'), 'sidepanel.html must include sidepanel.js');
    assert.ok(sidepanelHtml.includes('onboarding.js'), 'sidepanel.html must include onboarding.js');
    assert.ok(sidepanelHtml.includes('lib/markdown.js') || sidepanelHtml.includes('markdown.js'), 'sidepanel.html must include markdown.js');
  });

  await t.test('TC-F14-05: Extension permissions include sidePanel and activeTab', () => {
    assert.ok(manifest.permissions.includes('sidePanel'), 'permissions must include sidePanel');
    assert.ok(manifest.permissions.includes('activeTab'), 'permissions must include activeTab');
    assert.ok(manifest.permissions.includes('tabs'), 'permissions must include tabs');
  });
});
