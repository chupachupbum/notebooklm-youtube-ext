# NotebookLM YouTube Summarizer — Chrome Extension

A Chrome extension that summarizes YouTube videos using Google NotebookLM without leaving YouTube. Opens a side panel on YouTube pages, sends the video URL to a dedicated NotebookLM notebook via DOM automation on a background tab, and returns a comprehensive summary with limitations.

## Design Decisions (from interview)

| Decision            | Choice                                                                             |
| ------------------- | ---------------------------------------------------------------------------------- |
| UI surface          | Side panel                                                                         |
| Notebook strategy   | Single dedicated notebook, configured once                                         |
| Automation approach | DOM automation (Level 1)                                                           |
| Authentication      | Rely on existing browser session (user already logged into Google)                 |
| Workflow            | Add source → Ask summary → Ask limitations → Follow-up Q&A → Cleanup on "Done" |
| Source cleanup      | Remove source after session ends                                                   |
| Summary storage     | chrome.storage.local (Obsidian export deferred)                                    |
| Quality indicator   | NotebookLM-generated limitations via follow-up question                            |
| Manifest version    | V3 (service worker)                                                                |
| Frontend stack      | Vanilla JS + HTML/CSS (no framework)                                               |
| NotebookLM tab      | Background tab (`active: false`)                                                 |
| Follow-up questions | Yes, conversational Q&A after summary                                              |
| Distribution        | Personal use, load unpacked                                                        |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Chrome Browser                                                   │
│                                                                  │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐ │
│  │ YouTube Tab (active)│    │ NotebookLM Tab (background)      │ │
│  │                     │    │                                  │ │
│  │  ┌───────────────┐  │    │  content-notebooklm.js           │ │
│  │  │ Side Panel    │  │    │  ├── findAddSourceButton()       │ │
│  │  │               │  │    │  ├── addYouTubeSource(url)       │ │
│  │  │ [Summarize]   │──┼────│  ├── typeQuestion(q)             │ │
│  │  │               │  │    │  ├── clickAsk()                  │ │
│  │  │ Summary...    │◄─┼────│  ├── waitForAnswer()             │ │
│  │  │               │  │    │  ├── extractAnswer()             │ │
│  │  │ ⚠ Limits...   │  │    │  └── removeSource()              │ │
│  │  │               │  │    │                                  │ │
│  │  │ Ask follow-up │  │    └──────────────────────────────────┘ │
│  │  │ [________]    │  │                                         │
│  │  │ [Done]        │  │    ┌──────────────────────────────────┐ │
│  │  └───────────────┘  │    │ Service Worker (background.js)   │ │
│  │                     │    │  ├── tab management              │ │
│  └─────────────────────┘    │  ├── message routing             │ │
│                             │  └── chrome.storage              │ │
│                             └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### File Structure

```
notebooklm-ext/
├── manifest.json                  # MV3 manifest
├── background.js                  # Service worker: tab management, message routing
├── sidepanel/
│   ├── sidepanel.html             # Side panel UI
│   ├── sidepanel.css              # Styles
│   └── sidepanel.js               # Side panel logic
├── content/
│   └── notebooklm-controller.js   # Content script injected into NotebookLM tab
├── lib/
│   ├── selectors.js               # All NotebookLM DOM selectors in one place
│   └── storage.js                 # chrome.storage.local wrapper
└── icons/                         # Placeholder icons (16, 48, 128)
```

---

## Phased Implementation

### Phase 1 — Proof of Concept: Manual Flow

> **Goal:** Prove that DOM automation works end-to-end from a Chrome extension.

#### [NEW] `manifest.json`

MV3 manifest with:

- `permissions`: `sidePanel`, `activeTab`, `tabs`, `storage`, `scripting`
- `host_permissions`: `https://notebooklm.google.com/*`, `https://www.youtube.com/*`
- `side_panel.default_path`: `sidepanel/sidepanel.html`
- `content_scripts`: inject `notebooklm-controller.js` into `notebooklm.google.com`
- `background.service_worker`: `background.js`

#### [NEW] `background.js`

Service worker that:

- Opens/finds the NotebookLM tab (creates with `active: false` if not found)
- Routes messages between side panel ↔ NotebookLM content script
- Manages the lifecycle: `IDLE → ADDING_SOURCE → ASKING → WAITING → DONE`

#### [NEW] `sidepanel/sidepanel.html` + `sidepanel.css` + `sidepanel.js`

Minimal side panel UI:

- "Settings" section: input for NotebookLM notebook URL (saved to `chrome.storage.local`)
- "Summarize this video" button (extracts current YouTube tab URL)
- Loading spinner with status messages ("Adding source...", "Asking NotebookLM...", "Waiting for answer...")
- Summary display area (rendered as formatted text)
- Error states ("Not on a YouTube page", "NotebookLM not logged in", "Timeout")

#### [NEW] `content/notebooklm-controller.js`

Content script injected into NotebookLM pages. Implements the NotebookLM DOM API:

- `addSource(url)` — clicks "Add source" → selects YouTube/URL → pastes link → confirms
- `typeQuestion(text)` — finds the chat input, types the question
- `clickAsk()` — clicks the send/ask button
- `waitForAnswer()` — polls the DOM for the response container, waits for streaming to finish
- `extractAnswer()` — reads the response text from the DOM
- `removeSource(sourceId)` — finds and removes a specific source

> [!IMPORTANT]
> All DOM selectors will be centralized and use a robust fallback strategy (aria-labels, data attributes, text content matching) since NotebookLM's DOM can change.

#### Verification

- Load extension unpacked in Chrome
- Navigate to a YouTube video
- Open side panel → click Summarize
- Confirm: NotebookLM tab opens in background, source is added, question is asked, answer appears in side panel

---

### Phase 2 — Complete Workflow

> **Goal:** Full summary + limitations + follow-up Q&A + history

#### [MODIFY] `sidepanel/sidepanel.js` + `sidepanel.html`

- After summary arrives, automatically send the limitations question
- Display summary + "⚠️ Limitations" section
- Add follow-up question input + send button (appears after summary)
- Add "Done" button that triggers source cleanup
- Add "History" tab showing past summaries (video title, date, link to re-read)

#### [MODIFY] `content/notebooklm-controller.js`

- Support sequential questions (summary → limitations → follow-ups) without re-adding source
- Detect when NotebookLM is still streaming vs. finished (watch for typing indicator disappearing)
- Robust error recovery: retry if DOM element not found, timeout after configurable period

#### [NEW] `lib/storage.js`

Storage wrapper:

- `saveSummary({ videoUrl, videoTitle, summary, limitations, followUps, timestamp })`
- `getSummary(videoUrl)` — returns cached summary if already summarized
- `getHistory()` — returns all past summaries, newest first
- `deleteSummary(videoUrl)`

#### [MODIFY] `background.js`

- Cache-first logic: if video already summarized, show cached result immediately with "Re-summarize" option
- Handle "Done" signal: trigger source removal in NotebookLM tab
- Handle follow-up messages: forward to content script, relay answers back

#### Verification

- Full cycle works: summary + limitations + follow-up + cleanup
- History persists across browser restarts
- Cached summaries load instantly
- Follow-up questions work correctly

---

### Phase 3 — Polish & Reliability

> **Goal:** Handle edge cases, improve UX, make it robust for daily use.

#### [MODIFY] `content/notebooklm-controller.js`

- Robust selector layer: multiple fallback selectors per element, auto-detection when NotebookLM UI changes
- Better answer-complete detection (watch for CSS class changes, streaming indicators)
- Handle NotebookLM errors (rate limiting, source ingestion failures, "unable to process" responses)
- Handle authentication failures (detect login page redirect, notify user)

#### [MODIFY] `sidepanel/` (all files)

- Markdown rendering for summaries (headers, lists, bold from NotebookLM responses)
- Copy-to-clipboard button for the summary
- "Open in NotebookLM" link to jump to the notebook
- Better loading UX with progress steps
- Dark mode support (match YouTube's theme)
- Responsive design for different side panel widths

#### [MODIFY] `background.js`

- Tab lifecycle management: reuse existing NotebookLM tab if still open
- Handle service worker termination/restart (MV3 service workers are ephemeral)
- Queue management: if user clicks Summarize while another summary is in progress

#### [NEW] `lib/selectors.js`

Extract all DOM selectors into a dedicated module with:

- Primary and fallback selectors for each NotebookLM element
- Version detection (if NotebookLM changes its UI)
- Logging when selectors fail (for debugging)

#### Verification

- Works reliably across multiple consecutive summaries
- Handles NotebookLM UI changes gracefully
- No orphaned tabs or sources
- Extension survives service worker restarts

---

### Phase 4 (Future) — Advanced Features

> **Goal:** Extend beyond basic summarization.

Items deferred to this phase:

- **Obsidian export**: Native Messaging host to write .md files to vault
- **Custom prompts**: let user configure what question to ask (e.g., "list key takeaways" instead of "comprehensive summary")
- **Batch summarization**: summarize a YouTube playlist
- **Keyboard shortcut**: `Ctrl+Shift+S` to trigger summarize
- **NotebookLM tab hiding**: explore offscreen documents or minimized windows
- **Network observation (Level 2)**: monitor NotebookLM's internal API for more reliable answer detection

---

## Open Questions

> [!IMPORTANT]
> **NotebookLM Source Addition Flow**: I need to investigate the exact DOM steps for adding a YouTube URL as a source in NotebookLM. The flow may be: "Add source" button → "YouTube" or "Website" option → paste URL → "Insert" button. This needs hands-on exploration of the current NotebookLM UI to map the correct selectors. Should we do a quick exploration session first, or start building with placeholder selectors and iterate?

> [!NOTE]
> **Video Title Extraction**: For history/display purposes, we should extract the video title from the YouTube page. This is straightforward from the YouTube DOM (`document.title` or `yt-formatted-string`).

> [!NOTE]
> **Source Ingestion Time**: NotebookLM takes time to process a YouTube video (potentially 10-60 seconds). The extension needs to wait for ingestion to complete before asking questions. The existing Antigravity skill likely handles this — we should study its polling/wait strategy.
