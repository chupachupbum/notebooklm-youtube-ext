const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createChromeMock } = require('./chrome-mock.js');
const { createDOMEnvironment, setupYouTubeDOM, MockResizeObserver, MockMutationObserver } = require('./dom-mock.js');

const ROOT_DIR = path.resolve(__dirname, '../..');

const PATHS = {
  root: ROOT_DIR,
  manifest: path.join(ROOT_DIR, 'manifest.json'),
  background: path.join(ROOT_DIR, 'background.js'),
  injector: path.join(ROOT_DIR, 'content/youtube-injector.js'),
  injectorCss: path.join(ROOT_DIR, 'content/youtube-injector.css'),
  sidepanelHtml: path.join(ROOT_DIR, 'sidepanel/sidepanel.html'),
  sidepanelJs: path.join(ROOT_DIR, 'sidepanel/sidepanel.js'),
  sidepanelCss: path.join(ROOT_DIR, 'sidepanel/sidepanel.css'),
  onboardingJs: path.join(ROOT_DIR, 'sidepanel/onboarding.js'),
  onboardingCss: path.join(ROOT_DIR, 'sidepanel/onboarding.css'),
  markdownJs: path.join(ROOT_DIR, 'lib/markdown.js')
};

function readManifest() {
  const content = fs.readFileSync(PATHS.manifest, 'utf8');
  return JSON.parse(content);
}

function createTestSandbox(options = {}) {
  const { doc, win, windowListeners } = createDOMEnvironment(options.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const domNodes = setupYouTubeDOM(doc, options);
  const chrome = createChromeMock(options);

  const sandbox = {
    window: win,
    document: doc,
    chrome,
    URL: win.URL,
    URLSearchParams: win.URLSearchParams,
    ResizeObserver: win.ResizeObserver,
    MutationObserver: win.MutationObserver,
    CustomEvent: win.CustomEvent,
    Event: win.Event,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    setInterval: win.setInterval,
    clearInterval: win.clearInterval,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {}
    }
  };

  const context = vm.createContext(sandbox);
  return { context, doc, win, chrome, domNodes, windowListeners };
}

function runScriptInSandbox(scriptPath, sandboxContext) {
  if (!fs.existsSync(scriptPath)) {
    return false;
  }
  const code = fs.readFileSync(scriptPath, 'utf8');
  vm.runInContext(code, sandboxContext);
  return true;
}

module.exports = {
  PATHS,
  readManifest,
  createTestSandbox,
  runScriptInSandbox
};
