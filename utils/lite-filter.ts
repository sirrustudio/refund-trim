// Decides what happens to a URL in Lite. No React, storage or network, so the
// rules are easy to read and test.
import type { LiteSite } from "@/utils/lite-sites";

/**
 * - allow: load it in Lite
 * - block: show the blocked card
 * - external: open in Safari
 * - ignore: do nothing (a link that opens the native app)
 */
export type LiteVerdict = "allow" | "block" | "external" | "ignore";

type ParsedUrl = { protocol: string; host: string; path: string };

/**
 * A minimal URL parser. React Native's URL implementation is incomplete (some
 * getters throw "not implemented"), and only protocol, host and path are
 * needed.
 */
export function parseLiteUrl(raw: string): ParsedUrl | null {
  const match = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)/i.exec(
    raw.trim(),
  );
  if (!match) return null;
  const protocol = match[1].toLowerCase();
  // Drop "user:pass@" and ":port"; hosts are case-insensitive.
  const hostPart = (match[2] ?? "").split("@").pop() ?? "";
  const host = hostPart.replace(/:\d*$/, "").toLowerCase();
  const path = (match[3] || "/").toLowerCase();
  return { protocol, host, path };
}

function hostIsAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

// Whole segments: "/reel" matches "/reel" and "/reel/abc", not "/reelsomething".
function pathIsBlocked(path: string, blockedPaths: string[]): boolean {
  return blockedPaths.some(
    (blocked) => path === blocked || path.startsWith(`${blocked}/`),
  );
}

/** True on a login page (noScriptPaths), where the injected script must not run. */
export function isNoScriptUrl(site: LiteSite, url: string): boolean {
  const parsed = parseLiteUrl(url);
  if (!parsed) return false;
  if (!hostIsAllowed(parsed.host, site.allowedHosts)) return false;
  return pathIsBlocked(parsed.path, site.noScriptPaths ?? []);
}

/**
 * True on a page that only loads when signed in (signedInPaths). Signed out,
 * the site would have redirected to its login page, so reaching one means
 * the user has logged in.
 */
export function isSignedInUrl(site: LiteSite, url: string): boolean {
  const parsed = parseLiteUrl(url);
  if (!parsed) return false;
  if (!hostIsAllowed(parsed.host, site.allowedHosts)) return false;
  return pathIsBlocked(parsed.path, site.signedInPaths ?? []);
}

export function checkLiteUrl(site: LiteSite, url: string): LiteVerdict {
  const parsed = parseLiteUrl(url);
  if (!parsed) return "external";

  // Frames and resources the page creates itself.
  if (
    parsed.protocol === "about" ||
    parsed.protocol === "blob" ||
    parsed.protocol === "data"
  ) {
    return "allow";
  }
  // Other schemes (like instagram://, which opens the native app) are never
  // loaded here. The screen only passes http(s) links on to Safari.
  if (parsed.protocol !== "https" && parsed.protocol !== "http") {
    return "external";
  }

  // Before allowedHosts: applink.instagram.com is an instagram.com subdomain,
  // but it only opens the native app.
  if (hostIsAllowed(parsed.host, site.appLinkHosts ?? [])) return "ignore";
  if (!hostIsAllowed(parsed.host, site.allowedHosts)) return "external";

  // Allow-list mode (DMs only).
  if (
    site.onlyPaths &&
    !site.onlyPaths.some(
      (prefix) =>
        parsed.path === prefix || parsed.path.startsWith(`${prefix}/`),
    )
  ) {
    return "block";
  }

  const blockedByPattern = (site.blockedPathPatterns ?? []).some((pattern) =>
    pattern.test(parsed.path),
  );
  if (blockedByPattern || pathIsBlocked(parsed.path, site.blockedPaths)) {
    return "block";
  }
  return "allow";
}
