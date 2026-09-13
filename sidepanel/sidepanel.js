// Chrome API mock shim for standalone browser testing & debugging
if (typeof window.chrome === 'undefined' || !window.chrome.storage || !window.chrome.storage.local) {
  const mockStorage = {
    notebookUrl: 'https://notebook.google.com/notebook/fff86f43-6140-40db-99c4-5730e6ccb04f'
  };
  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: (keys, cb) => {
        const res = {};
        if (typeof keys === 'string') {
          res[keys] = mockStorage[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach(k => res[k] = mockStorage[k]);
        } else if (typeof keys === 'object') {
          Object.keys(keys).forEach(k => {
            res[k] = mockStorage[k] !== undefined ? mockStorage[k] : keys[k];
          });
        }
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (items, cb) => {
        Object.assign(mockStorage, items);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  };
  window.chrome.runtime = window.chrome.runtime || {
    sendMessage: () => Promise.resolve({ received: true }),
    onMessage: { addListener: () => {} }
  };
  window.chrome.tabs = window.chrome.tabs || {
    query: () => Promise.resolve([{ id: 1, url: 'https://www.youtube.com/watch?v=mockVideo', title: 'Demo YouTube Video' }]),
    onActivated: { addListener: () => {} },
    onUpdated: { addListener: () => {} }
  };
}

// State Management
const states = ['notYoutube', 'ready', 'working', 'results', 'error'];
let currentState = 'ready';

function showState(stateId) {
  currentState = stateId;
  states.forEach(state => {
    const el = document.getElementById(state);
    if (el) {
      if (state === stateId) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });
}

// Global Variables
let currentVideoUrl = '';
let currentVideoTitle = '';
let currentVideoId = null;
let currentTabId = null;
let fullSummaryText = '';
let currentRawSummary = '';
let currentRawLimitations = '';
let followUpHistory = [];
const DEFAULT_NOTEBOOK_URL = 'https://notebook.google.com/notebook/fff86f43-6140-40db-99c4-5730e6ccb04f';

// Helper to extract YouTube video ID
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

function resetSummaryUI() {
  fullSummaryText = '';
  currentRawSummary = '';
  currentRawLimitations = '';
  followUpHistory = [];
  const summaryEl = document.getElementById('summaryContent');
  if (summaryEl) summaryEl.innerHTML = '';
  const limitsEl = document.getElementById('limitationsContent');
  if (limitsEl) limitsEl.innerHTML = '';
  const followUpEl = document.getElementById('followUpResults');
  if (followUpEl) followUpEl.innerHTML = '';
  const limitsBlock = document.getElementById('limitationsBlock');
  if (limitsBlock) limitsBlock.classList.add('hidden');
  const followUpInput = document.getElementById('followUpInput');
  if (followUpInput) {
    followUpInput.value = '';
    followUpInput.disabled = false;
  }
  const followUpBtn = document.getElementById('followUpBtn');
  if (followUpBtn) followUpBtn.disabled = false;
}

// Setup settings logic
function loadSettings() {
  chrome.storage.local.get({ notebookUrl: DEFAULT_NOTEBOOK_URL }, (result) => {
    document.getElementById('notebookUrl').value = result.notebookUrl;
  });
}

function saveSettings() {
  const url = document.getElementById('notebookUrl').value.trim();
  chrome.storage.local.set({ notebookUrl: url || DEFAULT_NOTEBOOK_URL }, () => {
    const status = document.getElementById('settingsStatus');
    status.textContent = 'Settings saved!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}

// Tab handling logic
async function checkCurrentTab() {
  try {
    // 1. Check if video parameters were passed via URL (e.g. from popup window fallback)
    const urlParams = new URLSearchParams(window.location.search);
    const paramUrl = urlParams.get('url');
    const paramTitle = urlParams.get('title');
    const paramTabId = urlParams.get('tabId');
    if (paramTabId) currentTabId = parseInt(paramTabId, 10);

    if (paramUrl) {
      const vid = extractYouTubeVideoId(paramUrl);
      if (vid) {
        const isDiff = currentVideoId !== vid;
        if (isDiff && (currentState === 'results' || currentState === 'working')) {
          resetSummaryUI();
        }
        currentVideoId = vid;
        currentVideoUrl = paramUrl;
        currentVideoTitle = paramTitle || 'YouTube Video';
        document.getElementById('videoTitle').textContent = currentVideoTitle;
        document.getElementById('videoUrl').textContent = currentVideoUrl;
        if (isDiff || (currentState !== 'working' && currentState !== 'results')) {
          showState('ready');
        }
        return;
      }
    }

    // 2. Query the active tab in current window or last focused window
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // If running in a separate popup window or standalone tab where current tab is the extension page itself
    if (!tab || tab.url?.startsWith('chrome-extension://')) {
      const [lastFocusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (lastFocusedTab && !lastFocusedTab.url?.startsWith('chrome-extension://')) {
        tab = lastFocusedTab;
      } else {
        const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/watch*' });
        if (ytTabs.length > 0) tab = ytTabs.find(t => t.active) || ytTabs[0];
      }
    }

    const detectedVideoId = extractYouTubeVideoId(tab?.url);

    if (tab && detectedVideoId) {
      const isDiff = currentVideoId !== detectedVideoId;
      if (isDiff && (currentState === 'results' || currentState === 'working')) {
        resetSummaryUI();
      }

      currentTabId = tab.id;
      currentVideoId = detectedVideoId;
      currentVideoUrl = tab.url;
      currentVideoTitle = tab.title || 'YouTube Video';
      
      document.getElementById('videoTitle').textContent = currentVideoTitle;
      document.getElementById('videoUrl').textContent = currentVideoUrl;
      
      // Do not interrupt an active summarization or completed results unless the user navigated to a new video
      if (isDiff || (currentState !== 'working' && currentState !== 'results')) {
        showState('ready');
      }
    } else {
      // Not on a YouTube video (e.g. YouTube homepage, channel, or external site)
      if (currentState === 'results' || currentState === 'working') {
        resetSummaryUI();
      }
      currentVideoId = null;
      currentVideoUrl = '';
      currentVideoTitle = '';
      currentTabId = tab?.id || null;
      showState('notYoutube');
    }
  } catch (err) {
    console.error("Failed to query tabs:", err);
    if (currentState !== 'working' && currentState !== 'results') {
      showState('error');
      document.getElementById('errorMessage').textContent = "Failed to detect current tab.";
    }
  }
}

// Progress UI update
function updateProgress(currentStep) {
  const steps = ['open', 'add', 'ask', 'wait', 'limits', 'done'];
  let foundCurrent = false;
  
  steps.forEach(step => {
    const el = document.querySelector(`.step[data-step="${step}"]`);
    if (!el) return;
    
    // reset classes
    el.classList.remove('active', 'complete');
    
    if (step === currentStep) {
      el.classList.add('active');
      foundCurrent = true;
    } else if (!foundCurrent) {
      // Steps before the current one are complete
      el.classList.add('complete');
    }
  });
  
  if (currentStep === 'done') {
    const el = document.querySelector(`.step[data-step="done"]`);
    if (el) el.classList.add('complete');
  }
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    if (document.body.contains(toast)) {
      document.body.removeChild(toast);
    }
  }, 3000);
}

// Event Listeners setup
function attachEventListeners() {
  // Settings toggle
  document.getElementById('settingsToggle').addEventListener('click', () => {
    const settingsPanel = document.getElementById('settings');
    settingsPanel.classList.toggle('hidden');
  });

  document.getElementById('saveSettings').addEventListener('click', saveSettings);

  // Replay tutorial button
  const replayBtn = document.getElementById('replayTutorialBtn');
  if (replayBtn) {
    replayBtn.addEventListener('click', () => {
      const settingsPanel = document.getElementById('settings');
      if (settingsPanel) settingsPanel.classList.add('hidden');
      if (window.NLM_Onboarding && typeof window.NLM_Onboarding.start === 'function') {
        window.NLM_Onboarding.start();
      }
    });
  }

  // Summarize button
  document.getElementById('summarizeBtn').addEventListener('click', () => {
    showState('working');
    updateProgress('open');
    fullSummaryText = ''; // reset
    currentRawSummary = '';
    currentRawLimitations = '';
    followUpHistory = [];
    document.getElementById('summaryContent').innerHTML = '';
    document.getElementById('limitationsContent').innerHTML = '';
    document.getElementById('followUpResults').innerHTML = '';
    document.getElementById('limitationsBlock').classList.add('hidden');
    
    chrome.runtime.sendMessage({ 
      action: 'summarize', 
      videoUrl: currentVideoUrl, 
      videoTitle: currentVideoTitle,
      tabId: currentTabId
    }).catch(err => {
      showState('error');
      document.getElementById('errorMessage').textContent = "Failed to start summarization. Ensure background script is running.";
    });
  });

  // Follow-up button
  document.getElementById('followUpBtn').addEventListener('click', () => {
    const input = document.getElementById('followUpInput');
    const question = input.value.trim();
    if (!question) return;
    
    // Add pending UI
    const resultsContainer = document.getElementById('followUpResults');
    const pendingDiv = document.createElement('div');
    pendingDiv.className = 'q-and-a pending';
    pendingDiv.dataset.question = question;
    pendingDiv.innerHTML = `
      <div class="q">${escapeHtml(question)}</div>
      <div class="a">Thinking... <span class="spinner" style="display:inline-block; width:12px; height:12px; border-width:2px; margin:0 0 -2px 4px;"></span></div>
    `;
    resultsContainer.appendChild(pendingDiv);
    input.value = '';
    input.disabled = true;
    document.getElementById('followUpBtn').disabled = true;

    chrome.runtime.sendMessage({ action: 'followUp', question }).catch(err => {
      input.disabled = false;
      document.getElementById('followUpBtn').disabled = false;
      pendingDiv.querySelector('.a').textContent = 'Failed to send follow-up.';
    });
  });

  // Done button
  document.getElementById('doneBtn').addEventListener('click', async () => {
    const doneBtn = document.getElementById('doneBtn');
    const origText = doneBtn.textContent;
    doneBtn.disabled = true;
    doneBtn.textContent = 'Cleaning up...';

    try {
      const res = await chrome.runtime.sendMessage({ action: 'done' });
      if (res && res.success === false) {
        showToast('Cleanup failed: ' + (res.error || 'Unknown error'));
      } else {
        showToast('Cleaned up source!');
        showState('ready');
      }
    } catch (err) {
      console.error('Done action error:', err);
      showToast('Cleanup request failed');
    } finally {
      doneBtn.disabled = false;
      doneBtn.textContent = origText;
    }
  });

  // Copy button - Copies clean, beautifully formatted Markdown
  document.getElementById('copyBtn').addEventListener('click', () => {
    const strip = (t) => (window.NLM_Markdown ? window.NLM_Markdown.stripCitations(t) : t).trim();

    let textToCopy = '';
    if (currentVideoTitle) {
      textToCopy += `# ${currentVideoTitle}\n\n`;
    }
    if (currentVideoUrl) {
      textToCopy += `Source: ${currentVideoUrl}\n\n`;
    }

    if (currentRawSummary) {
      textToCopy += `## Summary\n\n${strip(currentRawSummary)}\n\n`;
    } else {
      const summaryEl = document.getElementById('summaryContent');
      if (summaryEl && summaryEl.innerText) {
        textToCopy += `## Summary\n\n${summaryEl.innerText}\n\n`;
      }
    }

    if (currentRawLimitations) {
      textToCopy += `## Limitations\n\n${strip(currentRawLimitations)}\n\n`;
    }

    if (followUpHistory.length > 0) {
      textToCopy += `## Follow-up Q&A\n\n`;
      followUpHistory.forEach(qa => {
        textToCopy += `### Q: ${qa.question}\n\n${strip(qa.answer)}\n\n`;
      });
    }

    if (!textToCopy) {
      showToast('Nothing to copy yet');
      return;
    }
    
    navigator.clipboard.writeText(textToCopy.trim()).then(() => {
      showToast('Copied Markdown to clipboard!');
    }).catch(err => {
      console.error("Failed to copy", err);
      showToast('Failed to copy');
    });
  });

  // Retry button
  document.getElementById('retryBtn').addEventListener('click', () => {
    checkCurrentTab();
  });
}

// Background messages listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'progress') {
    if (document.getElementById('working').classList.contains('hidden')) {
      showState('working');
    }
    updateProgress(message.step);
  } else if (message.action === 'summary') {
    showState('results');
    currentRawSummary = message.summary || '';
    currentRawLimitations = message.limitations || '';
    
    document.getElementById('summaryContent').innerHTML = formatText(message.summary);
    if (message.limitations) {
      document.getElementById('limitationsBlock').classList.remove('hidden');
      document.getElementById('limitationsContent').innerHTML = formatText(message.limitations);
    } else {
      document.getElementById('limitationsBlock').classList.add('hidden');
    }
  } else if (message.action === 'error') {
    showState('error');
    document.getElementById('errorMessage').textContent = message.message || 'An unknown error occurred.';
  } else if (message.action === 'followUpAnswer') {
    const resultsContainer = document.getElementById('followUpResults');
    const pendingDiv = resultsContainer.querySelector('.pending');
    const questionText = (pendingDiv && pendingDiv.dataset.question) || message.question || 'Follow-up';

    followUpHistory.push({
      question: questionText,
      answer: message.answer || ''
    });
    
    if (pendingDiv) {
      pendingDiv.classList.remove('pending');
      pendingDiv.querySelector('.a').innerHTML = formatText(message.answer);
    } else {
      // In case pending was not found, append a new one
      const div = document.createElement('div');
      div.className = 'q-and-a';
      div.innerHTML = `
        <div class="q">${escapeHtml(questionText)}</div>
        <div class="a">${formatText(message.answer)}</div>
      `;
      resultsContainer.appendChild(div);
    }
    
    const input = document.getElementById('followUpInput');
    input.disabled = false;
    document.getElementById('followUpBtn').disabled = false;
    input.focus();
  } else if (message.action === 'cleanedUp') {
    showToast('Cleaned up source!');
    resetSummaryUI();
    showState('ready');
  } else if (message.action === 'sessionCleanedUp') {
    resetSummaryUI();
    checkCurrentTab();
  } else if (message.action === 'cleanupError') {
    showToast('Cleanup error: ' + message.error);
  }
});

// Helper functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatText(text) {
  if (!text) return '';
  if (window.NLM_Markdown && typeof window.NLM_Markdown.renderMarkdown === 'function') {
    return window.NLM_Markdown.renderMarkdown(text);
  }
  // Fallback if markdown parser is unavailable
  let html = escapeHtml(text);
  html = html.split(/\n\s*\n/).map(p => `<p class="nlm-paragraph">${p}</p>`).join('');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return html;
}

// Track tab changes to update state
chrome.tabs.onActivated.addListener(checkCurrentTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    checkCurrentTab();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    currentTabId = null;
    currentVideoId = null;
    currentVideoUrl = '';
    currentVideoTitle = '';
    resetSummaryUI();
    showState('notYoutube');
  }
});

// Expose helpers globally for onboarding module
window.checkCurrentTab = checkCurrentTab;
window.showToast = showToast;

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  attachEventListeners();
  checkCurrentTab();
  if (window.NLM_Onboarding && typeof window.NLM_Onboarding.init === 'function') {
    window.NLM_Onboarding.init();
  }
});
