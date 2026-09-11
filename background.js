let notebookTabId = null;

console.log('[NLM-BG] Service worker initialized.');

// --- Side Panel / Window Activation ---
const hasSidePanel = typeof chrome.sidePanel !== 'undefined';
let fallbackWindowId = null;

console.log('[NLM-BG] chrome.sidePanel supported:', hasSidePanel);

// If sidePanel is supported, set default behavior to open on action click
if (hasSidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.log('[NLM-BG] setPanelBehavior not supported or failed:', err);
  });
}

// Action click handler (used in Opera / browsers where sidePanel isn't native or openPanelOnActionClick is not active)
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[NLM-BG] Action clicked on tab:', tab?.url);

  if (hasSidePanel && typeof chrome.sidePanel.open === 'function') {
    try {
      if (tab?.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
        return;
      } else if (tab?.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        return;
      }
    } catch (e) {
      console.warn('[NLM-BG] chrome.sidePanel.open failed, falling back to popup window:', e);
    }
  }

  // Fallback for Opera / browsers without chrome.sidePanel: open floating panel window
  await openFallbackWindow(tab);
});

// Fallback popup window manager
async function openFallbackWindow(tab) {
  if (fallbackWindowId !== null) {
    try {
      const existing = await chrome.windows.get(fallbackWindowId);
      if (existing) {
        await chrome.windows.update(fallbackWindowId, { focused: true });
        return;
      }
    } catch (e) {
      fallbackWindowId = null;
    }
  }

  const width = 430;
  const height = 750;
  let left = 1000;
  let top = 100;

  try {
    const currentWin = await chrome.windows.getCurrent();
    if (currentWin && typeof currentWin.width === 'number') {
      left = Math.max(0, (currentWin.left || 0) + currentWin.width - width);
      top = currentWin.top || 100;
    }
  } catch (e) {}

  const queryParams = new URLSearchParams();
  if (tab?.url) queryParams.set('url', tab.url);
  if (tab?.title) queryParams.set('title', tab.title);

  const qs = queryParams.toString();
  const panelUrl = chrome.runtime.getURL(`sidepanel/sidepanel.html${qs ? '?' + qs : ''}`);

  const win = await chrome.windows.create({
    url: panelUrl,
    type: 'popup',
    width: width,
    height: height,
    left: Math.round(left),
    top: Math.round(top)
  });
  fallbackWindowId = win.id;
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === fallbackWindowId) {
    fallbackWindowId = null;
  }
});

// Enable side panel options if supported by browser
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (hasSidePanel && chrome.sidePanel.setOptions && changeInfo.url) {
    if (tab.url?.includes('youtube.com')) {
      chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel/sidepanel.html',
        enabled: true
      }).catch(() => {});
    }
  }
});

// --- Tab Management ---
async function resolveNotebookTab() {
  if (notebookTabId) {
    try {
      const t = await chrome.tabs.get(notebookTabId);
      if (t) return notebookTabId;
    } catch (e) {
      notebookTabId = null;
    }
  }

  // Check chrome.storage.session
  try {
    const data = await chrome.storage.session.get(['notebookTabId']);
    if (data && data.notebookTabId) {
      try {
        const t = await chrome.tabs.get(data.notebookTabId);
        if (t) {
          notebookTabId = data.notebookTabId;
          return notebookTabId;
        }
      } catch (e) {}
    }
  } catch (e) {}

  // Fallback: search open tabs for NotebookLM
  const tabs = await chrome.tabs.query({ url: ['https://notebooklm.google.com/*', 'https://notebook.google.com/*'] });
  if (tabs.length > 0) {
    notebookTabId = tabs[0].id;
    try {
      await chrome.storage.session.set({ notebookTabId });
    } catch (e) {}
    return notebookTabId;
  }

  return null;
}

async function getOrCreateNotebookTab(notebookUrl) {
  console.log('[NLM-BG] Finding or creating NotebookLM tab for:', notebookUrl);
  const tabs = await chrome.tabs.query({ url: ['https://notebooklm.google.com/*', 'https://notebook.google.com/*'] });
  if (tabs.length > 0) {
    console.log('[NLM-BG] Found existing NotebookLM tab.');
    const tab = tabs[0];
    if (!tab.url.includes(notebookUrl)) {
      console.log('[NLM-BG] Updating tab URL to configured notebook URL.');
      await chrome.tabs.update(tab.id, { url: notebookUrl });
      await waitForTabLoad(tab.id);
    }
    notebookTabId = tab.id;
    try {
      await chrome.storage.session.set({ notebookTabId: tab.id });
    } catch (e) {}
    return tab;
  }
  
  console.log('[NLM-BG] Creating new NotebookLM background tab.');
  const tab = await chrome.tabs.create({
    url: notebookUrl,
    active: false  // Keep in background!
  });
  await waitForTabLoad(tab.id);
  notebookTabId = tab.id;
  try {
    await chrome.storage.session.set({ notebookTabId: tab.id });
  } catch (e) {}
  return tab;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 30000);
    
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        // Give NotebookLM extra time to initialize its Angular app
        console.log('[NLM-BG] Tab loaded. Waiting for extra initialization time.');
        setTimeout(resolve, 3000);
      }
    }
    
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// --- Content Script Communication ---
async function sendToNotebook(message) {
  const tabId = await resolveNotebookTab();
  if (!tabId) throw new Error('No NotebookLM tab found');
  console.log('[NLM-BG] Sending message to NotebookLM (tab ' + tabId + '):', message.action);
  
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    console.log('[NLM-BG] Message failed, ensuring content script is alive:', e.message);
    await ensureContentScriptReady(tabId);
    res = await chrome.tabs.sendMessage(tabId, message);
  }

  if (!res) {
    throw new Error(`No response received from NotebookLM for action: ${message.action}`);
  }
  if (res.error || res.success === false) {
    throw new Error(res.error || `NotebookLM action ${message.action} failed`);
  }
  return res;
}

/**
 * Ensure the content script is loaded and responsive in the target tab.
 * If not, programmatically inject it.
 */
async function ensureContentScriptReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (response && response.status === 'alive') {
      console.log('[NLM-BG] Content script is alive.');
      return;
    }
  } catch (e) {
    console.log('[NLM-BG] Content script not found, injecting...');
  }

  // Programmatically inject the content script
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/notebooklm-controller.js']
  });
  
  // Wait for it to initialize
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Verify it's now responsive
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (response && response.status === 'alive') {
      console.log('[NLM-BG] Content script injected and alive.');
      return;
    }
  } catch (e) {
    throw new Error('Failed to communicate with NotebookLM tab after injection');
  }
}

// --- Helper Functions ---
function sendProgress(step) {
  console.log('[NLM-BG] Progress step:', step);
  broadcastToSidePanel({ action: 'progress', step });
}

function broadcastToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel or companion window might not be open, that's fine
  });
}

async function saveToHistory({ videoUrl, videoTitle, summary, limitations }) {
  console.log('[NLM-BG] Saving summary to history.');
  try {
    const history = (await chrome.storage.local.get(['summaryHistory'])).summaryHistory || [];
    history.unshift({
      videoUrl,
      videoTitle,
      summary,
      limitations,
      timestamp: Date.now()
    });
    // Keep last 50 summaries
    if (history.length > 50) history.length = 50;
    await chrome.storage.local.set({ summaryHistory: history });
  } catch (error) {
    console.error('[NLM-BG] Error saving history:', error);
  }
}

// Keep service worker alive during active long-running operations
function withKeepAlive(asyncFn) {
  return async function(...args) {
    const timer = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {});
    }, 15000);
    try {
      return await asyncFn(...args);
    } finally {
      clearInterval(timer);
    }
  };
}

// --- Workflow Functions ---
const handleSummarize = withKeepAlive(async function({ videoUrl, videoTitle }) {
  console.log('[NLM-BG] Starting summarization for:', videoUrl);
  const settings = await chrome.storage.local.get(['notebookUrl']);
  const notebookUrl = settings.notebookUrl;
  if (!notebookUrl) {
    throw new Error('No notebook URL configured. Open settings and set your NotebookLM notebook URL.');
  }

  sendProgress('open');
  const tab = await getOrCreateNotebookTab(notebookUrl);
  notebookTabId = tab.id;
  
  // Ensure the content script is loaded and responsive
  await ensureContentScriptReady(notebookTabId);

  // Clear any existing chat history so generation starts with maximum speed and clean context
  await sendToNotebook({ action: 'clearChat' }).catch(() => {});

  sendProgress('add');
  await sendToNotebook({ action: 'addSource', url: videoUrl });

  sendProgress('ask');
  const summaryQuestion = `Provide a concise summary of this video in 4-5 bullet points. Focus on the main themes and notable flop examples. Keep it concise.`;
  const summary = await sendToNotebook({ action: 'askQuestion', question: summaryQuestion });

  // Brief pause to allow NotebookLM UI to complete chip rendering and idle
  await new Promise(r => setTimeout(r, 2000));

  sendProgress('limits');
  const limitsQuestion = `In 2 brief bullet points, what specific nuance or detail from the video is missed in a text summary?`;
  const limitations = await sendToNotebook({ action: 'askQuestion', question: limitsQuestion });

  sendProgress('done');
  broadcastToSidePanel({
    action: 'summary',
    summary: summary.text,
    limitations: limitations.text,
    videoUrl,
    videoTitle
  });

  await saveToHistory({ videoUrl, videoTitle, summary: summary.text, limitations: limitations.text });
});

const handleFollowUp = withKeepAlive(async function({ question }) {
  console.log('[NLM-BG] Handling follow-up question:', question);
  const answer = await sendToNotebook({ action: 'askQuestion', question });
  broadcastToSidePanel({ action: 'followUpAnswer', answer: answer.text, question });
});

const handleDone = withKeepAlive(async function() {
  console.log('[NLM-BG] Handling done/cleanup.');
  const tabId = await resolveNotebookTab();
  if (!tabId) {
    console.log('[NLM-BG] No open NotebookLM tab found to clean up.');
    broadcastToSidePanel({ action: 'cleanedUp', success: true });
    return { success: true };
  }

  try {
    const res = await sendToNotebook({ action: 'removeSource' });
    console.log('[NLM-BG] Source removed successfully:', res);
    try {
      await chrome.storage.session.remove(['notebookTabId']);
    } catch (e) {}
    notebookTabId = null;
    broadcastToSidePanel({ action: 'cleanedUp', success: true });
    return { success: true };
  } catch (e) {
    console.error('[NLM-BG] Error removing source:', e);
    broadcastToSidePanel({ action: 'cleanupError', error: e.message });
    throw e;
  }
});

// --- Central Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[NLM-BG] Received message:', message.action || message);

  if (message.action === 'summarize') {
    sendResponse({ received: true });
    handleSummarize(message).catch(err => {
      console.error('[NLM-BG] Summarize error:', err);
      broadcastToSidePanel({ action: 'error', message: err.message });
    });
    return false;
  }
  
  if (message.action === 'followUp') {
    sendResponse({ received: true });
    handleFollowUp(message).catch(err => {
      console.error('[NLM-BG] FollowUp error:', err);
      broadcastToSidePanel({ action: 'error', message: err.message });
    });
    return false;
  }
  
  if (message.action === 'done') {
    handleDone()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message port open for async response
  }

  return false;
});
