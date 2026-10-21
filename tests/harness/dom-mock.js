/**
 * YouTube DOM & Window Mock Environment
 * Simulates YouTube video pages, secondary sidebar, video player,
 * ResizeObserver, MutationObserver, and YouTube custom events.
 */

class MockClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }
  add(...names) {
    for (const name of names) {
      if (name) this.classes.add(name);
    }
    this._sync();
  }
  remove(...names) {
    for (const name of names) {
      this.classes.delete(name);
    }
    this._sync();
  }
  toggle(name, force) {
    if (force !== undefined) {
      if (force) this.add(name);
      else this.remove(name);
      return force;
    }
    const has = this.classes.has(name);
    if (has) this.remove(name);
    else this.add(name);
    return !has;
  }
  contains(name) {
    return this.classes.has(name);
  }
  _sync() {
    this.element._className = Array.from(this.classes).join(' ');
  }
  _fromClassName(str) {
    this.classes.clear();
    if (str) {
      str.trim().split(/\s+/).forEach(c => { if (c) this.classes.add(c); });
    }
  }
}

class MockElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.id = '';
    this._className = '';
    this.classList = new MockClassList(this);
    this.attributes = new Map();
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.src = '';
    this.title = '';
    this.textContent = '';
    this.innerHTML = '';
    this.clientHeight = 0;
    this.offsetHeight = 0;
    this.scrollHeight = 0;
    this.clientWidth = 0;
    this.offsetWidth = 0;
    this.isConnected = false;
  }

  get className() {
    return this._className;
  }
  set className(val) {
    this._className = val || '';
    this.classList._fromClassName(this._className);
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'src') this.src = String(value);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'id') this.id = '';
    if (name === 'class') this.className = '';
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    this._updateConnectedState(child, this.isConnected);
    return child;
  }

  prepend(...nodes) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
      node.parentNode = this;
      node.isConnected = this.isConnected;
      this.children.unshift(node);
      this._updateConnectedState(node, this.isConnected);
    }
  }

  insertBefore(newNode, referenceNode) {
    if (newNode.parentNode) {
      newNode.parentNode.removeChild(newNode);
    }
    const idx = this.children.indexOf(referenceNode);
    if (idx === -1) {
      return this.appendChild(newNode);
    }
    newNode.parentNode = this;
    newNode.isConnected = this.isConnected;
    this.children.splice(idx, 0, newNode);
    this._updateConnectedState(newNode, this.isConnected);
    return newNode;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
      child.isConnected = false;
      this._updateConnectedState(child, false);
      return child;
    }
    throw new Error('Node was not a child of this element');
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  _updateConnectedState(node, state) {
    node.isConnected = state;
    if (node.children) {
      for (const c of node.children) {
        this._updateConnectedState(c, state);
      }
    }
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (this.eventListeners.has(type)) {
      const list = this.eventListeners.get(type).filter(l => l !== listener);
      this.eventListeners.set(type, list);
    }
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    if (this.eventListeners.has(event.type)) {
      for (const listener of this.eventListeners.get(event.type)) {
        listener.call(this, event);
      }
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, defaultPrevented: false });
  }

  querySelector(selector) {
    return this._matchSelector(this, selector, true);
  }

  querySelectorAll(selector) {
    const results = [];
    this._matchSelector(this, selector, false, results);
    return results;
  }

  _matchSelector(root, selector, single = true, collected = []) {
    const parts = selector.trim().split(/\s+/);
    // Simple recursive selector matcher for #id, .class, tag, and hierarchical
    const checkNode = (node, part) => {
      if (!node || !node.tagName) return false;
      if (part.startsWith('#')) {
        return node.id === part.slice(1);
      } else if (part.startsWith('.')) {
        return node.classList.contains(part.slice(1));
      } else if (part.includes('[')) {
        const attrName = part.slice(part.indexOf('[') + 1, part.indexOf(']'));
        return node.hasAttribute(attrName);
      } else {
        return node.tagName.toLowerCase() === part.toLowerCase();
      }
    };

    if (parts.length === 1) {
      for (const child of root.children) {
        if (checkNode(child, parts[0])) {
          if (single) return child;
          collected.push(child);
        }
        const sub = this._matchSelector(child, selector, single, collected);
        if (single && sub) return sub;
      }
      return single ? null : collected;
    } else {
      // Multi-part selector (e.g., "#secondary #secondary-inner")
      const firstPart = parts[0];
      const restPart = parts.slice(1).join(' ');
      const matchFirst = (node) => {
        for (const child of node.children) {
          if (checkNode(child, firstPart)) {
            const sub = this._matchSelector(child, restPart, single, collected);
            if (single && sub) return sub;
          }
          const nested = matchFirst(child);
          if (single && nested) return nested;
        }
        return single ? null : collected;
      };
      return matchFirst(root);
    }
  }

  getBoundingClientRect() {
    return {
      top: 0,
      left: 0,
      width: this.clientWidth || this.offsetWidth || 0,
      height: this.clientHeight || this.offsetHeight || 0,
      bottom: this.clientHeight || this.offsetHeight || 0,
      right: this.clientWidth || this.offsetWidth || 0
    };
  }
}

class MockDocument {
  constructor() {
    this.body = new MockElement('BODY', this);
    this.body.isConnected = true;
    this.head = new MockElement('HEAD', this);
    this.head.isConnected = true;
    this.title = 'YouTube';
    this.eventListeners = new Map();
  }

  createElement(tag) {
    return new MockElement(tag, this);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }

  querySelector(selector) {
    if (selector === 'body') return this.body;
    if (selector === 'head') return this.head;
    return this.body.querySelector(selector) || this.head.querySelector(selector);
  }

  querySelectorAll(selector) {
    const fromBody = this.body.querySelectorAll(selector);
    const fromHead = this.head.querySelectorAll(selector);
    return [...fromBody, ...fromHead];
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (this.eventListeners.has(type)) {
      this.eventListeners.set(type, this.eventListeners.get(type).filter(l => l !== listener));
    }
  }

  dispatchEvent(event) {
    event.target = this;
    if (this.eventListeners.has(event.type)) {
      for (const listener of this.eventListeners.get(event.type)) {
        listener.call(this, event);
      }
    }
    return !event.defaultPrevented;
  }
}

class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
    MockResizeObserver.instances.push(this);
  }

  observe(element) {
    this.observed.add(element);
  }

  unobserve(element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
  }

  trigger(element, height, width = 640) {
    if (this.observed.has(element)) {
      element.clientHeight = height;
      element.offsetHeight = height;
      element.scrollHeight = height;
      element.clientWidth = width;
      element.offsetWidth = width;
      const entry = {
        target: element,
        contentRect: { height, width, top: 0, left: 0, right: width, bottom: height },
        borderBoxSize: [{ blockSize: height, inlineSize: width }]
      };
      this.callback([entry], this);
    }
  }
}
MockResizeObserver.instances = [];
MockResizeObserver.reset = () => { MockResizeObserver.instances = []; };

class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = new Map();
    MockMutationObserver.instances.push(this);
  }
  observe(target, options) {
    this.observed.set(target, options);
  }
  disconnect() {
    this.observed.clear();
  }
  trigger(mutations = []) {
    this.callback(mutations, this);
  }
}
MockMutationObserver.instances = [];
MockMutationObserver.reset = () => { MockMutationObserver.instances = []; };

class MockCustomEvent {
  constructor(type, eventInitDict = {}) {
    this.type = type;
    this.detail = eventInitDict.detail || null;
    this.bubbles = eventInitDict.bubbles || false;
    this.cancelable = eventInitDict.cancelable || false;
    this.defaultPrevented = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
}

function createDOMEnvironment(initialUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') {
  MockResizeObserver.reset();
  MockMutationObserver.reset();

  const doc = new MockDocument();
  const windowListeners = new Map();

  const win = {
    location: new URL(initialUrl),
    document: doc,
    ResizeObserver: MockResizeObserver,
    MutationObserver: MockMutationObserver,
    CustomEvent: MockCustomEvent,
    Event: MockCustomEvent,
    URL: URL,
    URLSearchParams: URLSearchParams,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    addEventListener: (type, listener) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    removeEventListener: (type, listener) => {
      if (windowListeners.has(type)) {
        windowListeners.set(type, windowListeners.get(type).filter(l => l !== listener));
      }
    },
    dispatchEvent: (event) => {
      event.target = win;
      if (windowListeners.has(event.type)) {
        for (const listener of windowListeners.get(event.type)) {
          listener.call(win, event);
        }
      }
      return !event.defaultPrevented;
    }
  };

  return { doc, win, windowListeners };
}

function setupYouTubeDOM(doc, options = {}) {
  // Primary container with video player
  const primary = doc.createElement('div');
  primary.id = 'primary';

  const playerContainer = doc.createElement('div');
  playerContainer.id = 'player';

  const moviePlayer = doc.createElement('div');
  moviePlayer.id = 'movie_player';
  moviePlayer.clientHeight = options.playerHeight || 480;
  moviePlayer.offsetHeight = options.playerHeight || 480;
  moviePlayer.scrollHeight = options.playerHeight || 480;

  playerContainer.appendChild(moviePlayer);
  primary.appendChild(playerContainer);

  // Title elements
  const titleContainer = doc.createElement('h1');
  titleContainer.className = 'ytd-watch-metadata';
  const titleText = doc.createElement('span');
  titleText.textContent = options.videoTitle || 'Rick Astley - Never Gonna Give You Up';
  titleContainer.appendChild(titleText);
  primary.appendChild(titleContainer);

  // Secondary sidebar
  const secondary = doc.createElement('div');
  secondary.id = 'secondary';

  const secondaryInner = doc.createElement('div');
  secondaryInner.id = 'secondary-inner';

  const related = doc.createElement('div');
  related.id = 'related';
  secondaryInner.appendChild(related);
  secondary.appendChild(secondaryInner);

  doc.body.appendChild(primary);
  doc.body.appendChild(secondary);

  return { primary, playerContainer, moviePlayer, titleContainer, secondary, secondaryInner, related };
}

module.exports = {
  createDOMEnvironment,
  setupYouTubeDOM,
  MockElement,
  MockDocument,
  MockResizeObserver,
  MockMutationObserver,
  MockCustomEvent
};
