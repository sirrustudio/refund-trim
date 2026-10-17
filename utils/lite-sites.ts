// One config per site that Lite can open. Adding a site = one new entry here;
// the filter, the injected script and the screens all read from this list.
//
// Everything below is a rule about WEB ADDRESSES (paths), on purpose: sites
// rename their page code often but their addresses rarely change, so address
// rules break least. If a site changes, this is the only file to fix — and it
// is plain JS, so it can ship as an `eas update`.

// Kill switch. Flip to false and ship an `eas update`: the page beside Today
// (and Today's dots, card and swipe) disappears and nothing else in Refund is
// affected.
export const LITE_APPS_ENABLED = true;

/**
 * What people see the feature called: the page title and Today's card. Code
 * and storage keep saying "lite", so a rename is this one line.
 *
 * No "Instagram" in it on purpose: Meta's brand rules say not to combine the
 * Instagram name with generic words (so not "Trim Instagram"). The page
 * still says "Instagram" where it only describes what opens, which they allow.
 */
export const LITE_FEATURE_NAME = 'Trim';

/**
 * Where "Read the code" (Check it yourself) sends people: the public copy of
 * these files, made by scripts/export-trim.sh and published by
 * scripts/publish-trim.sh (public since Oct 14 2026).
 *
 * Keep the address short: it is printed in capitals on one line of the Check
 * it yourself page, about 8pt a letter. This one (34 letters) fits as is on
 * most iPhones; on the narrow ones (SE, mini) the label shrinks a little.
 */
export const LITE_CODE_URL = 'https://github.com/sirrustudio/refund-trim';

export type LiteSiteId = 'instagram';

/**
 * One switch the user can flip: a set of addresses (and buttons) to close off.
 * It rests on web ADDRESSES, which is why it is safe to offer: no guessing at
 * the page's inner code.
 */
export type LiteOptionalBlock = {
  /** Stored in settings, so never rename one after release. */
  id: string;
  label: string;
  description: string;
  /** Starting position of the switch. */
  defaultOn: boolean;
  /** Shown as "beta" next to the label: address rules not verified yet. */
  beta?: boolean;
  /** Path prefixes closed off (whole path pieces, see LiteSite.blockedPaths). */
  blockedPaths: string[];
  /** For addresses a prefix can't describe, like "/someone/reels/". */
  blockedPathPatterns?: RegExp[];
  /** "Only these": everything else on the site is closed off. */
  allowOnlyPaths?: string[];
  /** Buttons hidden so people aren't tempted. Fragile by nature. */
  hideSelectors: string[];
  /** Replaces the blocked card's line while this switch is on. */
  blockedLine?: string;
};

export type LiteSite = {
  id: LiteSiteId;
  /** Name shown on the list, only to describe what opens (no logos). */
  label: string;
  /** What you can still do, under the name on the page (shown in capitals). */
  blurb: string;
  /** Where the browser opens. */
  startUrl: string;
  /**
   * Hosts the browser may stay on. "instagram.com" also covers
   * "www.instagram.com" and "m.instagram.com". Anything else opens in Safari
   * (so a login handed to another company's domain must be listed here too).
   */
  allowedHosts: string[];
  /**
   * Hosts whose only job is opening the site's real app ("Open app"). Refused
   * outright: not loaded in Lite, and not handed to Safari either, because
   * Safari would pass them on to the app.
   */
  appLinkHosts?: string[];
  /**
   * Path prefixes that are switched off. Matched on whole path pieces:
   * "/reel" blocks "/reel/abc" but not "/reelsomething".
   */
  blockedPaths: string[];
  /** Same as blockedPaths, for shapes a prefix can't describe. */
  blockedPathPatterns?: RegExp[];
  /** When set, ONLY these path prefixes may load (an allow-list). */
  onlyPaths?: string[];
  /** Login pages: Lite's helper script stays off these. */
  noScriptPaths?: string[];
  /**
   * Addresses that only open when you're signed in: signed out, the site sends
   * you to its login page instead (Instagram's inbox does, checked Oct 13).
   * Reaching one retires the first-login help.
   */
  signedInPaths?: string[];
  /**
   * The site has a message viewer that plays reels on top of the conversation
   * WITHOUT changing the address (confirmed on a real phone), so they cannot
   * be blocked by address. The "reels allowed in DMs" limit counts them in the
   * page instead (see lite-inject.ts).
   */
  dmReelViewer?: boolean;
  /** CSS selectors hidden so people aren't tempted. Fragile by nature. */
  hideSelectors: string[];
  /** Switches the user can flip (see LiteOptionalBlock). */
  optionalBlocks?: LiteOptionalBlock[];
  /**
   * The switch the page's "REELS OFF" stamp and line speak for. While it's
   * off, they hide rather than claim something untrue.
   */
  mainBlockId?: string;
  /** Text on the "Back to …" button of the blocked card. */
  safeHomeLabel: string;
  /** What the blocked card says. */
  blockedLine: string;
  /** false = not offered yet (waiting for a real-phone check). */
  shown: boolean;
};

export const LITE_SITES: LiteSite[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    blurb: 'DMs · stories · profile',
    startUrl: 'https://www.instagram.com/direct/inbox/',
    allowedHosts: ['instagram.com'],
    // Each opens the real Instagram app: "Open app" and "See full profile in
    // the app" link to applink (seen on the page Oct 13), and ig.me /
    // instagr.am are short links that Instagram's app claims (their Apple
    // app-link files list com.burbn.instagram, checked Oct 13). Sent to
    // Safari, iPhone would hand them straight to the app.
    appLinkHosts: ['applink.instagram.com', 'ig.me', 'instagr.am'],
    noScriptPaths: ['/accounts/login', '/two_factor', '/challenge'],
    signedInPaths: ['/direct'],
    blockedPaths: [],
    dmReelViewer: true,
    hideSelectors: [
      // The blue "Open app" button (it links to applink.instagram.com).
      'a[href*="applink.instagram.com"]',
      // The "Use the app" bar above the tab bar (home, profile, Explore; seen
      // Oct 15). Its button has no link, so it's matched by shape instead: a
      // Close × next to one lone button. Its button does nothing here anyway
      // (the real app's links are refused). The "Close" label follows the
      // account's language, so in other languages the bar may still show.
      'div:has(> div > div[role="button"] > div > svg[aria-label="Close"]):has(> div > button:only-child)',
    ],
    optionalBlocks: [
      {
        id: 'instagram-reels',
        label: 'Block Reels',
        description: 'Switch off the endless Reels feed.',
        defaultOn: true,
        blockedPaths: ['/reels', '/reel'],
        blockedPathPatterns: [
          // Guess, not verified: the Reels tab on someone's profile.
          /\/reels\/?$/,
          // Instagram's newer address for one reel puts the username first:
          // "/someone/reel/ABC123/". The "/reel" prefix above misses it.
          /^\/[^/]+\/reel\/./,
        ],
        // By link address, not class names, because addresses change less.
        hideSelectors: ['a[href^="/reels"]', 'a[href$="/reels/"]'],
        blockedLine: 'Reels are switched off here.',
      },
      {
        id: 'instagram-explore',
        label: 'Block Explore',
        description: "Switch off Instagram's discovery page.",
        defaultOn: false,
        blockedPaths: ['/explore'],
        hideSelectors: ['a[href^="/explore"]'],
      },
      {
        id: 'instagram-dms-only',
        label: 'DMs only',
        description: 'Only messages open. Everything else is closed.',
        defaultOn: false,
        beta: true,
        blockedPaths: [],
        // Not verified: /accounts, /challenge and /two_factor (the 2FA code
        // page) are kept open so login works.
        allowOnlyPaths: ['/direct', '/accounts', '/challenge', '/two_factor'],
        hideSelectors: [],
        blockedLine: 'Only messages are open here.',
      },
    ],
    mainBlockId: 'instagram-reels',
    safeHomeLabel: 'Back to messages',
    blockedLine: 'That part is switched off here.',
    shown: true,
  },
];

/** The sites listed on the tab. Empty when the kill switch is off. */
export function getShownLiteSites(): LiteSite[] {
  if (!LITE_APPS_ENABLED) return [];
  return LITE_SITES.filter((site) => site.shown);
}

/**
 * The site's rules plus the switches that are on. The filter and the injected
 * script just read the result, so they need no switch logic of their own.
 */
export function applyLiteBlocks(
  site: LiteSite,
  enabledBlockIds: string[],
): LiteSite {
  const on = (site.optionalBlocks ?? []).filter((block) =>
    enabledBlockIds.includes(block.id),
  );
  const onlyPaths = on.flatMap((block) => block.allowOnlyPaths ?? []);
  return {
    ...site,
    blockedPaths: [...site.blockedPaths, ...on.flatMap((b) => b.blockedPaths)],
    blockedPathPatterns: [
      ...(site.blockedPathPatterns ?? []),
      ...on.flatMap((b) => b.blockedPathPatterns ?? []),
    ],
    onlyPaths: onlyPaths.length > 0 ? onlyPaths : site.onlyPaths,
    hideSelectors: [
      ...site.hideSelectors,
      ...on.flatMap((b) => b.hideSelectors),
    ],
    blockedLine:
      [...on].reverse().find((b) => b.blockedLine)?.blockedLine ??
      site.blockedLine,
  };
}

/**
 * Looks a site up from the route param. The param comes from a link, so it is
 * checked against the list rather than trusted. A hidden site (`shown: false`)
 * is refused too, so a link can't open a site whose rules haven't been
 * checked yet.
 */
export function findLiteSite(id: unknown): LiteSite | null {
  if (!LITE_APPS_ENABLED || typeof id !== 'string') return null;
  return LITE_SITES.find((site) => site.id === id && site.shown) ?? null;
}
