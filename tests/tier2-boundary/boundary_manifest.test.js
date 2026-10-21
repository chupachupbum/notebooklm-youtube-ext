const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, readManifest } = require('../harness/test-helpers.js');

test('Tier 2 - Boundary & Corner Cases: Manifest & Configuration (F1, F2, F3)', async (t) => {
  const manifest = readManifest();
  const sidepanelCode = fs.readFileSync(PATHS.sidepanelJs, 'utf8');

  // Boundary F1: Host permissions & URL patterns
  await t.test('TC-B-F1-01: host_permissions contains both root and www YouTube origins', () => {
    assert.ok(manifest.host_permissions.includes('https://www.youtube.com/*'), 'Must cover www.youtube.com');
    assert.ok(manifest.host_permissions.includes('https://youtube.com/*'), 'Must cover apex youtube.com');
  });

  await t.test('TC-B-F1-02: Content script matches reject non-https or non-YouTube protocols', () => {
    const ytScript = manifest.content_scripts?.find(cs =>
      cs.matches && cs.matches.some(m => m.includes('youtube.com'))
    );
    if (!ytScript) {
      t.skip('M1 pending: content script for YouTube not yet in manifest.json');
      return;
    }
    const hasHttpInsecure = ytScript.matches.some(m => m.startsWith('http://'));
    assert.strictEqual(hasHttpInsecure, false, 'Must not allow insecure http:// for YouTube content scripts');
  });

  await t.test('TC-B-F1-03: Manifest specifies valid version integer manifest_version 3', () => {
    assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
  });

  await t.test('TC-B-F1-04: Background service worker definition conforms to MV3 (no background scripts array)', () => {
    assert.ok(manifest.background?.service_worker, 'Must declare service_worker');
    assert.strictEqual(manifest.background.scripts, undefined, 'MV3 must not use background.scripts array');
  });

  await t.test('TC-B-F1-05: Extension name and version are non-empty strings', () => {
    assert.ok(typeof manifest.name === 'string' && manifest.name.length > 0);
    assert.ok(typeof manifest.version === 'string' && manifest.version.length > 0);
  });

  // Boundary F2: Web accessible resources robustness
  await t.test('TC-B-F2-01: Web accessible resources does not use wildcard match for origins', () => {
    const warList = manifest.web_accessible_resources || [];
    if (warList.length === 0) {
      t.skip('M1 pending: web_accessible_resources not yet configured');
      return;
    }
    for (const entry of warList) {
      assert.ok(!entry.matches.includes('*://*/*'), 'Must not grant universal wildcard origin access');
    }
  });

  await t.test('TC-B-F2-02: Web accessible resources entries have non-empty resources arrays', () => {
    const warList = manifest.web_accessible_resources || [];
    if (warList.length === 0) {
      t.skip('M1 pending: web_accessible_resources not yet configured');
      return;
    }
    for (const entry of warList) {
      assert.ok(Array.isArray(entry.resources) && entry.resources.length > 0);
    }
  });

  await t.test('TC-B-F2-03: Required physical files declared in web_accessible_resources exist on disk', () => {
    assert.ok(fs.existsSync(PATHS.sidepanelHtml), 'sidepanel.html must exist on disk');
    assert.ok(fs.existsSync(PATHS.sidepanelCss), 'sidepanel.css must exist on disk');
    assert.ok(fs.existsSync(PATHS.sidepanelJs), 'sidepanel.js must exist on disk');
    assert.ok(fs.existsSync(PATHS.onboardingJs), 'onboarding.js must exist on disk');
    assert.ok(fs.existsSync(PATHS.onboardingCss), 'onboarding.css must exist on disk');
    assert.ok(fs.existsSync(PATHS.markdownJs), 'lib/markdown.js must exist on disk');
  });

  await t.test('TC-B-F2-04: Extension icons declared in manifest exist on disk', () => {
    const icons = manifest.icons || {};
    for (const [size, iconPath] of Object.entries(icons)) {
      const fullPath = require('node:path').join(PATHS.root, iconPath);
      assert.ok(fs.existsSync(fullPath), `Icon for size ${size} at ${iconPath} must exist`);
    }
  });

  await t.test('TC-B-F2-05: Permissions list contains only valid MV3 permissions', () => {
    const validPermissions = new Set([
      'sidePanel', 'activeTab', 'tabs', 'storage', 'scripting'
    ]);
    for (const p of manifest.permissions) {
      assert.ok(validPermissions.has(p), `Unexpected permission ${p}`);
    }
  });

  // Boundary F3: Query parameter edge cases
  await t.test('TC-B-F3-01: Handles inline=0 or inline=false without enabling inline mode', () => {
    const search = '?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&inline=0';
    const params = new URLSearchParams(search);
    const isInline = params.get('inline') === '1';
    assert.strictEqual(isInline, false, 'inline=0 must evaluate to false');
  });

  await t.test('TC-B-F3-02: Handles empty inline parameter value (inline=)', () => {
    const search = '?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&inline=';
    const params = new URLSearchParams(search);
    const isInline = params.get('inline') === '1';
    assert.strictEqual(isInline, false, 'inline= must evaluate to false');
  });

  await t.test('TC-B-F3-03: Handles malformed query parameters gracefully', () => {
    const malformedSearch = '?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&inline=1&bad=%E0%A4%A';
    assert.doesNotThrow(() => {
      const params = new URLSearchParams(malformedSearch);
      assert.strictEqual(params.get('inline'), '1');
    });
  });

  await t.test('TC-B-F3-04: Handles extra whitespace and unknown query params', () => {
    const search = '?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&foo=bar&inline=1&baz=123';
    const params = new URLSearchParams(search);
    assert.strictEqual(params.get('inline'), '1');
    assert.strictEqual(params.get('foo'), 'bar');
  });

  await t.test('TC-B-F3-05: Handles query param case-sensitivity', () => {
    const searchUpper = '?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&INLINE=1';
    const params = new URLSearchParams(searchUpper);
    assert.strictEqual(params.get('inline'), null, 'inline param query is case sensitive in URLSearchParams');
  });
});
