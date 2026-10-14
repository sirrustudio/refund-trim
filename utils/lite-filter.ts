// Decides what to do with a web address inside Lite. Pure on purpose: no
// React, no storage, no network, so the rules are easy to read and to test.
import type { LiteSite } from '@/utils/lite-sites';

/**
 * allow: load it in Lite · block: show the blocked card · external: open in
 * Safari · ignore: do nothing at all (an "open the real app" link).
 */
export type LiteVerdict = 'allow' | 'block' | 'external' | 'ignore';

type ParsedUrl = { protocol: string; host: string; path: string };

/**
 * A tiny parser instead of the global `URL`: React Native's `URL` has been
 * incomplete in places (some getters throw "not implemented"), and all we
 * need is protocol, host and path.
 */
export function parseLiteUrl(raw: string): ParsedUrl | null {
  const match = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)/i.exec(
    raw.trim(),
  );
  if (!match) return null;
  const protocol = match[1].toLowerCase();
  // Drop "user:pass@" and ":port", lowercase, since hosts ignore case.
  const hostPart = (match[2] ?? '').split('@').pop() ?? '';
  const host = hostPart.replace(/:\d*$/, '').toLowerCase();
  const path = (match[3] || '/').toLowerCase();
  return { protocol, host, path };
}

function hostIsAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

// "/reel" matches "/reel" and "/reel/abc" but not "/reelsomething".
function pathIsBlocked(path: string, blockedPaths: string[]): boolean {
  return blockedPaths.some(
    (blocked) => path === blocked || path.startsWith(`${blocked}/`),
  );
}

/**
 * True on a login page (the site's `noScriptPaths`): Lite's script stays out,
 * so no Refund code runs where a password or 2FA code is typed.
 */
export function isNoScriptUrl(site: LiteSite, url: string): boolean {
  const parsed = parseLiteUrl(url);
  if (!parsed) return false;
  if (!hostIsAllowed(parsed.host, site.allowedHosts)) return false;
  return pathIsBlocked(parsed.path, site.noScriptPaths ?? []);
}

/**
 * True on a page that only opens when you're signed in (the site's
 * `signedInPaths`). Signed out, the site would have sent you to its login page
 * instead, so landing here proves a login happened.
 */
export function isSignedInUrl(site: LiteSite, url: string): boolean {
  const parsed = parseLiteUrl(url);
  if (!parsed) return false;
  if (!hostIsAllowed(parsed.host, site.allowedHosts)) return false;
  return pathIsBlocked(parsed.path, site.signedInPaths ?? []);
}

export function checkLiteUrl(site: LiteSite, url: string): LiteVerdict {
  const parsed = parseLiteUrl(url);
  if (!parsed) return 'external';

  // A blank frame or an inline resource the page makes for itself.
  if (
    parsed.protocol === 'about' ||
    parsed.protocol === 'blob' ||
    parsed.protocol === 'data'
  ) {
    return 'allow';
  }
  // Anything but http(s) (e.g. "instagram://" trying to open the real app) is
  // not ours to load. The screen only hands http(s) links to Safari.
  if (parsed.protocol !== 'https' && parsed.protocol !== 'http') {
    return 'external';
  }

  // Checked before allowedHosts: applink.instagram.com is also an
  // instagram.com host, but it only hands you to the real app.
  if (hostIsAllowed(parsed.host, site.appLinkHosts ?? [])) return 'ignore';
  if (!hostIsAllowed(parsed.host, site.allowedHosts)) return 'external';

  // "Only these" mode (DMs only): anything outside the list is closed.
  if (
    site.onlyPaths &&
    !site.onlyPaths.some(
      (prefix) =>
        parsed.path === prefix || parsed.path.startsWith(`${prefix}/`),
    )
  ) {
    return 'block';
  }

  const blockedByPattern = (site.blockedPathPatterns ?? []).some((pattern) =>
    pattern.test(parsed.path),
  );
  if (blockedByPattern || pathIsBlocked(parsed.path, site.blockedPaths)) {
    return 'block';
  }
  return 'allow';
}
