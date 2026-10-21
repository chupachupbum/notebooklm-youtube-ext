#!/usr/bin/env node
/**
 * Master Test Runner for NotebookLM YouTube Summarizer E2E Suite
 * Supports 4 Tiers:
 * - Tier 1: Feature Coverage (F1 - F17)
 * - Tier 2: Boundary & Corner Cases (F1 - F17)
 * - Tier 3: Cross-Feature Combinations (Pairwise Interactions)
 * - Tier 4: Real-World Application Scenarios (End-to-End User Workflows)
 *
 * Usage:
 *   node tests/run-all.js
 *   node tests/run-all.js --tier=1
 *   node tests/run-all.js --milestone=1
 *   node tests/run-all.js --verbose
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const TESTS_ROOT = __dirname;
const args = process.argv.slice(2);

// Parse flags
const tierArg = args.find(a => a.startsWith('--tier='))?.split('=')[1]?.toLowerCase();
const milestoneArg = args.find(a => a.startsWith('--milestone='))?.split('=')[1]?.toLowerCase();
const isVerbose = args.includes('--verbose') || args.includes('-v');

const TIER_DIRS = {
  '1': path.join(TESTS_ROOT, 'tier1-features'),
  '2': path.join(TESTS_ROOT, 'tier2-boundary'),
  '3': path.join(TESTS_ROOT, 'tier3-combinations'),
  '4': path.join(TESTS_ROOT, 'tier4-scenarios')
};

const MILESTONE_FILES = {
  '1': [
    path.join(TESTS_ROOT, 'tier1-features/f1_f2_manifest.test.js'),
    path.join(TESTS_ROOT, 'tier1-features/f3_inline_mode.test.js'),
    path.join(TESTS_ROOT, 'tier1-features/f14_sidepanel_compat.test.js'),
    path.join(TESTS_ROOT, 'tier2-boundary/boundary_manifest.test.js')
  ],
  '2': [
    path.join(TESTS_ROOT, 'tier1-features/f4_f5_injection.test.js'),
    path.join(TESTS_ROOT, 'tier1-features/f6_height_sync.test.js'),
    path.join(TESTS_ROOT, 'tier1-features/f7_f8_collapse.test.js'),
    path.join(TESTS_ROOT, 'tier1-features/f9_styling.test.js'),
    path.join(TESTS_ROOT, 'tier2-boundary/boundary_injection.test.js'),
    path.join(TESTS_ROOT, 'tier2-boundary/boundary_controls.test.js')
  ],
  '3': [
    path.join(TESTS_ROOT, 'tier1-features/f10_f11_spa_nav.test.js'),
    path.join(TESTS_ROOT, 'tier1-features/f12_f13_lifecycle.test.js'),
    path.join(TESTS_ROOT, 'tier1-features/f15_background_msg.test.js'),
    path.join(TESTS_ROOT, 'tier1-features/f16_f17_bg_cleanup.test.js'),
    path.join(TESTS_ROOT, 'tier2-boundary/boundary_spa.test.js'),
    path.join(TESTS_ROOT, 'tier2-boundary/boundary_background.test.js')
  ],
  '4': [
    path.join(TESTS_ROOT, 'tier3-combinations/cross_feature.test.js'),
    path.join(TESTS_ROOT, 'tier4-scenarios/e2e_scenarios.test.js')
  ]
};

function collectTestFiles() {
  if (milestoneArg && MILESTONE_FILES[milestoneArg]) {
    return MILESTONE_FILES[milestoneArg];
  }

  if (tierArg && TIER_DIRS[tierArg]) {
    const dir = TIER_DIRS[tierArg];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.test.js'))
      .map(f => path.join(dir, f));
  }

  // All tiers
  const files = [];
  for (const dir of Object.values(TIER_DIRS)) {
    if (fs.existsSync(dir)) {
      const dirFiles = fs.readdirSync(dir)
        .filter(f => f.endsWith('.test.js'))
        .map(f => path.join(dir, f));
      files.push(...dirFiles);
    }
  }
  return files;
}

const targetFiles = collectTestFiles();

console.log('====================================================');
console.log(' NotebookLM YouTube Summarizer - E2E Test Suite');
console.log(` Filter: Tier=${tierArg || 'ALL'} | Milestone=${milestoneArg || 'ALL'}`);
console.log(` Target files (${targetFiles.length}):`);
targetFiles.forEach(f => console.log(`   • ${path.relative(TESTS_ROOT, f)}`));
console.log('====================================================\n');

if (targetFiles.length === 0) {
  console.error('No test files matched filter.');
  process.exit(1);
}

const nodeArgs = ['--test', ...targetFiles];
const child = spawn(process.execPath, nodeArgs, {
  stdio: 'inherit',
  cwd: path.resolve(TESTS_ROOT, '..'),
  env: process.env
});

child.on('exit', (code) => {
  console.log('\n====================================================');
  if (code === 0) {
    console.log(' [PASS] All executed test targets passed successfully.');
  } else {
    console.log(` [ALERT] Test run exited with code ${code}.`);
  }
  console.log('====================================================');
  process.exit(code || 0);
});
