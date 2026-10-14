// The small script Lite runs inside the page: layers 2 and 3 of its blocking
// (layer 1 is the web view's own check of every full page load).
//
// Why it's needed: Instagram is a "single-page app". Tapping
// Reels often loads NO new page: the site's JavaScript swaps the screen and
// changes the address. The web view's normal "should I load this?" check only
// sees full loads, so this script reports every address change back to us.
import type { LiteSite } from '@/utils/lite-sites';

export type LiteMessage = { type: 'nav'; url: string } | { type: 'reelLimit' };

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

/** Reads a message from the page. Anything unexpected returns null. */
export function parseLiteMessage(raw: string): LiteMessage | null {
  try {
    const data = JSON.parse(raw) as { type?: unknown; url?: unknown };
    if (data.type === 'reelLimit') return { type: 'reelLimit' };
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
 * Builds the injected script for one site. Only the address (`location.href`)
 * is sent back — never page content, never anything typed.
 */
export function buildLiteInjection(
  site: LiteSite,
  options: { reelLimit: number },
): string {
  const hideRule = site.hideSelectors.length
    ? `${site.hideSelectors.join(',')}{display:none !important;}`
    : '';
  // A whole number 0-99 only, since it is written into the script text.
  const reelLimit = Math.max(0, Math.min(99, Math.floor(options.reelLimit) || 0));
  // JSON.stringify makes the CSS a safe JS string literal.
  const css = JSON.stringify(hideRule);
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

  // The off switch. Removing the style is what makes it visible: the hidden
  // buttons come back while the box is there.
  function check() {
    var boxShown = !!document.querySelector(PASSWORD_BOX);
    if (boxShown === off) return;
    off = boxShown;
    if (style) {
      if (off && style.parentNode) style.parentNode.removeChild(style);
      if (!off) (document.head || document.documentElement).appendChild(style);
    }
    // Back on: report where we are, in case the address changed while off.
    if (!off) send();
  }
  // Every second, and at once when a box is tapped (before any typing).
  setInterval(function () {
    if (!document.hidden) check();
  }, 1000);
  document.addEventListener('focusin', function (event) {
    var box = event.target;
    if (box && box.matches && box.matches(PASSWORD_BOX)) check();
  }, true);
})();
true;
`;
}
