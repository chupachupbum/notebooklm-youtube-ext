/**
 * Markdown parser and citation sanitizer for NotebookLM YouTube Summarizer.
 * Lightweight, zero-dependency, and compliant with Chrome MV3 CSP.
 */
(function(global) {
  'use strict';

  /**
   * Escape HTML special characters to prevent XSS.
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Strip citation brackets and markers (e.g., [1], [1, 2], [1-3], 【1】).
   */
  function stripCitations(text) {
    if (!text) return '';
    return text
      .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, '')
      .replace(/【\s*\d+(?:\s*[,–-]\s*\d+)*\s*】/g, '')
      .replace(/\s+([.,;:!?])/g, '$1') // Clean up space left before punctuation
      .replace(/[ \t]{2,}/g, ' ');     // Clean up multiple spaces
  }

  /**
   * Parse inline markdown (bold, italic, inline code).
   * Assumes input text is already HTML-escaped.
   */
  function parseInline(text) {
    if (!text) return '';

    // Inline code: `code`
    text = text.replace(/`([^`]+)`/g, '<code class="nlm-inline-code">$1</code>');

    // Bold + Italic: ***text*** or ___text___
    text = text.replace(/(\*\*\*|___)(.*?)\1/g, '<strong><em>$2</em></strong>');

    // Bold: **text** or __text__
    text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');

    // Italic: *text* or _text_ (ensure not matching inside words for underscore)
    text = text.replace(/(^|[^\w])(\*|_)(?!\s)(.*?)(?!\s)\2([^\w]|$)/g, '$1<em>$3</em>$4');

    return text;
  }

  /**
   * Main function: Parse markdown string to HTML.
   */
  function renderMarkdown(rawText) {
    if (!rawText) return '';

    // 1. Strip citation numbers first
    const cleaned = stripCitations(rawText.trim());

    // Split into lines
    const lines = cleaned.split(/\r?\n/);
    const htmlBlocks = [];

    let currentList = null; // { type: 'ul' | 'ol', items: [] }
    let currentParagraph = [];

    function flushParagraph() {
      if (currentParagraph.length > 0) {
        const pText = currentParagraph.map(p => parseInline(escapeHtml(p))).join('<br>');
        htmlBlocks.push(`<p class="nlm-paragraph">${pText}</p>`);
        currentParagraph = [];
      }
    }

    function flushList() {
      if (currentList) {
        const tag = currentList.type;
        const itemsHtml = currentList.items
          .map(item => `<li class="nlm-list-item">${parseInline(escapeHtml(item))}</li>`)
          .join('');
        htmlBlocks.push(`<${tag} class="nlm-list nlm-${tag}">${itemsHtml}</${tag}>`);
        currentList = null;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Blank line: flushes current paragraph or list
      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      // Headers: # H1, ## H2, ### H3, #### H4
      const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headerMatch) {
        flushParagraph();
        flushList();
        const level = headerMatch[1].length;
        const title = headerMatch[2].trim();
        htmlBlocks.push(`<h${level} class="nlm-heading nlm-h${level}">${parseInline(escapeHtml(title))}</h${level}>`);
        continue;
      }

      // Stand-alone bold heading: **Heading Title** or **Heading Title:**
      const boldHeadingMatch = trimmed.match(/^\*\*([^*]+)\*\*:?$/);
      if (boldHeadingMatch) {
        flushParagraph();
        flushList();
        htmlBlocks.push(`<h3 class="nlm-heading nlm-h3">${parseInline(escapeHtml(boldHeadingMatch[1].trim()))}</h3>`);
        continue;
      }

      // Horizontal rule: --- or ***
      if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
        flushParagraph();
        flushList();
        htmlBlocks.push('<hr class="nlm-divider">');
        continue;
      }

      // Unordered list item: * item, - item, + item, • item
      const ulMatch = trimmed.match(/^[-*+•]\s+(.+)$/);
      if (ulMatch) {
        flushParagraph();
        if (!currentList || currentList.type !== 'ul') {
          flushList();
          currentList = { type: 'ul', items: [] };
        }
        currentList.items.push(ulMatch[1].trim());
        continue;
      }

      // Ordered list item: 1. item
      const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (olMatch) {
        flushParagraph();
        if (!currentList || currentList.type !== 'ol') {
          flushList();
          currentList = { type: 'ol', items: [] };
        }
        currentList.items.push(olMatch[2].trim());
        continue;
      }

      // Blockquote: > quote
      const bqMatch = trimmed.match(/^>\s*(.+)$/);
      if (bqMatch) {
        flushParagraph();
        flushList();
        htmlBlocks.push(`<blockquote class="nlm-blockquote">${parseInline(escapeHtml(bqMatch[1].trim()))}</blockquote>`);
        continue;
      }

      // Normal paragraph line
      if (currentList) {
        // If line is indented or continues previous list item
        if (/^\s{2,}/.test(line)) {
          const lastIdx = currentList.items.length - 1;
          if (lastIdx >= 0) {
            currentList.items[lastIdx] += ' ' + trimmed;
            continue;
          }
        }
        flushList();
      }

      currentParagraph.push(trimmed);
    }

    flushParagraph();
    flushList();

    return htmlBlocks.join('\n');
  }

  // Export functions to global scope
  const NLM_Markdown = {
    renderMarkdown,
    stripCitations,
    escapeHtml,
    parseInline
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NLM_Markdown;
  } else {
    global.NLM_Markdown = NLM_Markdown;
  }
})(typeof window !== 'undefined' ? window : this);
