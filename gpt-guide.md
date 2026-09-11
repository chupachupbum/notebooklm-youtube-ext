Yes — **this is very possible with a Chrome/Chromium extension**, and your NotebookLM idea is actually a good use case for it.

The important distinction is:

> You don't need to "fake a browser." You can let the extension control a real NotebookLM tab, manipulate its DOM, click buttons, enter text, wait for results, and read the response.

Chrome extensions explicitly support injecting scripts into pages and interacting with tabs. ([Chrome for Developers][1])

### What you could build

For example, your extension could expose something like:

```text
NotebookLM Controller
────────────────────────

Notebook: My Research

Sources
  [+ Add source]
  [x] paper.pdf
  [x] article.html
  [x] youtube-video

Question:
┌──────────────────────────────┐
│ What are the main findings?  │
└──────────────────────────────┘

[Ask]

Answer:
The main findings are...
```

But **NotebookLM itself could remain in another tab**, potentially in the background.

The flow would be roughly:

```text
Your extension UI
       │
       ▼
background/service worker
       │
       ▼
find/create NotebookLM tab
       │
       ▼
content script
       │
       ├── click "Add source"
       ├── upload/select source
       ├── click/remove source
       ├── type question
       ├── click Ask
       ├── wait for answer
       └── extract answer
       │
       ▼
return result to extension UI
```

### "Without it even show up?"

**Mostly yes, but there are several meanings of "not show up."**

#### 1. NotebookLM tab exists but isn't the active tab

Definitely.

Your extension can create/find a tab and operate on it while you're looking at another tab.

For example:

```js
const tab = await chrome.tabs.create({
    url: "https://notebooklm.google.com/",
    active: false
});
```

Then your extension can inject/run code against that tab.

Chrome provides APIs specifically for managing tabs and injecting scripts. ([Chrome for Developers][2])

So you could be browsing:

```text
You are looking at:
┌──────────────────────────────┐
│ GitHub                       │
│                              │
│ ...                          │
└──────────────────────────────┘

          meanwhile

NotebookLM tab
     ↓
automatically operated by extension
```

You don't have to watch it.

---

#### 2. Completely hidden tab

This is more complicated.

You can't simply have an ordinary webpage running in a magical invisible browser window. But Chrome extensions have mechanisms such as **offscreen documents**, and there is also the `chrome.debugger` API for controlling a tab at a much lower level. ([Chrome for Developers][3])

However, for NotebookLM, I would **not start with this**.

I'd first make:

```text
Extension
   ↓
background tab
   ↓
NotebookLM
```

because it's considerably easier to debug.

Once everything works, you can investigate whether you can make the interaction more invisible.

---

## The really interesting part: you don't necessarily need to click everything

There are actually **three levels** you could implement.

### Level 1 — DOM automation

This is the easiest.

Your content script does things like:

```js
document.querySelector('[aria-label="Add source"]').click();
```

Then:

```js
const input = document.querySelector('textarea');
input.value = question;
input.dispatchEvent(new Event('input', { bubbles: true }));
```

Then click the submit button.

And observe the DOM until NotebookLM generates the answer.

This is essentially what an agent like your Antigravity skill is doing.

---

### Level 2 — inspect NotebookLM's network traffic

This could potentially be much more powerful.

Instead of:

```text
click button
    ↓
wait
    ↓
read DOM
```

you could investigate what NotebookLM sends/receives internally:

```text
Extension
    │
    ├── observe network request
    │
    ├── identify source-upload request
    │
    ├── identify question request
    │
    └── identify response
```

Chrome extensions have APIs for observing network activity, and `chrome.debugger` can attach to a tab and interact with the Chrome DevTools Protocol. ([Chrome for Developers][4])

**But I wouldn't build the first version this way.**

NotebookLM's internal APIs are undocumented and could change at any time.

DOM automation is ugly, but often surprisingly effective.

---

### Level 3 — combine both

This is probably what I'd eventually build:

```text
             Your Extension
                   │
          ┌────────┴────────┐
          │                 │
       NotebookLM        Extension UI
       controller
          │
     ┌────┴─────┐
     │          │
    DOM       Network
 automation   observation
     │          │
     └────┬─────┘
          │
       NotebookLM
```

Use DOM interaction where necessary, and network observation where it gives you reliable state/results.

---

# There's another important possibility

You could make the extension behave almost like an **API for NotebookLM**.

For example, your extension could expose an internal interface:

```js
await notebook.addSource(file);

await notebook.removeSource(sourceId);

const answer = await notebook.ask(
    "What are the three most important conclusions?"
);

console.log(answer);
```

Then your actual UI doesn't need to know anything about NotebookLM.

Architecture:

```text
                    ┌───────────────────────┐
                    │    Your Extension     │
                    │                       │
                    │  NotebookLM API       │
                    │                       │
                    │  addSource()           │
                    │  removeSource()        │
                    │  ask()                │
                    │  getSources()         │
                    └───────────┬───────────┘
                                │
                         controller.js
                                │
                                ▼
                    ┌───────────────────────┐
                    │    NotebookLM Tab     │
                    │                       │
                    │  DOM automation       │
                    │  state detection      │
                    │  response extraction  │
                    └───────────────────────┘
```

Then you could have a **side panel** as the UI rather than modifying NotebookLM itself. Chrome extensions support side panels as an extension UI. ([Chrome for Developers][1])

That would make the experience quite nice:

```text
┌──────────────────────────────────────────────┐
│ Chrome                                      │
│                                              │
│  GitHub / browser / whatever                 │
│                                              │
│                              ┌─────────────┐ │
│                              │ NotebookLM  │ │
│                              │ Controller  │ │
│                              │             │ │
│                              │ Sources: 3  │ │
│                              │             │ │
│                              │ Ask:        │ │
│                              │ __________  │ │
│                              │             │ │
│                              │ [Ask]       │ │
│                              │             │ │
│                              │ Answer...   │ │
│                              └─────────────┘ │
└──────────────────────────────────────────────┘
```

Meanwhile NotebookLM itself could be sitting in an inactive tab.

---

## One big caveat: authentication

The extension doesn't magically get NotebookLM access.

The simplest situation is:

```text
Chrome
  ↓
you are already logged into Google
  ↓
NotebookLM works normally
  ↓
extension controls that authenticated tab
```

That's actually a major advantage over trying to implement a NotebookLM API yourself.

You don't need to handle:

* Google OAuth
* passwords
* cookies manually
* Google session tokens

The browser already has the authenticated session.

---

## Another caveat: NotebookLM's UI can change

This is probably the biggest technical weakness.

If today you have:

```html
<button aria-label="Add source">
```

and Google changes it tomorrow to:

```html
<button data-action="source-upload">
```

your automation breaks.

So I would **not** write something like:

```js
document.querySelector(
    "#some-random-class > div:nth-child(3) > button"
)
```

Instead build a robust selector/recognition layer:

```js
findAddSourceButton()
findQuestionInput()
findAskButton()
findAnswerContainer()
findSourceList()
```

Then all NotebookLM-specific ugliness stays in one module.

---

# And your Antigravity experience is actually useful here

Since you've already had an Antigravity skill successfully do:

> add/remove source → ask question → retrieve answer

I'd use that as the **reference behavior**.

You essentially want to turn:

```text
Antigravity agent
       ↓
browser automation
       ↓
NotebookLM
```

into:

```text
Chrome Extension
       ↓
browser automation
       ↓
NotebookLM
```

The extension doesn't need to reproduce the entire agent architecture.

It can be much simpler:

```text
          ┌───────────────────┐
          │ Chrome Extension  │
          ├───────────────────┤
          │ UI                │
          │ NotebookLM API    │
          │ Controller        │
          │ DOM adapter       │
          └─────────┬─────────┘
                    │
                    ▼
             NotebookLM tab
```

**I think this is quite feasible**, and I'd actually recommend starting with a tiny proof-of-concept:

```js
await notebookLM.open();

await notebookLM.addSource(file);

await notebookLM.ask("...");

const answer = await notebookLM.waitForAnswer();

console.log(answer);
```

Once those five operations work reliably, the rest of the extension is mostly UI and state management.

One thing I'd investigate early, though, is **how your existing Antigravity NotebookLM skill performs those operations**. If you show me the skill/code (or upload it), I can help map each operation to a Chrome-extension implementation and figure out whether DOM automation, CDP/network interception, or a hybrid approach is best.

[1]: https://developer.chrome.com/docs/extensions?utm_source=chatgpt.com "Chrome Extensions  |  Chrome for Developers"
[2]: https://developer.chrome.com/docs/extensions/reference/api?authuser=2&utm_source=chatgpt.com "API reference  |  Chrome for Developers"
[3]: https://developer.chrome.com/docs/extensions/mv2/reference/runtime?utm_source=chatgpt.com "chrome.runtime  |  Reference  |  Chrome for Developers"
[4]: https://developer.chrome.com/docs/extensions/reference/api/debugger?hl=en&utm_source=chatgpt.com "chrome.debugger  |  API  |  Chrome for Developers"
