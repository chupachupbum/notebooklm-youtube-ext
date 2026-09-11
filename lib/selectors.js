/**
 * Centralized DOM selectors for NotebookLM.
 * All NotebookLM-specific DOM queries go here so breakage is isolated.
 * Each selector group has a primary and fallback selectors.
 */
const SELECTORS = {
  // --- Chat input ---
  queryInput: [
    'textarea.query-box-input',                        // Primary
    'textarea[aria-label="Input for queries"]',         // English fallback
    'textarea[aria-label="Feld für Anfragen"]',         // German fallback
    'textarea[placeholder*="Ask a question"]',          // Placeholder-based
    'textarea[placeholder*="question or create"]',      // Alternate placeholder
  ],

  // --- Send/Ask button ---
  sendButton: [
    'button.send-button',                               // Primary
    'button[aria-label="Send"]',                        // aria-label
    'button[aria-label="Submit"]',                      // alt aria
    'button[mattooltip="Send"]',                        // Angular Material tooltip
    '.query-box button[type="submit"]',                 // Form submit
    '.query-box button:has(mat-icon)',                   // Button with icon in query box
  ],

  // --- Response containers ---
  response: [
    '.to-user-container .message-text-content',          // Primary
    '[data-message-author="bot"]',                      // data attr
    '[data-message-author="assistant"]',                // alt data attr
    '.response-container .message-text-content',        // alt class
    '.chat-message.bot .message-text-content',          // alt structure
  ],

  // --- Add Sources button (in the Sources panel) ---
  addSourcesButton: [
    'button:has(span.mat-label-large)',                  // Angular Material button with label
    'button:has(> span:contains("Add sources"))',       // Text-based (won't work with querySelector, needs custom)
    '[aria-label="Add sources"]',                       // aria
    '.source-panel button',                              // Generic source panel button
  ],

  // --- Source type: Websites button (in the add sources dialog) ---
  websitesButton: [
    'button:has(span:contains("Websites"))',            // Text-based  
    '[aria-label="Websites"]',                          // aria
    'button.source-type-websites',                       // Class-based
  ],

  // --- URL input (in the websites/add source dialog) ---
  urlInput: [
    'input[type="url"]',                                // Standard URL input
    'input[placeholder*="URL"]',                        // Placeholder-based
    'input[placeholder*="url"]',                        // lowercase
    'input[placeholder*="link"]',                       // link-based
    'input[placeholder*="paste"]',                      // paste-based
    'textarea[placeholder*="URL"]',                     // Could be textarea
    '.url-input input',                                  // Class-based
  ],

  // --- Submit/Insert source button ---
  insertSourceButton: [
    'button:has(span:contains("Insert"))',              // Text-based
    'button:has(span:contains("Add"))',                 // Alt text
    'button[aria-label="Insert"]',                      // aria
    'button[aria-label="Add"]',                          // alt aria
    '.source-dialog button.primary',                     // Dialog primary button
    '.mat-dialog-actions button.mat-primary',            // Angular Material dialog
  ],

  // --- Source list items ---
  sourceItem: [
    '.source-item',                                      // Primary
    '.source-list-item',                                 // Alt
    '[data-source-id]',                                  // Data attribute
  ],

  // --- Source delete/remove button ---
  removeSourceButton: [
    'button[aria-label="Delete"]',                      // aria
    'button[aria-label="Remove"]',                      // alt aria
    'button:has(mat-icon:contains("delete"))',          // Icon-based
    '.source-item button.delete',                        // Class-based
  ],

  // --- Close dialog button ---
  closeDialogButton: [
    'button[aria-label="Close"]',                       // aria
    'button.close-button',                               // Class-based
    '.mat-dialog-close',                                 // Angular Material
    'button:has(mat-icon:contains("close"))',           // Icon-based
  ],

  // --- Streaming/loading indicator (to know when response is complete) ---
  loadingIndicator: [
    '.loading-indicator',                                // Primary
    '.typing-indicator',                                 // Alt
    '.message-loading',                                  // Alt
    '[data-loading="true"]',                             // Data attr
    '.streaming-indicator',                              // Alt
  ],
};

// Make available globally when loaded as content script
if (typeof window !== 'undefined') {
  window.__NLM_SELECTORS = SELECTORS;
}

// Also export for module usage
if (typeof module !== 'undefined') {
  module.exports = SELECTORS;
}
