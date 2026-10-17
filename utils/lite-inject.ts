// The script Lite injects into the site's page, and the parsers for the
// messages it sends back.
//
// Blocking works in three layers:
//   1. onShouldStartLoadWithRequest checks every full page load ([site].tsx).
//   2. This script reports URL changes made with history.pushState. Instagram
//      is a single-page app, so most navigation never loads a new page.
//   3. This script hides links to blocked sections with CSS.
import type { LiteSite } from "@/utils/lite-sites";

/** An RGB colour, each channel 0-255. */
export type LiteRgb = { r: number; g: number; b: number };

export type LiteMessage =
  | { type: "nav"; url: string }
  | { type: "reelLimit" }
  | { type: "colors"; top: LiteRgb; bottom: LiteRgb };

/**
 * Injected when the blocked card goes up, since a reel that already started
 * would keep playing audio behind it. The flag keeps pausing videos that
 * start later, until the next page load.
 */
export const PAUSE_ALL_VIDEOS = `
window.__refundLiteBlocked = true;
Array.prototype.forEach.call(document.getElementsByTagName('video'), function (v) {
  try { v.pause(); } catch {}
});
true;
`;

/**
 * Injected when the app comes back after a while: the page stops updating in
 * the background, so new messages and notes wouldn't show. Skipped while a
 * text field has focus, so a half-typed message isn't lost. Only focus is
 * checked, never what's in the field.
 */
export const RELOAD_UNLESS_TYPING = `
(function () {
  const el = document.activeElement;
  const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName));
  if (!typing) location.reload();
})();
true;
`;

/** Longest URL we accept from the page. */
const MAX_URL_LENGTH = 2048;

/**
 * Parses a colour sent by the page. Only "rgb(r, g, b)" and "rgba(r, g, b, a)"
 * with channels 0-255 pass, so the page can only ever hand us three numbers.
 * Alpha is dropped; the script only sends opaque colours.
 */
export function parseLiteColor(value: unknown): LiteRgb | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const match = /^rgba?\((\d{1,3}), ?(\d{1,3}), ?(\d{1,3})(, ?[\d.]+)?\)$/.exec(
    value,
  );
  if (!match) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  if (r > 255 || g > 255 || b > 255) return null;
  return { r, g, b };
}

/** Validates a message from the page. Returns null for anything unexpected. */
export function parseLiteMessage(raw: string): LiteMessage | null {
  try {
    const data = JSON.parse(raw) as {
      type?: unknown;
      url?: unknown;
      top?: unknown;
      bottom?: unknown;
    };
    if (data.type === "reelLimit") return { type: "reelLimit" };
    if (data.type === "colors") {
      const top = parseLiteColor(data.top);
      const bottom = parseLiteColor(data.bottom);
      return top && bottom ? { type: "colors", top, bottom } : null;
    }
    if (
      data.type === "nav" &&
      typeof data.url === "string" &&
      data.url.length <= MAX_URL_LENGTH
    ) {
      return { type: "nav", url: data.url };
    }
  } catch {
    // Not JSON, so not ours.
  }
  return null;
}

/**
 * The bottom bar copy (see LiteBarCopy), in Instagram's own colour variables
 * so it follows dark mode. [data-refund-room] is the chat list's fixed layer,
 * shortened to end above the copy; refund-lite-typing undoes both.
 */
const BAR_COPY_CSS = [
  // Laid out like the site's bar. A hidden button (Reels) leaves an empty
  // slot that still takes its share of the space, as on the site.
  "#refund-lite-bar{position:fixed;left:0;right:0;bottom:0;height:50px;box-sizing:border-box;display:flex;justify-content:space-evenly;align-items:flex-start;z-index:2147483000;",
  "background:rgb(var(--ig-primary-background,255,255,255));border-top:1px solid rgb(var(--ig-elevated-separator,219,219,219));color:rgb(var(--ig-primary-text,0,0,0));}",
  "#refund-lite-bar > div{display:flex;}",
  "#refund-lite-bar a{width:48px;height:48px;display:flex;align-items:center;justify-content:center;color:inherit;-webkit-tap-highlight-color:transparent;}",
  "#refund-lite-bar img{width:24px;height:24px;border-radius:50%;object-fit:cover;}",
  // The current section's icon, filled the way the site fills it.
  "#refund-lite-bar .refund-here svg path,#refund-lite-bar .refund-here svg circle,#refund-lite-bar .refund-here svg polygon{fill:currentColor;}",
  "#refund-lite-bar .refund-here svg line{stroke:rgb(var(--ig-primary-background,255,255,255));}",
  // The site also gives that layer a full-screen height, so cap it.
  "html.refund-lite-copy [data-refund-room]{bottom:50px !important;height:auto !important;min-height:0 !important;max-height:calc(100% - 50px) !important;}",
  "html.refund-lite-typing #refund-lite-bar{display:none !important;}",
  "html.refund-lite-typing [data-refund-room]{bottom:0 !important;max-height:none !important;}",
  // Only the selected (filled) icon was ever seen: draw it as an outline.
  "#refund-lite-bar .refund-outline svg path{fill:none;stroke:currentColor;stroke-width:2;}",
].join("");

/**
 * Builds the injected script for one site. It sends back only the current
 * URL, the page's edge colours and a "reel limit reached" signal. Never page
 * content or anything typed.
 */
export function buildLiteInjection(
  site: LiteSite,
  options: { reelLimit: number },
): string {
  const hideRule = site.hideSelectors.length
    ? `${site.hideSelectors.join(",")}{display:none !important;}`
    : "";
  // An integer 0-99, since it's written straight into the script.
  const reelLimit = Math.max(
    0,
    Math.min(99, Math.floor(options.reelLimit) || 0),
  );
  const styleRules = (site.styleRules ?? []).join("");
  const copyRules = site.barCopy ? BAR_COPY_CSS : "";
  // Written into the script as JS literals; it runs in the page and can't
  // import lite-sites.ts.
  const css = JSON.stringify(hideRule + styleRules + copyRules);
  const barAnchor = JSON.stringify(site.barCopy?.siteBarAnchor ?? "");
  const copyPaths = JSON.stringify(site.barCopy?.copyOnPaths ?? []);
  const listAnchor = JSON.stringify(site.barCopy?.listAnchor ?? "");
  const noScriptPaths = JSON.stringify(site.noScriptPaths ?? []);

  return `
(function () {
  // Errors are caught and dropped throughout: a bug in this script must
  // never break Instagram's own page.

  // Backup for isNoScriptUrl in lite-filter.ts: never run on a login page.
  const path = location.pathname.toLowerCase();
  const onLoginPage = ${noScriptPaths}.some(function (p) {
    return path === p || path.indexOf(p + '/') === 0;
  });
  if (onLoginPage) return;

  if (window.__refundLite) return; // already injected on this page
  window.__refundLite = true;

  // Everything below is off while a password field is on the page, on any URL
  // (Instagram also shows its login form at "/"). Only the field's presence
  // is checked, never its value. name="password" still matches after "Show"
  // makes it type="text"; one-time-code is the 2FA field.
  const PASSWORD_FIELD =
    'input[type="password"],input[name="password"],input[autocomplete="one-time-code"]';
  let off = false;

  function send() {
    if (off) return;
    try {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: 'nav', url: location.href })
      );
    } catch {}
    refreshBarCopy(); // the new screen may need the bar copy, or not
  }

  // Layer 2: URL changes that don't load a page.
  ['pushState', 'replaceState'].forEach(function (name) {
    const original = history[name];
    history[name] = function () {
      const result = original.apply(this, arguments);
      send();
      return result;
    };
  });
  window.addEventListener('popstate', send);
  window.addEventListener('hashchange', send);

  // Edge colours for the safe-area strips the app paints around the page:
  // the first opaque background at y, walking up from the element there.
  function edgeColor(y) {
    let node = document.elementFromPoint(window.innerWidth / 2, y);
    while (node && node.nodeType === 1) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== 'transparent' && !/^rgba\\(.*, 0\\)$/.test(color)) {
        return color;
      }
      node = node.parentElement;
    }
    return null; // nothing opaque: keep the current colour
  }
  let lastColors = '';
  function sendColors() {
    if (off || document.hidden || !document.body) return;
    try {
      const top = edgeColor(0);
      const bottom = edgeColor(window.innerHeight - 1);
      if (!top || !bottom) return;
      const message = JSON.stringify({ type: 'colors', top: top, bottom: bottom });
      if (message === lastColors) return; // only send changes
      lastColors = message;
      window.ReactNativeWebView.postMessage(message);
    } catch {}
  }
  document.addEventListener('DOMContentLoaded', sendColors);
  window.addEventListener('load', sendColors);

  // While the blocked card is up, pause any video that starts. Media events
  // don't bubble, so this listens in the capture phase.
  document.addEventListener('play', function (event) {
    if (off || !window.__refundLiteBlocked) return;
    const video = event.target;
    if (video && video.tagName === 'VIDEO') {
      try { video.pause(); } catch {}
    }
  }, true);

  // DM reel limit. The DM viewer plays reels without changing the URL, so
  // count near-full-screen videos by source URL instead. getBoundingClientRect
  // forces a layout, so only measure on 'playing' or while a counted reel
  // might still be open.
  if (${reelLimit} > 0) {
    let seen = {};
    let count = 0;
    let lastReel = null; // the last video counted
    let lastSeenAt = 0; // when lastReel was last seen full screen

    const isBig = function (video) {
      if (location.pathname.indexOf('/direct/') !== 0) return false;
      const height = window.innerHeight;
      const box = video.getBoundingClientRect();
      return box.height > height * 0.6 && box.bottom > 0 && box.top < height;
    };

    // True once the video is counted, now or earlier.
    const countIfReel = function (video) {
      const key = video.currentSrc || video.src;
      if (!key) return false;
      if (seen[key]) return true;
      if (!isBig(video)) return false;
      seen[key] = true;
      lastReel = video;
      lastSeenAt = Date.now();
      count += 1;
      if (count > ${reelLimit}) {
        Array.prototype.forEach.call(document.getElementsByTagName('video'), function (v) {
          try { v.pause(); } catch {}
        });
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'reelLimit' }));
        } catch {}
      }
      return true;
    };

    // The viewer animates open, so a reel can start small: check again after
    // 300ms and 1s.
    const onPlaying = function (event) {
      if (off) return;
      const video = event.target;
      if (!video || video.tagName !== 'VIDEO') return;
      if (countIfReel(video)) return;
      setTimeout(function () {
        if (countIfReel(video)) return;
        setTimeout(function () { countIfReel(video); }, 700);
      }, 300);
    };
    document.addEventListener('playing', onPlaying, true);

    // Reset once the viewer has been closed for 1.5s (longer than the gap
    // between two reels), so the next conversation starts fresh.
    setInterval(function () {
      if (off || document.hidden || !lastReel) return;
      if (lastReel.isConnected && isBig(lastReel)) { lastSeenAt = Date.now(); return; }
      if (Date.now() - lastSeenAt > 1500) {
        count = 0;
        seen = {};
        lastReel = null;
      }
    }, 500);
  }

  // Layer 3: hide links to blocked sections.
  const css = ${css};
  let style = null;
  if (css) {
    style = document.createElement('style');
    style.id = 'refund-lite-style'; // easy to spot in Web Inspector
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // Bottom bar copy (see LiteBarCopy). Saved from the site's bar on other
  // pages into the page's own storage, and never sent to the app.
  const BAR_ANCHOR = ${barAnchor};
  const COPY_PATHS = ${copyPaths};
  const LIST_ANCHOR = ${listAnchor};
  const BAR_KEY = 'refundLiteBar';
  const BAR_HEIGHT = 50;
  const SAFE_PATH = /^\\/[A-Za-z0-9._\\/-]*$/;
  let siteBar = null; // the site's own bar, once found
  const notInBar = new WeakMap(); // anchor link outside the bar -> when seen
  let savedFor = ''; // path of the last save, to skip repeat writes
  let copy = null; // the copy, while it's in the DOM
  let copyShown = false; // whether <html> has the refund-lite-copy class

  // A note opened over the list keeps the URL but removes LIST_ANCHOR. If
  // the anchor was never seen on this path (layouts vary by account), assume
  // the list is showing: better a bar over a note than none on the list.
  let listSeenOn = '';
  function listShowing() {
    if (!LIST_ANCHOR) return true;
    const el = document.querySelector(LIST_ANCHOR);
    if (el && el.getClientRects().length) {
      listSeenOn = location.pathname;
      return true;
    }
    return listSeenOn !== location.pathname;
  }

  // A friend's note opens over the list without removing it, with its reply
  // box at the bottom. So the copy also hides for any open dialog (even a
  // zero-height wrapper), or any text field near the bottom: under the copy,
  // or just above it in the layer the copy lifts. Only positions are read.
  const OVER_LIST =
    '[role="dialog"],[aria-modal="true"],[role="textbox"],textarea,input[type="text"],input:not([type]),[contenteditable]:not([contenteditable="false"])';
  function somethingOverList() {
    const found = document.querySelectorAll(OVER_LIST);
    for (let i = 0; i < found.length; i++) {
      const el = found[i];
      if ((copy && copy.contains(el)) || !el.getClientRects().length) continue;
      if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') return true;
      const box = el.getBoundingClientRect();
      if (box.height && box.top < window.innerHeight && box.bottom > window.innerHeight - BAR_HEIGHT - 80) return true;
    }
    return false;
  }

  function onCopyPage() {
    const p = location.pathname.toLowerCase();
    return COPY_PATHS.some(function (c) {
      return p === c || p.indexOf(c + '/') === 0;
    });
  }

  // The site's bar is the short fixed strip at the bottom holding BAR_ANCHOR.
  // A match elsewhere is skipped for 1.5s, not for good: while the page
  // boots, the bar can briefly sit inside a bigger fixed layer.
  function findSiteBar() {
    if (siteBar && siteBar.isConnected && siteBar.querySelector(BAR_ANCHOR)) {
      return siteBar;
    }
    siteBar = null;
    const links = document.querySelectorAll(BAR_ANCHOR);
    for (let i = 0; i < links.length; i++) {
      if (copy && copy.contains(links[i])) continue;
      const now = Date.now();
      if (now - (notInBar.get(links[i]) || 0) < 1500) continue;
      let node = links[i].parentElement;
      for (let depth = 0; node && depth < 20; depth++) {
        if (getComputedStyle(node).position === 'fixed') {
          const box = node.getBoundingClientRect();
          if (box.bottom >= window.innerHeight - 2 && box.height <= 120) {
            siteBar = node;
            return node;
          }
          notInBar.set(links[i], now); // fixed, but some other layer
          break;
        }
        node = node.parentElement;
      }
    }
    return null;
  }

  // Copies an SVG through an allow-list of shape tags and attributes, so no
  // scripts, event handlers or links get through.
  const SVG_TAGS = /^(svg|g|path|line|polyline|polygon|circle|ellipse|rect)$/;
  const SVG_ATTRS = /^(viewBox|width|height|d|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|points|fill|fill-rule|clip-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|transform)$/;
  function cleanSvg(node) {
    const tag = String(node.tagName || '').toLowerCase();
    if (!SVG_TAGS.test(tag)) return '';
    let out = '<' + tag;
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i];
      if (SVG_ATTRS.test(attr.name) && !/[<>"&]/.test(attr.value)) {
        out += ' ' + attr.name + '="' + attr.value + '"';
      }
    }
    out += '>';
    for (let j = 0; j < node.children.length; j++) out += cleanSvg(node.children[j]);
    return out + '</' + tag + '>';
  }

  function readBar() {
    try {
      const data = JSON.parse(localStorage.getItem(BAR_KEY) || 'null');
      return data && data.order && data.items ? data : null;
    } catch {
      return null;
    }
  }

  // Prefers each button's unselected icon: the copy shows on a page that
  // isn't any of these sections.
  function saveBar(bar) {
    const key = location.pathname;
    if (bar === siteBar && savedFor === key && bar.__refundSaved) return;
    bar.__refundSaved = true;
    savedFor = key;
    const old = readBar();
    const items = (old && old.items) || {};
    const order = [];
    const links = bar.querySelectorAll('a[href]');
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute('href');
      if (!SAFE_PATH.test(href) || order.indexOf(href) >= 0) continue;
      order.push(href);
      const entry = items[href] || {};
      const here = !!links[i].querySelector('[aria-selected="true"]');
      const svg = links[i].querySelector('svg');
      const img = links[i].querySelector('img');
      if (svg) {
        const drawing = cleanSvg(svg);
        if (drawing && !here) {
          entry.svg = drawing;
          entry.plain = true;
        }
        if (drawing && here && !entry.svg) entry.svg = drawing;
        entry.label = svg.getAttribute('aria-label') || entry.label;
      }
      if (img && /^https:\\/\\//.test(img.getAttribute('src') || '')) {
        entry.img = img.getAttribute('src');
        entry.label = img.getAttribute('alt') || entry.label;
      }
      items[href] = entry;
    }
    if (!order.length) return;
    try {
      localStorage.setItem(BAR_KEY, JSON.stringify({ order: order, items: items }));
    } catch {}
  }

  function showCopy() {
    if (!document.body) return;
    if (!copy || !copy.isConnected) {
      const data = readBar();
      if (!data) return; // the site's bar hasn't been seen yet
      copy = document.createElement('nav');
      copy.id = 'refund-lite-bar';
      for (let i = 0; i < data.order.length; i++) {
        const href = data.order[i];
        const item = data.items[href];
        if (!item || !SAFE_PATH.test(href)) continue;
        const slot = document.createElement('div');
        const link = document.createElement('a');
        link.setAttribute('href', href);
        if (item.label) link.setAttribute('aria-label', String(item.label));
        if (item.img && /^https:\\/\\//.test(item.img)) {
          const photo = document.createElement('img');
          photo.src = item.img;
          photo.alt = '';
          link.appendChild(photo);
        } else if (item.svg) {
          link.innerHTML = item.svg; // built by cleanSvg: shapes only
          if (!item.plain) link.className = 'refund-outline';
        }
        slot.appendChild(link);
        copy.appendChild(slot);
      }
      copy.addEventListener('click', onCopyClick);
      document.body.appendChild(copy);
    }
    if (!copyShown) document.documentElement.classList.add('refund-lite-copy');
    copyShown = true;
    const section = location.pathname.split('/')[1];
    const copyLinks = copy.querySelectorAll('a');
    for (let j = 0; j < copyLinks.length; j++) {
      const a = copyLinks[j];
      const here = section && a.getAttribute('href').split('/')[1] === section;
      if (here !== a.classList.contains('refund-here')) a.classList.toggle('refund-here');
    }
    makeRoom();
  }

  // Never throws: check() calls it while switching off.
  function hideCopy() {
    try {
      if (copy && copy.parentNode) copy.parentNode.removeChild(copy);
      copy = null;
      if (copyShown) document.documentElement.classList.remove('refund-lite-copy');
      copyShown = false;
    } catch {}
  }

  // Marks the chat list's full-screen fixed layer so the CSS can end it
  // above the copy.
  function makeRoom() {
    if (document.querySelector('[data-refund-room]')) return;
    let node = document.elementFromPoint(
      window.innerWidth / 2,
      window.innerHeight - BAR_HEIGHT - 10
    );
    for (let depth = 0; node && node !== document.body && depth < 40; depth++) {
      if (getComputedStyle(node).position === 'fixed') {
        const box = node.getBoundingClientRect();
        if (box.top <= 0 && box.bottom >= window.innerHeight - 1) {
          node.setAttribute('data-refund-room', '');
          return;
        }
      }
      node = node.parentElement;
    }
  }

  // pushState plus popstate lets Instagram's router switch screens without a
  // reload. Its focus move then shows WebKit's focus ring, since no tap
  // started it, so the outline is hidden for 2s (focus stays, for VoiceOver).
  function onCopyClick(event) {
    const link = event.target && event.target.closest ? event.target.closest('a') : null;
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (!SAFE_PATH.test(href) || href === location.pathname) return;
    const until = Date.now() + 2000;
    const unring = function (focus) {
      if (Date.now() > until) {
        document.removeEventListener('focusin', unring, true);
        return;
      }
      const el = focus.target;
      if (!el || !el.style || /^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable) return;
      el.style.outline = 'none';
    };
    document.addEventListener('focusin', unring, true);
    try {
      history.pushState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    } catch {
      location.assign(href);
    }
  }

  function checkBarCopy() {
    if (!BAR_ANCHOR || off) return;
    try {
      if (onCopyPage()) {
        // Just after navigating, the site's bar can linger for a moment.
        if (findSiteBar() || !listShowing() || somethingOverList()) hideCopy();
        else showCopy();
        return;
      }
      hideCopy();
      const bar = findSiteBar();
      if (bar) saveBar(bar);
    } catch {}
  }

  // Checked a few times while the new screen renders, then on the 1s tick. A
  // document-wide MutationObserver fired constantly on busy accounts and made
  // the page lag.
  let checkTimers = [];
  function refreshBarCopy() {
    if (!BAR_ANCHOR) return;
    for (let i = 0; i < checkTimers.length; i++) clearTimeout(checkTimers[i]);
    checkTimers = [0, 120, 300, 700, 1500].map(function (ms) {
      return setTimeout(checkBarCopy, ms);
    });
  }
  if (BAR_ANCHOR) {
    // Keyboard up: hide the copy so the message box sits on the keyboard.
    try {
      window.visualViewport.addEventListener('resize', function () {
        const typing = window.visualViewport.height < window.innerHeight - 120;
        document.documentElement.classList.toggle('refund-lite-typing', typing);
      });
    } catch {}
    // A tap can open a note without a URL change.
    document.addEventListener('click', refreshBarCopy, true);
    refreshBarCopy();
  }

  // The off switch. Removing the style tag brings the hidden links back.
  function check() {
    const fieldShown = !!document.querySelector(PASSWORD_FIELD);
    if (fieldShown === off) return;
    off = fieldShown;
    if (off) hideCopy();
    if (style) {
      if (off && style.parentNode) style.parentNode.removeChild(style);
      if (!off) (document.head || document.documentElement).appendChild(style);
    }
    if (!off) send(); // back on: report the URL in case it changed meanwhile
  }
  // Every second, and on focus so it's off before anything is typed. A new
  // screen can change the edge colours and bar without a page load.
  setInterval(function () {
    if (document.hidden) return;
    check();
    sendColors();
    checkBarCopy();
  }, 1000);
  document.addEventListener('focusin', function (event) {
    const field = event.target;
    if (field && field.matches && field.matches(PASSWORD_FIELD)) check();
  }, true);
})();
true;
`;
}
