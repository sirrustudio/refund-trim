// Per-site config for Lite: the filter, the injected script and the screens
// all read from it. Rules use URL paths wherever possible, since sites rename
// CSS classes far more often than they change URLs.

// Kill switch: false removes Trim from the app (ships as an OTA update).
export const LITE_APPS_ENABLED = true;

/**
 * The user-facing name (code and storage keys still say "lite"). Meta's brand
 * guidelines rule out pairing "Instagram" with generic words like this.
 */
export const LITE_FEATURE_NAME = "Trim";

/** Where "Read the code" links. Shown on one line, so keep it short. */
export const LITE_CODE_URL = "https://github.com/sirrustudio/refund-trim";

export type LiteSiteId = "instagram";

/**
 * A tap on a link to `from` (a path, with or without its trailing slash, and
 * no query) goes to `to` instead, inside the page. Skipped when `to` is
 * blocked, so the tap is blocked instead.
 */
export type LiteLinkRewrite = { from: string; to: string };

/**
 * On these paths, a heading with one of these labels (lower case, exact)
 * between posts hides itself and every feed item after it. Only short text
 * outside posts, links and buttons is read.
 */
export type LiteHiddenPosts = { paths: string[]; labels: string[] };

/** A switch the user can flip in settings. */
export type LiteOptionalBlock = {
  /** Saved in settings: never rename one after release. */
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
  /** Shows a "beta" tag: the rules aren't fully verified. */
  beta?: boolean;
  blockedPaths: string[];
  blockedPathPatterns?: RegExp[];
  /** Allow-list mode: everything else on the site is blocked. */
  allowOnlyPaths?: string[];
  hideSelectors: string[];
  linkRewrites?: LiteLinkRewrite[];
  hidePosts?: LiteHiddenPosts;
  /** Replaces the blocked card's text while this switch is on. */
  blockedLine?: string;
  /** This switch controls the bar copy (see LiteBarCopy). */
  turnsOnBarCopy?: boolean;
};

/**
 * Instagram's website has no bottom bar on the chat list, so the only way out
 * is back. There, the injected script draws a copy of the site's own bar,
 * saved in the page's storage from the last one it saw. The app never reads it.
 */
export type LiteBarCopy = {
  /** A link only the site's bottom bar contains. */
  siteBarAnchor: string;
  copyOnPaths: string[];
  /** A link that's removed when something opens over the list (a note). */
  listAnchor?: string;
};

export type LiteSite = {
  id: LiteSiteId;
  /** Display name. Text only, no logos. */
  label: string;
  /** What you can still do, shown under the name. */
  blurb: string;
  startUrl: string;
  /** Subdomains included. Any other host opens in Safari. */
  allowedHosts: string[];
  /** Hosts that only open the native app. Ignored, since Safari would too. */
  appLinkHosts?: string[];
  /** Whole segments: "/reel" blocks "/reel/abc" but not "/reelsomething". */
  blockedPaths: string[];
  blockedPathPatterns?: RegExp[];
  /** If set, only these path prefixes may load. */
  onlyPaths?: string[];
  /** Login pages. The injected script never runs on these. */
  noScriptPaths?: string[];
  /** Paths that only load when signed in. Reaching one retires the login help. */
  signedInPaths?: string[];
  /** Reels play in a DM viewer that doesn't change the URL (see lite-inject.ts). */
  dmReelViewer?: boolean;
  /** CSS selectors for links to hide. These break when the site's markup changes. */
  hideSelectors: string[];
  /** CSS rules that move things. Removed with the hide rules on login forms. */
  styleRules?: string[];
  linkRewrites?: LiteLinkRewrite[];
  hidePosts?: LiteHiddenPosts;
  /**
   * Matches only once the site's own interface is drawn. The app keeps its
   * loading cover up until then, instead of showing the site's loading screens.
   */
  readySelector?: string;
  /**
   * A link only the site's own bottom bar contains. The script gives that bar
   * the page's background, since some pages (search) draw it see-through.
   */
  siteBarAnchor?: string;
  barCopy?: LiteBarCopy;
  optionalBlocks?: LiteOptionalBlock[];
  /** The switch the "REELS OFF" stamp refers to; the stamp hides while it's off. */
  mainBlockId?: string;
  /** Label of the blocked card's "Back to …" button. */
  safeHomeLabel: string;
  blockedLine: string;
  /** false hides the site until its rules have been tested on a phone. */
  shown: boolean;
};

export const LITE_SITES: LiteSite[] = [
  {
    id: "instagram",
    label: "Instagram",
    blurb: "DMs · stories · profile",
    startUrl: "https://www.instagram.com/direct/inbox/",
    allowedHosts: ["instagram.com"],
    // "Open app" links go to applink; Instagram's app claims the two short
    // domains in their apple-app-site-association files.
    appLinkHosts: ["applink.instagram.com", "ig.me", "instagr.am"],
    noScriptPaths: ["/accounts/login", "/two_factor", "/challenge"],
    signedInPaths: ["/direct"],
    blockedPaths: [],
    dmReelViewer: true,
    hideSelectors: [
      'a[href*="applink.instagram.com"]',
      // The "Use the app" banner. Its button has no href, so it's matched by
      // structure. "Close" is localized, so other languages may still see it.
      'div:has(> div > div[role="button"] > div > svg[aria-label="Close"]):has(> div > button:only-child)',
    ],
    styleRules: [
      // Moves the profile's settings gear to the top right, as in the app,
      // and keeps both icons against the screen edges.
      'header > div:has(> div > a[href^="/accounts/settings/"]){flex-direction:row-reverse !important;}',
      'header > div:has(> div > a[href^="/accounts/settings/"]) > div:has(> a[href^="/accounts/settings/"]){justify-content:flex-end !important;}',
      'header > div:has(> div > a[href^="/accounts/settings/"]) > div:last-child{justify-content:flex-start !important;}',
    ],
    // The chat list and the bottom bar both link to messages; the loading
    // screens before them have no links.
    readySelector: 'a[href^="/direct/"]',
    siteBarAnchor: 'a[href="/direct/inbox/"]',
    barCopy: {
      siteBarAnchor: 'a[href="/direct/inbox/"]',
      // Chats and message requests get the full screen, as in the app.
      copyOnPaths: ["/direct/inbox"],
      // Either link counts: Requests isn't on every account's list.
      listAnchor: 'a[href^="/direct/new"],a[href^="/direct/requests"]',
    },
    optionalBlocks: [
      {
        id: "instagram-reels",
        label: "Block Reels",
        description: "Switch off the endless Reels feed.",
        defaultOn: true,
        blockedPaths: ["/reels", "/reel"],
        blockedPathPatterns: [
          // Unverified: the Reels tab on a profile.
          /\/reels\/?$/,
          // Matches "/someone/reel/ABC123/", which the "/reel" prefix misses.
          /^\/[^/]+\/reel\/./,
        ],
        hideSelectors: ['a[href^="/reels"]', 'a[href$="/reels/"]'],
        blockedLine: "Reels are switched off here.",
      },
      {
        id: "instagram-explore",
        label: "Block Explore",
        description: "Switch off the Explore grid. Search still works.",
        defaultOn: false,
        beta: true,
        blockedPaths: [],
        blockedPathPatterns: [
          // The grid, and the grids behind hashtags, places and keyword
          // searches (mostly reels).
          /^\/explore\/?$/,
          /^\/explore\/(tags|locations|search\/keyword)(\/|$)/,
        ],
        // The search button opens the grid with a search box on top; this
        // opens the search page instead.
        linkRewrites: [{ from: "/explore", to: "/explore/search/" }],
        hideSelectors: [],
        blockedLine: "Explore is switched off here.",
      },
      {
        id: "instagram-hide-suggested",
        label: "Hide suggested posts",
        description: "Home keeps your stories and the people you follow.",
        defaultOn: true,
        beta: true,
        blockedPaths: [],
        // Home keeps its stories; the posts after Instagram's "Suggested
        // posts" heading go. Not "Suggested for you": that heading also sits
        // over the people-to-follow row mid-feed. English only.
        hidePosts: { paths: ["/"], labels: ["suggested posts"] },
        hideSelectors: [],
      },
      {
        id: "instagram-dms-only",
        label: "DMs only",
        description: "Only messages open. Everything else is closed.",
        defaultOn: false,
        beta: true,
        blockedPaths: [],
        // The login pages stay open. Unverified.
        allowOnlyPaths: ["/direct", "/accounts", "/challenge", "/two_factor"],
        hideSelectors: [],
        blockedLine: "Only messages are open here.",
      },
      {
        // Not a block: switches the bar copy (barCopy above).
        id: "instagram-dm-bar",
        label: "Bar in DMs",
        description: "Instagram's bottom bar on your chat list too.",
        defaultOn: true,
        beta: true,
        blockedPaths: [],
        hideSelectors: [],
        turnsOnBarCopy: true,
      },
    ],
    mainBlockId: "instagram-reels",
    safeHomeLabel: "Back to messages",
    blockedLine: "That part is switched off here.",
    shown: true,
  },
];

/** Sites listed on the Trim page. Empty when the kill switch is off. */
export function getShownLiteSites(): LiteSite[] {
  if (!LITE_APPS_ENABLED) return [];
  return LITE_SITES.filter((site) => site.shown);
}

/** Merges the switches that are on into the site's rules. */
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
    linkRewrites: [
      ...(site.linkRewrites ?? []),
      ...on.flatMap((b) => b.linkRewrites ?? []),
    ],
    hidePosts: on.find((b) => b.hidePosts)?.hidePosts ?? site.hidePosts,
    blockedLine:
      [...on].reverse().find((b) => b.blockedLine)?.blockedLine ??
      site.blockedLine,
    // No bar copy in allow-list mode: most of its buttons would be blocked.
    barCopy:
      onlyPaths.length === 0 &&
      (!site.optionalBlocks?.some((b) => b.turnsOnBarCopy) ||
        on.some((b) => b.turnsOnBarCopy))
        ? site.barCopy
        : undefined,
  };
}

/** Looks up a site from a route param. Hidden sites are refused. */
export function findLiteSite(id: unknown): LiteSite | null {
  if (!LITE_APPS_ENABLED || typeof id !== "string") return null;
  return LITE_SITES.find((site) => site.id === id && site.shown) ?? null;
}
