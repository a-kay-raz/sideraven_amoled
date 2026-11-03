// Sideraven True #000000 AMOLED Dark Mode Content Script
// Gate: this script runs whenever the extension is enabled. Whether the page
// actually goes AMOLED is decided here, live, from prefers-color-scheme, so
// a theme change in Settings applies without an app restart. Light mode
// leaves the page exactly as the site designed it. No per-site toggle: this
// is a global on/off by colour scheme only.
(function () {
  'use strict';

  const SKIP_TAGS = new Set([
    'IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SVG', 'PATH', 'CIRCLE',
    'RECT', 'IFRAME', 'SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD',
    'NOSCRIPT', 'SOURCE', 'TRACK', 'AUDIO', 'OBJECT', 'EMBED'
  ]);

  const SURFACE_TAGS = new Set([
    'ASIDE', 'NAV', 'DIALOG', 'FIELDSET', 'FORM', 'BLOCKQUOTE'
  ]);

  const SELECTOR =
    'body, div, main, section, article, aside, header, footer, nav, ' +
    'ul, ol, li, table, tr, td, th, form, fieldset, dialog, p, span, ' +
    'a, button, input, select, textarea, label, ' +
    'h1, h2, h3, h4, h5, h6';

  // Replaced wholesale on every off->on switch so a page changed while
  // AMOLED was off gets a full fresh scan instead of stale "processed" marks.
  let processedNodes = new WeakSet();
  const queue = [];
  let frameScheduled = false;
  let isAmoledOn = false;
  let amoledStyle = null;
  let addedMeta = null;

  const FALLBACK_CSS =
    'html, body { background-color: #000000 !important; color: #e4e4e7 !important; }';

  function ensureMetaDarkScheme() {
    if (!document.documentElement) return;
    document.documentElement.style.setProperty('color-scheme', 'dark', 'important');
    document.documentElement.style.setProperty('background-color', '#000000', 'important');

    if (document.head && !addedMeta && !document.querySelector('meta[name="color-scheme"]')) {
      const meta = document.createElement('meta');
      meta.name = 'color-scheme';
      meta.content = 'dark';
      document.head.prepend(meta);
      addedMeta = meta;
    }
  }

  function clearMetaDarkScheme() {
    if (document.documentElement) {
      document.documentElement.style.removeProperty('color-scheme');
      document.documentElement.style.removeProperty('background-color');
    }
    if (addedMeta) {
      addedMeta.remove();
      addedMeta = null;
    }
  }

  function getCssUrl() {
    try {
      if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL) {
        return browser.runtime.getURL('amoled_dark.css');
      }
    } catch (_) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL('amoled_dark.css');
      }
    } catch (_) {}
    return null;
  }

  async function ensureAmoledStyle() {
    if (amoledStyle) return;
    let cssText = FALLBACK_CSS;
    const url = getCssUrl();
    if (url) {
      try {
        const res = await fetch(url);
        if (res.ok) cssText = await res.text();
      } catch (_) {
        // Fall back to the minimal black style below; the page still goes
        // black instead of failing open to white.
      }
    }
    if (!isAmoledOn) return;
    const style = document.createElement('style');
    style.id = 'sideraven-amoled-style';
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
    amoledStyle = style;
  }

  function removeAmoledStyle() {
    if (amoledStyle) {
      amoledStyle.remove();
      amoledStyle = null;
    }
  }

  function clearAmoledMarks() {
    const marked = document.querySelectorAll(
      '[data-sideraven-amoled], [data-sideraven-amoled-text]'
    );
    for (let i = 0; i < marked.length; i++) {
      const el = marked[i];
      processedNodes.delete(el);
      el.removeAttribute('data-sideraven-amoled');
      el.removeAttribute('data-sideraven-amoled-text');
    }
    clearMetaDarkScheme();
  }

  function parseRgb(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') {
      return null;
    }
    const m = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    // Preserve translucent / glassmorphism headers & overlays
    if (a < 0.72) return null;
    return {
      r: parseInt(m[1], 10),
      g: parseInt(m[2], 10),
      b: parseInt(m[3], 10),
      a: a
    };
  }

  function processElement(el) {
    if (!isAmoledOn) return;
    if (!el || el.nodeType !== 1 || SKIP_TAGS.has(el.tagName) || processedNodes.has(el)) return;
    processedNodes.add(el);

    try {
      const style = window.getComputedStyle(el);
      const bgImg = style.backgroundImage;
      const hasImageBg = bgImg && bgImg !== 'none' && !bgImg.startsWith('linear-gradient') && !bgImg.startsWith('radial-gradient');

      if (!hasImageBg) {
        const bg = parseRgb(style.backgroundColor);
        if (bg) {
          const maxC = Math.max(bg.r, bg.g, bg.b);
          const minC = Math.min(bg.r, bg.g, bg.b);
          const saturation = maxC - minC;
          const lum = 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b;

          // Any opaque low-saturation background goes black. The old code
          // left mid greys (luminance 59-110) untouched, leaving grey
          // patches on an otherwise pure-black page.
          if (saturation < 45 && lum > 2) {
            const isSmallSurface = SURFACE_TAGS.has(el.tagName) || el.getAttribute('role') === 'dialog';
            el.setAttribute('data-sideraven-amoled', isSmallSurface ? 'surface' : 'bg');
          } else {
            el.removeAttribute('data-sideraven-amoled');
          }
        } else {
          el.removeAttribute('data-sideraven-amoled');
        }
      } else {
        el.removeAttribute('data-sideraven-amoled');
      }

      const fg = parseRgb(style.color);
      if (fg) {
        const fgLum = 0.2126 * fg.r + 0.7152 * fg.g + 0.0722 * fg.b;
        // Dark and mid-grey text on black is hard to read; lightening up
        // to luminance 128 keeps true secondary greys grey, brightens the
        // rest. Removing the attribute when the text is already light
        // makes re-processing after a style change correct.
        if (fgLum < 128) {
          el.setAttribute('data-sideraven-amoled-text', 'light');
        } else {
          el.removeAttribute('data-sideraven-amoled-text');
        }
      } else {
        el.removeAttribute('data-sideraven-amoled-text');
      }
    } catch (_) {
      // Ignore cross-origin or detached node errors
    }
  }

  function flushQueue() {
    frameScheduled = false;
    if (!isAmoledOn) {
      queue.length = 0;
      return;
    }
    const batchSize = 250;
    let count = 0;
    while (queue.length > 0 && count < batchSize) {
      const node = queue.shift();
      processElement(node);
      count++;
    }
    if (queue.length > 0) {
      scheduleFlush();
    }
  }

  function scheduleFlush() {
    if (frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(flushQueue);
  }

  function enqueueShadow(fragment) {
    if (!fragment) return;
    const children = fragment.querySelectorAll(SELECTOR);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!processedNodes.has(child)) {
        queue.push(child);
      }
      if (child.shadowRoot) {
        enqueueShadow(child.shadowRoot);
      }
    }
    if (queue.length > 0) {
      scheduleFlush();
    }
  }

  function enqueueSubtree(root) {
    if (!isAmoledOn) return;
    if (!root || root.nodeType !== 1 || SKIP_TAGS.has(root.tagName)) return;
    if (!processedNodes.has(root)) {
      queue.push(root);
    }
    const children = root.querySelectorAll(SELECTOR);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!processedNodes.has(child)) {
        queue.push(child);
      }
    }
    // Shadow DOM is invisible to querySelectorAll; walk it explicitly so
    // web-component pages recolour instead of staying white inside.
    if (root.shadowRoot) {
      enqueueShadow(root.shadowRoot);
    }
    for (let i = 0; i < children.length; i++) {
      if (children[i].shadowRoot) {
        enqueueShadow(children[i].shadowRoot);
      }
    }
    if (queue.length > 0) {
      scheduleFlush();
    }
  }

  function setAmoled(on) {
    if (on === isAmoledOn) return;
    isAmoledOn = on;
    if (on) {
      // Fresh scan: anything changed while AMOLED was off is re-evaluated.
      processedNodes = new WeakSet();
      ensureMetaDarkScheme();
      ensureAmoledStyle();
      if (document.documentElement) {
        enqueueSubtree(document.documentElement);
      }
    } else {
      queue.length = 0;
      frameScheduled = false;
      removeAmoledStyle();
      clearAmoledMarks();
    }
  }

  const darkQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  setAmoled(darkQuery ? darkQuery.matches : false);

  if (darkQuery) {
    if (typeof darkQuery.addEventListener === 'function') {
      darkQuery.addEventListener('change', (e) => setAmoled(e.matches));
    } else if (typeof darkQuery.addListener === 'function') {
      darkQuery.addListener((e) => setAmoled(e.matches));
    }
  }

  function onReady() {
    if (!isAmoledOn) return;
    ensureMetaDarkScheme();
    ensureAmoledStyle();
    if (document.documentElement) {
      enqueueSubtree(document.documentElement);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { passive: true });
  } else {
    onReady();
  }

  window.addEventListener('load', onReady, { passive: true });

  function startObserver() {
    if (!document.documentElement) return;
    const observer = new MutationObserver((mutations) => {
      if (!isAmoledOn) return;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (n.nodeType === 1) {
              enqueueSubtree(n);
            } else if (n.nodeType === 11) {
              enqueueShadow(n);
            }
          }
        } else if (m.type === 'attributes') {
          // Class/style changes (SPA theme switches, hover states, tabs)
          // used to be ignored forever because the node was already
          // marked processed. Re-queue it so it is re-evaluated.
          const target = m.target;
          if (target && target.nodeType === 1) {
            processedNodes.delete(target);
            enqueueSubtree(target);
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver, { passive: true });
  }
})();
