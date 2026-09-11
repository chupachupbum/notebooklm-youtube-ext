// ============================================================
// NotebookLM Controller - Content Script
// Injected into NotebookLM pages to perform DOM automation
// ============================================================

(function() {
  'use strict';

  // Only run in top-level window, ignore iframes
  if (window !== window.top) {
    return;
  }

  const LOG_PREFIX = '[NLM-CTRL]';
  const log = (...args) => console.log(LOG_PREFIX, ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, ...args);
  const err = (...args) => console.error(LOG_PREFIX, ...args);

  // --- DOM Helper Functions ---

  /**
   * Try multiple selectors, return the first element found.
   * @param {string[]} selectors - Array of CSS selectors to try
   * @param {Element} root - Root element to search from (default: document)
   * @returns {Element|null}
   */
  function findElement(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) {
          log(`Found element with selector: ${sel}`);
          return el;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    return null;
  }

  /**
   * Find element by text content. Useful for Angular Material buttons
   * where the text is inside nested spans.
   * @param {string} tag - HTML tag to search (e.g., 'button', 'span')
   * @param {string} text - Text to search for (case-insensitive, trimmed)
   * @param {Element} root - Root element
   * @returns {Element|null}
   */
  function findByText(tag, text, root = document) {
    const elements = root.querySelectorAll(tag);
    const searchText = text.toLowerCase().trim();
    for (const el of elements) {
      if (el.textContent.toLowerCase().trim().includes(searchText)) {
        log(`Found ${tag} by text: "${text}"`);
        return el;
      }
    }
    return null;
  }

  /**
   * Find a clickable element (button, link, or element with role=button) by its text.
   * Also searches nested spans (like mat-label-large) and returns the closest button.
   * @param {string} text - Text to search for (case-insensitive)
   * @param {Element} root - Root element
   * @returns {Element|null}
   */
  function findClickableByText(text, root = document) {
    const searchText = text.toLowerCase().trim();
    // 1. Search buttons and role=button directly
    const buttons = root.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]');
    for (const btn of buttons) {
      if (btn.textContent.toLowerCase().includes(searchText)) {
        return btn;
      }
    }
    // 2. Search inner text containers and traverse to closest clickable parent
    const elements = root.querySelectorAll('span, div, p, label, mat-icon');
    for (const el of elements) {
      if (el.textContent.toLowerCase().trim().includes(searchText)) {
        const clickable = el.closest('button, [role="button"], a, .mat-mdc-button, .mat-button, .mat-mdc-chip');
        if (clickable) return clickable;
      }
    }
    return null;
  }

  /**
   * Wait for an element to appear in the DOM.
   * Uses MutationObserver for efficiency.
   * @param {Function} finder - Function that returns the element or null
   * @param {number} timeoutMs - Maximum time to wait
   * @returns {Promise<Element>}
   */
  function waitForElement(finder, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      // Check immediately
      const existing = finder();
      if (existing) return resolve(existing);

      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('Timeout waiting for element'));
      }, timeoutMs);

      const observer = new MutationObserver(() => {
        const el = finder();
        if (el) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });
    });
  }

  /**
   * Simulate realistic typing into an input/textarea.
   * Dispatches input, change, and keyboard events.
   */
  async function simulateTyping(element, text) {
    element.focus();
    // Clear existing content
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Set value and dispatch events (Angular needs specific events)
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    // For Angular's ngModel detection
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, text);
    }
    
    // Angular FormControl explicitly requires InputEvent with insertText
    try {
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch (e) {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    
    await sleep(250); // Small delay for Angular to process
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Click an element with realistic behavior.
   * Uses instant scroll to prevent throttling delays in background/inactive tabs.
   */
  function simulateClick(element) {
    if (!element) return;
    try {
      element.scrollIntoView({ behavior: 'instant', block: 'center' });
    } catch (e) {}
    try {
      element.focus();
    } catch (e) {}
    element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    element.click();
  }

  // --- Core Operations ---

  /**
   * Add a YouTube URL as a source to the notebook.
   * Handles:
   * 1. Direct input if "Website and YouTube URLs" dialog is already open
   * 2. Clicking "Websites" if main source-picker dialog is open
   * 3. Clicking "+ Add sources" then "Websites" from notebook overview
   */
  async function addSource(url) {
    log('Starting addSource for URL:', url);

    // Check if the URL textarea is ALREADY visible
    let urlInput = findElement([
      'textarea[aria-label="Enter URLs"]',
      'textarea[placeholder*="Paste any links" i]',
      'textarea[formcontrolname="urls"]',
      'add-sources-dialog textarea'
    ]);

    if (!urlInput) {
      // Check if "Websites" button is visible in the source-type dialog
      let websitesBtn = findClickableByText('Websites') || findClickableByText('Website');
      if (!websitesBtn) {
        log('Websites button not visible, looking for "Add sources" button...');
        const addBtn = findElement(['button[aria-label="Add source"]', 'button[aria-label="Add sources"]'])
          || findClickableByText('Add sources')
          || findClickableByText('Add source');
        
        if (!addBtn) {
          throw new Error('Could not find "Add sources" button on NotebookLM page');
        }
        log('Found Add sources button, clicking it:', addBtn);
        simulateClick(addBtn);
        await sleep(1200);

        websitesBtn = await waitForElement(
          () => findClickableByText('Websites') || findClickableByText('Website'),
          8000
        );
      }

      if (!websitesBtn) {
        throw new Error('Could not find "Websites" button in Add Sources dialog');
      }
      log('Clicking Websites button:', websitesBtn);
      simulateClick(websitesBtn);
      await sleep(1200);

      // Now wait for the URL textarea
      urlInput = await waitForElement(
        () => findElement([
          'textarea[aria-label="Enter URLs"]',
          'textarea[placeholder*="Paste any links" i]',
          'textarea[formcontrolname="urls"]',
          'add-sources-dialog textarea',
          'input[type="url"]',
          'input[placeholder*="URL" i]'
        ]),
        8000
      );
    }

    if (!urlInput) {
      throw new Error('Could not find URL input field in Websites dialog');
    }

    log('Found URL input textarea, typing URL...');
    await simulateTyping(urlInput, url);
    await sleep(600);

    // Wait for Insert button to become enabled
    log('Waiting for Insert button to be enabled...');
    let submitBtn = null;
    for (let i = 0; i < 10; i++) {
      submitBtn = Array.from(document.querySelectorAll('add-sources-dialog button, mat-dialog-container button'))
        .find(b => b.textContent.trim() === 'Insert');
      if (submitBtn && !submitBtn.disabled) {
        break;
      }
      // Re-trigger input event if still disabled
      urlInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: url }));
      await sleep(400);
    }

    if (!submitBtn) {
      submitBtn = findClickableByText('Insert') || document.querySelector('button[type="submit"]');
    }

    if (!submitBtn) {
      throw new Error('Could not find Insert button in dialog');
    }

    log('Clicking Insert button:', submitBtn);
    simulateClick(submitBtn);

    // Wait for dialog to close and source to be ingested
    log('Waiting for source ingestion...');
    await sleep(3500);

    for (let i = 0; i < 30; i++) {
      const dialog = document.querySelector('add-sources-dialog, mat-dialog-container');
      if (!dialog || !dialog.offsetParent) {
        log('Dialog closed, ingestion in progress.');
        break;
      }
      await sleep(1500);
    }

    // Additional buffer for NotebookLM to parse video transcript
    await sleep(3000);
    log('addSource completed successfully.');
    return true;
  }

  /**
   * Ask a question in the NotebookLM chat.
   * Flow: Record message count → Type question → Submit via chat send button → Wait for new streamed response
   */
  async function askQuestion(question) {
    log('Asking question:', question.substring(0, 60) + '...');

    // Find the chat input (explicitly avoiding the "Search the web" left-panel input)
    const queryInput = await waitForElement(
      () => findElement([
        'textarea.query-box-input',
        'textarea[placeholder*="Ask a question" i]',
        'textarea[aria-label="Ask a question or create something"]',
        'textarea[aria-label="Query box" i]',
        'input.query-box-input'
      ]),
      10000
    );

    if (!queryInput) {
      throw new Error('Could not find chat query input box');
    }

    const initialCount = document.querySelectorAll('.to-user-container .message-text-content').length;
    log('Initial assistant message count:', initialCount);

    await simulateTyping(queryInput, question);
    log('Typed question into query box');
    await sleep(300);

    // Locate the chat submit button inside queryInput's form
    const form = queryInput.closest('form');
    let sendBtn = form ? form.querySelector('button.submit-button') : document.querySelector('button.submit-button');

    // Wait up to 2 seconds for Angular to enable the submit button after typing
    for (let i = 0; i < 10; i++) {
      if (sendBtn && !sendBtn.disabled) break;
      queryInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      sendBtn = form ? form.querySelector('button.submit-button') : document.querySelector('button.submit-button');
    }

    if (sendBtn && !sendBtn.disabled) {
      simulateClick(sendBtn);
      log('Clicked chat submit button');
    } else if (form) {
      log('Submitting via form.requestSubmit()');
      form.requestSubmit();
    } else {
      queryInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      log('Dispatched Enter key to send question');
    }

    const answer = await waitForAnswer(initialCount);
    log('Extracted answer, length:', answer.length);
    return answer;
  }

  /**
   * Helper to extract clean answer text by cloning and stripping internal thinking chains.
   */
  function extractMessageText(messageEl) {
    if (!messageEl) return '';
    const clone = messageEl.cloneNode(true);
    clone.querySelectorAll('thinking-chain-view, .thinking-chain, [class*="thinking"], mat-expansion-panel').forEach(el => el.remove());
    return clone.innerText.trim();
  }

  /**
   * Wait for NotebookLM to finish generating a response to the newly submitted question.
   * Ensures it only checks assistant messages created AFTER this question was sent.
   */
  async function waitForAnswer(initialCount = 0, timeoutMs = 240000) {
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;
    const STABLE_THRESHOLD = 3; // 3 consecutive stable checks (3s)

    while (Date.now() - startTime < timeoutMs) {
      const responseEls = document.querySelectorAll('.to-user-container .message-text-content');

      // Only check when a new response has been added
      if (responseEls.length > initialCount) {
        const lastResponse = responseEls[responseEls.length - 1];
        const currentText = extractMessageText(lastResponse);

        if (currentText.length > 0 && !currentText.includes('Thinking...') && !currentText.includes('Refining sentence structure...')) {
          if (currentText === lastText) {
            stableCount++;
            if (stableCount >= STABLE_THRESHOLD) {
              return currentText;
            }
          } else {
            stableCount = 0;
            lastText = currentText;
          }
        }
      }

      await sleep(1000);
    }

    throw new Error('Timeout waiting for NotebookLM response');
  }

  /**
   * Remove the most recently added source from the notebook.
   * Hardened to operate reliably even when tab is in the background.
   */
  async function removeSource() {
    log('Removing last source...');
    
    // Check for source containers, giving a short wait in case DOM is still rendering
    let sourceItems = document.querySelectorAll('.single-source-container, .source-item, [data-source-id]');
    if (sourceItems.length === 0) {
      await sleep(1000);
      sourceItems = document.querySelectorAll('.single-source-container, .source-item, [data-source-id]');
    }

    if (sourceItems.length === 0) {
      log('No sources found to remove');
      return { success: true, removed: false, message: 'No sources found' };
    }

    const lastSource = sourceItems[sourceItems.length - 1];
    log('Found source to remove:', lastSource.innerText?.substring(0, 50));

    // Ensure hover state is triggered so Angular/CSS reveals the more button
    lastSource.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(200);

    // Find more options button
    const moreBtn = lastSource.querySelector('.source-item-more-button, button[aria-label="More" i]')
      || Array.from(lastSource.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || '').toLowerCase() === 'more')
      || lastSource.querySelectorAll('button')[1];

    if (!moreBtn) {
      throw new Error('Could not find "More" options button on source item');
    }

    log('Found more options button, clicking it...');
    simulateClick(moreBtn);

    // Wait for the menu overlay to appear (polling up to 4000ms)
    log('Waiting for "Remove source" menu item...');
    let removeMenuItem = null;
    const menuStart = Date.now();
    while (Date.now() - menuStart < 4000) {
      const items = Array.from(document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"], .cdk-overlay-container button'));
      removeMenuItem = items.find(el => el.textContent.toLowerCase().includes('remove source'));
      if (removeMenuItem) break;
      await sleep(250);
    }

    // Retry once if menu didn't open
    if (!removeMenuItem) {
      log('Menu item not found, retrying click on More button...');
      simulateClick(moreBtn);
      const retryStart = Date.now();
      while (Date.now() - retryStart < 3000) {
        const items = Array.from(document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"], .cdk-overlay-container button'));
        removeMenuItem = items.find(el => el.textContent.toLowerCase().includes('remove source'));
        if (removeMenuItem) break;
        await sleep(250);
      }
    }

    if (!removeMenuItem) {
      throw new Error('Could not find "Remove source" menu item after clicking More button');
    }

    log('Found "Remove source" menu item, clicking it...');
    simulateClick(removeMenuItem);

    // Wait for confirmation dialog "Delete" button (polling up to 5000ms)
    log('Waiting for Delete confirmation button in dialog...');
    let confirmBtn = null;
    const dialogStart = Date.now();
    while (Date.now() - dialogStart < 5000) {
      const btns = Array.from(document.querySelectorAll('mat-dialog-container button, .cdk-overlay-pane button'));
      confirmBtn = btns.find(b => b.textContent.trim().toLowerCase() === 'delete');
      if (confirmBtn) break;
      await sleep(250);
    }

    if (!confirmBtn) {
      throw new Error('Could not find "Delete" confirmation button in dialog');
    }

    log('Found Delete confirmation button, clicking it...');
    simulateClick(confirmBtn);

    // Wait for dialog to dismiss and source removal to finish
    await sleep(1500);
    log('Source removed successfully.');

    // Also attempt to clear chat history to keep notebook clean
    await clearChatHistory().catch(() => {});

    return { success: true, removed: true };
  }

  /**
   * Clear chat history in NotebookLM to keep conversation compact and fast.
   */
  async function clearChatHistory() {
    log('Attempting to clear chat history...');
    try {
      const optBtn = document.querySelector('button[aria-label="Chat options" i]');
      if (!optBtn) {
        log('No chat options button found, chat is already clear.');
        return { success: true, cleared: false };
      }
      simulateClick(optBtn);
      await sleep(350);

      const items = Array.from(document.querySelectorAll('[role="menuitem"], .mat-mdc-menu-item'));
      const delItem = items.find(i => (i.innerText || '').toLowerCase().includes('delete chat history'));
      if (!delItem) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        return { success: true, cleared: false };
      }

      simulateClick(delItem);
      await sleep(350);

      const dialogBtns = Array.from(document.querySelectorAll('mat-dialog-container button'));
      const confirmBtn = dialogBtns.find(b => b.innerText.trim().toLowerCase() === 'delete');
      if (confirmBtn) {
        simulateClick(confirmBtn);
        await sleep(500);
        log('Chat history successfully deleted.');
        return { success: true, cleared: true };
      }
    } catch (e) {
      log('clearChatHistory caught error:', e);
    }
    return { success: true, cleared: false };
  }

  // --- Message Handler ---

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('Received message from background:', message.action);

    if (message.action === 'ping') {
      sendResponse({ status: 'alive' });
      return false;
    }

    if (message.action === 'addSource') {
      addSource(message.url)
        .then(() => {
          log('Responding to addSource: success');
          sendResponse({ success: true });
        })
        .catch(e => {
          err('addSource failed:', e);
          sendResponse({ success: false, error: e.message || String(e) });
        });
      return true; // Keep channel open for async response
    }

    if (message.action === 'askQuestion') {
      askQuestion(message.question)
        .then(text => {
          log('Responding to askQuestion: success');
          sendResponse({ success: true, text });
        })
        .catch(e => {
          err('askQuestion failed:', e);
          sendResponse({ success: false, error: e.message || String(e) });
        });
      return true; // Keep channel open for async response
    }

    if (message.action === 'removeSource') {
      removeSource()
        .then(() => {
          log('Responding to removeSource: success');
          sendResponse({ success: true });
        })
        .catch(e => {
          err('removeSource failed:', e);
          sendResponse({ success: false, error: e.message || String(e) });
        });
      return true; // Keep channel open for async response
    }

    if (message.action === 'clearChat') {
      clearChatHistory()
        .then(res => {
          log('Responding to clearChat: success');
          sendResponse({ success: true, ...res });
        })
        .catch(e => {
          sendResponse({ success: false, error: e.message || String(e) });
        });
      return true;
    }

    warn('Unknown action:', message.action);
    sendResponse({ error: 'Unknown action' });
    return false;
  });

  // --- Init ---
  log('Content script loaded on:', window.location.href);
})();
