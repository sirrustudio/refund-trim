// The small script Lite runs inside the page: layers 2 and 3 of its blocking
// (layer 1 is the web view's own check of every full page load).
//
// Why it's needed: Instagram is a "single-page app". Tapping
// Reels often loads NO new page: the site's JavaScript swaps the screen and
// changes the address. The web view's normal "should I load this?" check only
// sees full loads, so this script reports every address change back to us.
import type { LiteSite } from '@/utils/lite-sites';

/** A colour as three 0-255 numbers. */
export type LiteRgb = { r: number; g: number; b: number };

export type LiteMessage =
  | { type: 'nav'; url: string }
  | { type: 'reelLimit' }
  | { type: 'colors'; top: LiteRgb; bottom: LiteRgb };

/**
 * Pauses every video on the page. Run when the blocked card goes up: the card
 * hides the page, but a reel the site already started would keep playing its
 * sound behind it. The flag keeps pausing any video that starts AFTER this
 * (the site may start the reel a moment later); leaving the card loads a new
 * page, which clears it.
 */
export const PAUSE_ALL_VIDEOS = `
window.__refundLiteBlocked = true;
Array.prototype.forEach.call(document.getElementsByTagName('video'), function (v) {
  try { v.pause(); } catch (e) {}
});
true;
`;

/** Longest address we accept from the page, so a strange page can't flood us. */
const MAX_URL_LENGTH = 2048;

/**
 * Reads a CSS colour the page sent ("rgb(0, 0, 0)" or "rgba(…)"). Only those
 * two shapes with numbers 0-255 pass, so the page can't hand us anything else
 * to paint with; the alpha is dropped (the script only sends solid colours).
 */
export function parseLiteColor(value: unknown): LiteRgb | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const match = /^rgba?\((\d{1,3}), ?(\d{1,3}), ?(\d{1,3})(, ?[\d.]+)?\)$/.exec(
    value,
  );
  if (!match) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  if (r > 255 || g > 255 || b > 255) return null;
  return { r, g, b };
}

/** Reads a message from the page. Anything unexpected returns null. */
export function parseLiteMessage(raw: string): LiteMessage | null {
  try {
    const data = JSON.parse(raw) as {
      type?: unknown;
      url?: unknown;
      top?: unknown;
      bottom?: unknown;
    };
    if (data.type === 'reelLimit') return { type: 'reelLimit' };
    if (data.type === 'colors') {
      const top = parseLiteColor(data.top);
      const bottom = parseLiteColor(data.bottom);
      return top && bottom ? { type: 'colors', top, bottom } : null;
    }
    if (
      data.type === 'nav' &&
      typeof data.url === 'string' &&
      data.url.length <= MAX_URL_LENGTH
    ) {
      return { type: 'nav', url: data.url };
    }
  } catch {
    // Not JSON: not ours.
  }
  return null;
}

/**
 * The copy of the site's bottom bar (see LiteBarCopy). Its colours are the
 * page's own (Instagram's colour variables), so it matches light and dark.
 * On the message pages the screen's pinned layer gets a marker that lifts its
 * bottom edge above the copy; while the keyboard is up both go back, so the
 * typing box sits on the keyboard.
 */
const BAR_COPY_CSS = [
  // Laid out like the site's own bar (measured Oct 16): a 1pt line, then
  // 48pt buttons with equal gaps. A switched-off button (Reels) shrinks its
  // slot to nothing but the slot still gets its gaps, as in the site's bar,
  // so the icons line up with it exactly.
  '#refund-lite-bar{position:fixed;left:0;right:0;bottom:0;height:50px;box-sizing:border-box;display:flex;justify-content:space-evenly;align-items:flex-start;z-index:2147483000;',
  'background:rgb(var(--ig-primary-background,255,255,255));border-top:1px solid rgb(var(--ig-elevated-separator,219,219,219));color:rgb(var(--ig-primary-text,0,0,0));}',
  '#refund-lite-bar > div{display:flex;}',
  '#refund-lite-bar a{width:48px;height:48px;display:flex;align-items:center;justify-content:center;color:inherit;-webkit-tap-highlight-color:transparent;}',
  '#refund-lite-bar img{width:24px;height:24px;border-radius:50%;object-fit:cover;}',
  // The page you're on, filled in the way the site fills its own.
  '#refund-lite-bar .refund-here svg path,#refund-lite-bar .refund-here svg circle,#refund-lite-bar .refund-here svg polygon{fill:currentColor;}',
  '#refund-lite-bar .refund-here svg line{stroke:rgb(var(--ig-primary-background,255,255,255));}',
  // The site also sets that layer's height to the full screen: capped too.
  'html.refund-lite-copy [data-refund-room]{bottom:50px !important;height:auto !important;min-height:0 !important;max-height:calc(100% - 50px) !important;}',
  'html.refund-lite-typing #refund-lite-bar{display:none !important;}',
  'html.refund-lite-typing [data-refund-room]{bottom:0 !important;max-height:none !important;}',
  // Only the filled "you're here" drawing is known yet (the page has only
  // been seen from there): shown as its outline, so it doesn't look selected.
  '#refund-lite-bar .refund-outline svg path{fill:none;stroke:currentColor;stroke-width:2;}',
].join('');

/**
 * Builds the injected script for one site. Only the address (`location.href`)
 * and the colours at the page's top and bottom edges are sent back — never
 * page content, never anything typed.
 */
export function buildLiteInjection(
  site: LiteSite,
  options: { reelLimit: number },
): string {
  const hideRule = site.hideSelectors.length
    ? `${site.hideSelectors.join(',')}{display:none !important;}`
    : '';
  // A whole number 0-99 only, since it is written into the script text.
  const reelLimit = Math.max(
    0,
    Math.min(99, Math.floor(options.reelLimit) || 0),
  );
  const styleRules = (site.styleRules ?? []).join('');
  const copyRules = site.barCopy ? BAR_COPY_CSS : '';
  // JSON.stringify makes the CSS a safe JS string literal.
  const css = JSON.stringify(hideRule + styleRules + copyRules);
  // Where the copy of the site's bottom bar goes (see LiteBarCopy).
  const barAnchor = JSON.stringify(site.barCopy?.siteBarAnchor ?? '');
  const copyPaths = JSON.stringify(site.barCopy?.copyOnPaths ?? []);
  // The login pages, written into the script: it runs inside the page and
  // can't read lite-sites.ts.
  const noScriptPaths = JSON.stringify(site.noScriptPaths ?? []);

  return `
(function () {
  // Backup for the screen's own check (it hands over no script for a login
  // page): if this IS a login page, stop before doing anything. Same "whole
  // path piece" rule as isNoScriptUrl in lite-filter.ts.
  var path = location.pathname.toLowerCase();
  var onLoginPage = ${noScriptPaths}.some(function (p) {
    return path === p || path.indexOf(p + '/') === 0;
  });
  if (onLoginPage) return;

  if (window.__refundLite) return; // already injected on this page
  window.__refundLite = true;

  // OFF while a password box is on the page, whatever the address (Instagram
  // also shows its login form at "/", the same address as the home feed).
  // While off, every part below does nothing: it sends nothing, hides
  // nothing, counts nothing. It looks only at WHETHER such a box exists,
  // never at what is typed in it. name="password" is matched too because
  // "Show" turns the box into plain text; one-time-code is the 2FA box.
  var PASSWORD_BOX =
    'input[type="password"],input[name="password"],input[autocomplete="one-time-code"]';
  var off = false;

  function send() {
    if (off) return;
    try {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: 'nav', url: location.href })
      );
    } catch (e) {}
    // A new screen may need the bar copy, or no longer (see below).
    refreshBarCopy();
  }

  // Layer 2: the site changes the address without loading a page.
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      send();
      return result;
    };
  });
  window.addEventListener('popstate', send);
  window.addEventListener('hashchange', send);

  // Edge colours. Refund keeps the page clear of the clock and the home bar
  // (Instagram's top bar would sit under the clock: Safari never puts a page
  // there, so the site leaves no room for it) and paints those two strips to
  // match. This reads the background colour of whatever is at the page's top
  // and bottom edge: the first solid one, walking up from the element there.
  function edgeColor(y) {
    var node = document.elementFromPoint(window.innerWidth / 2, y);
    while (node && node.nodeType === 1) {
      var color = getComputedStyle(node).backgroundColor;
      // "transparent" and see-through colours (alpha 0) are skipped.
      if (color && color !== 'transparent' && !/^rgba\\(.*, 0\\)$/.test(color)) {
        return color;
      }
      node = node.parentElement;
    }
    // Nothing solid there: send nothing and keep the colour we have.
    return null;
  }
  var lastColors = '';
  function sendColors() {
    if (off || document.hidden || !document.body) return;
    try {
      var top = edgeColor(0);
      var bottom = edgeColor(window.innerHeight - 1);
      if (!top || !bottom) return;
      var message = JSON.stringify({ type: 'colors', top: top, bottom: bottom });
      // Only when they change: most checks send nothing.
      if (message === lastColors) return;
      lastColors = message;
      window.ReactNativeWebView.postMessage(message);
    } catch (e) {}
  }
  document.addEventListener('DOMContentLoaded', sendColors);
  window.addEventListener('load', sendColors);

  // While the blocked card is up (PAUSE_ALL_VIDEOS set the flag), any video
  // that starts playing is stopped again. Media events don't bubble, so this
  // listens while they travel down (capture).
  document.addEventListener('play', function (event) {
    if (off || !window.__refundLiteBlocked) return;
    var video = event.target;
    if (video && video.tagName === 'VIDEO') {
      try { video.pause(); } catch (e) {}
    }
  }, true);

  // Reel limit inside the DMs. The message viewer plays reels on top of the
  // conversation and never changes the address (checked on a real phone), so
  // an address rule can't see them. Instead we count the big videos that play:
  // each new reel is a new video source. Past the limit the video is paused and
  // the app is told, which shows a card and sends you back to the chat.
  // The count is per viewing: it starts again once the viewer has been closed
  // for a moment, so opening the NEXT friend's reel gets a fresh allowance.
  // Judged by what is on screen and by the video's own source, not by class
  // names, which change often. Not verified against every version of the viewer.
  //
  // Kept cheap on purpose: measuring a video (getBoundingClientRect) makes
  // the browser lay the page out, so we measure ONE video at a time, and
  // only when something happened: a video started, or a reel was counted and
  // we're waiting for the viewer to close. Small chat previews cost nothing.
  if (${reelLimit} > 0) {
    var seen = {};
    var count = 0;
    var lastReel = null;   // the video element counted last
    var lastSeenAt = 0;    // when lastReel was last seen big on screen

    // Is THIS video near-full-screen inside the DMs? One measurement.
    var isBig = function (video) {
      if (location.pathname.indexOf('/direct/') !== 0) return false;
      var height = window.innerHeight;
      var box = video.getBoundingClientRect();
      return box.height > height * 0.6 && box.bottom > 0 && box.top < height;
    };

    // Counts the video if it is a new reel. Returns true once it is counted
    // (or was already), so the callers can stop re-checking it.
    var countIfReel = function (video) {
      var key = video.currentSrc || video.src;
      if (!key) return false;
      if (seen[key]) return true;
      if (!isBig(video)) return false;
      seen[key] = true;
      lastReel = video;
      lastSeenAt = Date.now();
      count += 1;
      if (count > ${reelLimit}) {
        Array.prototype.forEach.call(document.getElementsByTagName('video'), function (v) {
          try { v.pause(); } catch (e) {}
        });
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'reelLimit' }));
        } catch (e) {}
      }
      return true;
    };

    // 'playing' fires once when a video starts, not several times a second.
    // The viewer animates open, so a reel can start small and grow: re-check
    // it twice more, then leave it alone.
    var onPlaying = function (event) {
      if (off) return;
      var video = event.target;
      if (!video || video.tagName !== 'VIDEO') return;
      if (countIfReel(video)) return;
      setTimeout(function () {
        if (countIfReel(video)) return;
        setTimeout(function () { countIfReel(video); }, 700);
      }, 300);
    };
    // Media events don't bubble, so listen while they travel down (capture).
    document.addEventListener('playing', onPlaying, true);

    // Viewer closed for over 1.5s (not just the gap between two reels): reset,
    // so the NEXT friend's reel gets a fresh allowance. Only the last counted
    // reel is watched: gone from the page costs nothing, still there costs
    // one measurement. Nothing runs while no reel has been counted.
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

  // Layer 3: hide the buttons that lead to the switched-off parts.
  var css = ${css};
  var style = null;
  if (css) {
    style = document.createElement('style');
    // Named so it's easy to find with Safari's Web Inspector: present = on.
    style.id = 'refund-lite-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // The site's own bottom bar on pages without one. Instagram's website
  // leaves it out of the message pages, so you had to go back to get
  // anywhere. There, this shows a copy of the site's OWN bar (its icons, your
  // photo), rebuilt from the last one seen on another page. The copy is kept
  // in the PAGE's own storage on this phone: none of it is ever sent to
  // Refund, so Refund never learns your photo or username.
  var BAR_ANCHOR = ${barAnchor};
  var COPY_PATHS = ${copyPaths};
  var BAR_KEY = 'refundLiteBar';
  var BAR_HEIGHT = 50;
  var SAFE_PATH = /^\\/[A-Za-z0-9._\\/-]*$/;
  var siteBar = null; // the site's own bar, once found
  // Links found NOT to be in it, and when: looked at again after a moment.
  var notInBar = typeof WeakMap === 'function' ? new WeakMap() : null;
  var savedFor = ''; // the bar and page last saved, to skip repeat writes
  var copy = null; // the copy, while it's on the page
  var copyShown = false; // the page-wide class that lifts the message screen

  function onCopyPage() {
    var p = location.pathname.toLowerCase();
    return COPY_PATHS.some(function (c) {
      return p === c || p.indexOf(c + '/') === 0;
    });
  }

  // The short strip pinned to the screen's bottom edge that holds
  // BAR_ANCHOR (a chat's back link to the inbox sits in the full-screen
  // message layer instead, which is far taller). Reused while it stays on the
  // page, so scrolling costs nothing. A link found elsewhere is left alone for
  // 1.5 seconds, not for good: while the page is being built the site's bar
  // can briefly sit inside a bigger pinned layer (Oct 16).
  function findSiteBar() {
    if (siteBar && siteBar.isConnected && siteBar.querySelector(BAR_ANCHOR)) {
      return siteBar;
    }
    siteBar = null;
    var links = document.querySelectorAll(BAR_ANCHOR);
    for (var i = 0; i < links.length; i++) {
      if (copy && copy.contains(links[i])) continue;
      var now = Date.now();
      if (notInBar && now - (notInBar.get(links[i]) || 0) < 1500) continue;
      var node = links[i].parentElement;
      for (var depth = 0; node && depth < 20; depth++) {
        if (getComputedStyle(node).position === 'fixed') {
          var box = node.getBoundingClientRect();
          if (box.bottom >= window.innerHeight - 2 && box.height <= 120) {
            siteBar = node;
            return node;
          }
          if (notInBar) notInBar.set(links[i], now); // pinned, but some other layer
          break;
        }
        node = node.parentElement;
      }
    }
    return null;
  }

  // Only drawings go into the copy: shapes and their look, nothing that runs.
  var SVG_TAGS = /^(svg|g|path|line|polyline|polygon|circle|ellipse|rect)$/;
  var SVG_ATTRS = /^(viewBox|width|height|d|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|points|fill|fill-rule|clip-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|transform)$/;
  function cleanSvg(node) {
    var tag = String(node.tagName || '').toLowerCase();
    if (!SVG_TAGS.test(tag)) return '';
    var out = '<' + tag;
    for (var i = 0; i < node.attributes.length; i++) {
      var attr = node.attributes[i];
      if (SVG_ATTRS.test(attr.name) && !/[<>"&]/.test(attr.value)) {
        out += ' ' + attr.name + '="' + attr.value + '"';
      }
    }
    out += '>';
    for (var j = 0; j < node.children.length; j++) out += cleanSvg(node.children[j]);
    return out + '</' + tag + '>';
  }

  function readBar() {
    try {
      var data = JSON.parse(localStorage.getItem(BAR_KEY) || 'null');
      return data && data.order && data.items ? data : null;
    } catch (e) {
      return null;
    }
  }

  // Each button's address and drawing. The plain drawing beats the filled
  // "you're here" one: the copy shows on pages that are none of them.
  function saveBar(bar) {
    var key = location.pathname;
    if (bar === siteBar && savedFor === key && bar.__refundSaved) return;
    bar.__refundSaved = true;
    savedFor = key;
    var old = readBar();
    var items = (old && old.items) || {};
    var order = [];
    var links = bar.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      if (!SAFE_PATH.test(href) || order.indexOf(href) >= 0) continue;
      order.push(href);
      var entry = items[href] || {};
      var here = !!links[i].querySelector('[aria-selected="true"]');
      var svg = links[i].querySelector('svg');
      var img = links[i].querySelector('img');
      if (svg) {
        var drawing = cleanSvg(svg);
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
    } catch (e) {}
  }

  function showCopy() {
    if (!document.body) return;
    if (!copy || !copy.isConnected) {
      var data = readBar();
      if (!data) return; // never seen the site's bar yet
      copy = document.createElement('nav');
      copy.id = 'refund-lite-bar';
      for (var i = 0; i < data.order.length; i++) {
        var href = data.order[i];
        var item = data.items[href];
        if (!item || !SAFE_PATH.test(href)) continue;
        var slot = document.createElement('div');
        var link = document.createElement('a');
        link.setAttribute('href', href);
        if (item.label) link.setAttribute('aria-label', String(item.label));
        if (item.img && /^https:\\/\\//.test(item.img)) {
          var photo = document.createElement('img');
          photo.src = item.img;
          photo.alt = '';
          link.appendChild(photo);
        } else if (item.svg) {
          link.innerHTML = item.svg; // rebuilt by cleanSvg: drawing only
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
    var section = location.pathname.split('/')[1];
    var copyLinks = copy.querySelectorAll('a');
    for (var j = 0; j < copyLinks.length; j++) {
      var a = copyLinks[j];
      var here = section && a.getAttribute('href').split('/')[1] === section;
      if (here !== a.classList.contains('refund-here')) a.classList.toggle('refund-here');
    }
    makeRoom();
  }

  // Never throws: the password-box off switch calls this on its way off.
  function hideCopy() {
    try {
      if (copy && copy.parentNode) copy.parentNode.removeChild(copy);
      copy = null;
      if (copyShown) document.documentElement.classList.remove('refund-lite-copy');
      copyShown = false;
    } catch (e) {}
  }

  // The message screen is one layer pinned to the whole screen (Oct 16). It
  // gets a marker, and the style lifts its bottom edge above the copy.
  function makeRoom() {
    if (document.querySelector('[data-refund-room]')) return;
    var node = document.elementFromPoint(
      window.innerWidth / 2,
      window.innerHeight - BAR_HEIGHT - 10
    );
    // Up from whatever is just above the copy, past any smaller pinned part,
    // to the first pinned layer that covers the whole screen.
    for (var depth = 0; node && node !== document.body && depth < 40; depth++) {
      if (getComputedStyle(node).position === 'fixed') {
        var box = node.getBoundingClientRect();
        if (box.top <= 0 && box.bottom >= window.innerHeight - 1) {
          node.setAttribute('data-refund-room', '');
          return;
        }
      }
      node = node.parentElement;
    }
  }

  // A tap on the copy moves the page the way the site's own bar does, with
  // no reload. Started from code, the site's focus move then drew the
  // browser's blue keyboard ring on the new page's title, so for 2 seconds
  // whatever gets focus loses the ring (it keeps the focus, for VoiceOver).
  function onCopyClick(event) {
    var link = event.target && event.target.closest ? event.target.closest('a') : null;
    if (!link) return;
    event.preventDefault();
    var href = link.getAttribute('href');
    if (!SAFE_PATH.test(href) || href === location.pathname) return;
    var until = Date.now() + 2000;
    var unring = function (focus) {
      if (Date.now() > until) {
        document.removeEventListener('focusin', unring, true);
        return;
      }
      var el = focus.target;
      if (!el || !el.style || /^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable) return;
      el.style.outline = 'none';
    };
    document.addEventListener('focusin', unring, true);
    try {
      history.pushState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    } catch (e) {
      location.assign(href);
    }
  }

  function checkBarCopy() {
    if (!BAR_ANCHOR || off) return;
    try {
      if (onCopyPage()) {
        // Just after the switch the site's own bar can still be up for a
        // moment: the copy waits for it to go.
        if (findSiteBar()) hideCopy();
        else showCopy();
        return;
      }
      hideCopy();
      var bar = findSiteBar();
      if (bar) saveBar(bar);
    } catch (e) {}
  }

  // Checked a few times just after the address changes (the new screen takes
  // a moment to be drawn), then once a second with the other checks. Not on
  // every change the page makes: on a real account the page changes all the
  // time (new posts, messages, typing dots), and checking each time made the
  // whole page lag (Oct 16).
  var checkTimers = [];
  function refreshBarCopy() {
    if (!BAR_ANCHOR) return;
    for (var i = 0; i < checkTimers.length; i++) clearTimeout(checkTimers[i]);
    checkTimers = [0, 120, 300, 700, 1500].map(function (ms) {
      return setTimeout(checkBarCopy, ms);
    });
  }
  if (BAR_ANCHOR) {
    // The keyboard: the visible part of the page shrinks. The copy steps
    // aside so the typing box sits on the keyboard, like the site's own bar.
    try {
      window.visualViewport.addEventListener('resize', function () {
        var typing = window.visualViewport.height < window.innerHeight - 120;
        document.documentElement.classList.toggle('refund-lite-typing', typing);
      });
    } catch (e) {}
    refreshBarCopy();
  }

  // The off switch. Removing the style is what makes it visible: the hidden
  // buttons come back while the box is there.
  function check() {
    var boxShown = !!document.querySelector(PASSWORD_BOX);
    if (boxShown === off) return;
    off = boxShown;
    if (off) hideCopy();
    if (style) {
      if (off && style.parentNode) style.parentNode.removeChild(style);
      if (!off) (document.head || document.documentElement).appendChild(style);
    }
    // Back on: report where we are, in case the address changed while off.
    if (!off) send();
  }
  // Every second, and at once when a box is tapped (before any typing). The
  // edge colours are checked on the same beat: a new screen inside the site
  // (a chat, the reel viewer) can change them without a page load.
  setInterval(function () {
    if (document.hidden) return;
    check();
    sendColors();
    checkBarCopy();
  }, 1000);
  document.addEventListener('focusin', function (event) {
    var box = event.target;
    if (box && box.matches && box.matches(PASSWORD_BOX)) check();
  }, true);
})();
true;
`;
}
