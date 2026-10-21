/**
 * Chrome Extension Manifest V3 Mock Environment
 * Provides comprehensive in-memory mock for chrome.* APIs:
 * - chrome.runtime (messaging, getURL, id)
 * - chrome.tabs (query, sendMessage, create, update, remove, onUpdated, onRemoved)
 * - chrome.storage (local, session)
 * - chrome.windows (getCurrent, create, update)
 * - chrome.sidePanel (setOptions, open)
 * - chrome.action (onClicked)
 */

class EventHook {
  constructor() {
    this.listeners = [];
  }
  addListener(fn) {
    if (typeof fn === 'function' && !this.listeners.includes(fn)) {
      this.listeners.push(fn);
    }
  }
  removeListener(fn) {
    this.listeners = this.listeners.filter(l => l !== fn);
  }
  hasListener(fn) {
    return this.listeners.includes(fn);
  }
  async dispatch(...args) {
    const results = [];
    for (const listener of [...this.listeners]) {
      results.push(await listener(...args));
    }
    return results;
  }
}

class StorageAreaMock {
  constructor() {
    this.store = new Map();
  }
  get(keys, callback) {
    const result = {};
    if (keys === null || keys === undefined) {
      for (const [k, v] of this.store.entries()) {
        result[k] = JSON.parse(JSON.stringify(v));
      }
    } else if (typeof keys === 'string') {
      if (this.store.has(keys)) {
        result[keys] = JSON.parse(JSON.stringify(this.store.get(keys)));
      }
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (this.store.has(k)) {
          result[k] = JSON.parse(JSON.stringify(this.store.get(k)));
        }
      }
    } else if (typeof keys === 'object') {
      for (const [k, defaultVal] of Object.entries(keys)) {
        result[k] = this.store.has(k)
          ? JSON.parse(JSON.stringify(this.store.get(k)))
          : defaultVal;
      }
    }
    if (typeof callback === 'function') callback(result);
    return Promise.resolve(result);
  }
  set(items, callback) {
    for (const [k, v] of Object.entries(items)) {
      this.store.set(k, JSON.parse(JSON.stringify(v)));
    }
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  }
  remove(keys, callback) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) {
      this.store.delete(k);
    }
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  }
  clear(callback) {
    this.store.clear();
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  }
}

function createChromeMock(initialState = {}) {
  const tabsList = initialState.tabs || [
    {
      id: 101,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
      active: true,
      currentWindow: true,
      windowId: 1
    }
  ];

  const windowsList = initialState.windows || [
    { id: 1, focused: true, width: 1920, height: 1080, left: 0, top: 0 }
  ];

  const sidePanelOptions = new Map();
  const sentRuntimeMessages = [];
  const sentTabMessages = [];

  const onMessageHook = new EventHook();
  const onUpdatedHook = new EventHook();
  const onRemovedHook = new EventHook();
  const onActivatedHook = new EventHook();
  const onClickedHook = new EventHook();

  const chromeMock = {
    runtime: {
      id: 'mock-nlm-extension-id',
      getURL: (path) => {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        return `chrome-extension://mock-nlm-extension-id/${cleanPath}`;
      },
      sendMessage: (message, callback) => {
        sentRuntimeMessages.push(message);
        let handled = false;
        let asyncResponsePromise = null;

        const sendResponse = (res) => {
          handled = true;
          if (typeof callback === 'function') callback(res);
        };

        for (const listener of [...onMessageHook.listeners]) {
          try {
            const isAsync = listener(message, { id: 'mock-nlm-extension-id', url: 'https://www.youtube.com' }, sendResponse);
            if (isAsync === true) {
              // Async listener will call sendResponse
              asyncResponsePromise = new Promise(resolve => {
                const origSend = sendResponse;
                // Wait for sendResponse
              });
            }
          } catch (e) {
            console.error('Error in chrome.runtime.onMessage listener:', e);
          }
        }

        return Promise.resolve({ success: true, message: 'Message queued' });
      },
      onMessage: onMessageHook,
      lastError: null
    },

    tabs: {
      query: (queryInfo) => {
        let matched = [...tabsList];
        if (queryInfo) {
          if (queryInfo.active !== undefined) {
            matched = matched.filter(t => t.active === queryInfo.active);
          }
          if (queryInfo.currentWindow !== undefined) {
            matched = matched.filter(t => t.currentWindow === queryInfo.currentWindow);
          }
          if (queryInfo.windowId !== undefined) {
            matched = matched.filter(t => t.windowId === queryInfo.windowId);
          }
          if (queryInfo.url !== undefined) {
            const pattern = queryInfo.url.replace(/\*/g, '.*');
            const regex = new RegExp(`^${pattern}$`);
            matched = matched.filter(t => t.url && regex.test(t.url));
          }
        }
        return Promise.resolve(matched);
      },
      sendMessage: (tabId, message, callback) => {
        sentTabMessages.push({ tabId, message });
        if (typeof callback === 'function') callback({ success: true });
        return Promise.resolve({ success: true });
      },
      create: (createProperties) => {
        const newTab = {
          id: Math.floor(Math.random() * 10000) + 200,
          url: createProperties.url || '',
          active: createProperties.active !== undefined ? createProperties.active : true,
          windowId: createProperties.windowId || 1
        };
        tabsList.push(newTab);
        return Promise.resolve(newTab);
      },
      update: (tabId, updateProperties) => {
        const tab = tabsList.find(t => t.id === tabId);
        if (tab) {
          Object.assign(tab, updateProperties);
          return Promise.resolve(tab);
        }
        return Promise.reject(new Error(`Tab ${tabId} not found`));
      },
      remove: async (tabId) => {
        const idx = tabsList.findIndex(t => t.id === tabId);
        if (idx !== -1) {
          tabsList.splice(idx, 1);
        }
        await onRemovedHook.dispatch(tabId, { isWindowClosing: false });
        return Promise.resolve();
      },
      onUpdated: onUpdatedHook,
      onActivated: onActivatedHook,
      onRemoved: onRemovedHook
    },

    storage: {
      local: new StorageAreaMock(),
      session: new StorageAreaMock()
    },

    windows: {
      get: (winId) => {
        const win = windowsList.find(w => w.id === winId);
        if (win) return Promise.resolve(win);
        return Promise.reject(new Error(`Window ${winId} not found`));
      },
      getCurrent: () => {
        const win = windowsList.find(w => w.focused) || windowsList[0];
        return Promise.resolve(win || { id: 1, width: 1920, height: 1080, left: 0, top: 0 });
      },
      create: (createData) => {
        const newWin = {
          id: Math.floor(Math.random() * 1000) + 10,
          ...createData
        };
        windowsList.push(newWin);
        return Promise.resolve(newWin);
      },
      update: (winId, updateData) => {
        const win = windowsList.find(w => w.id === winId);
        if (win) {
          Object.assign(win, updateData);
          return Promise.resolve(win);
        }
        return Promise.reject(new Error(`Window ${winId} not found`));
      }
    },

    sidePanel: {
      setOptions: (options) => {
        sidePanelOptions.set(options.tabId || 'global', options);
        return Promise.resolve();
      },
      open: (options) => {
        return Promise.resolve();
      },
      _getOptions: (key) => sidePanelOptions.get(key)
    },

    action: {
      onClicked: onClickedHook
    },

    // Test Harness Hooks
    _state: {
      tabsList,
      windowsList,
      sentRuntimeMessages,
      sentTabMessages,
      sidePanelOptions
    }
  };

  return chromeMock;
}

module.exports = { createChromeMock };
