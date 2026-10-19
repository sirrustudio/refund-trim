// The script Lite injects into the site's page, and the parsers for the
// messages it sends back.
//
// Blocking works in four layers:
//   1. This script stops taps on links to blocked sections before the site
//      handles them, so the page never leaves. The app checks the link again.
//      Some links are sent somewhere else instead (LiteLinkRewrite).
//   2. onShouldStartLoadWithRequest checks every full page load ([site].tsx).
//   3. This script reports URL changes made with history.pushState. Instagram
//      is a single-page app, so most navigation never loads a new page.
//   4. This script hides links to blocked sections with CSS.
import type { LiteSite } from "@/utils/lite-sites";

/** An RGB colour, each channel 0-255. */
export type LiteRgb = { r: number; g: number; b: number };

export type LiteMessage =
  | { type: "nav"; url: string }
  | { type: "tapBlocked"; url: string }
  | { type: "reelLimit" }
  | { type: "ready" }
  | { type: "colors"; top: LiteRgb; bottom: LiteRgb };

/**
 * Injected when the blocked card goes up, since a reel that already started
 * would keep playing audio behind it. The flag keeps pausing videos that
 * start later, until the next page load or RESUME_VIDEOS.
 */
export const PAUSE_ALL_VIDEOS = `
window.__refundLiteBlocked = true;
Array.prototype.forEach.call(document.getElementsByTagName('video'), function (v) {
  try { v.pause(); } catch {}
});
true;
`;

/** Injected when the blocked card closes without a page load. */
export const RESUME_VIDEOS = `
window.__refundLiteBlocked = false;
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

/**
 * Injected when the keyboard opens or closes. The app ends the web view at
 * the keyboard, so the page can't tell the keyboard is up; the class hides
 * the bar copy while typing.
 */
export function keyboardScript(up: boolean): string {
  return `document.documentElement.classList.toggle('refund-lite-typing', ${up}); true;`;
}

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
    if (data.type === "ready") return { type: "ready" };
    if (data.type === "colors") {
      const top = parseLiteColor(data.top);
      const bottom = parseLiteColor(data.bottom);
      return top && bottom ? { type: "colors", top, bottom } : null;
    }
    if (
      (data.type === "nav" || data.type === "tapBlocked") &&
      typeof data.url === "string" &&
      data.url.length <= MAX_URL_LENGTH
    ) {
      return { type: data.type, url: data.url };
    }
  } catch {
    // Not JSON, so not ours.
  }
  return null;
}

/**
 * The bottom bar copy (see LiteBarCopy), in Instagram's own colour variables
 * so it follows dark mode. [data-refund-room] is the chat list's fixed layer,
 * shortened to end above the copy; refund-lite-typing (set by the app while
 * the keyboard is up) undoes both.
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
 * Everything the page script takes from the site's rules, as JSON. Built into
 * the script, and sent to a page that's already open when the settings
 * change (buildLiteUpdate).
 */
export function buildLitePageConfig(
  site: LiteSite,
  options: { reelLimit: number },
): string {
  const hideRule = site.hideSelectors.length
    ? `${site.hideSelectors.join(",")}{display:none !important;}`
    : "";
  const styleRules = (site.styleRules ?? []).join("");
  const copyRules = site.barCopy ? BAR_COPY_CSS : "";
  // The search page draws the site's bar see-through, over its list.
  const barRules = site.siteBarAnchor
    ? "[data-refund-site-bar]{background-color:rgb(var(--ig-primary-background,255,255,255)) !important;}" +
      "html.refund-lite-search [data-refund-site-bar]{z-index:2147482000 !important;}"
    : "";
  const postRules = site.hidePosts
    ? "[data-refund-hidden-post],[data-refund-suggested-from] ~ *{display:none !important;}"
    : "";
  return JSON.stringify({
    css: hideRule + styleRules + copyRules + barRules + postRules,
    // An integer 0-99; 0 turns the reel limit off.
    reelLimit: Math.max(0, Math.min(99, Math.floor(options.reelLimit) || 0)),
    bar: site.barCopy
      ? {
          anchor: site.barCopy.siteBarAnchor,
          paths: site.barCopy.copyOnPaths,
          list: site.barCopy.listAnchor ?? "",
        }
      : null,
    // The same rules checkLiteUrl in lite-filter.ts uses, for the tap check.
    rules: {
      blocked: site.blockedPaths,
      patterns: (site.blockedPathPatterns ?? []).map((pattern) => [
        pattern.source,
        pattern.flags,
      ]),
      only: site.onlyPaths ?? null,
      // Taps that go somewhere else instead (see LiteLinkRewrite).
      rewrites: (site.linkRewrites ?? []).map((rewrite) => [
        rewrite.from.toLowerCase(),
        rewrite.to,
      ]),
    },
    siteBar: site.siteBarAnchor ?? "",
    hidePosts: site.hidePosts ?? null,
    ready: site.readySelector ?? "",
  });
}

/**
 * Applies new settings to a page that's already open, so it doesn't have to
 * reload. The app checks the current address against them itself.
 */
export function buildLiteUpdate(
  site: LiteSite,
  options: { reelLimit: number },
): string {
  return `window.__refundLiteSet && window.__refundLiteSet(${buildLitePageConfig(site, options)}); true;`;
}

/**
 * Builds the injected script for one site. It sends back only URLs (the
 * current one, or a link it stopped), the page's edge colours, and two
 * signals with no data: the reel limit was reached, and the page is drawn.
 * Never page content or anything typed.
 */
export function buildLiteInjection(
  site: LiteSite,
  options: { reelLimit: number },
): string {
  // Written into the script as JS literals; it runs in the page and can't
  // import lite-sites.ts.
  const config = buildLitePageConfig(site, options);
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

  // The site's rules (see buildLitePageConfig). __refundLiteSet replaces them
  // when the settings change.
  let cfg = ${config};

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
    checkSoon(); // the new screen may need the bar copy, or other edge colours
  }

  // Layer 3: URL changes that don't load a page.
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

  // Layer 1: taps on links, caught in the capture phase before the site's own
  // handlers see them. One to a blocked section is stopped, so the page stays
  // where it is; one with a rewrite goes to its target instead. The rules
  // match checkLiteUrl in lite-filter.ts on the link's path.
  let patterns = [];
  function compilePatterns() {
    patterns = [];
    const list = (cfg.rules && cfg.rules.patterns) || [];
    for (let i = 0; i < list.length; i++) {
      try { patterns.push(new RegExp(list[i][0], list[i][1])); } catch {}
    }
  }
  compilePatterns();

  // Whole segments: "/reel" matches "/reel" and "/reel/abc", not "/reelsomething".
  function underAny(p, prefixes) {
    return prefixes.some(function (prefix) {
      return p === prefix || p.indexOf(prefix + '/') === 0;
    });
  }

  function isBlockedPath(p) {
    const rules = cfg.rules || {};
    if (rules.only && !underAny(p, rules.only)) return true;
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].test(p)) return true;
    }
    return underAny(p, rules.blocked || []);
  }

  // Where a tap on this link goes instead (see LiteLinkRewrite), or null.
  // Links with a query are left alone: they're a choice already made.
  function rewriteFor(link, p) {
    if (link.search) return null;
    const list = (cfg.rules && cfg.rules.rewrites) || [];
    for (let i = 0; i < list.length; i++) {
      const from = list[i][0];
      if (p === from || p === from + '/') return list[i][1];
    }
    return null;
  }

  // Whether the page is already at a rewrite target, query included.
  function isAt(to) {
    const parts = to.split('?');
    if (location.pathname.toLowerCase() !== parts[0].toLowerCase()) return false;
    return !parts[1] || location.search.indexOf(parts[1]) >= 0;
  }

  document.addEventListener('click', function (event) {
    if (off || !event || event.defaultPrevented) return;
    try {
      const target = event.target;
      const link = target && target.closest ? target.closest('a[href]') : null;
      // Other sites are the app's call (they open in Safari).
      if (!link || link.hostname !== location.hostname) return;
      const p = (link.pathname || '/').toLowerCase();
      const to = rewriteFor(link, p);
      if (to && !isBlockedPath(to.split(/[?#]/)[0].toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // A second tap scrolls to the top, as the site's own does.
        if (isAt(to)) window.scrollTo({ top: 0, behavior: 'smooth' });
        else goInPage(to);
        return;
      }
      if (!isBlockedPath(p)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: 'tapBlocked', url: link.href })
      );
    } catch {}
  }, true);

  // pushState plus popstate lets Instagram's router switch screens without a
  // reload. Its focus move then shows WebKit's focus ring, since no tap
  // started it, so the outline is hidden for 2s (focus stays, for VoiceOver).
  function goInPage(href) {
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

  // Sent once, the first time the site's own interface is drawn, so the app
  // can take its loading cover away. No data.
  let readySent = false;
  function checkReady() {
    if (readySent || off || !cfg.ready) return;
    try {
      if (!document.querySelector(cfg.ready)) return;
      readySent = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    } catch {}
  }

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
  // might still be open. A limit of 0 is off.
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
    if (count > cfg.reelLimit) {
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
    if (off || !(cfg.reelLimit > 0)) return;
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

  // Layer 4: hide links to blocked sections.
  let style = null;
  function applyStyle() {
    if (!cfg.css) {
      if (style && style.parentNode) style.parentNode.removeChild(style);
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = 'refund-lite-style'; // easy to spot in Web Inspector
    }
    style.textContent = cfg.css;
    if (!off && !style.parentNode) {
      (document.head || document.documentElement).appendChild(style);
    }
  }
  applyStyle();

  // Bottom bar copy (see LiteBarCopy). Saved from the site's bar on other
  // pages into the page's own storage, and never sent to the app.
  const BAR_KEY = 'refundLiteBar';
  const BAR_HEIGHT = 50;
  const SAFE_PATH = /^\\/[A-Za-z0-9._\\/-]*$/;
  let siteBar = null; // the site's own bar, once found
  const notInBar = new WeakMap(); // anchor link outside the bar -> when seen
  let savedFor = ''; // path of the last save, to skip repeat writes
  let copy = null; // the copy, while it's in the DOM
  let copyShown = false; // whether <html> has the refund-lite-copy class

  // A note opened over the list keeps the URL but removes the list anchor. If
  // the anchor was never seen on this path (layouts vary by account), assume
  // the list is showing: better a bar over a note than none on the list.
  let listSeenOn = '';
  function listShowing() {
    if (!cfg.bar.list) return true;
    const el = document.querySelector(cfg.bar.list);
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
    return cfg.bar.paths.some(function (c) {
      return p === c || p.indexOf(c + '/') === 0;
    });
  }

  // The site's bar is the short fixed strip at the bottom holding the bar
  // anchor. A match elsewhere is skipped for 1.5s, not for good: while the
  // page boots, the bar can briefly sit inside a bigger fixed layer.
  function findSiteBar() {
    const anchor = (cfg.bar && cfg.bar.anchor) || cfg.siteBar;
    if (!anchor) return null;
    if (siteBar && siteBar.isConnected && siteBar.querySelector(anchor)) {
      return siteBar;
    }
    siteBar = null;
    const links = document.querySelectorAll(anchor);
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

  function onCopyClick(event) {
    const link = event.target && event.target.closest ? event.target.closest('a') : null;
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (!SAFE_PATH.test(href) || href === location.pathname) return;
    goInPage(href);
  }

  // Marks the site's own bar for the background rule in the CSS. It isn't
  // pinned: it's the last strip of the page's layout. So it's found by shape:
  // the outermost box around a bar link that spans the screen, ends at its
  // bottom and is no taller than a bar. On the search page the list is drawn
  // over it, so a class lifts it there.
  function markSiteBar() {
    if (!cfg.siteBar || off) return;
    try {
      const onSearch = location.pathname.indexOf('/explore/search') === 0;
      document.documentElement.classList.toggle('refund-lite-search', onSearch);
      const links = document.querySelectorAll(cfg.siteBar);
      for (let i = 0; i < links.length; i++) {
        if (copy && copy.contains(links[i])) continue;
        let strip = null;
        let node = links[i].parentElement;
        for (let depth = 0; node && node !== document.body && depth < 20; depth++) {
          const box = node.getBoundingClientRect();
          if (box.height > 140) break;
          if (box.width >= window.innerWidth - 2 && box.bottom >= window.innerHeight - 2) strip = node;
          node = node.parentElement;
        }
        if (strip) {
          if (strip.getAttribute('data-refund-site-bar') === null) {
            strip.setAttribute('data-refund-site-bar', '');
          }
          return;
        }
      }
    } catch {}
  }

  // Hides suggested posts (cfg.hidePosts). Instagram puts one "Suggested
  // posts" heading in the feed, and every post after it is a suggestion. Text
  // is only read from short pieces between posts: never inside a post
  // (captions, names, comments), a link or a button (like stories), which are
  // skipped before their text is looked at.
  const NOT_READ = 'article, a, button, [role="button"]';
  function hidePost(node) {
    if (!node || node.getAttribute('data-refund-hidden-post') !== null) return;
    // Hidden above the screen, it would pull the page up: scroll back by it.
    const box = node.getBoundingClientRect();
    const above = Math.min(Math.max(-box.top, 0), box.height);
    node.setAttribute('data-refund-hidden-post', '');
    if (above > 0.5) window.scrollBy(0, -above);
  }

  function hideLabelledPosts() {
    const rule = cfg.hidePosts;
    if (!rule || off) return;
    if (rule.paths.indexOf(location.pathname.toLowerCase()) < 0) return;
    try {
      const main = document.querySelector('main');
      if (!main) return;
      const tall = window.innerHeight * 1.5;
      const found = main.querySelectorAll('span, h2, h3, div[role="heading"]');
      for (let i = 0; i < found.length; i++) {
        const el = found[i];
        if (el.childElementCount > 0 || el.closest(NOT_READ)) continue;
        const text = (el.textContent || '').trim().toLowerCase();
        if (!text || text.length > 40 || rule.labels.indexOf(text) < 0) continue;
        // A heading: climb to the feed item holding it (the last box before
        // the tall list), then hide the heading's row and every item after.
        let item = el;
        while (item.parentElement && item.parentElement !== main &&
               item.parentElement.getBoundingClientRect().height <= tall) {
          item = item.parentElement;
        }
        if (!item.parentElement || item === el) continue;
        let row = el;
        while (row.parentElement && row.parentElement !== item) row = row.parentElement;
        hidePost(row);
        for (let next = item.nextElementSibling; next; next = next.nextElementSibling) {
          hidePost(next);
        }
        // Items added later are hidden by the CSS (~ after this mark), before
        // they're drawn. The spinner after the list is what makes the site
        // load more, so it goes too and the feed ends here.
        if (item.getAttribute('data-refund-suggested-from') === null) {
          item.setAttribute('data-refund-suggested-from', '');
        }
        let level = item.parentElement;
        for (let up = 0; level && level !== main && up < 3; up++) {
          for (let next = level.nextElementSibling; next; next = next.nextElementSibling) {
            hidePost(next);
          }
          level = level.parentElement;
        }
      }
    } catch {}
  }

  function checkBarCopy() {
    if (!cfg.bar || off) return;
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

  // After a new screen or a tap, check once a frame while the page changes,
  // for 1.5s (and until the first draw while the page boots): the bar copy
  // and the edge colours then follow a new screen in the frame it's drawn.
  // A whole-document MutationObserver that stayed on made busy accounts lag,
  // so this one only flags a change, and switches itself off.
  const nextFrame = typeof window.requestAnimationFrame === 'function'
    ? function (fn) { window.requestAnimationFrame(fn); }
    : function (fn) { setTimeout(fn, 16); };
  const bootUntil = Date.now() + 10000;
  let checkUntil = 0;
  let frameQueued = false;
  let changed = false;
  let watcher = null;

  function checkSoon() {
    checkUntil = Date.now() + 1500;
    changed = true;
    if (!watcher && typeof window.MutationObserver === 'function') {
      try {
        watcher = new window.MutationObserver(function () { changed = true; });
        watcher.observe(document.documentElement, { childList: true, subtree: true });
      } catch {
        watcher = null;
      }
    }
    if (!frameQueued) {
      frameQueued = true;
      nextFrame(onFrame);
    }
  }

  function onFrame() {
    frameQueued = false;
    // Without a watcher there's no way to tell, so check every frame.
    if ((changed || !watcher) && !document.hidden) {
      changed = false;
      checkReady();
      checkBarCopy();
      markSiteBar();
      hideLabelledPosts();
      sendColors();
    }
    const now = Date.now();
    if (now < checkUntil || (!readySent && now < bootUntil)) {
      frameQueued = true;
      nextFrame(onFrame);
    } else if (watcher) {
      watcher.disconnect();
      watcher = null;
    }
  }

  // A tap can open a note, a dialog or a full-screen viewer without a URL
  // change.
  document.addEventListener('click', checkSoon, true);
  document.addEventListener('DOMContentLoaded', checkSoon);
  // New posts load while scrolling, with no tap or URL change: look for
  // suggestions at most every 250ms then.
  let postsCheckAt = 0;
  window.addEventListener('scroll', function () {
    if (!cfg.hidePosts) return;
    const now = Date.now();
    if (now - postsCheckAt < 250) return;
    postsCheckAt = now;
    hideLabelledPosts();
  }, { passive: true });
  window.addEventListener('load', sendColors);
  checkSoon();

  // The web form bar is hidden, and its tick was the only way to close the
  // keyboard. As in a chat app: a swipe down, or a tap on anything that
  // isn't a control, closes it. The app sets refund-lite-typing while the
  // keyboard is up.
  const CONTROL =
    'input,textarea,select,button,a,[role="button"],[role="textbox"],[contenteditable]:not([contenteditable="false"])';
  let touchStartY = null;
  let touchLastY = null;
  let touchTarget = null;
  function closeKeyboard() {
    const el = document.activeElement;
    if (el && el !== document.body && el.blur) el.blur();
  }
  document.addEventListener('touchstart', function (event) {
    touchStartY = null;
    if (off || !event.touches || event.touches.length !== 1) return;
    if (!document.documentElement.classList.contains('refund-lite-typing')) return;
    touchStartY = touchLastY = event.touches[0].clientY;
    touchTarget = event.target;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', function (event) {
    if (touchStartY === null || !event.touches || !event.touches.length) return;
    touchLastY = event.touches[0].clientY;
    if (touchLastY - touchStartY > 24) {
      touchStartY = null;
      closeKeyboard();
    }
  }, { capture: true, passive: true });
  document.addEventListener('touchend', function () {
    if (touchStartY === null) return;
    const tap = Math.abs(touchLastY - touchStartY) < 10;
    const target = touchTarget;
    touchStartY = null;
    if (tap && target && target.closest && !target.closest(CONTROL)) closeKeyboard();
  }, { capture: true, passive: true });

  // The app calls this when the settings change, so the open page follows
  // them without a reload.
  window.__refundLiteSet = function (next) {
    try {
      if (!next || typeof next !== 'object' || typeof next.css !== 'string') return;
      cfg = next;
      compilePatterns();
      applyStyle();
      if (!cfg.bar) hideCopy();
      if (!cfg.hidePosts) {
        const hidden = document.querySelectorAll('[data-refund-hidden-post],[data-refund-suggested-from]');
        for (let i = 0; i < hidden.length; i++) {
          hidden[i].removeAttribute('data-refund-hidden-post');
          hidden[i].removeAttribute('data-refund-suggested-from');
        }
      }
      checkSoon();
    } catch {}
  };

  // The off switch. Removing the style tag brings the hidden links back.
  function check() {
    const fieldShown = !!document.querySelector(PASSWORD_FIELD);
    if (fieldShown === off) return;
    off = fieldShown;
    if (off) {
      hideCopy();
      if (style && style.parentNode) style.parentNode.removeChild(style);
      return;
    }
    applyStyle();
    send(); // back on: report the URL in case it changed meanwhile
  }
  // Every second, and on focus so it's off before anything is typed. A new
  // screen can change the edge colours and bar without a page load.
  setInterval(function () {
    if (document.hidden) return;
    check();
    checkReady();
    sendColors();
    checkBarCopy();
    markSiteBar();
    hideLabelledPosts();
  }, 1000);
  document.addEventListener('focusin', function (event) {
    const field = event.target;
    if (field && field.matches && field.matches(PASSWORD_FIELD)) check();
  }, true);
})();
true;
`;
}
