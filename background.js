let notebookTabId = null;

console.log('[NLM-BG] Service worker initialized.');

// --- Side Panel / Window Activation ---
const hasSidePanel = typeof chrome.sidePanel !== 'undefined';
let fallbackWindowId = null;

chrome.storage.session.get(['fallbackWindowId']).then((data) => {
  if (data && data.fallbackWindowId) {
    fallbackWindowId = data.fallbackWindowId;
  }
}).catch(() => {});

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
  if (fallbackWindowId === null) {
    try {
      const data = await chrome.storage.session.get(['fallbackWindowId']);
      if (data && data.fallbackWindowId) {
        fallbackWindowId = data.fallbackWindowId;
      }
    } catch (e) {}
  }

  if (fallbackWindowId !== null) {
    try {
      let existing = true;
      if (typeof chrome.windows?.get === 'function') {
        existing = await chrome.windows.get(fallbackWindowId);
      }
      if (existing) {
        await chrome.windows.update(fallbackWindowId, { focused: true });
        return;
      }
    } catch (e) {
      fallbackWindowId = null;
      await chrome.storage.session.remove(['fallbackWindowId']).catch(() => {});
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
  if (tab?.id) queryParams.set('tabId', tab.id.toString());

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
  await chrome.storage.session.set({ fallbackWindowId: win.id }).catch(() => {});
}

// Helper to extract YouTube video ID from various URL formats
function extractYouTubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    
    if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        return parsed.searchParams.get('v') || null;
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.split('/')[2] || null;
      }
      if (parsed.pathname.startsWith('/live/')) {
        return parsed.pathname.split('/')[2] || null;
      }
    } else if (hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split('?')[0] || null;
    }
  } catch (e) {}
  return null;
}

// Active session tracking across service worker restarts
let activeSession = {
  tabId: null,
  videoUrl: null,
  videoId: null,
  hasSource: false,
  sessionId: null,
  status: 'idle'
};

chrome.storage.session.get(['activeSession']).then((data) => {
  if (data && data.activeSession) {
    activeSession = Object.assign(activeSession, data.activeSession);
    console.log('[NLM-BG] Restored activeSession from storage:', activeSession);
  }
}).catch(() => {});

async function syncSession() {
  try {
    await chrome.storage.session.set({ activeSession });
  } catch (e) {}
}

let cleanupPromise = null;

async function performCleanup(reason = 'manual') {
  console.log(`[NLM-BG] performCleanup triggered. Reason: ${reason}`);
  if (cleanupPromise) return cleanupPromise;

  cleanupPromise = (async () => {
    let cleanupError = null;
    try {
      // Invalidate current session ID to abort in-flight summarization
      activeSession.sessionId = null;

      if (activeSession.hasSource) {
        console.log('[NLM-BG] Active source present in NotebookLM, running cleanup...');
        await handleDone();
      } else {
        console.log('[NLM-BG] No active source to remove.');
      }
    } catch (err) {
      console.warn('[NLM-BG] performCleanup caught error:', err);
      cleanupError = err;
    } finally {
      activeSession = {
        tabId: null,
        videoUrl: null,
        videoId: null,
        hasSource: false,
        sessionId: null,
        status: 'idle'
      };
      await syncSession();
      cleanupPromise = null;
      broadcastToSidePanel({ action: 'sessionCleanedUp', reason });
    }
    if (cleanupError) {
      throw cleanupError;
    }
  })();

  return cleanupPromise;
}

// Tab close listener
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === fallbackWindowId) {
    fallbackWindowId = null;
    chrome.storage.session.remove(['fallbackWindowId']).catch(() => {});
  }
  if (tabId === notebookTabId) {
    notebookTabId = null;
    try {
      await chrome.storage.session.remove(['notebookTabId']);
    } catch (e) {}
  }
  // Check if closed tab is our active YouTube video tab
  if (activeSession.tabId && tabId === activeSession.tabId) {
    console.log(`[NLM-BG] Active YouTube tab (${tabId}) was closed. Triggering cleanup.`);
    await performCleanup('tabClosed').catch(() => {});
  }
});

// Window close listener (tracks fallback popup window removal)
if (chrome.windows?.onRemoved) {
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === fallbackWindowId) {
      fallbackWindowId = null;
      chrome.storage.session.remove(['fallbackWindowId']).catch(() => {});
    }
  });
}

// Tab update / navigation listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (hasSidePanel && chrome.sidePanel.setOptions && changeInfo.url) {
    if (tab.url?.includes('youtube.com')) {
      chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel/sidepanel.html',
        enabled: true
      }).catch(() => {});
    }
  }

  // Track navigation and cleanup on YouTube tabs
  const checkUrl = changeInfo.url || (changeInfo.status === 'loading' && tab?.url);
  if (checkUrl) {
    const newVideoId = extractYouTubeVideoId(checkUrl);

    if (activeSession.tabId && tabId === activeSession.tabId) {
      // If the tracked video changed or navigated to a non-video page (e.g. youtube.com homepage)
      if (newVideoId !== activeSession.videoId) {
        console.log(`[NLM-BG] Active YouTube tab (${tabId}) navigated away from video ${activeSession.videoId} to ${checkUrl}. Triggering cleanup.`);
        await performCleanup('navigatedAway').catch(() => {});
        if (newVideoId) {
          activeSession.tabId = tabId;
          activeSession.videoId = newVideoId;
          activeSession.videoUrl = checkUrl;
          activeSession.status = 'ready';
          await syncSession();
        }
      }
    } else if (newVideoId && !activeSession.tabId) {
      // Bind newly opened/activated YouTube video tab so subsequent navigations/close will be tracked
      activeSession.tabId = tabId;
      activeSession.videoId = newVideoId;
      activeSession.videoUrl = checkUrl;
      activeSession.status = 'ready';
      await syncSession();
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
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        // Give NotebookLM extra time to initialize its Angular app
        console.log('[NLM-BG] Tab loaded. Waiting for extra initialization time.');
        setTimeout(resolve, 3000);
      }
    }

    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 30000);
    
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
    let history = (await chrome.storage.local.get(['summaryHistory'])).summaryHistory;
    if (!Array.isArray(history)) history = [];
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
const handleSummarize = withKeepAlive(async function({ videoUrl, videoTitle, tabId }) {
  console.log('[NLM-BG] Starting summarization for:', videoUrl, 'tabId:', tabId);
  const targetVideoId = extractYouTubeVideoId(videoUrl);

  // If there is an existing session with an active source, clean it up first
  if (activeSession.hasSource) {
    console.log('[NLM-BG] Cleaning up previous source before starting new summary...');
    await performCleanup('newSummaryStarted').catch(() => {});
  }

  // Determine tabId if not provided
  let targetTabId = tabId;
  if (!targetTabId) {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes(targetVideoId)) {
        targetTabId = tabs[0].id;
      } else {
        const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/watch*' });
        const matched = ytTabs.find(t => t.url && t.url.includes(targetVideoId));
        if (matched) targetTabId = matched.id;
      }
    } catch (e) {}
  }

  const currentSessionId = Date.now().toString();
  activeSession = {
    tabId: targetTabId,
    videoUrl,
    videoId: targetVideoId,
    hasSource: false,
    sessionId: currentSessionId,
    status: 'working'
  };
  await syncSession();

  try {
    const isCancelled = () => activeSession.sessionId !== currentSessionId;

    const settings = await chrome.storage.local.get(['notebookUrl']);
    const notebookUrl = settings.notebookUrl;
    if (!notebookUrl) {
      throw new Error('No notebook URL configured. Open settings and set your NotebookLM notebook URL.');
    }

    if (isCancelled()) return;

    sendProgress('open');
    const tab = await getOrCreateNotebookTab(notebookUrl);
    notebookTabId = tab.id;
    
    if (isCancelled()) return;

    // Ensure the content script is loaded and responsive
    await ensureContentScriptReady(notebookTabId);

    if (isCancelled()) return;

    // Clear any existing chat history so generation starts with maximum speed and clean context
    await sendToNotebook({ action: 'clearChat' }).catch(() => {});

    if (isCancelled()) return;

    sendProgress('add');
    activeSession.hasSource = true;
    await syncSession();
    await sendToNotebook({ action: 'addSource', url: videoUrl });

    if (isCancelled()) return;

    sendProgress('ask');
    const summaryQuestion = `Provide a comprehensive, detailed summary of this video. Thoroughly explain all key themes, core arguments, and important examples in depth without artificial brevity.
Organize your response using clear markdown headings (such as ## Executive Summary, ## Key Themes, ## Detailed Takeaways) and well-structured bullet points with bold lead-in titles for each point (e.g., * **Theme / Concept**: Detailed explanation). Be thorough, precise, and avoid conversational filler.`;
    const summary = await sendToNotebook({ action: 'askQuestion', question: summaryQuestion });

    if (isCancelled()) return;

    // Brief pause to allow NotebookLM UI to complete chip rendering and idle
    await new Promise(r => setTimeout(r, 2000));

    if (isCancelled()) return;

    sendProgress('limits');
    const limitsQuestion = `Provide a complete and thorough analysis of what specific nuances, visual demonstrations, tonal subtleties, or practical details from the video are missed or compromised in a text summary.
Format your response using clear markdown bullet points with bold lead-ins for each limitation (e.g., * **Visual Context**: Detailed explanation). Be thorough and complete.`;
    const limitations = await sendToNotebook({ action: 'askQuestion', question: limitsQuestion });

    if (isCancelled()) return;

    activeSession.status = 'results';
    await syncSession();

    sendProgress('done');
    broadcastToSidePanel({
      action: 'summary',
      summary: summary.text,
      limitations: limitations.text,
      videoUrl,
      videoTitle
    });

    await saveToHistory({ videoUrl, videoTitle, summary: summary.text, limitations: limitations.text });
  } catch (err) {
    activeSession.status = 'idle';
    await syncSession().catch(() => {});
    throw err;
  }
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
    activeSession.hasSource = false;
    activeSession.status = 'idle';
    await syncSession();
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
    activeSession.hasSource = false;
    activeSession.status = 'idle';
    await syncSession();
    broadcastToSidePanel({ action: 'cleanedUp', success: true });
    return { success: true };
  } catch (e) {
    console.error('[NLM-BG] Error removing source:', e);
    activeSession.hasSource = false;
    activeSession.status = 'idle';
    await syncSession();
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
      broadcastToSidePanel({ action: 'followUpError', message: err.message });
    });
    return false;
  }
  
  if (message.action === 'done') {
    performCleanup('manualDone')
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message port open for async response
  }

  return false;
});
