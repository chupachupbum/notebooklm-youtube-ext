const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, readManifest } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 1: YouTube Content Script Registration (Manifest V3)', async (t) => {
  const manifest = readManifest();

  await t.test('TC-F1-01: manifest.json has valid content_scripts array', () => {
    assert.ok(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');
  });

  await t.test('TC-F1-02: content_scripts contains entry targeting YouTube URLs', () => {
    const ytScript = manifest.content_scripts.find(cs =>
      cs.matches && cs.matches.some(m => m.includes('youtube.com'))
    );
    assert.ok(ytScript, 'Must have a content script entry matching YouTube domains');
    assert.ok(ytScript.matches.includes('https://www.youtube.com/*'), 'Must match https://www.youtube.com/*');
    assert.ok(ytScript.matches.includes('https://youtube.com/*'), 'Must match https://youtube.com/*');
  });

  await t.test('TC-F1-03: YouTube content script registers content/youtube-injector.js', () => {
    const ytScript = manifest.content_scripts.find(cs =>
      cs.matches && cs.matches.some(m => m.includes('youtube.com'))
    );
    assert.ok(ytScript, 'YouTube content script entry must exist');
    assert.ok(Array.isArray(ytScript.js), 'js must be an array');
    assert.ok(
      ytScript.js.includes('content/youtube-injector.js'),
      'Must register content/youtube-injector.js'
    );
  });

  await t.test('TC-F1-04: YouTube content script registers content/youtube-injector.css', () => {
    const ytScript = manifest.content_scripts.find(cs =>
      cs.matches && cs.matches.some(m => m.includes('youtube.com'))
    );
    assert.ok(ytScript, 'YouTube content script entry must exist');
    assert.ok(Array.isArray(ytScript.css), 'css must be an array');
    assert.ok(
      ytScript.css.includes('content/youtube-injector.css'),
      'Must register content/youtube-injector.css'
    );
  });

  await t.test('TC-F1-05: YouTube content script sets document_idle and all_frames false', () => {
    const ytScript = manifest.content_scripts.find(cs =>
      cs.matches && cs.matches.some(m => m.includes('youtube.com'))
    );
    assert.ok(ytScript, 'YouTube content script entry must exist');
    assert.strictEqual(ytScript.run_at, 'document_idle', 'run_at must be document_idle');
    assert.strictEqual(ytScript.all_frames, false, 'all_frames must be false to avoid iframe recursion');
  });
});

test('Tier 1 - Feature 2: Web Accessible Resources Declaration (Manifest V3)', async (t) => {
  const manifest = readManifest();

  await t.test('TC-F2-01: web_accessible_resources array is present in manifest.json', () => {
    assert.ok(
      Array.isArray(manifest.web_accessible_resources),
      'web_accessible_resources must be an array in Manifest V3'
    );
  });

  await t.test('TC-F2-02: Exposes sidepanel/sidepanel.html to YouTube matches', () => {
    const resEntry = manifest.web_accessible_resources?.find(war =>
      war.matches && war.matches.some(m => m.includes('youtube.com'))
    );
    assert.ok(resEntry, 'web_accessible_resources entry for YouTube must exist');
    assert.ok(
      resEntry.resources.includes('sidepanel/sidepanel.html'),
      'sidepanel/sidepanel.html must be declared in web_accessible_resources'
    );
  });

  await t.test('TC-F2-03: Exposes sidepanel.css and onboarding.css stylesheets to YouTube', () => {
    const resEntry = manifest.web_accessible_resources?.find(war =>
      war.matches && war.matches.some(m => m.includes('youtube.com'))
    );
    assert.ok(resEntry, 'web_accessible_resources entry for YouTube must exist');
    assert.ok(
      resEntry.resources.includes('sidepanel/sidepanel.css'),
      'sidepanel/sidepanel.css must be accessible'
    );
    assert.ok(
      resEntry.resources.includes('sidepanel/onboarding.css'),
      'sidepanel/onboarding.css must be accessible'
    );
  });

  await t.test('TC-F2-04: Exposes sidepanel.js and onboarding.js scripts to YouTube', () => {
    const resEntry = manifest.web_accessible_resources?.find(war =>
      war.matches && war.matches.some(m => m.includes('youtube.com'))
    );
    assert.ok(resEntry, 'web_accessible_resources entry for YouTube must exist');
    assert.ok(
      resEntry.resources.includes('sidepanel/sidepanel.js'),
      'sidepanel/sidepanel.js must be accessible'
    );
    assert.ok(
      resEntry.resources.includes('sidepanel/onboarding.js'),
      'sidepanel/onboarding.js must be accessible'
    );
  });

  await t.test('TC-F2-05: Exposes lib/markdown.js and icons/* to YouTube', () => {
    const resEntry = manifest.web_accessible_resources?.find(war =>
      war.matches && war.matches.some(m => m.includes('youtube.com'))
    );
    assert.ok(resEntry, 'web_accessible_resources entry for YouTube must exist');
    assert.ok(
      resEntry.resources.includes('lib/markdown.js'),
      'lib/markdown.js must be accessible'
    );
    assert.ok(
      resEntry.resources.includes('icons/*'),
      'icons/* must be accessible'
    );
  });
});
