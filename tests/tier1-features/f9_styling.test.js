const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 9: Dark Theme & Visual Styling', async (t) => {
  if (!fs.existsSync(PATHS.injectorCss)) {
    t.skip('Milestone 2 pending: content/youtube-injector.css not yet created');
    return;
  }

  const css = fs.readFileSync(PATHS.injectorCss, 'utf8');

  await t.test('TC-F9-01: Stylesheet file content/youtube-injector.css exists and is readable', () => {
    assert.ok(css.length > 0, 'youtube-injector.css must not be empty');
  });

  await t.test('TC-F9-02: Applies dark theme background (#1a1a2e)', () => {
    const hasDarkBg = css.includes('#1a1a2e') || css.includes('--bg-color');
    assert.ok(hasDarkBg, 'CSS must include dark theme color #1a1a2e or CSS variable for background');
  });

  await t.test('TC-F9-03: Applies rounded corners (border-radius) to injected container', () => {
    const hasBorderRadius = css.includes('border-radius');
    assert.ok(hasBorderRadius, 'CSS must specify border-radius for smooth rounded container integration');
  });

  await t.test('TC-F9-04: Applies border styling to container', () => {
    const hasBorder = css.includes('border:') || css.includes('border-top:') || css.includes('border-color:');
    assert.ok(hasBorder, 'CSS must specify border styling for clear visual separation');
  });

  await t.test('TC-F9-05: Applies CSS transitions for smooth height or collapse animations', () => {
    const hasTransition = css.includes('transition');
    assert.ok(hasTransition, 'CSS must define transition property for smooth expand/collapse animations');
  });
});
