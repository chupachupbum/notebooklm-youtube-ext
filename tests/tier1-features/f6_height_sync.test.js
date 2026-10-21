const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('../harness/test-helpers.js');

test('Tier 1 - Feature 6: Video Player Height Synchronization via ResizeObserver', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('Milestone 2 pending: content/youtube-injector.js not yet created');
    return;
  }

  await t.test('TC-F6-01: Registers ResizeObserver on video player element', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    assert.ok(
      sandbox.win.ResizeObserver.instances.length > 0,
      'Must instantiate at least one ResizeObserver'
    );
    const ro = sandbox.win.ResizeObserver.instances[0];
    const observesPlayer = Array.from(ro.observed).some(el =>
      el.id === 'movie_player' || el.id === 'player' || el.classList?.contains('html5-video-player')
    );
    assert.ok(observesPlayer, 'ResizeObserver must observe player element');
  });

  await t.test('TC-F6-02: Synchronizes container height to match video player initial height', () => {
    const sandbox = createTestSandbox({ playerHeight: 520 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    assert.ok(panel, 'Injected panel container must exist');
    // Check style.height or offsetHeight
    const heightStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(heightStr.includes('520'), `Expected container height to match 520px, got ${heightStr}`);
  });

  await t.test('TC-F6-03: Dynamically updates panel height when player resizes', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Simulate video resizing from 480px to 720px
    ro.trigger(sandbox.domNodes.moviePlayer, 720);

    const updatedHeight = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(updatedHeight.includes('720'), `Panel height must update to 720px, got ${updatedHeight}`);
  });

  await t.test('TC-F6-04: Responds accurately to theater mode player height changes', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Theater mode usually expands player height (e.g. 600px)
    ro.trigger(sandbox.domNodes.moviePlayer, 600);

    const theaterHeight = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(theaterHeight.includes('600'), `Panel height must adjust to theater height 600px, got ${theaterHeight}`);
  });

  await t.test('TC-F6-05: Applies fallback min-height when player height is 0 or unmeasured', () => {
    const sandbox = createTestSandbox({ playerHeight: 0 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('[id*="nlm-youtube-panel"]');
    const ro = sandbox.win.ResizeObserver.instances[0];
    if (ro) ro.trigger(sandbox.domNodes.moviePlayer, 0);

    const heightVal = parseInt(panel.style.height || panel.style.minHeight || '0', 10);
    assert.ok(heightVal > 0, 'Must apply a positive fallback height when player height is 0');
  });
});
