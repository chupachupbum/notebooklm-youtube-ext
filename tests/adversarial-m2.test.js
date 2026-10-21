const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PATHS, createTestSandbox, runScriptInSandbox } = require('./harness/test-helpers.js');

test('Tier 5 - Adversarial Stress Suite: Height Synchronization & Collapse Controls (M2)', async (t) => {
  if (!fs.existsSync(PATHS.injector)) {
    t.skip('content/youtube-injector.js does not exist');
    return;
  }

  // --- Dimension 1: Height Synchronization Under Extreme Conditions ---

  await t.test('ADV-H-01: Zero Player Height (Audio-only / hidden player)', () => {
    const sandbox = createTestSandbox({ playerHeight: 0 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    assert.ok(panel, 'Panel must exist');
    
    // Initial height check
    let h = parseInt(panel.style.height || '0', 10);
    assert.ok(h >= 300, `Initial fallback height must be >= 300px, got ${h}px`);

    // Trigger ResizeObserver with 0 multiple times
    const ro = sandbox.win.ResizeObserver.instances[0];
    if (ro) {
      ro.trigger(sandbox.domNodes.moviePlayer, 0);
      h = parseInt(panel.style.height || '0', 10);
      assert.ok(h >= 300, `Post-RO trigger height must stay >= 300px, got ${h}px`);

      ro.trigger(sandbox.domNodes.moviePlayer, 0);
      h = parseInt(panel.style.height || '0', 10);
      assert.ok(h >= 300, `Repeated 0 height trigger must remain >= 300px, got ${h}px`);
    }
  });

  await t.test('ADV-H-02: Extreme 4K (2160px) and 8K (4320px) Ultra-High Resolution', () => {
    const sandbox = createTestSandbox({ playerHeight: 2160 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    assert.ok(panel, 'Panel must exist');

    // Check synchronous 4K initial assignment
    let hStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(hStr.includes('2160'), `Synchronous initial height must be 2160px, got ${hStr}`);

    const ro = sandbox.win.ResizeObserver.instances[0];
    assert.ok(ro, 'ResizeObserver must exist');

    // Trigger dynamic 4K
    ro.trigger(sandbox.domNodes.moviePlayer, 2160);
    hStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(hStr.includes('2160'), `Dynamic height must be 2160px, got ${hStr}`);

    // Trigger dynamic 8K (4320px)
    ro.trigger(sandbox.domNodes.moviePlayer, 4320);
    hStr = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(hStr.includes('4320'), `Extreme 8K height must not be clamped, got ${hStr}`);
  });

  await t.test('ADV-H-03: Rapid Resize Jitter (50 rapid consecutive resize events)', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const ro = sandbox.win.ResizeObserver.instances[0];
    assert.ok(ro, 'ResizeObserver instance required');

    // Send 50 rapid jitter events
    const jitterHeights = [];
    for (let i = 0; i < 49; i++) {
      jitterHeights.push(300 + ((i * 37) % 700));
    }
    jitterHeights.push(850); // 50th final target height

    for (let i = 0; i < jitterHeights.length; i++) {
      ro.trigger(sandbox.domNodes.moviePlayer, jitterHeights[i]);
    }

    const finalH = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(
      finalH.includes('850'),
      `After 50 rapid jitter events, panel height must match final event 850px, got ${finalH}`
    );
  });

  await t.test('ADV-H-04: High-Frequency Jitter with Interleaved Zeroes', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Interleave 0s between normal heights
    const sequence = [720, 0, 1080, 0, 600, 0, 960];
    for (const h of sequence) {
      ro.trigger(sandbox.domNodes.moviePlayer, h);
      const curH = parseInt(panel.style.height || '0', 10);
      assert.ok(curH >= 300, `Interleaved height should never drop below 300px, was ${curH} at input ${h}`);
    }

    const finalH = panel.style.height || `${panel.offsetHeight}px`;
    assert.ok(finalH.includes('960'), `Final height must be 960px, got ${finalH}`);
  });

  await t.test('ADV-H-05: DOM Node Removal of #movie_player while ResizeObserver is active', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const ro = sandbox.win.ResizeObserver.instances[0];
    assert.ok(ro, 'ResizeObserver exists');

    // Remove player element from DOM
    sandbox.domNodes.moviePlayer.remove();
    assert.strictEqual(sandbox.domNodes.moviePlayer.parentNode, null, 'Player must be detached');

    // Trigger observer on detached element — must not throw
    assert.doesNotThrow(() => {
      ro.trigger(sandbox.domNodes.moviePlayer, 640);
    }, 'Triggering RO on detached element must not throw');

    // Re-trigger navigation without player
    assert.doesNotThrow(() => {
      sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
        detail: { url: 'https://www.youtube.com/watch?v=no_player_test' }
      }));
    }, 'Navigation without movie_player in DOM must not throw');

    const curH = parseInt(panel.style.height || '0', 10);
    assert.ok(curH >= 300, 'Panel height should remain at fallback or last valid height');
  });

  await t.test('ADV-H-06: Malformed ResizeObserver Entries (Edge Case Resilience)', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const ro = sandbox.win.ResizeObserver.instances[0];
    assert.ok(ro, 'ResizeObserver exists');

    // Invoke callback directly with edge-case entries
    assert.doesNotThrow(() => {
      ro.callback([null]);
    });
    assert.doesNotThrow(() => {
      ro.callback([{ target: null, contentRect: null, borderBoxSize: [] }]);
    });
    assert.doesNotThrow(() => {
      ro.callback([{ contentRect: { height: -100 } }]);
    });
    assert.doesNotThrow(() => {
      ro.callback([{ contentRect: { height: NaN } }]);
    });
  });

  // --- Dimension 2: Rapid Collapse/Expand Bursts & Decoupled State ---

  await t.test('ADV-C-01: Rapid Burst of 10 Clicks on Close Button', () => {
    const sandbox = createTestSandbox({ playerHeight: 520 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    const iframe = panel.querySelector('iframe');
    const header = panel.querySelector('#nlm-panel-header');

    assert.ok(closeBtn, 'Close button exists');

    // 10 rapid clicks on close button (toggles between collapsed and expanded)
    for (let i = 0; i < 10; i++) {
      closeBtn.click();
      const isCol = (i % 2 === 0);
      if (isCol) {
        assert.ok(panel.classList.contains('collapsed'), `Click ${i+1}: must have .collapsed`);
        assert.ok(panel.classList.contains('nlm-collapsed'), `Click ${i+1}: must have .nlm-collapsed`);
        assert.strictEqual(panel.style.height, '40px', `Click ${i+1}: height must be 40px`);
        assert.strictEqual(iframe.style.display, 'none', `Click ${i+1}: iframe must be display: none`);
        assert.strictEqual(header.getAttribute('aria-expanded'), 'false', `Click ${i+1}: aria-expanded false`);
      } else {
        assert.strictEqual(panel.classList.contains('collapsed'), false, `Click ${i+1}: must not have .collapsed`);
        assert.strictEqual(panel.classList.contains('nlm-collapsed'), false, `Click ${i+1}: must not have .nlm-collapsed`);
        assert.strictEqual(panel.style.height, '520px', `Click ${i+1}: height must be 520px`);
        assert.strictEqual(iframe.style.display, '', `Click ${i+1}: iframe must be visible`);
        assert.strictEqual(header.getAttribute('aria-expanded'), 'true', `Click ${i+1}: aria-expanded true`);
      }
    }
  });

  await t.test('ADV-C-02: Rapid Alternating Clicks (10 Cycles: Close -> Header -> Close -> Header)', () => {
    const sandbox = createTestSandbox({ playerHeight: 520 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    const header = panel.querySelector('#nlm-panel-header');
    const iframe = panel.querySelector('iframe');

    for (let cycle = 0; cycle < 10; cycle++) {
      // 1. Collapse
      closeBtn.click();
      assert.ok(panel.classList.contains('collapsed'), `Cycle ${cycle}: must be collapsed`);
      assert.strictEqual(panel.style.height, '40px', `Cycle ${cycle}: collapsed height 40px`);
      assert.strictEqual(iframe.style.display, 'none', `Cycle ${cycle}: iframe hidden`);

      // 2. Expand
      header.click();
      assert.ok(!panel.classList.contains('collapsed'), `Cycle ${cycle}: must be expanded`);
      assert.strictEqual(panel.style.height, '520px', `Cycle ${cycle}: restored height 520px`);
      assert.strictEqual(iframe.style.display, '', `Cycle ${cycle}: iframe visible`);
    }
  });

  await t.test('ADV-C-03: Resizing Arriving During Collapsed State (Decoupled State Integrity)', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    const header = panel.querySelector('#nlm-panel-header');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Collapse panel
    closeBtn.click();
    assert.strictEqual(panel.style.height, '40px');

    // Deliver 20 resize events while collapsed
    const resizeSequence = [
      500, 600, 720, 800, 1080, 1200, 1440, 1600, 1920, 2160,
      480, 520, 640, 700, 850, 900, 950, 1000, 1100, 1337
    ];

    for (let i = 0; i < resizeSequence.length; i++) {
      const h = resizeSequence[i];
      ro.trigger(sandbox.domNodes.moviePlayer, h);
      assert.strictEqual(
        panel.style.height,
        '40px',
        `Resize event ${i} (${h}px) must NOT alter DOM height while collapsed`
      );
      assert.ok(
        panel.classList.contains('collapsed'),
        `Panel must remain .collapsed during resize event ${i}`
      );
    }

    // Now re-expand
    header.click();
    assert.strictEqual(
      panel.style.height,
      '1337px',
      'Upon expansion, panel must adopt the latest resized height (1337px)'
    );
    assert.ok(!panel.classList.contains('collapsed'), 'Panel is expanded');
  });

  await t.test('ADV-C-04: Resize to 0px While Collapsed -> Expand Preserves Safe Fallback', () => {
    const sandbox = createTestSandbox({ playerHeight: 480 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    const header = panel.querySelector('#nlm-panel-header');
    const ro = sandbox.win.ResizeObserver.instances[0];

    // Collapse
    closeBtn.click();
    assert.strictEqual(panel.style.height, '40px');

    // Player goes to 0px (hidden)
    ro.trigger(sandbox.domNodes.moviePlayer, 0);
    assert.strictEqual(panel.style.height, '40px', 'Still collapsed at 40px');

    // Expand
    header.click();
    const restored = parseInt(panel.style.height || '0', 10);
    assert.ok(restored >= 300, `Restored height after 0px resize must be safe fallback >= 300px, got ${restored}px`);
  });

  await t.test('ADV-C-05: Repeated Header Clicks When Already Expanded Do Not Collapse', () => {
    const sandbox = createTestSandbox({ playerHeight: 500 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const header = panel.querySelector('#nlm-panel-header');

    // Panel is initially expanded
    assert.ok(!panel.classList.contains('collapsed'));
    assert.strictEqual(panel.style.height, '500px');

    // Click header 5 times while already expanded
    for (let i = 0; i < 5; i++) {
      header.click();
      assert.ok(!panel.classList.contains('collapsed'), `Header click ${i+1}: must remain expanded`);
      assert.strictEqual(panel.style.height, '500px', `Header click ${i+1}: height stays 500px`);
    }
  });

  await t.test('ADV-C-06: Keyboard Accessibility: Enter and Space Trigger Expansion', () => {
    const sandbox = createTestSandbox({ playerHeight: 540 });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    const header = panel.querySelector('#nlm-panel-header');

    const makeKeyEvent = (key) => {
      const evt = new sandbox.win.CustomEvent('keydown');
      evt.key = key;
      return evt;
    };

    // Test Enter key
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));
    header.dispatchEvent(makeKeyEvent('Enter'));
    assert.ok(!panel.classList.contains('collapsed'), 'Enter key must expand panel');
    assert.strictEqual(panel.style.height, '540px');

    // Test Space key
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));
    header.dispatchEvent(makeKeyEvent(' '));
    assert.ok(!panel.classList.contains('collapsed'), 'Space key must expand panel');
    assert.strictEqual(panel.style.height, '540px');

    // Other keys (e.g. Tab, Escape) should NOT expand
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));
    header.dispatchEvent(makeKeyEvent('Escape'));
    assert.ok(panel.classList.contains('collapsed'), 'Escape key must not expand panel');
  });

  // --- Dimension 3: SPA Navigation + Collapse Interaction ---

  await t.test('ADV-SC-01: Navigating to Different Video While Collapsed Auto-Expands', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one',
      playerHeight: 480
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');
    const iframe = panel.querySelector('iframe');

    // Collapse on Video 1
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // SPA navigate to Video 2
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: {
        url: 'https://www.youtube.com/watch?v=video_two',
        response: { title: 'Video Two Title' }
      }
    }));

    // Auto-restore must expand
    assert.ok(!panel.classList.contains('collapsed'), 'Must auto-expand on new video');
    assert.strictEqual(panel.style.height, '480px');
    assert.strictEqual(iframe.style.display, '');
    assert.ok(iframe.src.includes('video_two'));
  });

  await t.test('ADV-SC-02: Same-Video Timestamp Change While Collapsed Remains Collapsed', () => {
    const sandbox = createTestSandbox({
      url: 'https://www.youtube.com/watch?v=video_one',
      playerHeight: 480
    });
    runScriptInSandbox(PATHS.injector, sandbox.context);

    const panel = sandbox.doc.querySelector('#nlm-youtube-panel');
    const closeBtn = panel.querySelector('#nlm-panel-close');

    // Collapse on Video 1
    closeBtn.click();
    assert.ok(panel.classList.contains('collapsed'));

    // Same video with timestamp seek
    sandbox.win.dispatchEvent(new sandbox.win.CustomEvent('yt-navigate-finish', {
      detail: {
        url: 'https://www.youtube.com/watch?v=video_one#t=1m30s'
      }
    }));

    // Should NOT auto-expand on seek
    assert.ok(panel.classList.contains('collapsed'), 'Must remain collapsed on same-video seek');
    assert.strictEqual(panel.style.height, '40px');
  });
});
