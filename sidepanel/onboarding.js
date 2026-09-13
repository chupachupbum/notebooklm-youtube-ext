/**
 * Onboarding Flow for NotebookLM YouTube Summarizer
 * Provides an interactive 5-step onboarding experience:
 * Steps 1-3: Centered setup modals (Welcome, Google Auth Check, Notebook URL requirement)
 * Steps 4-5: Floating coach marks with element spotlights (Summarize button, Settings/Replay)
 */

(function () {
  'use strict';

  const ONBOARDING_VERSION = 1;
  const TOTAL_STEPS = 5;

  let currentStep = 0;
  let overlayEl = null;
  let activeModalEl = null;
  let activeTooltipEl = null;
  let currentTargetEl = null;
  let demoModeActive = false;

  const STEPS = [
    // Step 1: Welcome
    {
      type: 'modal',
      icon: '📓',
      title: 'Welcome to NLM Summarizer!',
      body: 'Summarize YouTube videos directly using Google NotebookLM — without switching tabs or losing your place.',
      primaryBtnText: 'Get Started →',
      showBack: false,
      showSkip: true
    },

    // Step 2: Google Sign-in Verification
    {
      type: 'modal',
      icon: '🔐',
      title: 'Sign in to Google',
      body: 'This extension uses your active Google session in this browser to communicate with NotebookLM in the background.<br><br>Please make sure you are signed into Google in this browser profile.',
      hint: 'Tip: If you are not signed in yet, click the link below to open NotebookLM and log into your Google account.',
      externalLink: {
        text: 'Open NotebookLM to Check ↗',
        url: 'https://notebooklm.google.com/'
      },
      primaryBtnText: "I'm Signed In →",
      showBack: true,
      showSkip: true
    },

    // Step 3: Notebook URL Setup (Required)
    {
      type: 'modal',
      icon: '🔗',
      title: 'Connect Your Notebook',
      body: 'Paste the URL of your NotebookLM notebook where video summaries should be stored. You only need to set this up once.',
      hint: '💡 Open NotebookLM, create or open a notebook, and copy its browser URL (e.g., https://notebooklm.google.com/notebook/...)',
      hasInput: true,
      inputLabel: 'NotebookLM Notebook URL:',
      inputPlaceholder: 'https://notebooklm.google.com/notebook/...',
      primaryBtnText: 'Save & Continue →',
      showBack: true,
      showSkip: true
    },

    // Step 4: Summarize CTA (Coach mark on #summarizeBtn)
    {
      type: 'tooltip',
      targetSelector: '#summarizeBtn',
      placement: 'top',
      title: '🎬 One-Click Summarize',
      body: "Whenever you're on any YouTube video, click this button. The extension will automatically send the video transcript to NotebookLM and extract a comprehensive summary.",
      primaryBtnText: 'Next →',
      showBack: true,
      showSkip: true
    },

    // Step 5: Settings & Replay (Coach mark on #settingsToggle)
    {
      type: 'tooltip',
      targetSelector: '#settingsToggle',
      placement: 'bottom',
      title: '⚙️ Settings & Tour Replay',
      body: 'You can update your notebook URL or replay this tour anytime right here in Settings. Follow-up questions and markdown export are also ready for you!',
      primaryBtnText: 'Got It! Finish Tour 🎉',
      showBack: true,
      showSkip: false
    }
  ];

  /**
   * Check if onboarding should be shown on startup
   */
  function init() {
    if (!chrome.storage || !chrome.storage.local) return;

    chrome.storage.local.get(['onboardingComplete', 'onboardingVersion', 'notebookUrl'], (result) => {
      const isComplete = result && result.onboardingComplete;
      const version = (result && result.onboardingVersion) || 0;

      if (!isComplete || version < ONBOARDING_VERSION) {
        // First-time user detected: launch onboarding!
        start();
      }
    });
  }

  /**
   * Start or restart the onboarding flow from step 0
   */
  function start() {
    cleanup();
    currentStep = 0;

    // If currently in 'notYoutube' state, temporarily simulate the 'ready' state
    // so the user can see the actual button during the interactive tour
    prepareDemoState();

    createOverlay();
    showStep(0);
  }

  /**
   * Temporarily reveal ready state with demo details if user is not currently on a video
   */
  function prepareDemoState() {
    const notYoutubeEl = document.getElementById('notYoutube');
    const readyEl = document.getElementById('ready');
    const videoTitleEl = document.getElementById('videoTitle');
    const videoUrlEl = document.getElementById('videoUrl');

    if (readyEl && readyEl.classList.contains('hidden')) {
      demoModeActive = true;
      if (notYoutubeEl) notYoutubeEl.classList.add('hidden');
      readyEl.classList.remove('hidden');
      if (videoTitleEl && (!videoTitleEl.textContent.trim() || videoTitleEl.textContent === 'Video Title')) {
        videoTitleEl.textContent = 'Demo: Exploring Generative AI with NotebookLM';
      }
      if (videoUrlEl && !videoUrlEl.textContent.trim()) {
        videoUrlEl.textContent = 'https://www.youtube.com/watch?v=demo';
      }
    }
  }

  /**
   * Revert demo state if needed
   */
  function restoreDemoState() {
    if (demoModeActive) {
      demoModeActive = false;
      if (typeof window.checkCurrentTab === 'function') {
        window.checkCurrentTab();
      }
    }
  }

  /**
   * Create the full-screen backdrop overlay
   */
  function createOverlay() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'onboarding-overlay';
    document.body.appendChild(overlayEl);

    // Trigger reflow for smooth fade-in
    requestAnimationFrame(() => {
      overlayEl.classList.add('active');
    });
  }

  /**
   * Render a specific step
   */
  function showStep(index) {
    if (index < 0 || index >= TOTAL_STEPS) return;
    currentStep = index;

    // Clean up active modal/tooltip/spotlight
    removeActiveModal();
    removeActiveTooltip();
    removeSpotlight();

    const config = STEPS[index];
    if (config.type === 'modal') {
      renderModal(config, index);
    } else if (config.type === 'tooltip') {
      if (config.targetSelector === '#summarizeBtn') {
        prepareDemoState();
      }
      renderTooltip(config, index);
    }
  }

  /**
   * Render Centered Modal Card (Steps 1-3)
   */
  function renderModal(config, stepIndex) {
    const container = document.createElement('div');
    container.className = 'onboarding-modal-container';

    const modal = document.createElement('div');
    modal.className = 'onboarding-modal';

    // Icon
    const iconEl = document.createElement('div');
    iconEl.className = 'onboarding-icon';
    iconEl.textContent = config.icon || '✨';
    modal.appendChild(iconEl);

    // Title
    const titleEl = document.createElement('h2');
    titleEl.className = 'onboarding-title';
    titleEl.textContent = config.title;
    modal.appendChild(titleEl);

    // Body
    const bodyEl = document.createElement('p');
    bodyEl.className = 'onboarding-body';
    bodyEl.innerHTML = config.body;
    modal.appendChild(bodyEl);

    // Hint (if present)
    if (config.hint) {
      const hintEl = document.createElement('div');
      hintEl.className = 'onboarding-hint';
      hintEl.innerHTML = config.hint;
      modal.appendChild(hintEl);
    }

    // External link button (Step 2)
    if (config.externalLink) {
      const linkBtn = document.createElement('a');
      linkBtn.className = 'onboarding-btn-external';
      linkBtn.textContent = config.externalLink.text;
      linkBtn.href = config.externalLink.url;
      linkBtn.target = '_blank';
      linkBtn.rel = 'noopener noreferrer';
      modal.appendChild(linkBtn);
    }

    // Input field (Step 3)
    let inputEl = null;
    let errorEl = null;
    if (config.hasInput) {
      const inputGroup = document.createElement('div');
      inputGroup.className = 'onboarding-input-group';

      const label = document.createElement('label');
      label.textContent = config.inputLabel;
      inputGroup.appendChild(label);

      inputEl = document.createElement('input');
      inputEl.type = 'url';
      inputEl.className = 'onboarding-input';
      inputEl.placeholder = config.inputPlaceholder;

      // Prepopulate with existing value from settings input if available
      const existingSettingsInput = document.getElementById('notebookUrl');
      if (existingSettingsInput && existingSettingsInput.value.trim()) {
        inputEl.value = existingSettingsInput.value.trim();
      } else {
        chrome.storage.local.get(['notebookUrl'], (res) => {
          if (res && res.notebookUrl) {
            inputEl.value = res.notebookUrl;
          }
        });
      }

      errorEl = document.createElement('div');
      errorEl.className = 'onboarding-error-msg';
      errorEl.textContent = 'Please enter a valid Notebook URL with notebook ID (e.g., https://notebooklm.google.com/notebook/...)';

      inputGroup.appendChild(inputEl);
      inputGroup.appendChild(errorEl);
      modal.appendChild(inputGroup);

      // Clear error on typing
      inputEl.addEventListener('input', () => {
        inputEl.classList.remove('input-error');
        errorEl.classList.remove('visible');
      });
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'onboarding-actions';

    const primaryBtn = document.createElement('button');
    primaryBtn.className = 'onboarding-btn-primary';
    primaryBtn.textContent = config.primaryBtnText;

    primaryBtn.addEventListener('click', () => {
      if (config.hasInput) {
        // Validate Notebook URL requirement
        const val = inputEl.value.trim();
        if (!validateNotebookUrl(val)) {
          inputEl.classList.add('input-error');
          errorEl.classList.add('visible');
          inputEl.focus();
          return;
        }

        // Save URL
        saveNotebookUrl(val);
      }

      nextStep();
    });

    actions.appendChild(primaryBtn);

    // Row for Back & Skip
    const subNavRow = document.createElement('div');
    subNavRow.className = 'onboarding-btn-row';

    if (config.showBack && stepIndex > 0) {
      const backBtn = document.createElement('button');
      backBtn.className = 'onboarding-btn-secondary';
      backBtn.textContent = '← Back';
      backBtn.addEventListener('click', prevStep);
      subNavRow.appendChild(backBtn);
    } else {
      subNavRow.appendChild(document.createElement('div')); // spacer
    }

    if (config.showSkip) {
      const skipBtn = document.createElement('button');
      skipBtn.className = 'onboarding-btn-link';
      skipBtn.textContent = 'Skip tour';
      skipBtn.addEventListener('click', skip);
      subNavRow.appendChild(skipBtn);
    }

    actions.appendChild(subNavRow);
    modal.appendChild(actions);

    // Footer with dots
    const footer = createFooter(stepIndex);
    modal.appendChild(footer);

    container.appendChild(modal);
    document.body.appendChild(container);
    activeModalEl = container;

    // Focus primary element
    if (inputEl) {
      setTimeout(() => inputEl.focus(), 100);
    }
  }

  /**
   * Render Tooltip Coach Mark (Steps 4-5)
   */
  function renderTooltip(config, stepIndex) {
    const target = document.querySelector(config.targetSelector);
    if (!target) {
      console.warn('[NLM-Onboarding] Target element not found:', config.targetSelector);
      nextStep();
      return;
    }

    currentTargetEl = target;
    target.classList.add('onboarding-spotlight-active');
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const tooltip = document.createElement('div');
    tooltip.className = 'onboarding-tooltip';
    tooltip.setAttribute('data-placement', config.placement || 'bottom');

    const arrow = document.createElement('div');
    arrow.className = 'onboarding-tooltip-arrow';
    tooltip.appendChild(arrow);

    const titleEl = document.createElement('h3');
    titleEl.className = 'onboarding-title';
    titleEl.textContent = config.title;
    tooltip.appendChild(titleEl);

    const bodyEl = document.createElement('p');
    bodyEl.className = 'onboarding-body';
    bodyEl.innerHTML = config.body;
    tooltip.appendChild(bodyEl);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'onboarding-btn-row';

    if (config.showBack && stepIndex > 0) {
      const backBtn = document.createElement('button');
      backBtn.className = 'onboarding-btn-secondary';
      backBtn.textContent = '← Back';
      backBtn.addEventListener('click', prevStep);
      btnRow.appendChild(backBtn);
    }

    const primaryBtn = document.createElement('button');
    primaryBtn.className = 'onboarding-btn-primary';
    primaryBtn.style.width = 'auto';
    primaryBtn.style.flex = '1';
    primaryBtn.textContent = config.primaryBtnText;
    primaryBtn.addEventListener('click', () => {
      if (stepIndex === TOTAL_STEPS - 1) {
        complete();
      } else {
        nextStep();
      }
    });
    btnRow.appendChild(primaryBtn);

    tooltip.appendChild(btnRow);

    // Footer with dots & skip
    const footer = createFooter(stepIndex, config.showSkip);
    tooltip.appendChild(footer);

    document.body.appendChild(tooltip);
    activeTooltipEl = tooltip;

    // Position tooltip relative to target
    positionTooltip(tooltip, target, config.placement || 'bottom', arrow);

    // Recalculate position on resize
    window.addEventListener('resize', handleReposition);
  }

  function handleReposition() {
    if (activeTooltipEl && currentTargetEl) {
      const config = STEPS[currentStep];
      const arrow = activeTooltipEl.querySelector('.onboarding-tooltip-arrow');
      positionTooltip(activeTooltipEl, currentTargetEl, config.placement || 'bottom', arrow);
    }
  }

  /**
   * Dynamic positioning calculation for coach mark tooltips
   */
  function positionTooltip(tooltip, target, preferredPlacement, arrow) {
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 12;

    let top = 0;
    let left = 0;
    let actualPlacement = preferredPlacement;

    // Center horizontally on target, clamped to viewport bounds
    left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tooltipRect.width - 12));

    if (preferredPlacement === 'top') {
      top = targetRect.top - tooltipRect.height - margin;
      if (top < 12) {
        // Flip to bottom if out of view
        top = targetRect.bottom + margin;
        actualPlacement = 'bottom';
      }
    } else {
      top = targetRect.bottom + margin;
      if (top + tooltipRect.height > window.innerHeight - 12) {
        // Flip to top if out of view
        top = targetRect.top - tooltipRect.height - margin;
        actualPlacement = 'top';
      }
    }

    tooltip.setAttribute('data-placement', actualPlacement);
    tooltip.style.position = 'fixed';
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.left = `${Math.round(left)}px`;

    // Center arrow over the target
    if (arrow) {
      const targetCenter = targetRect.left + targetRect.width / 2;
      const arrowLeft = targetCenter - left - 6;
      arrow.style.left = `${Math.max(12, Math.min(arrowLeft, tooltipRect.width - 24))}px`;
    }
  }

  /**
   * Helper: Build footer with step counter, dots, and optional skip
   */
  function createFooter(stepIndex, showSkip) {
    const footer = document.createElement('div');
    footer.className = 'onboarding-footer';

    const counter = document.createElement('span');
    counter.className = 'onboarding-step-counter';
    counter.textContent = `Step ${stepIndex + 1} of ${TOTAL_STEPS}`;
    footer.appendChild(counter);

    const dots = document.createElement('div');
    dots.className = 'onboarding-dots';
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const dot = document.createElement('div');
      dot.className = `onboarding-dot${i === stepIndex ? ' active' : ''}`;
      dots.appendChild(dot);
    }
    footer.appendChild(dots);

    const endWrapper = document.createElement('div');
    endWrapper.className = 'onboarding-footer-end';
    if (showSkip) {
      const skipLink = document.createElement('button');
      skipLink.className = 'onboarding-btn-link';
      skipLink.style.padding = '0';
      skipLink.textContent = 'Skip';
      skipLink.addEventListener('click', skip);
      endWrapper.appendChild(skipLink);
    }
    footer.appendChild(endWrapper);

    return footer;
  }

  /**
   * Step navigation
   */
  function nextStep() {
    if (currentStep < TOTAL_STEPS - 1) {
      showStep(currentStep + 1);
    } else {
      complete();
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      showStep(currentStep - 1);
    }
  }

  function skip() {
    complete();
  }

  /**
   * Mark onboarding as complete, persist flag, and clean up UI
   */
  function complete() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        onboardingComplete: true,
        onboardingVersion: ONBOARDING_VERSION
      });
    }

    cleanup();
    restoreDemoState();

    if (typeof window.showToast === 'function') {
      window.showToast("🎉 Setup complete! You're ready to summarize.");
    }
  }

  /**
   * Tear down all onboarding UI elements
   */
  function cleanup() {
    window.removeEventListener('resize', handleReposition);
    removeActiveModal();
    removeActiveTooltip();
    removeSpotlight();

    if (overlayEl) {
      overlayEl.classList.remove('active');
      setTimeout(() => {
        if (overlayEl && overlayEl.parentNode) {
          overlayEl.parentNode.removeChild(overlayEl);
        }
        overlayEl = null;
      }, 250);
    }
  }

  function removeActiveModal() {
    if (activeModalEl && activeModalEl.parentNode) {
      activeModalEl.parentNode.removeChild(activeModalEl);
    }
    activeModalEl = null;
  }

  function removeActiveTooltip() {
    if (activeTooltipEl && activeTooltipEl.parentNode) {
      activeTooltipEl.parentNode.removeChild(activeTooltipEl);
    }
    activeTooltipEl = null;
  }

  function removeSpotlight() {
    if (currentTargetEl) {
      currentTargetEl.classList.remove('onboarding-spotlight-active');
      currentTargetEl = null;
    }
  }

  /**
   * URL validation helper
   */
  function validateNotebookUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      // Must strictly be notebooklm.google.com or notebook.google.com
      const host = parsed.hostname.toLowerCase();
      const isGoogleHost = (host === 'notebooklm.google.com' || host === 'notebook.google.com');
      if (!isGoogleHost) {
        return false;
      }
      // Must contain /notebook/ followed by a notebook ID/slug
      const path = parsed.pathname;
      const hasNotebookId = /^\/notebook\/[a-zA-Z0-9_-]+/.test(path);
      return hasNotebookId;
    } catch (e) {
      return false;
    }
  }

  /**
   * Save Notebook URL to chrome.storage.local and synchronize settings UI
   */
  function saveNotebookUrl(url) {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ notebookUrl: url });
    }
    const settingsInput = document.getElementById('notebookUrl');
    if (settingsInput) {
      settingsInput.value = url;
    }
  }

  // Expose to window for sidepanel.js integration
  window.NLM_Onboarding = {
    init,
    start,
    complete,
    skip,
    showStep
  };

})();
