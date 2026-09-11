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
let fullSummaryText = '';
const DEFAULT_NOTEBOOK_URL = 'https://notebook.google.com/notebook/fff86f43-6140-40db-99c4-5730e6ccb04f';

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
    if (paramUrl && paramUrl.includes('youtube.com/watch')) {
      const isDiff = currentVideoUrl !== paramUrl;
      currentVideoUrl = paramUrl;
      currentVideoTitle = paramTitle || 'YouTube Video';
      document.getElementById('videoTitle').textContent = currentVideoTitle;
      document.getElementById('videoUrl').textContent = currentVideoUrl;
      if (isDiff || (currentState !== 'working' && currentState !== 'results')) {
        showState('ready');
      }
      return;
    }

    // 2. Query the active tab in current window or last focused window
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // If running in a separate popup window or current tab is not youtube, inspect last focused window
    if (!tab || !tab.url || !tab.url.includes('youtube.com/watch')) {
      const [lastFocusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (lastFocusedTab && lastFocusedTab.url && lastFocusedTab.url.includes('youtube.com/watch')) {
        tab = lastFocusedTab;
      } else {
        // Search across any window for an active YouTube video
        const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/watch*' });
        if (ytTabs.length > 0) {
          tab = ytTabs.find(t => t.active) || ytTabs[0];
        }
      }
    }

    if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
      const isDiff = currentVideoUrl !== tab.url;
      currentVideoUrl = tab.url;
      currentVideoTitle = tab.title || 'YouTube Video';
      
      document.getElementById('videoTitle').textContent = currentVideoTitle;
      document.getElementById('videoUrl').textContent = currentVideoUrl;
      
      // Do not interrupt an active summarization or completed results unless the user navigated to a new video
      if (isDiff || (currentState !== 'working' && currentState !== 'results')) {
        showState('ready');
      }
    } else {
      if (currentState !== 'working' && currentState !== 'results') {
        showState('notYoutube');
      }
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

  // Summarize button
  document.getElementById('summarizeBtn').addEventListener('click', () => {
    showState('working');
    updateProgress('open');
    fullSummaryText = ''; // reset
    document.getElementById('summaryContent').innerHTML = '';
    document.getElementById('limitationsContent').innerHTML = '';
    document.getElementById('followUpResults').innerHTML = '';
    document.getElementById('limitationsBlock').classList.add('hidden');
    
    chrome.runtime.sendMessage({ 
      action: 'summarize', 
      videoUrl: currentVideoUrl, 
      videoTitle: currentVideoTitle 
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

  // Copy button
  document.getElementById('copyBtn').addEventListener('click', () => {
    let textToCopy = "Summary:\n" + document.getElementById('summaryContent').innerText;
    const limits = document.getElementById('limitationsContent').innerText;
    if (limits) {
      textToCopy += "\n\nLimitations:\n" + limits;
    }
    const followUps = document.querySelectorAll('.q-and-a:not(.pending)');
    if (followUps.length > 0) {
      textToCopy += "\n\nFollow-ups:\n";
      followUps.forEach(qa => {
        textToCopy += "Q: " + qa.querySelector('.q').innerText + "\n";
        textToCopy += "A: " + qa.querySelector('.a').innerText + "\n\n";
      });
    }
    
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('Copied to clipboard!');
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
    
    if (pendingDiv) {
      pendingDiv.classList.remove('pending');
      pendingDiv.querySelector('.a').innerHTML = formatText(message.answer);
    } else {
      // In case pending was not found, append a new one
      const div = document.createElement('div');
      div.className = 'q-and-a';
      div.innerHTML = `
        <div class="q">Follow-up</div>
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
    showState('ready');
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
  // Simple markdown-like formatting for basic readability
  let html = escapeHtml(text);
  // Convert double newlines to paragraphs
  html = html.split(/\n\s*\n/).map(p => `<p>${p}</p>`).join('');
  // Convert single newlines to br
  html = html.replace(/\n/g, '<br>');
  // Convert **bold**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return html;
}

// Track tab changes to update state
chrome.tabs.onActivated.addListener(checkCurrentTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    checkCurrentTab();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  attachEventListeners();
  checkCurrentTab();
});
